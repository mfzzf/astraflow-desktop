package data

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"astraflow-api/internal/biz"
)

const (
	modelCatalogPageSize = 50
	modelCatalogMaxItems = 5000
	modelCatalogCacheTTL = time.Minute
)

type ucloudModelCatalogClient struct {
	data  *Data
	mu    sync.Mutex
	cache map[[sha256.Size]byte]cachedModelCatalog
}

type cachedModelCatalog struct {
	models    []*biz.ModelCatalogItem
	expiresAt time.Time
}

type ucloudSquareModel struct {
	ID                    string         `json:"Id"`
	Name                  string         `json:"Name"`
	ChineseName           string         `json:"ChineseName"`
	Manufacturer          string         `json:"Manufacturer"`
	SimpleDescribe        string         `json:"SimpleDescribe"`
	SimpleDescribeEn      string         `json:"SimpleDescribeEn"`
	Describe              string         `json:"Describe"`
	DescribeEn            string         `json:"DescribeEn"`
	Description           string         `json:"Description"`
	DescriptionEn         string         `json:"DescriptionEn"`
	ModelType             string         `json:"ModelType"`
	InputModalities       []string       `json:"InputModalities"`
	OutputModalities      []string       `json:"OutputModalities"`
	SupportedCapabilities []string       `json:"SupportedCapabilities"`
	ModalTypes            []string       `json:"ModalTypes"`
	MaxModelLen           any            `json:"MaxModelLen"`
	MaxInputTokens        any            `json:"MaxInputTokens"`
	MaxOutputTokens       any            `json:"MaxOutputTokens"`
	Icon                  string         `json:"Icon"`
	CoverURL              string         `json:"CoverUrl"`
	Pricing               map[string]any `json:"Pricing"`
	HfUpdateTime          int64          `json:"HfUpdateTime"`
	CreateAt              int64          `json:"CreateAt"`
	UpdateAt              int64          `json:"UpdateAt"`
}

type ucloudModelCatalogResponse struct {
	RetCode      *int            `json:"RetCode"`
	Message      string          `json:"Message"`
	TotalCount   any             `json:"TotalCount"`
	SquareModels json.RawMessage `json:"SquareModels"`
}

func NewModelCatalogClient(data *Data) biz.ModelCatalogClient {
	return &ucloudModelCatalogClient{data: data, cache: make(map[[sha256.Size]byte]cachedModelCatalog)}
}

func (client *ucloudModelCatalogClient) ListModels(ctx context.Context, authorization string) ([]*biz.ModelCatalogItem, error) {
	key := sha256.Sum256([]byte(strings.TrimSpace(authorization)))
	if cached := client.readCache(key, time.Now()); cached != nil {
		return cached, nil
	}
	models := make([]*biz.ModelCatalogItem, 0, modelCatalogPageSize)
	total := modelCatalogPageSize
	for offset := 0; offset < total && offset < modelCatalogMaxItems; offset += modelCatalogPageSize {
		page, count, err := client.fetchPage(ctx, authorization, offset)
		if err != nil {
			return nil, err
		}
		if offset == 0 {
			total = min(max(count, len(page)), modelCatalogMaxItems)
		}
		models = append(models, page...)
		if len(page) < modelCatalogPageSize {
			break
		}
	}
	client.writeCache(key, models, time.Now())
	return cloneModelCatalog(models), nil
}

