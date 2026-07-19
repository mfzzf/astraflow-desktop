package service

import (
	"context"
	"strconv"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type AutomationService struct {
	v1.UnimplementedAutomationServiceServer
	uc *biz.AutomationUsecase
}

func NewAutomationService(uc *biz.AutomationUsecase) *AutomationService {
	return &AutomationService{uc: uc}
}

func (service *AutomationService) ListAutomations(ctx context.Context, request *v1.ListAutomationsRequest) (*v1.ListAutomationsResponse, error) {
	offset, err := biz.ParseAutomationPageToken(request.GetPageToken())
	if err != nil {
		return nil, err
	}
	limit := int(request.GetPageSize())
	items, more, err := service.uc.ListAutomations(ctx, authorizationFromContext(ctx), biz.AutomationListOptions{Offset: offset, Limit: limit})
	if err != nil {
		return nil, err
	}
	response := &v1.ListAutomationsResponse{Automations: make([]*v1.CloudAutomation, 0, len(items))}
	for _, item := range items {
		response.Automations = append(response.Automations, toCloudAutomationDTO(item))
	}
	if more {
		if limit <= 0 || limit > 100 {
			limit = 50
		}
		response.NextPageToken = strconv.Itoa(offset + limit)
	}
	return response, nil
}

func (service *AutomationService) CreateAutomation(ctx context.Context, request *v1.CreateAutomationRequest) (*v1.CloudAutomation, error) {
	automation, err := service.uc.CreateAutomation(ctx, authorizationFromContext(ctx), &biz.CloudAutomation{
		ID: request.GetAutomationId(), WorkspaceID: request.GetWorkspaceId(),
		Name: request.GetName(), Prompt: request.GetPrompt(), RuntimeID: request.GetRuntimeId(),
		Model: request.GetModel(), ReasoningEffort: request.GetReasoningEffort(),
		PermissionMode: request.GetPermissionMode(), ScheduleKind: request.GetScheduleKind(),
		ScheduleExpression: request.GetScheduleExpression(), TimeZone: request.GetTimeZone(),
		Enabled: request.GetEnabled(), SourceDeviceID: request.GetSourceDeviceId(),
		ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toCloudAutomationDTO(automation), nil
}

func (service *AutomationService) SetAutomationEnabled(ctx context.Context, request *v1.SetAutomationEnabledRequest) (*v1.CloudAutomation, error) {
	automation, err := service.uc.SetAutomationEnabled(
		ctx, authorizationFromContext(ctx), request.GetAutomationId(), request.GetExpectedVersion(),
		request.GetEnabled(), request.GetSourceDeviceId(), request.GetClientMutationId(),
	)
	if err != nil {
		return nil, err
	}
	return toCloudAutomationDTO(automation), nil
}

func toCloudAutomationDTO(automation *biz.CloudAutomation) *v1.CloudAutomation {
	if automation == nil {
		return nil
	}
	result := &v1.CloudAutomation{
		Id: automation.ID, WorkspaceId: automation.WorkspaceID, Name: automation.Name,
		Prompt: automation.Prompt, RuntimeId: automation.RuntimeID, Model: automation.Model,
		ReasoningEffort: automation.ReasoningEffort, PermissionMode: automation.PermissionMode,
		ScheduleKind: automation.ScheduleKind, ScheduleExpression: automation.ScheduleExpression,
		TimeZone: automation.TimeZone, Enabled: automation.Enabled, Version: automation.Version,
		LastError: automation.LastError, CreatedAt: timestamppb.New(automation.CreatedAt),
		UpdatedAt: timestamppb.New(automation.UpdatedAt),
	}
	if automation.NextRunAt != nil {
		result.NextRunAt = timestamppb.New(*automation.NextRunAt)
	}
	if automation.LastRunAt != nil {
		result.LastRunAt = timestamppb.New(*automation.LastRunAt)
	}
	return result
}
