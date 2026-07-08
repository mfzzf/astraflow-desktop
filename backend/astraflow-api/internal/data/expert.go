package data

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/jackc/pgx/v5"
)

type expertRepo struct {
	data *Data
}

func NewExpertRepo(data *Data) biz.ExpertRepo {
	return &expertRepo{data: data}
}

func (r *expertRepo) ListCategories(ctx context.Context) ([]*biz.ExpertCategory, error) {
	if err := r.requireDB(); err != nil {
		return nil, err
	}

	rows, err := r.data.db.Query(ctx, `
		SELECT id, name_zh, name_en, description_zh, description_en, sort_order, expert_count, updated_at
		FROM expert_categories
		ORDER BY sort_order ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := make([]*biz.ExpertCategory, 0)
	for rows.Next() {
		category := &biz.ExpertCategory{}
		if err := rows.Scan(
			&category.ID,
			&category.NameZh,
			&category.NameEn,
			&category.DescriptionZh,
			&category.DescriptionEn,
			&category.SortOrder,
			&category.ExpertCount,
			&category.UpdatedAt,
		); err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}

	return categories, rows.Err()
}

func (r *expertRepo) ListExperts(ctx context.Context, filter biz.ExpertListFilter) (*biz.ExpertListResult, error) {
	if err := r.requireDB(); err != nil {
		return nil, err
	}

	offset, err := biz.OffsetFromPageToken(filter.PageToken)
	if err != nil {
		return nil, kerrors.BadRequest(v1.ErrorReason_INVALID_ARGUMENT.String(), err.Error())
	}

	where, args := expertWhere(filter)
	var total int32
	if err := r.data.db.QueryRow(ctx, "SELECT COUNT(*) FROM experts "+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	orderBy := "updated_at DESC, id ASC"
	if filter.OrderBy == "name" {
		orderBy = "LOWER(COALESCE(NULLIF(display_name_zh, ''), NULLIF(display_name_en, ''), id)) ASC, id ASC"
	}

	limit := filter.PageSize + 1
	queryArgs := append(args, limit, offset)
	query := fmt.Sprintf(`
		SELECT
			id, slug, source, source_folder, type, status, category_id,
			display_name_zh, display_name_en, profession_zh, profession_en,
			description_zh, description_en, avatar_path, tags_json, quick_prompts_json,
			prompt_count, skill_file_count, mcp_file_count, member_count, runtime_hash, updated_at
		FROM experts
		%s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`, where, orderBy, len(queryArgs)-1, len(queryArgs))

	rows, err := r.data.db.Query(ctx, query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	experts, err := scanExpertListRows(rows)
	if err != nil {
		return nil, err
	}

	nextPageToken := biz.NextPageToken(offset, len(experts), filter.PageSize)
	if len(experts) > int(filter.PageSize) {
		experts = experts[:filter.PageSize]
	}

	meta, err := r.CatalogMeta(ctx)
	if err != nil {
		return nil, err
	}

	return &biz.ExpertListResult{
		Experts:        experts,
		NextPageToken:  nextPageToken,
		TotalSize:      total,
		CatalogVersion: meta.Version,
		CatalogHash:    meta.Hash,
		UpdatedAt:      meta.Updated,
	}, nil
}

func (r *expertRepo) GetExpert(ctx context.Context, expertID string) (*biz.ExpertDetail, error) {
	if err := r.requireDB(); err != nil {
		return nil, err
	}

	summary, sourcePlugin, defaultInitPrompt, err := r.getExpertSummary(ctx, expertID)
	if err != nil {
		return nil, err
	}

	agents, err := r.listExpertAgents(ctx, summary.ID)
	if err != nil {
		return nil, err
	}
	skills, err := r.listExpertSkills(ctx, summary.ID)
	if err != nil {
		return nil, err
	}
	mcpServers, err := r.listExpertMcpServers(ctx, summary.ID)
	if err != nil {
		return nil, err
	}
	teamMembers, err := r.listExpertTeamMembers(ctx, summary.ID)
	if err != nil {
		return nil, err
	}
	meta, err := r.CatalogMeta(ctx)
	if err != nil {
		return nil, err
	}

	return &biz.ExpertDetail{
		Summary:           summary,
		DefaultInitPrompt: defaultInitPrompt,
		Agents:            agents,
		Skills:            skills,
		McpServers:        mcpServers,
		TeamMembers:       teamMembers,
		SourcePlugin:      sourcePlugin,
		CatalogHash:       meta.Hash,
	}, nil
}

func (r *expertRepo) GetExpertRuntime(ctx context.Context, expertID string) (*biz.ExpertRuntime, error) {
	detail, err := r.GetExpert(ctx, expertID)
	if err != nil {
		return nil, err
	}
	if detail.Summary.Status != biz.ExpertStatusDownloaded || detail.Summary.RuntimeHash == "" {
		return nil, kerrors.BadRequest("EXPERT_RUNTIME_UNAVAILABLE", "expert runtime is unavailable")
	}

	team := biz.ExpertTeam{}
	for _, agent := range detail.Agents {
		if agent.Role == "lead" && team.LeadAgent == "" {
			team.LeadAgent = agent.AgentName
		}
	}
	for _, member := range detail.TeamMembers {
		if member.Role == "member" && member.AgentName != "" {
			team.MemberAgents = append(team.MemberAgents, member.AgentName)
		}
	}
	if team.LeadAgent == "" && len(detail.Agents) > 0 {
		team.LeadAgent = detail.Agents[0].AgentName
	}

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

func (r *expertRepo) CatalogMeta(ctx context.Context) (*biz.ExpertCatalogMeta, error) {
	if err := r.requireDB(); err != nil {
		return nil, err
	}

	rows, err := r.data.db.Query(ctx, `
		SELECT id, runtime_hash, updated_at
		FROM experts
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	parts := make([]string, 0)
	var latest time.Time
	for rows.Next() {
		var id string
		var runtimeHash string
		var updatedAt time.Time
		if err := rows.Scan(&id, &runtimeHash, &updatedAt); err != nil {
			return nil, err
		}
		parts = append(parts, id+":"+runtimeHash+":"+updatedAt.UTC().Format(time.RFC3339Nano))
		if updatedAt.After(latest) {
			latest = updatedAt
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	version := ""
	if !latest.IsZero() {
		version = latest.UTC().Format(time.RFC3339Nano)
	}

	return &biz.ExpertCatalogMeta{
		Version: version,
		Hash:    biz.CatalogHash(parts),
		Updated: latest,
	}, nil
}

func (r *expertRepo) getExpertSummary(ctx context.Context, expertID string) (*biz.ExpertListItem, string, biz.LocalizedText, error) {
	rows, err := r.data.db.Query(ctx, `
		SELECT
			id, slug, source, source_folder, type, status, category_id,
			display_name_zh, display_name_en, profession_zh, profession_en,
			description_zh, description_en, avatar_path, tags_json, quick_prompts_json,
			prompt_count, skill_file_count, mcp_file_count, member_count, runtime_hash, updated_at,
			source_plugin, default_init_prompt_json
		FROM experts
		WHERE id = $1 OR slug = $1
		LIMIT 1
	`, expertID)
	if err != nil {
		return nil, "", biz.LocalizedText{}, err
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, "", biz.LocalizedText{}, kerrors.NotFound("EXPERT_NOT_FOUND", "expert not found")
	}

	summary, sourcePlugin, defaultInitPrompt, err := scanExpertSummaryWithDetail(rows)
	if err != nil {
		return nil, "", biz.LocalizedText{}, err
	}
	return summary, sourcePlugin, defaultInitPrompt, rows.Err()
}

func (r *expertRepo) listExpertAgents(ctx context.Context, expertID string) ([]*biz.ExpertAgent, error) {
	rows, err := r.data.db.Query(ctx, `
		SELECT id, expert_id, agent_name, role, display_name_zh, display_name_en,
			profession_zh, profession_en, description, prompt_markdown,
			frontmatter_json, skills_json, max_turns, sort_order, content_hash
		FROM expert_agents
		WHERE expert_id = $1
		ORDER BY sort_order ASC, agent_name ASC
	`, expertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	agents := make([]*biz.ExpertAgent, 0)
	for rows.Next() {
		var frontmatter []byte
		var skills []byte
		agent := &biz.ExpertAgent{}
		if err := rows.Scan(
			&agent.ID,
			&agent.ExpertID,
			&agent.AgentName,
			&agent.Role,
			&agent.DisplayNameZh,
			&agent.DisplayNameEn,
			&agent.ProfessionZh,
			&agent.ProfessionEn,
			&agent.Description,
			&agent.PromptMarkdown,
			&frontmatter,
			&skills,
			&agent.MaxTurns,
			&agent.SortOrder,
			&agent.ContentHash,
		); err != nil {
			return nil, err
		}
		agent.FrontmatterJSON = string(frontmatter)
		agent.Skills = parseStringArray(skills)
		agents = append(agents, agent)
	}
	return agents, rows.Err()
}

func (r *expertRepo) listExpertSkills(ctx context.Context, expertID string) ([]*biz.ExpertSkill, error) {
	rows, err := r.data.db.Query(ctx, `
		SELECT id, expert_id, skill_slug, relative_path, skill_md, metadata_json, content_hash
		FROM expert_skills
		WHERE expert_id = $1
		ORDER BY skill_slug ASC, relative_path ASC
	`, expertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	skills := make([]*biz.ExpertSkill, 0)
	for rows.Next() {
		var metadata []byte
		skill := &biz.ExpertSkill{}
		if err := rows.Scan(
			&skill.ID,
			&skill.ExpertID,
			&skill.SkillSlug,
			&skill.RelativePath,
			&skill.SkillMarkdown,
			&metadata,
			&skill.ContentHash,
		); err != nil {
			return nil, err
		}
		skill.MetadataJSON = string(metadata)
		skill.Title, skill.Description = skillTitleAndDescription(metadata, skill.SkillMarkdown)
		skills = append(skills, skill)
	}
	return skills, rows.Err()
}

func (r *expertRepo) listExpertMcpServers(ctx context.Context, expertID string) ([]*biz.ExpertMcpServer, error) {
	rows, err := r.data.db.Query(ctx, `
		SELECT id, expert_id, relative_path, mcp_json, server_count, content_hash
		FROM expert_mcp_servers
		WHERE expert_id = $1
		ORDER BY relative_path ASC
	`, expertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	servers := make([]*biz.ExpertMcpServer, 0)
	for rows.Next() {
		var mcpJSON []byte
		server := &biz.ExpertMcpServer{}
		if err := rows.Scan(
			&server.ID,
			&server.ExpertID,
			&server.RelativePath,
			&mcpJSON,
			&server.ServerCount,
			&server.ContentHash,
		); err != nil {
			return nil, err
		}
		server.McpJSON = string(mcpJSON)
		servers = append(servers, server)
	}
	return servers, rows.Err()
}

func (r *expertRepo) listExpertTeamMembers(ctx context.Context, expertID string) ([]*biz.ExpertTeamMember, error) {
	rows, err := r.data.db.Query(ctx, `
		SELECT id, expert_id, agent_name, role, display_name_zh, display_name_en,
			profession_zh, profession_en, avatar_path, sort_order
		FROM expert_team_members
		WHERE expert_id = $1
		ORDER BY sort_order ASC, agent_name ASC
	`, expertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]*biz.ExpertTeamMember, 0)
	for rows.Next() {
		member := &biz.ExpertTeamMember{}
		if err := rows.Scan(
			&member.ID,
			&member.ExpertID,
			&member.AgentName,
			&member.Role,
			&member.DisplayNameZh,
			&member.DisplayNameEn,
			&member.ProfessionZh,
			&member.ProfessionEn,
			&member.AvatarPath,
			&member.SortOrder,
		); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (r *expertRepo) requireDB() error {
	if r.data == nil || r.data.db == nil {
		return kerrors.InternalServer("DATABASE_UNAVAILABLE", "database is not configured")
	}
	return nil
}

func expertWhere(filter biz.ExpertListFilter) (string, []any) {
	conditions := make([]string, 0, 5)
	args := make([]any, 0, 5)

	add := func(condition string, value any) {
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf(condition, len(args)))
	}

	if strings.TrimSpace(filter.CategoryID) != "" {
		add("category_id = $%d", strings.TrimSpace(filter.CategoryID))
	}
	if strings.TrimSpace(filter.Type) != "" {
		add("type = $%d", strings.TrimSpace(filter.Type))
	}
	if strings.TrimSpace(filter.Status) != "" {
		add("status = $%d", strings.TrimSpace(filter.Status))
	}
	if strings.TrimSpace(filter.Query) != "" {
		add("search_text ILIKE '%' || $%d || '%'", strings.TrimSpace(filter.Query))
	}

	if len(conditions) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func scanExpertListRows(rows pgx.Rows) ([]*biz.ExpertListItem, error) {
	experts := make([]*biz.ExpertListItem, 0)
	for rows.Next() {
		expert, err := scanExpertListItem(rows)
		if err != nil {
			return nil, err
		}
		experts = append(experts, expert)
	}
	return experts, rows.Err()
}

type expertListScanner interface {
	Scan(dest ...any) error
}

func scanExpertListItem(scanner expertListScanner) (*biz.ExpertListItem, error) {
	var tags []byte
	var quickPrompts []byte
	expert := &biz.ExpertListItem{}
	if err := scanner.Scan(
		&expert.ID,
		&expert.Slug,
		&expert.Source,
		&expert.SourceFolder,
		&expert.Type,
		&expert.Status,
		&expert.CategoryID,
		&expert.DisplayNameZh,
		&expert.DisplayNameEn,
		&expert.ProfessionZh,
		&expert.ProfessionEn,
		&expert.DescriptionZh,
		&expert.DescriptionEn,
		&expert.AvatarPath,
		&tags,
		&quickPrompts,
		&expert.PromptCount,
		&expert.SkillCount,
		&expert.McpCount,
		&expert.MemberCount,
		&expert.RuntimeHash,
		&expert.UpdatedAt,
	); err != nil {
		return nil, err
	}
	expert.Tags = parseLocalizedArray(tags)
	expert.QuickPrompts = parseLocalizedArray(quickPrompts)
	expert.RuntimeAvailable = expert.Status == biz.ExpertStatusDownloaded && expert.RuntimeHash != ""
	if !expert.RuntimeAvailable {
		expert.UnavailableReason = expert.Status
	}
	return expert, nil
}

func scanExpertSummaryWithDetail(rows pgx.Rows) (*biz.ExpertListItem, string, biz.LocalizedText, error) {
	var tags []byte
	var quickPrompts []byte
	var sourcePlugin []byte
	var defaultInitPrompt []byte
	expert := &biz.ExpertListItem{}
	if err := rows.Scan(
		&expert.ID,
		&expert.Slug,
		&expert.Source,
		&expert.SourceFolder,
		&expert.Type,
		&expert.Status,
		&expert.CategoryID,
		&expert.DisplayNameZh,
		&expert.DisplayNameEn,
		&expert.ProfessionZh,
		&expert.ProfessionEn,
		&expert.DescriptionZh,
		&expert.DescriptionEn,
		&expert.AvatarPath,
		&tags,
		&quickPrompts,
		&expert.PromptCount,
		&expert.SkillCount,
		&expert.McpCount,
		&expert.MemberCount,
		&expert.RuntimeHash,
		&expert.UpdatedAt,
		&sourcePlugin,
		&defaultInitPrompt,
	); err != nil {
		return nil, "", biz.LocalizedText{}, err
	}
	expert.Tags = parseLocalizedArray(tags)
	expert.QuickPrompts = parseLocalizedArray(quickPrompts)
	expert.RuntimeAvailable = expert.Status == biz.ExpertStatusDownloaded && expert.RuntimeHash != ""
	if !expert.RuntimeAvailable {
		expert.UnavailableReason = expert.Status
	}
	return expert, string(sourcePlugin), parseLocalizedText(defaultInitPrompt), nil
}

func parseLocalizedArray(raw []byte) []biz.LocalizedText {
	if len(raw) == 0 {
		return nil
	}

	var localized []biz.LocalizedText
	if err := json.Unmarshal(raw, &localized); err == nil {
		return localized
	}

	var stringsOnly []string
	if err := json.Unmarshal(raw, &stringsOnly); err == nil {
		items := make([]biz.LocalizedText, 0, len(stringsOnly))
		for _, value := range stringsOnly {
			items = append(items, localizedFromString(value))
		}
		return items
	}

	var records []map[string]any
	if err := json.Unmarshal(raw, &records); err == nil {
		items := make([]biz.LocalizedText, 0, len(records))
		for _, record := range records {
			items = append(items, biz.LocalizedText{
				Zh: stringValue(record["zh"]),
				En: stringValue(record["en"]),
			})
		}
		return items
	}

	return nil
}

func parseLocalizedText(raw []byte) biz.LocalizedText {
	if len(raw) == 0 {
		return biz.LocalizedText{}
	}
	var text biz.LocalizedText
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err == nil {
		return biz.LocalizedText{
			Zh: stringValue(record["zh"]),
			En: stringValue(record["en"]),
		}
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return localizedFromString(value)
	}
	return biz.LocalizedText{}
}

func parseStringArray(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	return nil
}

func localizedFromString(value string) biz.LocalizedText {
	if hasCJK(value) {
		return biz.LocalizedText{Zh: value}
	}
	return biz.LocalizedText{En: value}
}

func hasCJK(value string) bool {
	for _, r := range value {
		if (r >= 0x4E00 && r <= 0x9FFF) || (r >= 0x3400 && r <= 0x4DBF) {
			return true
		}
	}
	return false
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func skillTitleAndDescription(metadata []byte, markdown string) (string, string) {
	title := ""
	description := ""
	var record map[string]any
	if err := json.Unmarshal(metadata, &record); err == nil {
		title = firstNonEmpty(
			stringValue(record["displayName"]),
			stringValue(record["title"]),
			stringValue(record["name"]),
		)
		description = stringValue(record["description"])
	}
	if title == "" {
		for _, line := range strings.Split(markdown, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "# ") {
				title = strings.TrimSpace(strings.TrimPrefix(line, "# "))
				break
			}
		}
	}
	return title, description
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func contentHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}
