package data

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"astraflow-api/internal/biz"
)

const (
	maxUCloudMarketResponseBytes = 8 * 1024 * 1024
)

type marketplaceRepo struct {
	data *Data
}

type ucloudResponseBase struct {
	RetCode *int   `json:"RetCode"`
	Message string `json:"Message"`
}

type mcpRepositoryPO struct {
	URL       string `json:"Url"`
	Source    string `json:"Source"`
	Subfolder string `json:"Subfolder"`
	ID        string `json:"Id"`
}

type mcpMarketItemPO struct {
	Name          string          `json:"Name"`
	Title         string          `json:"Title"`
	Description   string          `json:"Description"`
	Version       string          `json:"Version"`
	WebsiteURL    string          `json:"WebsiteUrl"`
	Repository    mcpRepositoryPO `json:"Repository"`
	IconURL       string          `json:"IconUrl"`
	RegistryTypes []string        `json:"RegistryTypes"`
	Transports    []string        `json:"Transports"`
	Status        string          `json:"Status"`
	PublishedAt   string          `json:"PublishedAt"`
	UpdatedAt     string          `json:"UpdatedAt"`
	IsLatest      bool            `json:"IsLatest"`
	ServerJSONURL string          `json:"ServerJsonUrl"`
}

type describeMcpMarketResponsePO struct {
	ucloudResponseBase
	TotalCount       int32             `json:"TotalCount"`
	Mcps             []mcpMarketItemPO `json:"Mcps"`
	AllRegistryTypes []string          `json:"AllRegistryTypes"`
	AllTransports    []string          `json:"AllTransports"`
}

type describeMcpDetailResponsePO struct {
	ucloudResponseBase
	Mcp        mcpMarketItemPO `json:"Mcp"`
	ServerJSON string          `json:"ServerJson"`
}

type skillMarketItemPO struct {
	Slug              string `json:"Slug"`
	Version           string `json:"Version"`
	Name              string `json:"Name"`
	Author            string `json:"Author"`
	Description       string `json:"Desc"`
	DescriptionZh     string `json:"DescZh"`
	Category          string `json:"Category"`
	License           string `json:"License"`
	Downloads         int64  `json:"Downloads"`
	FileCount         int32  `json:"FileCount"`
	SizeBytes         int64  `json:"SizeBytes"`
	ArchiveURL        string `json:"ArchiveUrl"`
	UpstreamURL       string `json:"UpStreamUrl"`
	UpstreamUpdatedAt int64  `json:"UpStreamUpdatedAt"`
	FilesJSON         string `json:"FilesJson"`
	SkillMdURL        string `json:"SkillMdUrl"`
	Upstream          string `json:"UpStream"`
	Latest            bool   `json:"Latest"`
	IconURL           string `json:"IconUrl"`
}

type describeSkillMarketResponsePO struct {
	ucloudResponseBase
	TotalCount    int32               `json:"TotalCount"`
	Skills        []skillMarketItemPO `json:"Skills"`
	AllCategories []string            `json:"AllCategories"`
}

type describeSkillDetailResponsePO struct {
	ucloudResponseBase
	Skill   skillMarketItemPO `json:"Skill"`
	SkillMd string            `json:"SkillMd"`
}

func NewMarketplaceRepo(data *Data) biz.MarketplaceRepo {
	return &marketplaceRepo{data: data}
}

func (r *marketplaceRepo) ListMcps(ctx context.Context, filter biz.MarketplaceListFilter) (*biz.McpMarketResult, error) {
	params := map[string]any{
		"Action":  "DescribeMcpMarket",
		"Backend": "DevPortal",
		"Keyword": filter.Keyword,
		"OrderBy": filter.OrderBy,
		"Offset":  filter.Offset,
		"Limit":   filter.Limit,
	}
	var response describeMcpMarketResponsePO
	if err := r.callUCloud(ctx, params, &response); err != nil {
		return nil, err
	}

	mcps := make([]*biz.McpMarketItem, 0, len(response.Mcps))
	for _, item := range response.Mcps {
		mcps = append(mcps, toBizMcpMarketItem(item))
	}
	return &biz.McpMarketResult{
		TotalCount:       response.TotalCount,
		Mcps:             mcps,
		AllRegistryTypes: append([]string(nil), response.AllRegistryTypes...),
		AllTransports:    append([]string(nil), response.AllTransports...),
	}, nil
}

func (r *marketplaceRepo) GetMcpDetail(ctx context.Context, name string) (*biz.McpDetail, error) {
	params := map[string]any{
		"Action":  "DescribeMcpDetail",
		"Backend": "DevPortal",
		"Name":    name,
	}
	var response describeMcpDetailResponsePO
	if err := r.callUCloud(ctx, params, &response); err != nil {
		return nil, err
	}
	return &biz.McpDetail{
		Mcp:        toBizMcpMarketItem(response.Mcp),
		ServerJSON: response.ServerJSON,
	}, nil
}

