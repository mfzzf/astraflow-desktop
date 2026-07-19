package service

import (
	"context"
	"strconv"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"
)

type ModelCatalogService struct {
	v1.UnimplementedModelCatalogServiceServer

	uc *biz.ModelCatalogUsecase
}

func NewModelCatalogService(uc *biz.ModelCatalogUsecase) *ModelCatalogService {
	return &ModelCatalogService{uc: uc}
}

func (service *ModelCatalogService) ListModels(ctx context.Context, request *v1.ListModelsRequest) (*v1.ListModelsResponse, error) {
	offset, err := biz.ParseModelPageToken(request.GetPageToken())
	if err != nil {
		return nil, err
	}
	result, err := service.uc.ListModels(ctx, authorizationFromContext(ctx), biz.ModelCatalogFilter{
		Keyword: request.GetKeyword(), Vendor: request.GetVendor(), OutputType: request.GetOutputType(),
		Offset: offset, Limit: int(request.GetPageSize()),
	})
	if err != nil {
		return nil, err
	}
	response := &v1.ListModelsResponse{
		Models:    make([]*v1.ModelCatalogItem, 0, len(result.Models)),
		Vendors:   make([]*v1.ModelVendorFacet, 0, len(result.Vendors)),
		TotalSize: int32(result.Total),
	}
	if result.HasMore {
		response.NextPageToken = strconv.Itoa(result.NextPage)
	}
	for _, model := range result.Models {
		response.Models = append(response.Models, &v1.ModelCatalogItem{
			Id: model.ID, Name: model.Name, ChineseName: model.ChineseName,
			Manufacturer: model.Manufacturer, Description: model.Description, DescriptionEn: model.DescriptionEn,
			ModelType: model.ModelType, InputModalities: append([]string(nil), model.InputModalities...),
			OutputModalities: append([]string(nil), model.OutputModalities...), Capabilities: append([]string(nil), model.Capabilities...),
			ContextLength: model.ContextLength, IconUrl: model.IconURL, CoverUrl: model.CoverURL,
			Pricing: toProtoStruct(model.Pricing), UpdatedAtUnix: model.UpdatedAtUnix,
		})
	}
	for _, vendor := range result.Vendors {
		response.Vendors = append(response.Vendors, &v1.ModelVendorFacet{
			Name: vendor.Name, IconUrl: vendor.IconURL, Count: int32(vendor.Count),
		})
	}
	return response, nil
}
