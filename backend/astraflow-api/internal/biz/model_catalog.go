package biz

import (
	"context"
	"sort"
	"strconv"
	"strings"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	defaultModelCatalogPageSize = 30
	maxModelCatalogPageSize     = 100
)

type ModelCatalogItem struct {
	ID               string
	Name             string
	ChineseName      string
	Manufacturer     string
	Description      string
	DescriptionEn    string
	ModelType        string
	InputModalities  []string
	OutputModalities []string
	Capabilities     []string
	ContextLength    int64
	IconURL          string
	CoverURL         string
	Pricing          map[string]any
	UpdatedAtUnix    int64
}

type ModelVendorFacet struct {
	Name    string
	IconURL string
	Count   int
}

type ModelCatalogFilter struct {
	Keyword    string
	Vendor     string
	OutputType string
	Offset     int
	Limit      int
}

type ModelCatalogResult struct {
	Models   []*ModelCatalogItem
	Vendors  []*ModelVendorFacet
	Total    int
	HasMore  bool
	NextPage int
}

type ModelCatalogClient interface {
	ListModels(context.Context, string) ([]*ModelCatalogItem, error)
}

type ModelCatalogUsecase struct {
	crossDevice *CrossDeviceUsecase
	client      ModelCatalogClient
}

func NewModelCatalogUsecase(crossDevice *CrossDeviceUsecase, client ModelCatalogClient) *ModelCatalogUsecase {
	return &ModelCatalogUsecase{crossDevice: crossDevice, client: client}
}

func (uc *ModelCatalogUsecase) ListModels(ctx context.Context, authorization string, filter ModelCatalogFilter) (*ModelCatalogResult, error) {
	if _, err := uc.crossDevice.authenticate(ctx, authorization); err != nil {
		return nil, err
	}
	filter.Keyword = strings.ToLower(strings.TrimSpace(filter.Keyword))
	filter.Vendor = strings.TrimSpace(filter.Vendor)
	filter.OutputType = strings.ToLower(strings.TrimSpace(filter.OutputType))
	if filter.Offset < 0 {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "model page token is invalid")
	}
	if filter.Limit <= 0 || filter.Limit > maxModelCatalogPageSize {
		filter.Limit = defaultModelCatalogPageSize
	}
	if filter.OutputType != "" && !oneOf(filter.OutputType, "text", "image", "video", "audio") {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "model output type is invalid")
	}

	models, err := uc.client.ListModels(ctx, authorization)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("MODEL_CATALOG_UNAVAILABLE", "UCloud model catalog is unavailable")
	}
	vendors := buildModelVendorFacets(models)
	filtered := make([]*ModelCatalogItem, 0, len(models))
	for _, model := range models {
		if model == nil || model.ID == "" {
			continue
		}
		if filter.Vendor != "" && model.Manufacturer != filter.Vendor {
			continue
		}
		if filter.OutputType != "" && !containsFold(model.OutputModalities, filter.OutputType) {
			continue
		}
		if filter.Keyword != "" && !strings.Contains(modelSearchText(model), filter.Keyword) {
			continue
		}
		filtered = append(filtered, model)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		if filtered[i].UpdatedAtUnix != filtered[j].UpdatedAtUnix {
			return filtered[i].UpdatedAtUnix > filtered[j].UpdatedAtUnix
		}
		return strings.ToLower(filtered[i].Name) < strings.ToLower(filtered[j].Name)
	})

	total := len(filtered)
	if filter.Offset > total {
		filter.Offset = total
	}
	end := min(filter.Offset+filter.Limit, total)
	page := append([]*ModelCatalogItem(nil), filtered[filter.Offset:end]...)
	return &ModelCatalogResult{
		Models: page, Vendors: vendors, Total: total,
		HasMore: end < total, NextPage: end,
	}, nil
}

func ParseModelPageToken(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(value)
	if err != nil || offset < 0 {
		return 0, kerrors.BadRequest("INVALID_ARGUMENT", "model page token is invalid")
	}
	return offset, nil
}

func buildModelVendorFacets(models []*ModelCatalogItem) []*ModelVendorFacet {
	facets := make(map[string]*ModelVendorFacet)
	for _, model := range models {
		if model == nil || strings.TrimSpace(model.Manufacturer) == "" {
			continue
		}
		facet := facets[model.Manufacturer]
		if facet == nil {
			facet = &ModelVendorFacet{Name: model.Manufacturer, IconURL: model.IconURL}
			facets[model.Manufacturer] = facet
		}
		facet.Count++
	}
	result := make([]*ModelVendorFacet, 0, len(facets))
	for _, facet := range facets {
		result = append(result, facet)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Count != result[j].Count {
			return result[i].Count > result[j].Count
		}
		return result[i].Name < result[j].Name
	})
	return result
}

func modelSearchText(model *ModelCatalogItem) string {
	values := []string{
		model.ID, model.Name, model.ChineseName, model.Manufacturer,
		model.Description, model.DescriptionEn, model.ModelType,
	}
	values = append(values, model.InputModalities...)
	values = append(values, model.OutputModalities...)
	values = append(values, model.Capabilities...)
	return strings.ToLower(strings.Join(values, " "))
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
}