func (r *marketplaceRepo) ListSkills(ctx context.Context, filter biz.MarketplaceListFilter) (*biz.SkillMarketResult, error) {
	params := map[string]any{
		"Action":   "DescribeSkillMarket",
		"Backend":  "SkillLab",
		"Keyword":  filter.Keyword,
		"Category": filter.Category,
		"OrderBy":  filter.OrderBy,
		"Offset":   filter.Offset,
		"Limit":    filter.Limit,
	}
	var response describeSkillMarketResponsePO
	if err := r.callUCloud(ctx, params, &response); err != nil {
		return nil, err
	}

	skills := make([]*biz.SkillMarketItem, 0, len(response.Skills))
	for _, item := range response.Skills {
		skills = append(skills, toBizSkillMarketItem(item))
	}
	return &biz.SkillMarketResult{
		TotalCount:    response.TotalCount,
		Skills:        skills,
		AllCategories: append([]string(nil), response.AllCategories...),
	}, nil
}

func (r *marketplaceRepo) GetSkillDetail(ctx context.Context, slug, version string) (*biz.SkillDetail, error) {
	params := map[string]any{
		"Action":  "DescribeSkillDetail",
		"Backend": "SkillLab",
		"Slug":    slug,
	}
	if version != "" {
		params["Version"] = version
	}
	var response describeSkillDetailResponsePO
	if err := r.callUCloud(ctx, params, &response); err != nil {
		return nil, err
	}
	return &biz.SkillDetail{
		Skill:   toBizSkillMarketItem(response.Skill),
		SkillMd: response.SkillMd,
	}, nil
}

func (r *marketplaceRepo) callUCloud(ctx context.Context, params map[string]any, result any) error {
	params["_timestamp"] = time.Now().UnixMilli()
	body, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("encode UCloud request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.data.ucloudMarketEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create UCloud request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")

	response, err := r.data.marketHTTPClient.Do(request)
	if err != nil {
		return fmt.Errorf("call UCloud marketplace: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("call UCloud marketplace: HTTP %d", response.StatusCode)
	}

	limited := io.LimitReader(response.Body, maxUCloudMarketResponseBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return fmt.Errorf("read UCloud marketplace response: %w", err)
	}
	if len(payload) > maxUCloudMarketResponseBytes {
		return fmt.Errorf("UCloud marketplace response is too large")
	}
	if err := json.Unmarshal(payload, result); err != nil {
		return fmt.Errorf("decode UCloud marketplace response: %w", err)
	}
	var base ucloudResponseBase
	if err := json.Unmarshal(payload, &base); err != nil {
		return fmt.Errorf("decode UCloud response status: %w", err)
	}
	if base.RetCode == nil {
		return fmt.Errorf("UCloud marketplace response is missing RetCode")
	}
	if *base.RetCode != 0 {
		return fmt.Errorf("UCloud marketplace RetCode %d: %s", *base.RetCode, base.Message)
	}
	return nil
}

func toBizMcpMarketItem(item mcpMarketItemPO) *biz.McpMarketItem {
	return &biz.McpMarketItem{
		Name:        item.Name,
		Title:       item.Title,
		Description: item.Description,
		Version:     item.Version,
		WebsiteURL:  item.WebsiteURL,
		Repository: biz.McpRepository{
			URL:       item.Repository.URL,
			Source:    item.Repository.Source,
			Subfolder: item.Repository.Subfolder,
			ID:        item.Repository.ID,
		},
		IconURL:       item.IconURL,
		RegistryTypes: append([]string(nil), item.RegistryTypes...),
		Transports:    append([]string(nil), item.Transports...),
		Status:        item.Status,
		PublishedAt:   item.PublishedAt,
		UpdatedAt:     item.UpdatedAt,
		IsLatest:      item.IsLatest,
		ServerJSONURL: item.ServerJSONURL,
	}
}

func toBizSkillMarketItem(item skillMarketItemPO) *biz.SkillMarketItem {
	return &biz.SkillMarketItem{
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
		ArchiveURL:        item.ArchiveURL,
		UpstreamURL:       item.UpstreamURL,
		UpstreamUpdatedAt: item.UpstreamUpdatedAt,
		FilesJSON:         item.FilesJSON,
		SkillMdURL:        item.SkillMdURL,
		Upstream:          item.Upstream,
		Latest:            item.Latest,
		IconURL:           item.IconURL,
	}
}
