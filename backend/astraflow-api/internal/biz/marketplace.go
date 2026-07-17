package biz

import (
	"context"
	"net/url"
	"strings"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	DefaultMarketplacePageSize = int32(24)
	MaxMarketplacePageSize     = int32(100)
	MaxMarketplaceOffset       = int32(100_000)
)

type MarketplaceListFilter struct {
	Keyword  string
	Category string
	OrderBy  string
	Offset   int32
	Limit    int32
}

type McpRepository struct {
	URL       string
	Source    string
	Subfolder string
	ID        string
}

type McpMarketItem struct {
	Name          string
	Title         string
	Description   string
	Version       string
	WebsiteURL    string
	Repository    McpRepository
	IconURL       string
	RegistryTypes []string
	Transports    []string
	Status        string
	PublishedAt   string
	UpdatedAt     string
	IsLatest      bool
	ServerJSONURL string
}

type McpMarketResult struct {
	TotalCount       int32
	Mcps             []*McpMarketItem
	AllRegistryTypes []string
	AllTransports    []string
}

type SkillMarketItem struct {
	Slug              string
	Version           string
	Name              string
	Author            string
	Description       string
	DescriptionZh     string
	Category          string
	License           string
	Downloads         int64
	FileCount         int32
	SizeBytes         int64
	ArchiveURL        string
	UpstreamURL       string
	UpstreamUpdatedAt int64
	FilesJSON         string
	SkillMdURL        string
	Upstream          string
	Latest            bool
}

type SkillMarketResult struct {
	TotalCount    int32
	Skills        []*SkillMarketItem
	AllCategories []string
}

type SkillDetail struct {
	Skill   *SkillMarketItem
	SkillMd string
}

type MarketplaceRepo interface {
	ListMcps(context.Context, MarketplaceListFilter) (*McpMarketResult, error)
	GetMcpServerManifest(context.Context, string) (string, error)
	ListSkills(context.Context, MarketplaceListFilter) (*SkillMarketResult, error)
	GetSkillDetail(context.Context, string, string) (*SkillDetail, error)
}

type MarketplaceUsecase struct {
	repo MarketplaceRepo
}

func NewMarketplaceUsecase(repo MarketplaceRepo) *MarketplaceUsecase {
	return &MarketplaceUsecase{repo: repo}
}

func (uc *MarketplaceUsecase) ListMcps(ctx context.Context, filter MarketplaceListFilter) (*McpMarketResult, error) {
	filter = normalizeMarketplaceFilter(filter)
	result, err := uc.repo.ListMcps(ctx, filter)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("MARKETPLACE_UNAVAILABLE", "MCP marketplace is temporarily unavailable")
	}
	return result, nil
}

func (uc *MarketplaceUsecase) GetMcpServerManifest(ctx context.Context, serverJSONURL string) (string, error) {
	serverJSONURL = strings.TrimSpace(serverJSONURL)
	if serverJSONURL == "" {
		return "", kerrors.BadRequest("INVALID_ARGUMENT", "server_json_url is required")
	}
	parsed, err := url.Parse(serverJSONURL)
	if err != nil ||
		parsed.Scheme != "https" ||
		parsed.User != nil ||
		strings.ToLower(parsed.Hostname()) != "devportal.cn-wlcb.ufileos.com" ||
		(parsed.Port() != "" && parsed.Port() != "443") ||
		!strings.HasPrefix(parsed.EscapedPath(), "/mcp/") {
		return "", kerrors.BadRequest("INVALID_ARGUMENT", "server_json_url is not allowed")
	}
	manifest, err := uc.repo.GetMcpServerManifest(ctx, serverJSONURL)
	if err != nil {
		return "", kerrors.ServiceUnavailable("MARKETPLACE_UNAVAILABLE", "MCP server manifest is temporarily unavailable")
	}
	return manifest, nil
}

func (uc *MarketplaceUsecase) ListSkills(ctx context.Context, filter MarketplaceListFilter) (*SkillMarketResult, error) {
	filter = normalizeMarketplaceFilter(filter)
	result, err := uc.repo.ListSkills(ctx, filter)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("MARKETPLACE_UNAVAILABLE", "Skill marketplace is temporarily unavailable")
	}
	return result, nil
}

func (uc *MarketplaceUsecase) GetSkillDetail(ctx context.Context, slug, version string) (*SkillDetail, error) {
	slug = strings.TrimSpace(slug)
	version = strings.TrimSpace(version)
	if slug == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "slug is required")
	}
	detail, err := uc.repo.GetSkillDetail(ctx, slug, version)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("MARKETPLACE_UNAVAILABLE", "Skill detail is temporarily unavailable")
	}
	return detail, nil
}

func normalizeMarketplaceFilter(filter MarketplaceListFilter) MarketplaceListFilter {
	filter.Keyword = strings.TrimSpace(filter.Keyword)
	filter.Category = strings.TrimSpace(filter.Category)
	filter.OrderBy = strings.ToLower(strings.TrimSpace(filter.OrderBy))
	if filter.OrderBy != "popular" && filter.OrderBy != "recent" {
		filter.OrderBy = "recent"
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	} else if filter.Offset > MaxMarketplaceOffset {
		filter.Offset = MaxMarketplaceOffset
	}
	if filter.Limit <= 0 {
		filter.Limit = DefaultMarketplacePageSize
	} else if filter.Limit > MaxMarketplacePageSize {
		filter.Limit = MaxMarketplacePageSize
	}
	return filter
}
