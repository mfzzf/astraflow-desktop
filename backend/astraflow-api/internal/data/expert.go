package data

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type expertRepo struct {
	data               *Data
	artifactCache      expertArtifactCache
	artifactURLAllowed func(string) bool
}

type localizedTextPO struct {
	Zh string `json:"Zh"`
	En string `json:"En"`
}

func (text *localizedTextPO) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err == nil {
		if hasCJK(value) {
			text.Zh = value
		} else {
			text.En = value
		}
		return nil
	}

	type localizedTextAlias localizedTextPO
	var localized localizedTextAlias
	if err := json.Unmarshal(data, &localized); err != nil {
		return err
	}
	*text = localizedTextPO(localized)
	return nil
}

type expertMemberPO struct {
	ID         string          `json:"Id"`
	AgentName  string          `json:"AgentName"`
	Name       localizedTextPO `json:"Name"`
	Profession localizedTextPO `json:"Profession"`
	Role       string          `json:"Role"`
	AvatarURL  string          `json:"AvatarUrl"`
	PromptPath string          `json:"PromptPath"`
}

type expertTeamInfoPO struct {
	LeadAgent    string   `json:"LeadAgent"`
	MemberAgents []string `json:"MemberAgents"`
}

type expertSkillPO struct {
	Name        localizedTextPO `json:"Name"`
	Path        string          `json:"Path"`
	Description localizedTextPO `json:"Description"`
}

type expertArtifactPO struct {
	Revision    string `json:"Revision"`
	Source      string `json:"Source"`
	ArchiveURL  string `json:"ArchiveUrl"`
	PreviewURL  string `json:"PreviewUrl"`
	ManifestURL string `json:"ManifestUrl"`
	IconURL     string `json:"IconUrl"`
	Checksum    string `json:"Checksum"`
	FileCount   int32  `json:"FileCount"`
	SizeBytes   int64  `json:"SizeBytes"`
}

type expertPO struct {
	SourceID          string            `json:"SourceId"`
	Slug              string            `json:"Slug"`
	Plugin            string            `json:"Plugin"`
	Version           string            `json:"Version"`
	Type              string            `json:"Type"`
	Status            string            `json:"Status"`
	DisplayName       localizedTextPO   `json:"DisplayName"`
	Profession        localizedTextPO   `json:"Profession"`
	Description       localizedTextPO   `json:"Description"`
	CategoryID        string            `json:"CategoryId"`
	Category          localizedTextPO   `json:"Category"`
	Tags              []localizedTextPO `json:"Tags"`
	QuickPrompts      []localizedTextPO `json:"QuickPrompts"`
	DefaultInitPrompt localizedTextPO   `json:"DefaultInitPrompt"`
	Author            string            `json:"Author"`
	OperationalTag    localizedTextPO   `json:"OperationalTag"`
	Visibility        string            `json:"Visibility"`
	IsOPC             bool              `json:"IsOPC"`
	DisplayPosition   int32             `json:"DisplayPosition"`
	PrimaryAgent      string            `json:"PrimaryAgent"`
	Members           []expertMemberPO  `json:"Members"`
	MemberCount       int32             `json:"MemberCount"`
	Team              *expertTeamInfoPO `json:"Team"`
	Skills            []expertSkillPO   `json:"Skills"`
	Artifact          expertArtifactPO  `json:"Artifact"`
	Compatibility     []string          `json:"Compatibility"`
	UpstreamUpdatedAt int64             `json:"UpstreamUpdatedAt"`
	UpstreamCreatedAt int64             `json:"UpstreamCreatedAt"`
	SyncedAt          int64             `json:"SyncedAt"`
}

type expertCategoryPO struct {
	ID          string          `json:"Id"`
	Name        localizedTextPO `json:"Name"`
	Description localizedTextPO `json:"Description"`
	Sort        int32           `json:"Sort"`
	UpdatedAt   int64           `json:"UpdatedAt"`
}

type describeExpertMarketResponsePO struct {
	ucloudResponseBase
	TotalCount    int32              `json:"TotalCount"`
	Experts       []expertPO         `json:"Experts"`
	AllCategories []expertCategoryPO `json:"AllCategories"`
}

