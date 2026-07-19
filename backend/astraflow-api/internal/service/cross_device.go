package service

import (
	"context"
	"strconv"
	"strings"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type CrossDeviceService struct {
	v1.UnimplementedCrossDeviceServiceServer
	uc *biz.CrossDeviceUsecase
}

func NewCrossDeviceService(uc *biz.CrossDeviceUsecase) *CrossDeviceService {
	return &CrossDeviceService{uc: uc}
}

func (service *CrossDeviceService) GetNativeOAuthConfig(ctx context.Context, _ *v1.GetNativeOAuthConfigRequest) (*v1.NativeOAuthConfig, error) {
	config, err := service.uc.NativeOAuthConfig(ctx)
	if err != nil {
		return nil, err
	}
	return &v1.NativeOAuthConfig{
		AuthorizationEndpoint: config.AuthorizationEndpoint, ClientId: config.ClientID, Scopes: config.Scopes,
	}, nil
}

func (service *CrossDeviceService) ExchangeNativeOAuthCode(ctx context.Context, request *v1.ExchangeNativeOAuthCodeRequest) (*v1.NativeOAuthTokens, error) {
	tokens, err := service.uc.ExchangeNativeOAuthCode(ctx, request.GetCode(), request.GetRedirectUri(), request.GetCodeVerifier())
	if err != nil {
		return nil, err
	}
	return toNativeOAuthTokensDTO(tokens), nil
}

func (service *CrossDeviceService) RefreshNativeOAuthToken(ctx context.Context, request *v1.RefreshNativeOAuthTokenRequest) (*v1.NativeOAuthTokens, error) {
	tokens, err := service.uc.RefreshNativeOAuthToken(ctx, request.GetRefreshToken())
	if err != nil {
		return nil, err
	}
	return toNativeOAuthTokensDTO(tokens), nil
}

func (service *CrossDeviceService) GetCurrentAccount(ctx context.Context, _ *v1.GetCurrentAccountRequest) (*v1.Account, error) {
	account, err := service.uc.CurrentAccount(ctx, authorizationFromContext(ctx))
	if err != nil {
		return nil, err
	}
	return toAccountDTO(account), nil
}

func (service *CrossDeviceService) RegisterDevice(ctx context.Context, request *v1.RegisterDeviceRequest) (*v1.Device, error) {
	device, err := service.uc.RegisterDevice(ctx, authorizationFromContext(ctx), &biz.Device{
		ID: request.GetDeviceId(), Type: request.GetType(), Name: request.GetName(),
		Platform: request.GetPlatform(), AppVersion: request.GetAppVersion(),
		ProtocolVersion: int(request.GetProtocolVersion()), Capabilities: fromProtoStruct(request.GetCapabilities()),
		PublicKey: request.GetPublicKey(),
	}, request.GetClientMutationId())
	if err != nil {
		return nil, err
	}
	return toDeviceDTO(device), nil
}

func (service *CrossDeviceService) ListDevices(ctx context.Context, request *v1.ListDevicesRequest) (*v1.ListDevicesResponse, error) {
	devices, err := service.uc.ListDevices(ctx, authorizationFromContext(ctx), request.GetIncludeRevoked())
	if err != nil {
		return nil, err
	}
	response := &v1.ListDevicesResponse{Devices: make([]*v1.Device, 0, len(devices))}
	for _, device := range devices {
		response.Devices = append(response.Devices, toDeviceDTO(device))
	}
	return response, nil
}

func (service *CrossDeviceService) RevokeDevice(ctx context.Context, request *v1.RevokeDeviceRequest) (*v1.Device, error) {
	device, err := service.uc.RevokeDevice(ctx, authorizationFromContext(ctx), request.GetDeviceId(), request.GetExpectedVersion())
	if err != nil {
		return nil, err
	}
	return toDeviceDTO(device), nil
}

func (service *CrossDeviceService) CreateDeviceConnectionToken(ctx context.Context, request *v1.CreateDeviceConnectionTokenRequest) (*v1.DeviceConnectionToken, error) {
	token, err := service.uc.CreateDeviceConnectionToken(ctx, authorizationFromContext(ctx), request.GetDeviceId())
	if err != nil {
		return nil, err
	}
	return &v1.DeviceConnectionToken{
		Token: token.Token, WebsocketPath: token.WebSocketPath, ExpiresAt: timestamppb.New(token.ExpiresAt),
	}, nil
}

func (service *CrossDeviceService) UpsertPushEndpoint(ctx context.Context, request *v1.UpsertPushEndpointRequest) (*v1.PushEndpoint, error) {
	endpoint, err := service.uc.UpsertPushEndpoint(ctx, authorizationFromContext(ctx), &biz.PushEndpoint{
		ID: request.GetEndpointId(), DeviceID: request.GetDeviceId(), Provider: request.GetProvider(),
		Token: request.GetToken(), Locale: request.GetLocale(), Enabled: request.GetEnabled(),
	})
	if err != nil {
		return nil, err
	}
	return toPushEndpointDTO(endpoint), nil
}

func (service *CrossDeviceService) CreateWorkspace(ctx context.Context, request *v1.CreateWorkspaceRequest) (*v1.Workspace, error) {
	workspace, err := service.uc.CreateWorkspace(ctx, authorizationFromContext(ctx), &biz.Workspace{
		ID: request.GetWorkspaceId(), ProjectID: request.GetProjectId(), Type: request.GetType(), Name: request.GetName(),
		OwnerDeviceID: request.GetOwnerDeviceId(), GatewayProtocolVersion: int(request.GetGatewayProtocolVersion()),
		SourceDeviceID: request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toWorkspaceDTO(workspace), nil
}

func (service *CrossDeviceService) ListWorkspaces(ctx context.Context, request *v1.ListWorkspacesRequest) (*v1.ListWorkspacesResponse, error) {
	workspaces, err := service.uc.ListWorkspaces(ctx, authorizationFromContext(ctx), request.GetIncludeUnavailable())
	if err != nil {
		return nil, err
	}
	response := &v1.ListWorkspacesResponse{Workspaces: make([]*v1.Workspace, 0, len(workspaces))}
	for _, workspace := range workspaces {
		response.Workspaces = append(response.Workspaces, toWorkspaceDTO(workspace))
	}
	return response, nil
}

func (service *CrossDeviceService) GetWorkspace(ctx context.Context, request *v1.GetWorkspaceRequest) (*v1.Workspace, error) {
	workspace, err := service.uc.GetWorkspace(ctx, authorizationFromContext(ctx), request.GetWorkspaceId())
	if err != nil {
		return nil, err
	}
	return toWorkspaceDTO(workspace), nil
}

func (service *CrossDeviceService) CreateSession(ctx context.Context, request *v1.CreateSessionRequest) (*v1.Session, error) {
	session, err := service.uc.CreateSession(ctx, authorizationFromContext(ctx), &biz.Session{
		ID: request.GetSessionId(), WorkspaceID: request.GetWorkspaceId(), Mode: request.GetMode(), Title: request.GetTitle(),
		RuntimeID: request.GetRuntimeId(), Model: request.GetModel(), ReasoningEffort: request.GetReasoningEffort(),
		PermissionMode: request.GetPermissionMode(), SourceDeviceID: request.GetSourceDeviceId(),
		ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toSessionDTO(session), nil
}

func (service *CrossDeviceService) ListSessions(ctx context.Context, request *v1.ListSessionsRequest) (*v1.ListSessionsResponse, error) {
	offset := parsePageToken(request.GetPageToken())
	limit := int(request.GetPageSize())
	sessions, more, err := service.uc.ListSessions(ctx, authorizationFromContext(ctx), biz.SessionListOptions{
		Offset: offset, Limit: limit, IncludeArchived: request.GetIncludeArchived(),
	})
	if err != nil {
		return nil, err
	}
	response := &v1.ListSessionsResponse{Sessions: make([]*v1.Session, 0, len(sessions))}
	for _, session := range sessions {
		response.Sessions = append(response.Sessions, toSessionDTO(session))
	}
	if more {
		if limit <= 0 || limit > biz.MaxSessionPageSize {
			limit = 30
		}
		response.NextPageToken = strconv.Itoa(offset + limit)
	}
	return response, nil
}

func (service *CrossDeviceService) GetSession(ctx context.Context, request *v1.GetSessionRequest) (*v1.Session, error) {
	session, err := service.uc.GetSession(ctx, authorizationFromContext(ctx), request.GetSessionId())
	if err != nil {
		return nil, err
	}
	return toSessionDTO(session), nil
}

func (service *CrossDeviceService) UpdateSession(ctx context.Context, request *v1.UpdateSessionRequest) (*v1.Session, error) {
	session, err := service.uc.UpdateSession(ctx, authorizationFromContext(ctx), biz.SessionUpdate{
		SessionID: request.GetSessionId(), ExpectedVersion: request.GetExpectedVersion(),
		Title: request.Title, Pinned: request.Pinned, Archived: request.Archived, Model: request.Model,
		ReasoningEffort: request.ReasoningEffort, PermissionMode: request.PermissionMode,
		WorkspaceID: request.WorkspaceId, RuntimeID: request.RuntimeId,
		SourceDeviceID: request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toSessionDTO(session), nil
}

func (service *CrossDeviceService) CreateMessage(ctx context.Context, request *v1.CreateMessageRequest) (*v1.Message, error) {
	message, err := service.uc.CreateMessage(ctx, authorizationFromContext(ctx), &biz.Message{
		ID: request.GetMessageId(), SessionID: request.GetSessionId(), Role: request.GetRole(), Status: request.GetStatus(),
		Content: fromProtoStruct(request.GetContent()), Parts: fromProtoStructs(request.GetParts()),
		SourceDeviceID: request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toMessageDTO(message), nil
}

func (service *CrossDeviceService) ListMessages(ctx context.Context, request *v1.ListMessagesRequest) (*v1.ListMessagesResponse, error) {
	offset := parsePageToken(request.GetPageToken())
	limit := int(request.GetPageSize())
	messages, more, err := service.uc.ListMessages(ctx, authorizationFromContext(ctx), request.GetSessionId(), biz.MessageListOptions{
		Offset: offset, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	response := &v1.ListMessagesResponse{Messages: make([]*v1.Message, 0, len(messages))}
	for _, message := range messages {
		response.Messages = append(response.Messages, toMessageDTO(message))
	}
	if more {
		if limit <= 0 || limit > biz.MaxMessagePageSize {
			limit = 50
		}
		response.NextPageToken = strconv.Itoa(offset + limit)
	}
	return response, nil
}

func (service *CrossDeviceService) CreateAgentRun(ctx context.Context, request *v1.CreateAgentRunRequest) (*v1.AgentRun, error) {
	run, err := service.uc.CreateAgentRun(ctx, authorizationFromContext(ctx), &biz.AgentRun{
		ID: request.GetRunId(), SessionID: request.GetSessionId(), ExecutionTarget: request.GetExecutionTarget(),
		TargetDeviceID: request.GetTargetDeviceId(), WorkspaceID: request.GetWorkspaceId(), RuntimeID: request.GetRuntimeId(),
		Model: request.GetModel(), ReasoningEffort: request.GetReasoningEffort(), PermissionMode: request.GetPermissionMode(),
		ReturnArtifacts: request.GetReturnArtifacts(),
		DispatchMode:    request.GetDispatchMode(),
		SourceDeviceID:  request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toAgentRunDTO(run), nil
}

func (service *CrossDeviceService) GetAgentRun(ctx context.Context, request *v1.GetAgentRunRequest) (*v1.AgentRun, error) {
	run, err := service.uc.GetAgentRun(ctx, authorizationFromContext(ctx), request.GetRunId())
	if err != nil {
		return nil, err
	}
	return toAgentRunDTO(run), nil
}

func (service *CrossDeviceService) ListAgentRuns(ctx context.Context, request *v1.ListAgentRunsRequest) (*v1.ListAgentRunsResponse, error) {
	offset := parsePageToken(request.GetPageToken())
	limit := int(request.GetPageSize())
	runs, more, err := service.uc.ListAgentRuns(ctx, authorizationFromContext(ctx), biz.AgentRunListOptions{
		SessionID: request.GetSessionId(), Offset: offset, Limit: limit, ActiveOnly: request.GetActiveOnly(),
	})
	if err != nil {
		return nil, err
	}
	response := &v1.ListAgentRunsResponse{Runs: make([]*v1.AgentRun, 0, len(runs))}
	for _, run := range runs {
		response.Runs = append(response.Runs, toAgentRunDTO(run))
	}
	if more {
		if limit <= 0 || limit > biz.MaxAgentRunPageSize {
			limit = 30
		}
		response.NextPageToken = strconv.Itoa(offset + limit)
	}
	return response, nil
}

func (service *CrossDeviceService) CancelAgentRun(ctx context.Context, request *v1.CancelAgentRunRequest) (*v1.AgentRun, error) {
	run, err := service.uc.CancelAgentRun(ctx, authorizationFromContext(ctx), request.GetRunId(), request.GetSourceDeviceId(), request.GetClientMutationId())
	if err != nil {
		return nil, err
	}
	return toAgentRunDTO(run), nil
}

func (service *CrossDeviceService) AppendAgentRunEvents(ctx context.Context, request *v1.AppendAgentRunEventsRequest) (*v1.AppendAgentRunEventsResponse, error) {
	events := make([]*biz.AgentRunEvent, 0, len(request.GetEvents()))
	for _, event := range request.GetEvents() {
		events = append(events, &biz.AgentRunEvent{
			EventID: event.GetEventId(), Seq: event.GetSeq(), Type: event.GetType(), Payload: fromProtoStruct(event.GetPayload()),
			ProducerType: event.GetProducerType(), ProducerID: event.GetProducerId(), OccurredAt: fromProtoTimestamp(event.GetOccurredAt()),
		})
	}
	accepted, run, err := service.uc.AppendAgentRunEvents(ctx, authorizationFromContext(ctx), biz.AppendAgentRunEventsOptions{
		RunID: request.GetRunId(), RunStatus: request.GetRunStatus(), RuntimeSessionRef: request.GetRuntimeSessionRef(),
		ErrorCode: request.GetErrorCode(), ErrorMessage: request.GetErrorMessage(),
	}, events)
	if err != nil {
		return nil, err
	}
	return &v1.AppendAgentRunEventsResponse{AcceptedCount: int32(accepted), LastEventSeq: run.LastEventSeq, Run: toAgentRunDTO(run)}, nil
}

func (service *CrossDeviceService) ListAgentRunEvents(ctx context.Context, request *v1.ListAgentRunEventsRequest) (*v1.ListAgentRunEventsResponse, error) {
	events, last, more, err := service.uc.ListAgentRunEvents(ctx, authorizationFromContext(ctx), request.GetRunId(), request.GetAfterSeq(), int(request.GetLimit()))
	if err != nil {
		return nil, err
	}
	response := &v1.ListAgentRunEventsResponse{LastEventSeq: last, HasMore: more, Events: make([]*v1.AgentRunEvent, 0, len(events))}
	for _, event := range events {
		response.Events = append(response.Events, toAgentRunEventDTO(event))
	}
	return response, nil
}

func (service *CrossDeviceService) ResolveAgentAction(ctx context.Context, request *v1.ResolveAgentActionRequest) (*v1.AgentAction, error) {
	action, err := service.uc.ResolveAgentAction(ctx, authorizationFromContext(ctx), biz.AgentActionResolution{
		RunID: request.GetRunId(), ActionID: request.GetActionId(), ExpectedVersion: request.GetExpectedVersion(),
		Resolution: request.GetResolution(), Payload: fromProtoStruct(request.GetPayload()),
		SourceDeviceID: request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toAgentActionDTO(action), nil
}

func (service *CrossDeviceService) ListAgentActions(ctx context.Context, request *v1.ListAgentActionsRequest) (*v1.ListAgentActionsResponse, error) {
	actions, err := service.uc.ListAgentActions(ctx, authorizationFromContext(ctx), request.GetRunId(), request.GetPendingOnly())
	if err != nil {
		return nil, err
	}
	response := &v1.ListAgentActionsResponse{Actions: make([]*v1.AgentAction, 0, len(actions))}
	for _, action := range actions {
		response.Actions = append(response.Actions, toAgentActionDTO(action))
	}
	return response, nil
}

func (service *CrossDeviceService) PullSyncEvents(ctx context.Context, request *v1.PullSyncEventsRequest) (*v1.PullSyncEventsResponse, error) {
	return service.PullSyncEventsAuthorized(ctx, authorizationFromContext(ctx), request.GetAfter(), int(request.GetLimit()))
}

func (service *CrossDeviceService) PullSyncEventsAuthorized(ctx context.Context, authorization string, after int64, limit int) (*v1.PullSyncEventsResponse, error) {
	events, more, resync, err := service.uc.PullSyncEvents(ctx, authorization, after, limit)
	if err != nil {
		return nil, err
	}
	response := &v1.PullSyncEventsResponse{HasMore: more, ResyncRequired: resync, NextCursor: after, Events: make([]*v1.SyncEventEnvelope, 0, len(events))}
	for _, event := range events {
		response.Events = append(response.Events, toSyncEventDTO(event))
		response.NextCursor = event.Cursor
	}
	return response, nil
}

func (service *CrossDeviceService) GetSyncSnapshot(ctx context.Context, request *v1.GetSyncSnapshotRequest) (*v1.GetSyncSnapshotResponse, error) {
	snapshot, err := service.uc.GetSyncSnapshot(ctx, authorizationFromContext(ctx), request.GetIncludeArchivedSessions())
	if err != nil {
		return nil, err
	}
	response := &v1.GetSyncSnapshotResponse{
		Account: toAccountDTO(snapshot.Account), Cursor: snapshot.Cursor, SchemaVersion: int32(snapshot.SchemaVersion),
		Devices:        make([]*v1.Device, 0, len(snapshot.Devices)),
		Workspaces:     make([]*v1.Workspace, 0, len(snapshot.Workspaces)),
		Sessions:       make([]*v1.Session, 0, len(snapshot.Sessions)),
		ActiveRuns:     make([]*v1.AgentRun, 0, len(snapshot.ActiveRuns)),
		PendingActions: make([]*v1.AgentAction, 0, len(snapshot.PendingActions)),
	}
	for _, device := range snapshot.Devices {
		response.Devices = append(response.Devices, toDeviceDTO(device))
	}
	for _, workspace := range snapshot.Workspaces {
		response.Workspaces = append(response.Workspaces, toWorkspaceDTO(workspace))
	}
	for _, session := range snapshot.Sessions {
		response.Sessions = append(response.Sessions, toSessionDTO(session))
	}
	for _, run := range snapshot.ActiveRuns {
		response.ActiveRuns = append(response.ActiveRuns, toAgentRunDTO(run))
	}
	for _, action := range snapshot.PendingActions {
		response.PendingActions = append(response.PendingActions, toAgentActionDTO(action))
	}
	return response, nil
}

func (service *CrossDeviceService) ApplySyncMutations(ctx context.Context, request *v1.ApplySyncMutationsRequest) (*v1.ApplySyncMutationsResponse, error) {
	authorization := authorizationFromContext(ctx)
	if _, err := service.uc.CurrentAccount(ctx, authorization); err != nil {
		return nil, err
	}
	if len(request.GetMutations()) == 0 || len(request.GetMutations()) > 100 {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "between 1 and 100 sync mutations are required")
	}
	response := &v1.ApplySyncMutationsResponse{Results: make([]*v1.SyncMutationResult, 0, len(request.GetMutations()))}
	for _, mutation := range request.GetMutations() {
		result := &v1.SyncMutationResult{MutationId: strings.TrimSpace(mutation.GetMutationId())}
		if result.MutationId == "" {
			result.Status, result.ErrorCode, result.ErrorMessage = "failed", "INVALID_ARGUMENT", "mutation id is required"
			response.Results = append(response.Results, result)
			continue
		}
		entityType, entityID, version, err := service.applySyncMutation(ctx, authorization, request.GetSourceDeviceId(), mutation)
		result.EntityType, result.EntityId, result.EntityVersion = entityType, entityID, version
		if err != nil {
			serviceError := kerrors.FromError(err)
			result.Status, result.ErrorCode, result.ErrorMessage = "failed", serviceError.Reason, serviceError.Message
		} else {
			result.Status = "applied"
		}
		response.Results = append(response.Results, result)
	}
	return response, nil
}

func (service *CrossDeviceService) applySyncMutation(ctx context.Context, authorization, sourceDeviceID string, mutation *v1.SyncMutation) (string, string, int64, error) {
	payload := fromProtoStruct(mutation.GetPayload())
	switch strings.ToLower(strings.TrimSpace(mutation.GetOperation())) {
	case "workspace.create":
		entityID := syncString(payload, "workspaceId", "workspace_id", "id")
		workspace, err := service.uc.CreateWorkspace(ctx, authorization, &biz.Workspace{
			ID: entityID, ProjectID: syncString(payload, "projectId", "project_id"),
			Type: syncString(payload, "type"), Name: syncString(payload, "name"),
			OwnerDeviceID:          syncString(payload, "ownerDeviceId", "owner_device_id"),
			GatewayProtocolVersion: int(syncNumber(payload, "gatewayProtocolVersion", "gateway_protocol_version")),
			SourceDeviceID:         sourceDeviceID, ClientMutationID: mutation.GetMutationId(),
		})
		if err != nil {
			return "workspace", entityID, 0, err
		}
		return "workspace", workspace.ID, 0, nil
	case "session.create":
		entityID := syncString(payload, "sessionId", "session_id", "id")
		session, err := service.uc.CreateSession(ctx, authorization, &biz.Session{
			ID: entityID, WorkspaceID: syncString(payload, "workspaceId", "workspace_id"),
			Mode: syncString(payload, "mode"), Title: syncString(payload, "title"),
			RuntimeID: syncString(payload, "runtimeId", "runtime_id"), Model: syncString(payload, "model"),
			ReasoningEffort: syncString(payload, "reasoningEffort", "reasoning_effort"),
			PermissionMode:  syncString(payload, "permissionMode", "permission_mode"),
			SourceDeviceID:  sourceDeviceID, ClientMutationID: mutation.GetMutationId(),
		})
		if err != nil {
			return "session", entityID, 0, err
		}
		return "session", session.ID, session.Version, nil
	case "session.update":
		update := biz.SessionUpdate{
			SessionID:       syncString(payload, "sessionId", "session_id", "id"),
			ExpectedVersion: int64(syncNumber(payload, "expectedVersion", "expected_version")),
			Title:           syncOptionalString(payload, "title"), Pinned: syncOptionalBool(payload, "pinned"),
			Archived: syncOptionalBool(payload, "archived"), Model: syncOptionalString(payload, "model"),
			ReasoningEffort: syncOptionalString(payload, "reasoningEffort", "reasoning_effort"),
			PermissionMode:  syncOptionalString(payload, "permissionMode", "permission_mode"),
			WorkspaceID:     syncOptionalString(payload, "workspaceId", "workspace_id"),
			RuntimeID:       syncOptionalString(payload, "runtimeId", "runtime_id"),
			SourceDeviceID:  sourceDeviceID, ClientMutationID: mutation.GetMutationId(),
		}
		session, err := service.uc.UpdateSession(ctx, authorization, update)
		if err != nil {
			return "session", update.SessionID, 0, err
		}
		return "session", session.ID, session.Version, nil
	case "message.create":
		entityID := syncString(payload, "messageId", "message_id", "id")
		message, err := service.uc.CreateMessage(ctx, authorization, &biz.Message{
			ID: entityID, SessionID: syncString(payload, "sessionId", "session_id"),
			Role: syncString(payload, "role"), Status: syncString(payload, "status"),
			Content: syncMap(payload, "content"), Parts: syncMaps(payload, "parts"),
			SourceDeviceID: sourceDeviceID, ClientMutationID: mutation.GetMutationId(),
		})
		if err != nil {
			return "message", entityID, 0, err
		}
		return "message", message.ID, 0, nil
	default:
		return "", "", 0, kerrors.BadRequest("UNSUPPORTED_MUTATION", "sync mutation operation is not supported")
	}
}

func toAccountDTO(account *biz.Account) *v1.Account {
	return &v1.Account{
		Id: account.ID, Provider: account.Provider, Subject: account.Subject, Email: account.Email,
		DisplayName: account.DisplayName, TenantId: account.TenantID, Status: account.Status,
		CreatedAt: timestamppb.New(account.CreatedAt), UpdatedAt: timestamppb.New(account.UpdatedAt),
	}
}

func toNativeOAuthTokensDTO(tokens *biz.OAuthTokens) *v1.NativeOAuthTokens {
	return &v1.NativeOAuthTokens{
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, TokenType: tokens.TokenType,
		ExpiresIn: tokens.ExpiresIn, IdToken: tokens.IDToken,
	}
}

func toDeviceDTO(device *biz.Device) *v1.Device {
	return &v1.Device{
		Id: device.ID, Type: device.Type, Name: device.Name, Platform: device.Platform, AppVersion: device.AppVersion,
		ProtocolVersion: int32(device.ProtocolVersion), Capabilities: toProtoStruct(device.Capabilities), PublicKey: device.PublicKey,
		LastSeenAt: timestamppb.New(device.LastSeenAt), RevokedAt: toProtoTimestamp(device.RevokedAt), Version: device.Version,
		CreatedAt: timestamppb.New(device.CreatedAt), UpdatedAt: timestamppb.New(device.UpdatedAt),
		Online: device.RevokedAt == nil && device.LastSeenAt.After(time.Now().UTC().Add(-45*time.Second)),
	}
}

func toPushEndpointDTO(endpoint *biz.PushEndpoint) *v1.PushEndpoint {
	return &v1.PushEndpoint{
		Id: endpoint.ID, DeviceId: endpoint.DeviceID, Provider: endpoint.Provider, Locale: endpoint.Locale,
		Enabled: endpoint.Enabled, CreatedAt: timestamppb.New(endpoint.CreatedAt), UpdatedAt: timestamppb.New(endpoint.UpdatedAt),
	}
}

func toWorkspaceDTO(workspace *biz.Workspace) *v1.Workspace {
	return &v1.Workspace{
		Id: workspace.ID, ProjectId: workspace.ProjectID, Type: workspace.Type, Name: workspace.Name,
		SandboxId: workspace.SandboxID, GatewayProtocolVersion: int32(workspace.GatewayProtocolVersion),
		State: workspace.State, OwnerDeviceId: workspace.OwnerDeviceID,
		CreatedAt: timestamppb.New(workspace.CreatedAt), UpdatedAt: timestamppb.New(workspace.UpdatedAt),
	}
}

func toSessionDTO(session *biz.Session) *v1.Session {
	return &v1.Session{
		Id: session.ID, WorkspaceId: session.WorkspaceID, Mode: session.Mode, Title: session.Title,
		RuntimeId: session.RuntimeID, Model: session.Model, ReasoningEffort: session.ReasoningEffort,
		PermissionMode: session.PermissionMode, Version: session.Version, PinnedAt: toProtoTimestamp(session.PinnedAt),
		ArchivedAt: toProtoTimestamp(session.ArchivedAt), CreatedAt: timestamppb.New(session.CreatedAt),
		UpdatedAt: timestamppb.New(session.UpdatedAt), DeletedAt: toProtoTimestamp(session.DeletedAt),
	}
}

func toMessageDTO(message *biz.Message) *v1.Message {
	return &v1.Message{
		Id: message.ID, SessionId: message.SessionID, Role: message.Role, Status: message.Status,
		Content: toProtoStruct(message.Content), Parts: toProtoStructs(message.Parts),
		ClientMutationId: message.ClientMutationID, CreatedAt: timestamppb.New(message.CreatedAt), UpdatedAt: timestamppb.New(message.UpdatedAt),
	}
}

func toAgentRunDTO(run *biz.AgentRun) *v1.AgentRun {
	return &v1.AgentRun{
		Id: run.ID, SessionId: run.SessionID, ExecutionTarget: run.ExecutionTarget, TargetDeviceId: run.TargetDeviceID,
		WorkspaceId: run.WorkspaceID, Status: run.Status, RuntimeId: run.RuntimeID, Model: run.Model,
		ReasoningEffort: run.ReasoningEffort, PermissionMode: run.PermissionMode, RuntimeSessionRef: run.RuntimeSessionRef,
		ReturnArtifacts: run.ReturnArtifacts,
		LastEventSeq:    run.LastEventSeq, StartedAt: toProtoTimestamp(run.StartedAt), CompletedAt: toProtoTimestamp(run.CompletedAt),
		ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage, CreatedAt: timestamppb.New(run.CreatedAt), UpdatedAt: timestamppb.New(run.UpdatedAt),
	}
}

func toAgentRunEventDTO(event *biz.AgentRunEvent) *v1.AgentRunEvent {
	return &v1.AgentRunEvent{
		EventId: event.EventID, Seq: event.Seq, Type: event.Type, Payload: toProtoStruct(event.Payload),
		ProducerType: event.ProducerType, ProducerId: event.ProducerID, OccurredAt: timestamppb.New(event.OccurredAt),
	}
}

func toAgentActionDTO(action *biz.AgentAction) *v1.AgentAction {
	return &v1.AgentAction{
		Id: action.ID, RunId: action.RunID, EventSeq: action.EventSeq, Type: action.Type, Status: action.Status,
		Request: toProtoStruct(action.Request), Resolution: toProtoStruct(action.Resolution), Version: action.Version,
		ExpiresAt: toProtoTimestamp(action.ExpiresAt), ResolvedAt: toProtoTimestamp(action.ResolvedAt), CreatedAt: timestamppb.New(action.CreatedAt),
	}
}

func toSyncEventDTO(event *biz.SyncEvent) *v1.SyncEventEnvelope {
	return &v1.SyncEventEnvelope{
		SchemaVersion: int32(event.SchemaVersion), EventId: event.EventID, Cursor: event.Cursor,
		AggregateType: event.AggregateType, AggregateId: event.AggregateID, EntityVersion: event.EntityVersion,
		EventType: event.EventType, Payload: toProtoStruct(event.Payload), OccurredAt: timestamppb.New(event.OccurredAt),
	}
}

func fromProtoStruct(value *structpb.Struct) map[string]any {
	if value == nil {
		return nil
	}
	return value.AsMap()
}

func fromProtoStructs(values []*structpb.Struct) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, fromProtoStruct(value))
	}
	return result
}

func toProtoStruct(value map[string]any) *structpb.Struct {
	if value == nil {
		return &structpb.Struct{}
	}
	result, err := structpb.NewStruct(value)
	if err != nil {
		return &structpb.Struct{}
	}
	return result
}

func toProtoStructs(values []map[string]any) []*structpb.Struct {
	result := make([]*structpb.Struct, 0, len(values))
	for _, value := range values {
		result = append(result, toProtoStruct(value))
	}
	return result
}

func syncString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok {
			return value
		}
	}
	return ""
}

func syncNumber(payload map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case float64:
			return value
		case string:
			parsed, _ := strconv.ParseFloat(value, 64)
			return parsed
		}
	}
	return 0
}

func syncOptionalString(payload map[string]any, keys ...string) *string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		text, _ := value.(string)
		return &text
	}
	return nil
}

func syncOptionalBool(payload map[string]any, keys ...string) *bool {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		boolean, _ := value.(bool)
		return &boolean
	}
	return nil
}

func syncMap(payload map[string]any, key string) map[string]any {
	value, _ := payload[key].(map[string]any)
	return value
}

func syncMaps(payload map[string]any, key string) []map[string]any {
	values, _ := payload[key].([]any)
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if item, ok := value.(map[string]any); ok {
			result = append(result, item)
		}
	}
	return result
}

func fromProtoTimestamp(value *timestamppb.Timestamp) time.Time {
	if value == nil {
		return time.Time{}
	}
	return value.AsTime()
}

func toProtoTimestamp(value *time.Time) *timestamppb.Timestamp {
	if value == nil || value.IsZero() {
		return nil
	}
	return timestamppb.New(*value)
}
