package biz

import (
	"context"
	"strings"
	"testing"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type identityResolverStub struct {
	identity *AuthenticatedIdentity
	err      error
}

type nativeOAuthClientStub struct{}

func (nativeOAuthClientStub) Config() (*NativeOAuthConfig, error) {
	return &NativeOAuthConfig{
		AuthorizationEndpoint: "https://oauth.example/authorize",
		ClientID:              "client",
		Scopes:                []string{"openid"},
		AllowedRedirectURIs:   []string{"astraflow://oauth/callback", "https://app.example/oauth/callback"},
	}, nil
}

func (nativeOAuthClientStub) ExchangeCode(context.Context, string, string, string) (*OAuthTokens, error) {
	return &OAuthTokens{AccessToken: "access", TokenType: "Bearer"}, nil
}

func (nativeOAuthClientStub) RefreshToken(context.Context, string) (*OAuthTokens, error) {
	return &OAuthTokens{AccessToken: "access", TokenType: "Bearer"}, nil
}

func (stub identityResolverStub) Resolve(context.Context, string) (*AuthenticatedIdentity, error) {
	return stub.identity, stub.err
}

type crossDeviceRepoStub struct {
	account       *Account
	createdRun    *AgentRun
	appended      []*AgentRunEvent
	appendOptions AppendAgentRunEventsOptions
	resultErr     error
}

func (stub *crossDeviceRepoStub) EnsureAccount(_ context.Context, account *Account) (*Account, error) {
	stub.account = account
	account.Status = "active"
	return account, nil
}

func (stub *crossDeviceRepoStub) RegisterDevice(_ context.Context, device *Device, _ string) (*Device, error) {
	return device, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListDevices(context.Context, string, bool) ([]*Device, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) RevokeDevice(context.Context, string, string, int64) (*Device, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) IssueDeviceConnectionToken(context.Context, string, string, [32]byte, time.Time) error {
	return stub.resultErr
}

func (stub *crossDeviceRepoStub) ConsumeDeviceConnectionToken(context.Context, [32]byte) (*DeviceConnectionIdentity, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) ClaimDeviceCommands(context.Context, string, string, int) ([]*DeviceCommand, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) UpdateDeviceCommand(context.Context, string, string, string, string, map[string]any) error {
	return stub.resultErr
}

func (stub *crossDeviceRepoStub) TouchDevice(context.Context, string, string) error {
	return stub.resultErr
}

func (stub *crossDeviceRepoStub) UpsertPushEndpoint(_ context.Context, endpoint *PushEndpoint) (*PushEndpoint, error) {
	return endpoint, stub.resultErr
}

func (stub *crossDeviceRepoStub) CreateWorkspace(_ context.Context, workspace *Workspace) (*Workspace, error) {
	return workspace, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListWorkspaces(context.Context, string, bool) ([]*Workspace, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) GetWorkspace(context.Context, string, string) (*Workspace, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) CreateSession(_ context.Context, session *Session) (*Session, error) {
	return session, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListSessions(context.Context, string, SessionListOptions) ([]*Session, bool, error) {
	return nil, false, stub.resultErr
}

func (stub *crossDeviceRepoStub) GetSession(context.Context, string, string) (*Session, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) UpdateSession(context.Context, string, SessionUpdate) (*Session, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) CreateMessage(_ context.Context, message *Message) (*Message, error) {
	return message, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListMessages(context.Context, string, string, MessageListOptions) ([]*Message, bool, error) {
	return nil, false, stub.resultErr
}

func (stub *crossDeviceRepoStub) CreateAgentRun(_ context.Context, run *AgentRun) (*AgentRun, error) {
	stub.createdRun = run
	return run, stub.resultErr
}

func (stub *crossDeviceRepoStub) GetAgentRun(context.Context, string, string) (*AgentRun, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListAgentRuns(context.Context, string, AgentRunListOptions) ([]*AgentRun, bool, error) {
	return nil, false, stub.resultErr
}

func (stub *crossDeviceRepoStub) CancelAgentRun(context.Context, string, string, string, string) (*AgentRun, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) AppendAgentRunEvents(_ context.Context, _ string, options AppendAgentRunEventsOptions, events []*AgentRunEvent) (int, *AgentRun, error) {
	stub.appendOptions = options
	stub.appended = events
	return len(events), &AgentRun{ID: options.RunID, LastEventSeq: events[len(events)-1].Seq}, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListAgentRunEvents(context.Context, string, string, int64, int) ([]*AgentRunEvent, int64, bool, error) {
	return nil, 0, false, stub.resultErr
}

func (stub *crossDeviceRepoStub) ResolveAgentAction(context.Context, string, AgentActionResolution) (*AgentAction, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) ListAgentActions(context.Context, string, string, bool) ([]*AgentAction, error) {
	return nil, stub.resultErr
}

func (stub *crossDeviceRepoStub) PullSyncEvents(context.Context, string, int64, int) ([]*SyncEvent, bool, bool, error) {
	return nil, false, false, stub.resultErr
}

func (stub *crossDeviceRepoStub) LatestSyncCursor(context.Context, string) (int64, error) {
	return 0, stub.resultErr
}

func newCrossDeviceTestUsecase(repo *crossDeviceRepoStub) *CrossDeviceUsecase {
	return NewCrossDeviceUsecase(repo, identityResolverStub{identity: &AuthenticatedIdentity{
		Provider: "ucloud", Subject: "42", Email: "person@example.com", DisplayName: "Person",
	}}, nativeOAuthClientStub{})
}

func TestCrossDeviceAccountUsesStableProviderSubject(t *testing.T) {
	repo := &crossDeviceRepoStub{}
	usecase := newCrossDeviceTestUsecase(repo)
	first, err := usecase.CurrentAccount(t.Context(), "Bearer token")
	if err != nil {
		t.Fatalf("CurrentAccount() error = %v", err)
	}
	second, err := usecase.CurrentAccount(t.Context(), "Bearer token")
	if err != nil {
		t.Fatalf("CurrentAccount() second error = %v", err)
	}
	if first.ID == "" || first.ID != second.ID || first.Subject != "42" {
		t.Fatalf("stable account ids = %q / %q, subject = %q", first.ID, second.ID, first.Subject)
	}
}

func TestRegisterDesktopRequiresDeviceKey(t *testing.T) {
	usecase := newCrossDeviceTestUsecase(&crossDeviceRepoStub{})
	_, err := usecase.RegisterDevice(t.Context(), "Bearer token", &Device{
		Type: "desktop", Name: "MacBook", Platform: "darwin-arm64", ProtocolVersion: 1,
	}, "mutation-1")
	if got := kerrors.FromError(err).Code; got != 400 {
		t.Fatalf("RegisterDevice() code = %d, want 400", got)
	}
}

func TestExchangeNativeOAuthRequiresPKCEAndApprovedRedirect(t *testing.T) {
	usecase := newCrossDeviceTestUsecase(&crossDeviceRepoStub{})
	if _, err := usecase.ExchangeNativeOAuthCode(t.Context(), "code", "https://app.example/oauth/callback", strings.Repeat("a", 43)); err != nil {
		t.Fatalf("ExchangeNativeOAuthCode() error = %v", err)
	}
	if _, err := usecase.ExchangeNativeOAuthCode(t.Context(), "code", "http://evil.example/callback", strings.Repeat("a", 43)); kerrors.FromError(err).Code != 400 {
		t.Fatalf("ExchangeNativeOAuthCode() insecure redirect error = %v", err)
	}
	if _, err := usecase.ExchangeNativeOAuthCode(t.Context(), "code", "astraflow://evil/callback", strings.Repeat("a", 43)); kerrors.FromError(err).Code != 400 {
		t.Fatalf("ExchangeNativeOAuthCode() unregistered custom redirect error = %v", err)
	}
}

func TestCreateAgentRunKeepsExplicitExecutionTarget(t *testing.T) {
	tests := []struct {
		name string
		run  *AgentRun
		want string
	}{
		{name: "desktop", run: &AgentRun{SessionID: "session", ExecutionTarget: "desktop", TargetDeviceID: "mac"}, want: "waiting_device"},
		{name: "cloud", run: &AgentRun{SessionID: "session", ExecutionTarget: "cloud", WorkspaceID: "workspace"}, want: "queued"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo := &crossDeviceRepoStub{}
			usecase := newCrossDeviceTestUsecase(repo)
			if _, err := usecase.CreateAgentRun(t.Context(), "Bearer token", test.run); err != nil {
				t.Fatalf("CreateAgentRun() error = %v", err)
			}
			if repo.createdRun.ExecutionTarget != test.name || repo.createdRun.Status != test.want {
				t.Fatalf("CreateAgentRun() target/status = %q/%q", repo.createdRun.ExecutionTarget, repo.createdRun.Status)
			}
		})
	}
}

func TestCreateAgentRunAllowsTargetDesktopToAdoptLocalChannelRun(t *testing.T) {
	repo := &crossDeviceRepoStub{}
	usecase := newCrossDeviceTestUsecase(repo)
	_, err := usecase.CreateAgentRun(t.Context(), "Bearer token", &AgentRun{
		SessionID: "session", ExecutionTarget: "desktop", TargetDeviceID: "mac",
		SourceDeviceID: "mac", DispatchMode: "local_origin",
	})
	if err != nil {
		t.Fatalf("CreateAgentRun() error = %v", err)
	}
	if repo.createdRun.Status != "running" {
		t.Fatalf("CreateAgentRun() status = %q, want running", repo.createdRun.Status)
	}

	_, err = usecase.CreateAgentRun(t.Context(), "Bearer token", &AgentRun{
		SessionID: "session", ExecutionTarget: "desktop", TargetDeviceID: "mac",
		SourceDeviceID: "phone", DispatchMode: "local_origin",
	})
	if got := kerrors.FromError(err).Code; got != 400 {
		t.Fatalf("CreateAgentRun() mismatched source code = %d, want 400", got)
	}
}

func TestAppendAgentRunEventsSortsAndCreatesApprovalAction(t *testing.T) {
	repo := &crossDeviceRepoStub{}
	usecase := newCrossDeviceTestUsecase(repo)
	events := []*AgentRunEvent{
		{EventID: "event-2", Seq: 2, Type: "agent.permission.requested", ProducerType: "desktop", Payload: map[string]any{"action_id": "action-1", "request": map[string]any{"tool": "shell"}}},
		{EventID: "event-1", Seq: 1, Type: "agent.text.delta", ProducerType: "desktop", Payload: map[string]any{"delta": "hello"}},
	}
	accepted, _, err := usecase.AppendAgentRunEvents(t.Context(), "Bearer token", AppendAgentRunEventsOptions{RunID: "run-1"}, events)
	if err != nil {
		t.Fatalf("AppendAgentRunEvents() error = %v", err)
	}
	if accepted != 2 || repo.appended[0].Seq != 1 || repo.appended[1].Seq != 2 {
		t.Fatalf("AppendAgentRunEvents() order = %d,%d", repo.appended[0].Seq, repo.appended[1].Seq)
	}
	action := repo.appended[1].Action
	if action == nil || action.ID != "action-1" || action.Type != "permission" {
		t.Fatalf("approval action = %#v", action)
	}
}

func TestCrossDeviceConflictsMapToHTTPConflict(t *testing.T) {
	usecase := newCrossDeviceTestUsecase(&crossDeviceRepoStub{resultErr: ErrCrossDeviceConflict})
	_, err := usecase.RevokeDevice(t.Context(), "Bearer token", "device", 1)
	if got := kerrors.FromError(err).Code; got != 409 {
		t.Fatalf("RevokeDevice() code = %d, want 409", got)
	}
}