type describeExpertDetailResponsePO struct {
	ucloudResponseBase
	Expert   expertPO `json:"Expert"`
	ExpertMd string   `json:"ExpertMd"`
}

func NewExpertRepo(data *Data) biz.ExpertRepo {
	return &expertRepo{
		data:               data,
		artifactURLAllowed: isTrustedExpertArtifactURL,
	}
}

func (r *expertRepo) ListCategories(ctx context.Context) ([]*biz.ExpertCategory, *biz.ExpertCatalogMeta, error) {
	response, err := r.describeExpertMarket(ctx, biz.ExpertListFilter{PageSize: 1})
	if err != nil {
		return nil, nil, err
	}

	categories := make([]*biz.ExpertCategory, 0, len(response.AllCategories))
	for _, category := range response.AllCategories {
		categories = append(categories, toBizExpertCategory(category))
	}

	return categories, expertCatalogMeta(response.Experts, response.AllCategories), nil
}

func (r *expertRepo) ListExperts(ctx context.Context, filter biz.ExpertListFilter) (*biz.ExpertListResult, error) {
	offset, err := biz.OffsetFromPageToken(filter.PageToken)
	if err != nil {
		return nil, kerrors.BadRequest(v1.ErrorReason_INVALID_ARGUMENT.String(), err.Error())
	}

	response, err := r.describeExpertMarket(ctx, biz.ExpertListFilter{
		PageSize:   filter.PageSize,
		PageToken:  strconv.FormatInt(int64(offset), 10),
		CategoryID: filter.CategoryID,
		Type:       filter.Type,
		Query:      filter.Query,
	})
	if err != nil {
		return nil, err
	}

	experts := make([]*biz.ExpertListItem, 0, len(response.Experts))
	for _, expert := range response.Experts {
		experts = append(experts, toBizExpertListItem(expert))
	}

	meta := expertCatalogMeta(response.Experts, response.AllCategories)
	nextPageToken := ""
	if len(experts) > 0 && int64(offset)+int64(len(experts)) < int64(response.TotalCount) {
		nextPageToken = strconv.FormatInt(int64(offset)+int64(len(experts)), 10)
	}

	return &biz.ExpertListResult{
		Experts:        experts,
		NextPageToken:  nextPageToken,
		TotalSize:      response.TotalCount,
		CatalogVersion: meta.Version,
		CatalogHash:    meta.Hash,
		UpdatedAt:      meta.Updated,
	}, nil
}

