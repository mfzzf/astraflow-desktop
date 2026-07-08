package service

import (
	"context"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type ExpertService struct {
	v1.UnimplementedExpertServiceServer

	uc *biz.ExpertUsecase
}

func NewExpertService(uc *biz.ExpertUsecase) *ExpertService {
	return &ExpertService{uc: uc}
}

func (s *ExpertService) ListExpertCategories(ctx context.Context, req *v1.ListExpertCategoriesRequest) (*v1.ListExpertCategoriesResponse, error) {
	categories, meta, err := s.uc.ListCategories(ctx)
	if err != nil {
		return nil, err
	}

	return &v1.ListExpertCategoriesResponse{
		Categories:     mapExpertCategories(categories),
		CatalogVersion: meta.Version,
		CatalogHash:    meta.Hash,
		UpdatedAt:      timestamp(meta.Updated),
	}, nil
}

func (s *ExpertService) ListExperts(ctx context.Context, req *v1.ListExpertsRequest) (*v1.ListExpertsResponse, error) {
	result, err := s.uc.ListExperts(ctx, biz.ExpertListFilter{
		PageSize:   req.GetPageSize(),
		PageToken:  req.GetPageToken(),
		CategoryID: req.GetCategoryId(),
		Type:       req.GetType(),
		Status:     req.GetStatus(),
		Query:      req.GetQuery(),
		OrderBy:    req.GetOrderBy(),
		Locale:     req.GetLocale(),
	})
	if err != nil {
		return nil, err
	}

	experts := make([]*v1.ExpertListItem, 0, len(result.Experts))
	for _, expert := range result.Experts {
		experts = append(experts, mapExpertListItem(expert, req.GetLocale()))
	}

	return &v1.ListExpertsResponse{
		Experts:        experts,
		NextPageToken:  result.NextPageToken,
		TotalSize:      result.TotalSize,
		CatalogVersion: result.CatalogVersion,
		CatalogHash:    result.CatalogHash,
		UpdatedAt:      timestamp(result.UpdatedAt),
	}, nil
}

func (s *ExpertService) GetExpert(ctx context.Context, req *v1.GetExpertRequest) (*v1.GetExpertResponse, error) {
	expert, err := s.uc.GetExpert(ctx, req.GetExpertId())
	if err != nil {
		return nil, err
	}

	return &v1.GetExpertResponse{
		Expert: mapExpertDetail(expert, req.GetLocale()),
	}, nil
}

func (s *ExpertService) GetExpertRuntime(ctx context.Context, req *v1.GetExpertRuntimeRequest) (*v1.GetExpertRuntimeResponse, error) {
	runtime, err := s.uc.GetExpertRuntime(ctx, req.GetExpertId())
	if err != nil {
		return nil, err
	}

	return &v1.GetExpertRuntimeResponse{
		Runtime: mapExpertRuntime(runtime),
	}, nil
}

func mapExpertCategories(categories []*biz.ExpertCategory) []*v1.ExpertCategory {
	result := make([]*v1.ExpertCategory, 0, len(categories))
	for _, category := range categories {
		result = append(result, &v1.ExpertCategory{
			Id:            category.ID,
			NameZh:        category.NameZh,
			NameEn:        category.NameEn,
			DescriptionZh: category.DescriptionZh,
			DescriptionEn: category.DescriptionEn,
			SortOrder:     category.SortOrder,
			ExpertCount:   category.ExpertCount,
			UpdatedAt:     timestamp(category.UpdatedAt),
		})
	}
	return result
}

func mapExpertListItem(expert *biz.ExpertListItem, locale string) *v1.ExpertListItem {
	return &v1.ExpertListItem{
		Id:                expert.ID,
		Slug:              expert.Slug,
		Source:            expert.Source,
		SourceFolder:      expert.SourceFolder,
		Type:              expert.Type,
		Status:            expert.Status,
		CategoryId:        expert.CategoryID,
		DisplayName:       biz.Localize(biz.LocalizedText{Zh: expert.DisplayNameZh, En: expert.DisplayNameEn}, locale),
		DisplayNameZh:     expert.DisplayNameZh,
		DisplayNameEn:     expert.DisplayNameEn,
		Profession:        biz.Localize(biz.LocalizedText{Zh: expert.ProfessionZh, En: expert.ProfessionEn}, locale),
		ProfessionZh:      expert.ProfessionZh,
		ProfessionEn:      expert.ProfessionEn,
		Description:       biz.Localize(biz.LocalizedText{Zh: expert.DescriptionZh, En: expert.DescriptionEn}, locale),
		DescriptionZh:     expert.DescriptionZh,
		DescriptionEn:     expert.DescriptionEn,
		AvatarUrl:         avatarURL(expert),
		Tags:              biz.LocalizeList(expert.Tags, locale),
		QuickPrompts:      biz.LocalizeList(expert.QuickPrompts, locale),
		PromptCount:       expert.PromptCount,
		SkillCount:        expert.SkillCount,
		McpCount:          expert.McpCount,
		MemberCount:       expert.MemberCount,
		RuntimeHash:       expert.RuntimeHash,
		RuntimeAvailable:  expert.RuntimeAvailable,
		UnavailableReason: expert.UnavailableReason,
		UpdatedAt:         timestamp(expert.UpdatedAt),
	}
}

func mapExpertDetail(expert *biz.ExpertDetail, locale string) *v1.ExpertDetail {
	return &v1.ExpertDetail{
		Summary:           mapExpertListItem(expert.Summary, locale),
		DefaultInitPrompt: mapLocalizedText(expert.DefaultInitPrompt),
		Agents:            mapExpertAgents(expert.Agents),
		Skills:            mapExpertSkills(expert.Skills),
		McpServers:        mapExpertMcpServers(expert.McpServers),
		TeamMembers:       mapExpertTeamMembers(expert.TeamMembers),
		SourcePlugin:      expert.SourcePlugin,
		CatalogHash:       expert.CatalogHash,
	}
}

func mapExpertRuntime(runtime *biz.ExpertRuntime) *v1.ExpertRuntime {
	return &v1.ExpertRuntime{
		Expert: &v1.ExpertRuntimeSummary{
			Id:                runtime.Expert.ID,
			Type:              runtime.Expert.Type,
			RuntimeHash:       runtime.Expert.RuntimeHash,
			DisplayName:       mapLocalizedText(runtime.Expert.DisplayName),
			Profession:        mapLocalizedText(runtime.Expert.Profession),
			DefaultInitPrompt: mapLocalizedText(runtime.Expert.DefaultInitPrompt),
		},
		Agents:     mapExpertAgents(runtime.Agents),
		Team:       &v1.ExpertTeam{LeadAgent: runtime.Team.LeadAgent, MemberAgents: runtime.Team.MemberAgents},
		Skills:     mapExpertSkills(runtime.Skills),
		McpServers: mapExpertMcpServers(runtime.McpServers),
		Policy: &v1.ExpertRuntimePolicy{
			AllowRawPromptDisplay: runtime.Policy.AllowRawPromptDisplay,
			ToolScope:             runtime.Policy.ToolScope,
		},
	}
}

func mapExpertAgents(agents []*biz.ExpertAgent) []*v1.ExpertAgent {
	result := make([]*v1.ExpertAgent, 0, len(agents))
	for _, agent := range agents {
		result = append(result, &v1.ExpertAgent{
			Id:              agent.ID,
			ExpertId:        agent.ExpertID,
			AgentName:       agent.AgentName,
			Role:            agent.Role,
			DisplayNameZh:   agent.DisplayNameZh,
			DisplayNameEn:   agent.DisplayNameEn,
			ProfessionZh:    agent.ProfessionZh,
			ProfessionEn:    agent.ProfessionEn,
			Description:     agent.Description,
			PromptMarkdown:  agent.PromptMarkdown,
			FrontmatterJson: agent.FrontmatterJSON,
			Skills:          agent.Skills,
			MaxTurns:        agent.MaxTurns,
			SortOrder:       agent.SortOrder,
			ContentHash:     agent.ContentHash,
		})
	}
	return result
}

func mapExpertSkills(skills []*biz.ExpertSkill) []*v1.ExpertSkill {
	result := make([]*v1.ExpertSkill, 0, len(skills))
	for _, skill := range skills {
		result = append(result, &v1.ExpertSkill{
			Id:            skill.ID,
			ExpertId:      skill.ExpertID,
			SkillSlug:     skill.SkillSlug,
			RelativePath:  skill.RelativePath,
			Title:         skill.Title,
			Description:   skill.Description,
			SkillMarkdown: skill.SkillMarkdown,
			MetadataJson:  skill.MetadataJSON,
			ContentHash:   skill.ContentHash,
		})
	}
	return result
}

func mapExpertMcpServers(servers []*biz.ExpertMcpServer) []*v1.ExpertMcpServer {
	result := make([]*v1.ExpertMcpServer, 0, len(servers))
	for _, server := range servers {
		result = append(result, &v1.ExpertMcpServer{
			Id:           server.ID,
			ExpertId:     server.ExpertID,
			RelativePath: server.RelativePath,
			McpJson:      server.McpJSON,
			ServerCount:  server.ServerCount,
			ContentHash:  server.ContentHash,
		})
	}
	return result
}

func mapExpertTeamMembers(members []*biz.ExpertTeamMember) []*v1.ExpertTeamMember {
	result := make([]*v1.ExpertTeamMember, 0, len(members))
	for _, member := range members {
		result = append(result, &v1.ExpertTeamMember{
			Id:            member.ID,
			ExpertId:      member.ExpertID,
			AgentName:     member.AgentName,
			Role:          member.Role,
			DisplayNameZh: member.DisplayNameZh,
			DisplayNameEn: member.DisplayNameEn,
			ProfessionZh:  member.ProfessionZh,
			ProfessionEn:  member.ProfessionEn,
			AvatarPath:    member.AvatarPath,
			SortOrder:     member.SortOrder,
		})
	}
	return result
}

func mapLocalizedText(text biz.LocalizedText) *v1.LocalizedText {
	return &v1.LocalizedText{Zh: text.Zh, En: text.En}
}

func avatarURL(expert *biz.ExpertListItem) string {
	if expert.AvatarPath == "" {
		return ""
	}
	return "/v1/experts/" + expert.ID + "/assets/" + expert.AvatarPath
}

func timestamp(value time.Time) *timestamppb.Timestamp {
	if value.IsZero() {
		return nil
	}
	return timestamppb.New(value)
}