func (client *ucloudModelCatalogClient) fetchPage(ctx context.Context, authorization string, offset int) ([]*biz.ModelCatalogItem, int, error) {
	body, err := json.Marshal(map[string]any{
		"Action": "ListUFSquareModel", "Offset": offset, "Limit": modelCatalogPageSize,
		"OrderBy": "HfUpdateTime", "Order": "Desc",
	})
	if err != nil {
		return nil, 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.data.ucloudMarketEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Authorization", strings.TrimSpace(authorization))
	request.Header.Set("Content-Type", "application/json")
	response, err := client.data.marketHTTPClient.Do(request)
	if err != nil {
		return nil, 0, fmt.Errorf("call UCloud model catalog: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxUCloudMarketResponseBytes+1))
	if err != nil || len(payload) > maxUCloudMarketResponseBytes {
		return nil, 0, fmt.Errorf("read UCloud model catalog response")
	}
	parsed := ucloudModelCatalogResponse{}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, 0, fmt.Errorf("decode UCloud model catalog: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || parsed.RetCode == nil || *parsed.RetCode != 0 {
		return nil, 0, fmt.Errorf("UCloud model catalog RetCode: %s", strings.TrimSpace(parsed.Message))
	}
	raw, err := decodeSquareModels(parsed.SquareModels)
	if err != nil {
		return nil, 0, err
	}
	models := make([]*biz.ModelCatalogItem, 0, len(raw))
	for _, model := range raw {
		item := normalizeSquareModel(model)
		if item.ID != "" {
			models = append(models, item)
		}
	}
	return models, parseCatalogCount(parsed.TotalCount, len(models)), nil
}

func decodeSquareModels(payload json.RawMessage) ([]ucloudSquareModel, error) {
	if len(payload) == 0 || string(payload) == "null" {
		return nil, nil
	}
	var list []ucloudSquareModel
	if err := json.Unmarshal(payload, &list); err == nil {
		return list, nil
	}
	var keyed map[string]ucloudSquareModel
	if err := json.Unmarshal(payload, &keyed); err != nil {
		return nil, fmt.Errorf("decode UCloud model list: %w", err)
	}
	list = make([]ucloudSquareModel, 0, len(keyed))
	for _, model := range keyed {
		list = append(list, model)
	}
	return list, nil
}

func normalizeSquareModel(model ucloudSquareModel) *biz.ModelCatalogItem {
	id := strings.TrimSpace(model.ID)
	if id == "" {
		id = strings.TrimSpace(model.Name)
	}
	outputs := cleanStrings(model.OutputModalities)
	if len(outputs) == 0 {
		outputs = cleanStrings(model.ModalTypes)
	}
	return &biz.ModelCatalogItem{
		ID: id, Name: strings.TrimSpace(model.Name), ChineseName: strings.TrimSpace(model.ChineseName),
		Manufacturer:  strings.TrimSpace(model.Manufacturer),
		Description:   catalogFirstNonEmpty(model.SimpleDescribe, model.Describe, model.Description),
		DescriptionEn: catalogFirstNonEmpty(model.SimpleDescribeEn, model.DescribeEn, model.DescriptionEn),
		ModelType:     strings.TrimSpace(model.ModelType), InputModalities: cleanStrings(model.InputModalities),
		OutputModalities: outputs, Capabilities: cleanStrings(model.SupportedCapabilities),
		ContextLength: max(intValue(model.MaxModelLen), intValue(model.MaxInputTokens), intValue(model.MaxOutputTokens)),
		IconURL:       strings.TrimSpace(model.Icon), CoverURL: strings.TrimSpace(model.CoverURL), Pricing: model.Pricing,
		UpdatedAtUnix: max(model.HfUpdateTime, model.UpdateAt, model.CreateAt),
	}
}

func intValue(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case json.Number:
		result, _ := typed.Int64()
		return result
	case string:
		result, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return result
	case []any:
		var result int64
		for _, item := range typed {
			result = max(result, intValue(item))
		}
		return result
	default:
		return 0
	}
}

func parseCatalogCount(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(typed)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func cleanStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func catalogFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func (client *ucloudModelCatalogClient) readCache(key [sha256.Size]byte, now time.Time) []*biz.ModelCatalogItem {
	client.mu.Lock()
	defer client.mu.Unlock()
	item, ok := client.cache[key]
	if !ok || !item.expiresAt.After(now) {
		delete(client.cache, key)
		return nil
	}
	return cloneModelCatalog(item.models)
}

func (client *ucloudModelCatalogClient) writeCache(key [sha256.Size]byte, models []*biz.ModelCatalogItem, now time.Time) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.cache) >= 128 {
		client.cache = make(map[[sha256.Size]byte]cachedModelCatalog)
	}
	client.cache[key] = cachedModelCatalog{models: cloneModelCatalog(models), expiresAt: now.Add(modelCatalogCacheTTL)}
}

func cloneModelCatalog(models []*biz.ModelCatalogItem) []*biz.ModelCatalogItem {
	result := make([]*biz.ModelCatalogItem, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		clone := *model
		clone.InputModalities = append([]string(nil), model.InputModalities...)
		clone.OutputModalities = append([]string(nil), model.OutputModalities...)
		clone.Capabilities = append([]string(nil), model.Capabilities...)
		if model.Pricing != nil {
			clone.Pricing = make(map[string]any, len(model.Pricing))
			for key, value := range model.Pricing {
				clone.Pricing[key] = value
			}
		}
		result = append(result, &clone)
	}
	return result
}
