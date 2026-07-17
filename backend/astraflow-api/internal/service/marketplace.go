package service

import (
	"context"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"
)

type MarketplaceService struct {
	v1.UnimplementedMarketplaceServiceServer

	uc *biz.MarketplaceUsecase
}

func NewMarketplaceService(uc *biz.MarketplaceUsecase) *MarketplaceService {
	return &MarketplaceService{uc: uc}
}

func (s *MarketplaceService) ListMcpMarket(ctx context.Context, request *v1.ListMcpMarketRequest) (*v1.ListMcpMarketResponse, error) {
	result, err := s.uc.ListMcps(ctx, biz.MarketplaceListFilter{
		Keyword:       request.GetKeyword(),
		OrderBy:       request.GetOrderBy(),
		RegistryTypes: append([]string(nil), request.GetRegistryTypes()...),
		Transports:    append([]string(nil), request.GetTransports()...),
		Statuses:      append([]string(nil), request.GetStatuses()...),
		Offset:        request.GetOffset(),
		Limit:         request.GetLimit(),
	})
	if err != nil {
		return nil, err
	}

	mcps := make([]*v1.McpMarketItem, 0, len(result.Mcps))
	for _, item := range result.Mcps {
		mcps = append(mcps, toMcpMarketItemDTO(item))
	}
	return &v1.ListMcpMarketResponse{
		TotalCount:       result.TotalCount,
		Mcps:             mcps,
		AllRegistryTypes: append([]string(nil), result.AllRegistryTypes...),
		AllTransports:    append([]string(nil), result.AllTransports...),
	}, nil
}

func (s *MarketplaceService) GetMcpDetail(ctx context.Context, request *v1.GetMcpDetailRequest) (*v1.GetMcpDetailResponse, error) {
	detail, err := s.uc.GetMcpDetail(ctx, request.GetName())
	if err != nil {
		return nil, err
	}
	return &v1.GetMcpDetailResponse{
		Mcp:        toMcpMarketItemDTO(detail.Mcp),
		ServerJson: detail.ServerJSON,
	}, nil
}

func (s *MarketplaceService) ListSkillMarket(ctx context.Context, request *v1.ListSkillMarketRequest) (*v1.ListSkillMarketResponse, error) {
	result, err := s.uc.ListSkills(ctx, biz.MarketplaceListFilter{
		Keyword:     request.GetKeyword(),
		Category:    request.GetCategory(),
		SubCategory: request.GetSubCategory(),
		OrderBy:     request.GetOrderBy(),
		Offset:      request.GetOffset(),
		Limit:       request.GetLimit(),
	})
	if err != nil {
		return nil, err
	}

	skills := make([]*v1.SkillMarketItem, 0, len(result.Skills))
	for _, item := range result.Skills {
		skills = append(skills, toSkillMarketItemDTO(item))
	}
	return &v1.ListSkillMarketResponse{
		TotalCount:       result.TotalCount,
		Skills:           skills,
		AllCategories:    append([]string(nil), result.AllCategories...),
		AllSubCategories: toSkillSubCategoryDTOs(result.AllSubCategories),
	}, nil
}

func (s *MarketplaceService) GetSkillDetail(ctx context.Context, request *v1.GetSkillDetailRequest) (*v1.GetSkillDetailResponse, error) {
	detail, err := s.uc.GetSkillDetail(ctx, request.GetSlug(), request.GetVersion())
	if err != nil {
		return nil, err
	}
	return &v1.GetSkillDetailResponse{
		Skill:   toSkillMarketItemDTO(detail.Skill),
		SkillMd: detail.SkillMd,
	}, nil
}

func toMcpMarketItemDTO(item *biz.McpMarketItem) *v1.McpMarketItem {
	if item == nil {
		return nil
	}
	return &v1.McpMarketItem{
		Name:        item.Name,
		Title:       item.Title,
		Description: item.Description,
		Version:     item.Version,
		WebsiteUrl:  item.WebsiteURL,
		Repository: &v1.McpRepository{
			Url:       item.Repository.URL,
			Source:    item.Repository.Source,
			Subfolder: item.Repository.Subfolder,
			Id:        item.Repository.ID,
		},
		IconUrl:       item.IconURL,
		RegistryTypes: append([]string(nil), item.RegistryTypes...),
		Transports:    append([]string(nil), item.Transports...),
		Status:        item.Status,
		PublishedAt:   item.PublishedAt,
		UpdatedAt:     item.UpdatedAt,
		IsLatest:      item.IsLatest,
		ServerJsonUrl: item.ServerJSONURL,
	}
}

func toSkillMarketItemDTO(item *biz.SkillMarketItem) *v1.SkillMarketItem {
	if item == nil {
		return nil
	}
	return &v1.SkillMarketItem{
		Slug:              item.Slug,
		Version:           item.Version,
		Name:              item.Name,
		Author:            item.Author,
		Description:       item.Description,
		DescriptionZh:     item.DescriptionZh,
		Category:          item.Category,
		License:           item.License,
		Downloads:         item.Downloads,
		FileCount:         item.FileCount,
		SizeBytes:         item.SizeBytes,
		ArchiveUrl:        item.ArchiveURL,
		UpstreamUrl:       item.UpstreamURL,
		UpstreamUpdatedAt: item.UpstreamUpdatedAt,
		FilesJson:         item.FilesJSON,
		SkillMdUrl:        item.SkillMdURL,
		Upstream:          item.Upstream,
		Latest:            item.Latest,
		IconUrl:           item.IconURL,
		Stars:             item.Stars,
		SubCategories:     toSkillSubCategoryDTOs(item.SubCategories),
	}
}

func toSkillSubCategoryDTOs(items []biz.SkillSubCategory) []*v1.SkillSubCategory {
	result := make([]*v1.SkillSubCategory, 0, len(items))
	for _, item := range items {
		result = append(result, &v1.SkillSubCategory{Key: item.Key, Name: item.Name})
	}
	return result
}