func (r *expertRepo) GetExpert(ctx context.Context, expertID string) (*biz.ExpertDetail, error) {
	response, err := r.describeExpertDetail(ctx, expertID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(response.Expert.Slug) == "" {
		return nil, kerrors.NotFound("EXPERT_NOT_FOUND", "expert not found")
	}

	artifact, err := r.loadExpertArtifact(ctx, response.Expert)
	if err != nil {
		return nil, err
	}
	return toBizExpertDetail(response.Expert, response.ExpertMd, artifact), nil
}

func (r *expertRepo) GetExpertRuntime(ctx context.Context, expertID string) (*biz.ExpertRuntime, error) {
	response, err := r.describeExpertDetail(ctx, expertID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(response.Expert.Slug) == "" {
		return nil, kerrors.NotFound("EXPERT_NOT_FOUND", "expert not found")
	}

	artifact, err := r.loadExpertArtifact(ctx, response.Expert)
	if err != nil {
		return nil, err
	}
	detail := toBizExpertDetail(response.Expert, response.ExpertMd, artifact)
	if !expertRuntimeAvailable(detail.Summary) || len(detail.Agents) == 0 {
		return nil, kerrors.BadRequest("EXPERT_RUNTIME_UNAVAILABLE", "expert runtime is unavailable")
	}

	team := toBizExpertTeam(response.Expert)

	return &biz.ExpertRuntime{
		Expert: biz.ExpertRuntimeSummary{
			ID:          detail.Summary.ID,
			Type:        detail.Summary.Type,
			RuntimeHash: detail.Summary.RuntimeHash,
			DisplayName: biz.LocalizedText{
				Zh: detail.Summary.DisplayNameZh,
				En: detail.Summary.DisplayNameEn,
			},
			Profession: biz.LocalizedText{
				Zh: detail.Summary.ProfessionZh,
				En: detail.Summary.ProfessionEn,
			},
			DefaultInitPrompt: detail.DefaultInitPrompt,
		},
		Agents:     detail.Agents,
		Team:       team,
		Skills:     detail.Skills,
		McpServers: detail.McpServers,
		Policy: biz.ExpertRuntimePolicy{
			AllowRawPromptDisplay: false,
			ToolScope:             "declared",
		},
	}, nil
}

func (r *expertRepo) describeExpertMarket(ctx context.Context, filter biz.ExpertListFilter) (*describeExpertMarketResponsePO, error) {
	offset, err := biz.OffsetFromPageToken(filter.PageToken)
	if err != nil {
		return nil, kerrors.BadRequest(v1.ErrorReason_INVALID_ARGUMENT.String(), err.Error())
	}

	params := map[string]any{
		"Action":          "DescribeExpertMarket",
		"Backend":         "DevPortal",
		"Keyword":         strings.TrimSpace(filter.Query),
		"Category":        expertFilterSlice(filter.CategoryID),
		"ExpertType":      expertTypeFilterSlice(filter.Type),
		"ExcludeKeywords": []string{},
		"Offset":          offset,
		"Limit":           filter.PageSize,
	}
	var response describeExpertMarketResponsePO
	if err := callPublicUCloudAction(ctx, r.data, params, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func (r *expertRepo) describeExpertDetail(ctx context.Context, slug string) (*describeExpertDetailResponsePO, error) {
	params := map[string]any{
		"Action":  "DescribeExpertDetail",
		"Backend": "DevPortal",
		"Slug":    strings.TrimSpace(slug),
	}
	var response describeExpertDetailResponsePO
	if err := callPublicUCloudAction(ctx, r.data, params, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func expertFilterSlice(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return []string{}
	}
	return []string{value}
}

func expertTypeFilterSlice(value string) []string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "agent":
		return []string{"agent"}
	case "team":
		return []string{"team"}
	default:
		return []string{}
	}
}

func toBizExpertCategory(category expertCategoryPO) *biz.ExpertCategory {
	return &biz.ExpertCategory{
		ID:            category.ID,
		NameZh:        category.Name.Zh,
		NameEn:        category.Name.En,
		DescriptionZh: category.Description.Zh,
		DescriptionEn: category.Description.En,
		SortOrder:     category.Sort,
		UpdatedAt:     unixTime(category.UpdatedAt),
	}
}

func toBizExpertListItem(expert expertPO) *biz.ExpertListItem {
	status := strings.ToLower(strings.TrimSpace(expert.Status))
	promptCount := int32(0)

	memberCount := expert.MemberCount
	if memberCount == 0 {
		memberCount = int32(len(expert.Members))
	}
	if status == biz.ExpertStatusComplete {
		promptCount = memberCount
		if promptCount == 0 {
			promptCount = 1
		}
	}

	item := &biz.ExpertListItem{
		ID:                expert.Slug,
		Slug:              expert.Slug,
		Source:            expert.SourceID,
		SourceFolder:      expert.Plugin,
		Type:              strings.ToLower(strings.TrimSpace(expert.Type)),
		Status:            status,
		CategoryID:        expert.CategoryID,
		DisplayNameZh:     expert.DisplayName.Zh,
		DisplayNameEn:     expert.DisplayName.En,
		ProfessionZh:      expert.Profession.Zh,
		ProfessionEn:      expert.Profession.En,
		DescriptionZh:     expert.Description.Zh,
		DescriptionEn:     expert.Description.En,
		AvatarPath:        expert.Artifact.IconURL,
		Tags:              toBizLocalizedTexts(expert.Tags),
		QuickPrompts:      toBizLocalizedTexts(expert.QuickPrompts),
		PromptCount:       promptCount,
		SkillCount:        int32(len(expert.Skills)),
		MemberCount:       memberCount,
		RuntimeHash:       expertRuntimeHash(expert),
		UpdatedAt:         latestUnixTime(expert.UpstreamUpdatedAt, expert.SyncedAt),
		UnavailableReason: status,
	}
	item.RuntimeAvailable = expertRuntimeAvailable(item)
	if item.RuntimeAvailable {
		item.UnavailableReason = ""
	}
	return item
}

func toBizExpertDetail(expert expertPO, expertMd string, artifact *expertArtifactRuntime) *biz.ExpertDetail {
	summary := toBizExpertListItem(expert)
	agents := toBizExpertAgents(expert, artifact)
	skills := toBizExpertSkills(expert, artifact)
	mcpServers := toBizExpertMcpServers(expert, artifact)
	members := toBizExpertTeamMembers(expert)
	summary.PromptCount = int32(len(agents))
	summary.SkillCount = int32(len(skills))
	summary.McpCount = int32(len(mcpServers))
	summary.RuntimeAvailable = expertRuntimeAvailable(summary)
	if summary.RuntimeAvailable {
		summary.UnavailableReason = ""
	} else {
		summary.UnavailableReason = summary.Status
	}
	catalogHash := biz.CatalogHash([]string{
		expert.Slug,
		expert.Version,
		summary.RuntimeHash,
		contentHash(expertMd),
		summary.UpdatedAt.UTC().Format(time.RFC3339Nano),
	})

	return &biz.ExpertDetail{
		Summary: summary,
		DefaultInitPrompt: biz.LocalizedText{
			Zh: expert.DefaultInitPrompt.Zh,
			En: expert.DefaultInitPrompt.En,
		},
		Agents:       agents,
		Skills:       skills,
		McpServers:   mcpServers,
		TeamMembers:  members,
		SourcePlugin: expert.Plugin,
		CatalogHash:  catalogHash,
	}
}

func toBizExpertAgents(expert expertPO, artifact *expertArtifactRuntime) []*biz.ExpertAgent {
	if artifact == nil || len(artifact.AgentPrompts) == 0 {
		return []*biz.ExpertAgent{}
	}

	skillNames := make([]string, 0, len(expert.Skills))
	for _, skill := range expert.Skills {
		if name := expertSkillSlug(skill); name != "" {
			skillNames = append(skillNames, name)
		}
	}

	agents := make([]*biz.ExpertAgent, 0, len(artifact.AgentPrompts))
	leadAgent := firstNonEmpty(teamLeadAgent(expert), expert.PrimaryAgent, expert.Slug)
	for index, prompt := range artifact.AgentPrompts {
		member := findExpertMember(expert.Members, prompt.AgentName)
		role := "single"
		if strings.EqualFold(expert.Type, "team") {
			if prompt.AgentName == leadAgent {
				role = "lead"
			} else {
				role = "member"
			}
		}
		displayName := expert.DisplayName
		profession := expert.Profession
		if member != nil {
			role = firstNonEmpty(member.Role, role)
			displayName = member.Name
			profession = member.Profession
		}
		agents = append(agents, &biz.ExpertAgent{
			ID:             expert.Slug + ":" + prompt.AgentName,
			ExpertID:       expert.Slug,
			AgentName:      prompt.AgentName,
			Role:           role,
			DisplayNameZh:  displayName.Zh,
			DisplayNameEn:  displayName.En,
			ProfessionZh:   profession.Zh,
			ProfessionEn:   profession.En,
			Description:    firstNonEmpty(expert.Description.Zh, expert.Description.En),
			PromptMarkdown: prompt.Markdown,
			Skills:         skillNames,
			SortOrder:      int32(index),
			ContentHash:    contentHash(prompt.Markdown),
		})
	}
	return agents
}

func toBizExpertSkills(expert expertPO, artifact *expertArtifactRuntime) []*biz.ExpertSkill {
	skills := make([]*biz.ExpertSkill, 0, len(expert.Skills))
	usedPaths := make(map[string]struct{})
	for index, skill := range expert.Skills {
		slug := expertSkillSlug(skill)
		markdown, artifactPath := artifactSkillMarkdown(artifact, skill.Path, slug)
		if artifactPath != "" {
			usedPaths[artifactPath] = struct{}{}
		}
		metadata, _ := json.Marshal(map[string]any{
			"name":        skill.Name,
			"path":        skill.Path,
			"description": skill.Description,
		})
		hashInput := strings.Join([]string{
			slug,
			skill.Path,
			skill.Name.Zh,
			skill.Name.En,
			skill.Description.Zh,
			skill.Description.En,
		}, "\n")
		skills = append(skills, &biz.ExpertSkill{
			ID:            fmt.Sprintf("%s:%s:%d", expert.Slug, slug, index),
			ExpertID:      expert.Slug,
			SkillSlug:     slug,
			RelativePath:  skill.Path,
			Title:         firstNonEmpty(skill.Name.Zh, skill.Name.En, slug),
			Description:   firstNonEmpty(skill.Description.Zh, skill.Description.En),
			SkillMarkdown: markdown,
			MetadataJSON:  string(metadata),
			ContentHash:   contentHash(hashInput + "\n" + markdown),
		})
	}
	if artifact != nil {
		for _, file := range artifact.SkillFiles {
			if _, exists := usedPaths[file.Path]; exists {
				continue
			}
			slug := path.Base(path.Dir(file.Path))
			skills = append(skills, &biz.ExpertSkill{
				ID:            fmt.Sprintf("%s:%s:%d", expert.Slug, slug, len(skills)),
				ExpertID:      expert.Slug,
				SkillSlug:     slug,
				RelativePath:  file.Path,
				Title:         slug,
				SkillMarkdown: file.Markdown,
				MetadataJSON:  "{}",
				ContentHash:   contentHash(file.Markdown),
			})
		}
	}
	return skills
}

func toBizExpertMcpServers(expert expertPO, artifact *expertArtifactRuntime) []*biz.ExpertMcpServer {
	if artifact == nil {
		return []*biz.ExpertMcpServer{}
	}
	servers := make([]*biz.ExpertMcpServer, 0, len(artifact.McpFiles))
	for index, file := range artifact.McpFiles {
		var manifest struct {
			McpServers map[string]json.RawMessage `json:"mcpServers"`
			Servers    map[string]json.RawMessage `json:"servers"`
		}
		_ = json.Unmarshal([]byte(file.JSON), &manifest)
		serverCount := len(manifest.McpServers)
		if serverCount == 0 {
			serverCount = len(manifest.Servers)
		}
		servers = append(servers, &biz.ExpertMcpServer{
			ID:           fmt.Sprintf("%s:mcp:%d", expert.Slug, index),
			ExpertID:     expert.Slug,
			RelativePath: file.Path,
			McpJSON:      file.JSON,
			ServerCount:  int32(serverCount),
			ContentHash:  contentHash(file.JSON),
		})
	}
	return servers
}

func toBizExpertTeamMembers(expert expertPO) []*biz.ExpertTeamMember {
	members := make([]*biz.ExpertTeamMember, 0, len(expert.Members))
	for index, member := range expert.Members {
		agentName := firstNonEmpty(member.AgentName, member.ID)
		memberID := firstNonEmpty(member.ID, expert.Slug+":"+agentName)
		members = append(members, &biz.ExpertTeamMember{
			ID:            memberID,
			ExpertID:      expert.Slug,
			AgentName:     agentName,
			Role:          member.Role,
			DisplayNameZh: member.Name.Zh,
			DisplayNameEn: member.Name.En,
			ProfessionZh:  member.Profession.Zh,
			ProfessionEn:  member.Profession.En,
			AvatarPath:    member.AvatarURL,
			SortOrder:     int32(index),
		})
	}
	return members
}

func toBizExpertTeam(expert expertPO) biz.ExpertTeam {
	leadAgent := firstNonEmpty(teamLeadAgent(expert), expert.PrimaryAgent, expert.Slug)
	memberAgents := make([]string, 0)
	if expert.Team != nil {
		memberAgents = append(memberAgents, expert.Team.MemberAgents...)
	}
	if len(memberAgents) == 0 {
		for _, member := range expert.Members {
			agentName := strings.TrimSpace(member.AgentName)
			if agentName != "" && agentName != leadAgent {
				memberAgents = append(memberAgents, agentName)
			}
		}
	}
	return biz.ExpertTeam{
		LeadAgent:    leadAgent,
		MemberAgents: uniqueStrings(memberAgents),
	}
}

func teamLeadAgent(expert expertPO) string {
	if expert.Team == nil {
		return ""
	}
	return expert.Team.LeadAgent
}

func findExpertMember(members []expertMemberPO, agentName string) *expertMemberPO {
	for index := range members {
		if members[index].AgentName == agentName || members[index].ID == agentName {
			return &members[index]
		}
	}
	return nil
}

func expertSkillSlug(skill expertSkillPO) string {
	if name := firstNonEmpty(skill.Name.En, skill.Name.Zh); name != "" {
		return name
	}
	parent := path.Base(path.Dir(strings.TrimSpace(skill.Path)))
	if parent != "." && parent != "/" {
		return parent
	}
	return strings.TrimSuffix(path.Base(strings.TrimSpace(skill.Path)), path.Ext(skill.Path))
}

func expertRuntimeHash(expert expertPO) string {
	if checksum := strings.TrimSpace(expert.Artifact.Checksum); checksum != "" {
		return checksum
	}
	return biz.CatalogHash([]string{
		expert.Slug,
		expert.Version,
		expert.Artifact.Revision,
		strconv.FormatInt(expert.UpstreamUpdatedAt, 10),
		strconv.FormatInt(expert.SyncedAt, 10),
	})
}

func expertRuntimeAvailable(expert *biz.ExpertListItem) bool {
	return expert != nil &&
		(expert.Status == biz.ExpertStatusComplete || expert.Status == biz.ExpertStatusDownloaded) &&
		expert.RuntimeHash != "" &&
		expert.PromptCount > 0
}

func expertCatalogMeta(experts []expertPO, categories []expertCategoryPO) *biz.ExpertCatalogMeta {
	parts := make([]string, 0, len(experts)+len(categories))
	var latest time.Time

	for _, expert := range experts {
		updatedAt := latestUnixTime(expert.UpstreamUpdatedAt, expert.SyncedAt)
		if updatedAt.After(latest) {
			latest = updatedAt
		}
		parts = append(parts, strings.Join([]string{
			"expert",
			expert.Slug,
			expert.Version,
			expertRuntimeHash(expert),
			updatedAt.UTC().Format(time.RFC3339Nano),
		}, ":"))
	}
	for _, category := range categories {
		updatedAt := unixTime(category.UpdatedAt)
		if updatedAt.After(latest) {
			latest = updatedAt
		}
		parts = append(parts, strings.Join([]string{
			"category",
			category.ID,
			category.Name.Zh,
			category.Name.En,
			strconv.FormatInt(int64(category.Sort), 10),
			updatedAt.UTC().Format(time.RFC3339Nano),
		}, ":"))
	}

	hash := biz.CatalogHash(parts)
	version := hash
	if !latest.IsZero() {
		version = latest.UTC().Format(time.RFC3339Nano)
	}
	return &biz.ExpertCatalogMeta{
		Version: version,
		Hash:    hash,
		Updated: latest,
	}
}

func toBizLocalizedTexts(items []localizedTextPO) []biz.LocalizedText {
	result := make([]biz.LocalizedText, 0, len(items))
	for _, item := range items {
		result = append(result, biz.LocalizedText{Zh: item.Zh, En: item.En})
	}
	return result
}

func unixTime(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	if value >= 1_000_000_000_000 {
		return time.UnixMilli(value).UTC()
	}
	return time.Unix(value, 0).UTC()
}

func latestUnixTime(values ...int64) time.Time {
	var latest time.Time
	for _, value := range values {
		candidate := unixTime(value)
		if candidate.After(latest) {
			latest = candidate
		}
	}
	return latest
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func hasCJK(value string) bool {
	for _, r := range value {
		if (r >= 0x4E00 && r <= 0x9FFF) || (r >= 0x3400 && r <= 0x4DBF) {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func contentHash(value string) string {
	return biz.CatalogHash([]string{value})
}
