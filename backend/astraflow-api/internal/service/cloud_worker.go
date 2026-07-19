package service

import (
	"context"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type CloudWorkerService struct {
	v1.UnimplementedCloudWorkerServiceServer
	uc *biz.CloudWorkerUsecase
}

func NewCloudWorkerService(uc *biz.CloudWorkerUsecase) *CloudWorkerService {
	return &CloudWorkerService{uc: uc}
}

func (service *CloudWorkerService) ClaimWorkspace(ctx context.Context, request *v1.ClaimCloudWorkspaceRequest) (*v1.CloudWorkspaceLease, error) {
	lease, err := service.uc.ClaimWorkspace(ctx, authorizationFromContext(ctx), request.GetWorkerId(), int(request.GetLeaseSeconds()))
	if err != nil {
		return nil, err
	}
	return &v1.CloudWorkspaceLease{
		Workspace: toWorkspaceDTO(lease.Workspace), AccountId: lease.AccountID,
		Repository: toProtoStruct(lease.Repository), LeaseToken: lease.LeaseToken,
		LeaseExpiresAt: timestamppb.New(lease.LeaseExpiresAt),
	}, nil
}

func (service *CloudWorkerService) CompleteWorkspace(ctx context.Context, request *v1.CompleteCloudWorkspaceRequest) (*v1.Workspace, error) {
	workspace, err := service.uc.CompleteWorkspace(ctx, authorizationFromContext(ctx), request.GetWorkspaceId(), request.GetWorkerId(), request.GetLeaseToken(), request.GetState(), request.GetSandboxId(), request.GetErrorMessage())
	if err != nil {
		return nil, err
	}
	return toWorkspaceDTO(workspace), nil
}

func (service *CloudWorkerService) ClaimRun(ctx context.Context, request *v1.ClaimCloudRunRequest) (*v1.CloudRunLease, error) {
	lease, err := service.uc.ClaimRun(ctx, authorizationFromContext(ctx), request.GetWorkerId(), int(request.GetLeaseSeconds()))
	if err != nil {
		return nil, err
	}
	response := &v1.CloudRunLease{
		Run: toAgentRunDTO(lease.Run), Workspace: toWorkspaceDTO(lease.Workspace),
		Session: toSessionDTO(lease.Session), AccountId: lease.AccountID,
		LeaseToken: lease.LeaseToken, LeaseExpiresAt: timestamppb.New(lease.LeaseExpiresAt),
		Messages:  make([]*v1.Message, 0, len(lease.Messages)),
		Artifacts: make([]*v1.Artifact, 0, len(lease.Artifacts)),
		Actions:   make([]*v1.AgentAction, 0, len(lease.Actions)),
	}
	for _, message := range lease.Messages {
		response.Messages = append(response.Messages, toMessageDTO(message))
	}
	for _, artifact := range lease.Artifacts {
		response.Artifacts = append(response.Artifacts, toArtifactDTO(artifact))
	}
	for _, action := range lease.Actions {
		response.Actions = append(response.Actions, toAgentActionDTO(action))
	}
	return response, nil
}

func (service *CloudWorkerService) RenewRun(ctx context.Context, request *v1.RenewCloudRunRequest) (*v1.CloudRunLeaseState, error) {
	state, err := service.uc.RenewRun(ctx, authorizationFromContext(ctx), request.GetRunId(), request.GetWorkerId(), request.GetLeaseToken(), int(request.GetLeaseSeconds()))
	if err != nil {
		return nil, err
	}
	response := &v1.CloudRunLeaseState{
		Run: toAgentRunDTO(state.Run), LeaseExpiresAt: timestamppb.New(state.LeaseExpiresAt),
		Actions: make([]*v1.AgentAction, 0, len(state.Actions)),
	}
	for _, action := range state.Actions {
		response.Actions = append(response.Actions, toAgentActionDTO(action))
	}
	return response, nil
}

func (service *CloudWorkerService) AppendRunEvents(ctx context.Context, request *v1.AppendCloudRunEventsRequest) (*v1.AppendAgentRunEventsResponse, error) {
	events := make([]*biz.AgentRunEvent, 0, len(request.GetEvents()))
	for _, event := range request.GetEvents() {
		events = append(events, &biz.AgentRunEvent{
			EventID: event.GetEventId(), Seq: event.GetSeq(), Type: event.GetType(),
			Payload: fromProtoStruct(event.GetPayload()), ProducerType: event.GetProducerType(),
			ProducerID: event.GetProducerId(), OccurredAt: fromProtoTimestamp(event.GetOccurredAt()),
		})
	}
	accepted, run, err := service.uc.AppendRunEvents(ctx, authorizationFromContext(ctx), request.GetRunId(), request.GetWorkerId(), request.GetLeaseToken(), biz.AppendAgentRunEventsOptions{
		RunID: request.GetRunId(), RunStatus: request.GetRunStatus(), RuntimeSessionRef: request.GetRuntimeSessionRef(),
		ErrorCode: request.GetErrorCode(), ErrorMessage: request.GetErrorMessage(),
	}, events)
	if err != nil {
		return nil, err
	}
	return &v1.AppendAgentRunEventsResponse{AcceptedCount: int32(accepted), LastEventSeq: run.LastEventSeq, Run: toAgentRunDTO(run)}, nil
}

func (service *CloudWorkerService) CreateRunArtifactUpload(ctx context.Context, request *v1.CreateCloudRunArtifactUploadRequest) (*v1.ArtifactUpload, error) {
	upload, err := service.uc.CreateRunArtifactUpload(
		ctx,
		authorizationFromContext(ctx),
		request.GetRunId(),
		request.GetWorkerId(),
		request.GetLeaseToken(),
		&biz.ArtifactUpload{
			ID: request.GetUploadId(), ArtifactID: request.GetArtifactId(),
			Kind: request.GetKind(), FileName: request.GetFileName(), MimeType: request.GetMimeType(),
			Size: request.GetSize(), SHA256: request.GetSha256(), ClientMutationID: request.GetClientMutationId(),
		},
	)
	if err != nil {
		return nil, err
	}
	return toArtifactUploadDTO(upload), nil
}

func (service *CloudWorkerService) CompleteRunArtifactUpload(ctx context.Context, request *v1.CompleteCloudRunArtifactUploadRequest) (*v1.Artifact, error) {
	artifact, err := service.uc.CompleteRunArtifactUpload(
		ctx,
		authorizationFromContext(ctx),
		request.GetRunId(),
		request.GetWorkerId(),
		request.GetLeaseToken(),
		request.GetUploadId(),
	)
	if err != nil {
		return nil, err
	}
	return toArtifactDTO(artifact), nil
}
