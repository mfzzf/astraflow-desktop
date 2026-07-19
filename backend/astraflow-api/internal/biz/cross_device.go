package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
)

const (
	MaxAgentEventBatchSize = 100
	MaxSyncEventPageSize   = 500
	MaxSessionPageSize     = 100
	MaxMessagePageSize     = 200
	MaxAgentRunPageSize    = 100
	MaxRunEventPageSize    = 500
)

var (
	ErrCrossDeviceNotFound = errors.New("cross-device entity not found")
	ErrCrossDeviceConflict = errors.New("cross-device version or state conflict")
	ErrAgentEventSequence  = errors.New("agent event sequence is not contiguous")
)

type AuthenticatedIdentity struct {
	Provider    string
	Subject     string
	Email       string
	DisplayName string
	TenantID    string
}

type IdentityResolver interface {
	Resolve(context.Context, string) (*AuthenticatedIdentity, error)
}

type NativeOAuthConfig struct {
	AuthorizationEndpoint string
	ClientID              string
	Scopes                []string
	AllowedRedirectURIs   []string
}

type NativeOAuthClient interface {
	Config() (*NativeOAuthConfig, error)
	ExchangeCode(context.Context, string, string, string) (*OAuthTokens, error)
	RefreshToken(context.Context, string) (*OAuthTokens, error)
}

type Account struct {
	ID          string
	Provider    string
	Subject     string
	Email       string
	DisplayName string
	TenantID    string
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Device struct {
	ID              string
	AccountID       string
	Type            string
	Name            string
	Platform        string
	AppVersion      string
	ProtocolVersion int
	Capabilities    map[string]any
	PublicKey       string
	LastSeenAt      time.Time
	RevokedAt       *time.Time
	Version         int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type DeviceConnectionToken struct {
	Token         string
	WebSocketPath string
	ExpiresAt     time.Time
}

type DeviceConnectionIdentity struct {
	AccountID string
	DeviceID  string
	PublicKey string
}

type DeviceCommand struct {
	ID        string
	AccountID string
	DeviceID  string
	RunID     string
	Type      string
	Payload   map[string]any
	Status    string
	Attempts  int
	CreatedAt time.Time
}

type PushEndpoint struct {
	ID        string
	AccountID string
	DeviceID  string
	Provider  string
	Token     string
	Locale    string
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PushDelivery contains the minimum metadata needed to deliver a notification.
// Prompt text, tool parameters, terminal output, and other run content must
// never be copied into this structure.
type PushDelivery struct {
	ID             string
	AccountID      string
	PushEndpointID string
	RunID          string
	EventType      string
	Provider       string
	Token          string
	Title          string
	Body           string
	Data           map[string]any
	Attempts       int
}

type PushDeliveryRepo interface {
	ClaimPushDeliveries(context.Context, int, time.Duration) ([]*PushDelivery, error)
	CompletePushDelivery(context.Context, string) error
	NackPushDelivery(context.Context, string, string, time.Time, bool, bool) error
}

type Workspace struct {
	ID                     string
	AccountID              string
	ProjectID              string
	Type                   string
	Name                   string
	SandboxID              string
	GatewayProtocolVersion int
	State                  string
	OwnerDeviceID          string
	SourceDeviceID         string
	ClientMutationID       string
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type Session struct {
	ID               string
	AccountID        string
	WorkspaceID      string
	Mode             string
	Title            string
	RuntimeID        string
	Model            string
	ReasoningEffort  string
	PermissionMode   string
	Version          int64
	PinnedAt         *time.Time
	ArchivedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
	SourceDeviceID   string
	ClientMutationID string
}

type SessionUpdate struct {
	SessionID        string
	ExpectedVersion  int64
	Title            *string
	Pinned           *bool
	Archived         *bool
	Model            *string
	ReasoningEffort  *string
	PermissionMode   *string
	WorkspaceID      *string
	RuntimeID        *string
	SourceDeviceID   string
	ClientMutationID string
}

type SessionListOptions struct {
	Offset          int
	Limit           int
	IncludeArchived bool
}

type Message struct {
	ID               string
	AccountID        string
	SessionID        string
	Role             string
	Status           string
	Content          map[string]any
	Parts            []map[string]any
	SourceDeviceID   string
	ClientMutationID string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type MessageListOptions struct {
	Offset int
	Limit  int
}

type AgentRun struct {
	ID                string
	AccountID         string
	SessionID         string
	ExecutionTarget   string
	TargetDeviceID    string
	WorkspaceID       string
	Status            string
	RuntimeID         string
	Model             string
	ReasoningEffort   string
	PermissionMode    string
	ReturnArtifacts   bool
	DispatchMode      string
	RuntimeSessionRef string
	LastEventSeq      int64
	StartedAt         *time.Time
	CompletedAt       *time.Time
	ErrorCode         string
	ErrorMessage      string
	SourceDeviceID    string
	ClientMutationID  string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type AgentRunListOptions struct {
	SessionID  string
	Offset     int
	Limit      int
	ActiveOnly bool
}

type AgentRunEvent struct {
	RunID        string
	AccountID    string
	EventID      string
	Seq          int64
	Type         string
	Payload      map[string]any
	ProducerType string
	ProducerID   string
	OccurredAt   time.Time
	Action       *AgentAction
}

type AppendAgentRunEventsOptions struct {
	RunID             string
	RunStatus         string
	RuntimeSessionRef string
	ErrorCode         string
	ErrorMessage      string
}

type AgentAction struct {
	ID         string
	AccountID  string
	RunID      string
	EventSeq   int64
	Type       string
	Status     string
	Request    map[string]any
	Resolution map[string]any
	Version    int64
	ExpiresAt  *time.Time
	ResolvedAt *time.Time
	CreatedAt  time.Time
}

type AgentActionResolution struct {
	RunID            string
	ActionID         string
	ExpectedVersion  int64
	Resolution       string
	Payload          map[string]any
	SourceDeviceID   string
	ClientMutationID string
}

type SyncEvent struct {
	SchemaVersion int
	EventID       string
	Cursor        int64
	AccountID     string
	AggregateType string
	AggregateID   string
	EntityVersion int64
	EventType     string
	Payload       map[string]any
	OccurredAt    time.Time
}

type SyncSnapshot struct {
	Account        *Account
	Devices        []*Device
	Workspaces     []*Workspace
	Sessions       []*Session
	ActiveRuns     []*AgentRun
	PendingActions []*AgentAction
	Cursor         int64
	SchemaVersion  int
}

type CrossDeviceRepo interface {
	EnsureAccount(context.Context, *Account) (*Account, error)
	RegisterDevice(context.Context, *Device, string) (*Device, error)
	ListDevices(context.Context, string, bool) ([]*Device, error)
	RevokeDevice(context.Context, string, string, int64) (*Device, error)
	IssueDeviceConnectionToken(context.Context, string, string, [sha256.Size]byte, time.Time) error
	ConsumeDeviceConnectionToken(context.Context, [sha256.Size]byte) (*DeviceConnectionIdentity, error)
	ClaimDeviceCommands(context.Context, string, string, int) ([]*DeviceCommand, error)
	UpdateDeviceCommand(context.Context, string, string, string, string, map[string]any) error
	TouchDevice(context.Context, string, string) error
	UpsertPushEndpoint(context.Context, *PushEndpoint) (*PushEndpoint, error)
	CreateWorkspace(context.Context, *Workspace) (*Workspace, error)
	ListWorkspaces(context.Context, string, bool) ([]*Workspace, error)
	GetWorkspace(context.Context, string, string) (*Workspace, error)
	CreateSession(context.Context, *Session) (*Session, error)
	ListSessions(context.Context, string, SessionListOptions) ([]*Session, bool, error)
	GetSession(context.Context, string, string) (*Session, error)
	UpdateSession(context.Context, string, SessionUpdate) (*Session, error)
	CreateMessage(context.Context, *Message) (*Message, error)
	ListMessages(context.Context, string, string, MessageListOptions) ([]*Message, bool, error)
	CreateAgentRun(context.Context, *AgentRun) (*AgentRun, error)
	GetAgentRun(context.Context, string, string) (*AgentRun, error)
	ListAgentRuns(context.Context, string, AgentRunListOptions) ([]*AgentRun, bool, error)
	CancelAgentRun(context.Context, string, string, string, string) (*AgentRun, error)
	AppendAgentRunEvents(context.Context, string, AppendAgentRunEventsOptions, []*AgentRunEvent) (int, *AgentRun, error)
	ListAgentRunEvents(context.Context, string, string, int64, int) ([]*AgentRunEvent, int64, bool, error)
	ResolveAgentAction(context.Context, string, AgentActionResolution) (*AgentAction, error)
	ListAgentActions(context.Context, string, string, bool) ([]*AgentAction, error)
	PullSyncEvents(context.Context, string, int64, int) ([]*SyncEvent, bool, bool, error)
	LatestSyncCursor(context.Context, string) (int64, error)
}

type CrossDeviceUsecase struct {
	repo        CrossDeviceRepo
	identity    IdentityResolver
	nativeOAuth NativeOAuthClient
}

func NewCrossDeviceUsecase(repo CrossDeviceRepo, identity IdentityResolver, nativeOAuth NativeOAuthClient) *CrossDeviceUsecase {
	return &CrossDeviceUsecase{repo: repo, identity: identity, nativeOAuth: nativeOAuth}
}

func (uc *CrossDeviceUsecase) NativeOAuthConfig(context.Context) (*NativeOAuthConfig, error) {
	config, err := uc.nativeOAuth.Config()
	if err != nil {
		return nil, kerrors.ServiceUnavailable("NATIVE_OAUTH_UNAVAILABLE", "native OAuth is not configured")
	}
	return config, nil
}

func (uc *CrossDeviceUsecase) ExchangeNativeOAuthCode(ctx context.Context, code, redirectURI, codeVerifier string) (*OAuthTokens, error) {
	code = strings.TrimSpace(code)
	redirectURI = strings.TrimSpace(redirectURI)
	codeVerifier = strings.TrimSpace(codeVerifier)
	config, err := uc.nativeOAuth.Config()
	if err != nil {
		return nil, kerrors.ServiceUnavailable("NATIVE_OAUTH_UNAVAILABLE", "native OAuth is not configured")
	}
	allowedRedirect := false
	for _, candidate := range config.AllowedRedirectURIs {
		if redirectURI == candidate {
			allowedRedirect = true
			break
		}
	}
	if !allowedRedirect {
		return nil, invalidArgument("native OAuth redirect URI is invalid")
	}
	if code == "" || len(code) > 4096 || len(codeVerifier) < 43 || len(codeVerifier) > 128 {
		return nil, invalidArgument("authorization code and PKCE verifier are required")
	}
	return uc.nativeOAuth.ExchangeCode(ctx, code, redirectURI, codeVerifier)
}

func (uc *CrossDeviceUsecase) RefreshNativeOAuthToken(ctx context.Context, refreshToken string) (*OAuthTokens, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" || len(refreshToken) > 8192 {
		return nil, invalidArgument("refresh token is required")
	}
	return uc.nativeOAuth.RefreshToken(ctx, refreshToken)
}

func (uc *CrossDeviceUsecase) CurrentAccount(ctx context.Context, authorization string) (*Account, error) {
	return uc.authenticate(ctx, authorization)
}

func (uc *CrossDeviceUsecase) RegisterDevice(ctx context.Context, authorization string, device *Device, mutationID string) (*Device, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, invalidArgument("device is required")
	}
	device.AccountID = account.ID
	device.ID = normalizeOptionalID(device.ID)
	if device.ID == "" {
		device.ID = uuid.NewString()
	}
	device.Type = strings.ToLower(strings.TrimSpace(device.Type))
	device.Name = strings.TrimSpace(device.Name)
	device.Platform = strings.ToLower(strings.TrimSpace(device.Platform))
	device.AppVersion = strings.TrimSpace(device.AppVersion)
	device.PublicKey = strings.TrimSpace(device.PublicKey)
	mutationID = normalizeOptionalID(mutationID)
	if !oneOf(device.Type, "desktop", "mobile", "worker") || device.Name == "" || device.Platform == "" {
		return nil, invalidArgument("device type, name, and platform are required")
	}
	if device.Type == "desktop" && device.PublicKey == "" {
		return nil, invalidArgument("desktop devices require a public key")
	}
	if device.ProtocolVersion <= 0 || device.ProtocolVersion > 1000 {
		return nil, invalidArgument("device protocol version is invalid")
	}
	if !within(device.ID, 128) || !within(device.Name, 160) || !within(device.Platform, 80) || !within(device.AppVersion, 64) || !within(device.PublicKey, 8192) || !within(mutationID, 160) {
		return nil, invalidArgument("device metadata is too long")
	}
	return uc.repo.RegisterDevice(ctx, device, mutationID)
}

func (uc *CrossDeviceUsecase) ListDevices(ctx context.Context, authorization string, includeRevoked bool) ([]*Device, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	return uc.repo.ListDevices(ctx, account.ID, includeRevoked)
}

func (uc *CrossDeviceUsecase) RevokeDevice(ctx context.Context, authorization, deviceID string, expectedVersion int64) (*Device, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	deviceID = normalizeRequiredID(deviceID)
	if deviceID == "" || expectedVersion <= 0 {
		return nil, invalidArgument("device id and expected version are required")
	}
	device, err := uc.repo.RevokeDevice(ctx, account.ID, deviceID, expectedVersion)
	return device, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CreateDeviceConnectionToken(ctx context.Context, authorization, deviceID string) (*DeviceConnectionToken, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	deviceID = normalizeRequiredID(deviceID)
	if deviceID == "" {
		return nil, invalidArgument("device id is required")
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return nil, kerrors.ServiceUnavailable("DEVICE_RELAY_UNAVAILABLE", "device connection token could not be created")
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	hash := sha256.Sum256([]byte(token))
	expiresAt := time.Now().UTC().Add(time.Minute)
	if err := uc.repo.IssueDeviceConnectionToken(ctx, account.ID, deviceID, hash, expiresAt); err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return &DeviceConnectionToken{Token: token, WebSocketPath: "/v1/device-relay", ExpiresAt: expiresAt}, nil
}

func (uc *CrossDeviceUsecase) ConsumeDeviceConnectionToken(ctx context.Context, token string) (*DeviceConnectionIdentity, error) {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 256 {
		return nil, kerrors.Unauthorized("DEVICE_CONNECTION_INVALID", "device connection token is invalid")
	}
	identity, err := uc.repo.ConsumeDeviceConnectionToken(ctx, sha256.Sum256([]byte(token)))
	if err != nil {
		if errors.Is(err, ErrCrossDeviceNotFound) || errors.Is(err, ErrCrossDeviceConflict) {
			return nil, kerrors.Unauthorized("DEVICE_CONNECTION_INVALID", "device connection token is invalid or expired")
		}
		return nil, kerrors.ServiceUnavailable("DEVICE_RELAY_UNAVAILABLE", "device connection could not be authenticated")
	}
	return identity, nil
}

func (uc *CrossDeviceUsecase) ClaimDeviceCommands(ctx context.Context, identity *DeviceConnectionIdentity, limit int) ([]*DeviceCommand, error) {
	if identity == nil || identity.AccountID == "" || identity.DeviceID == "" {
		return nil, kerrors.Unauthorized("DEVICE_CONNECTION_INVALID", "device connection is not authenticated")
	}
	if limit <= 0 || limit > 25 {
		limit = 10
	}
	commands, err := uc.repo.ClaimDeviceCommands(ctx, identity.AccountID, identity.DeviceID, limit)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("DEVICE_RELAY_UNAVAILABLE", "device commands could not be loaded")
	}
	return commands, nil
}

func (uc *CrossDeviceUsecase) UpdateDeviceCommand(ctx context.Context, identity *DeviceConnectionIdentity, commandID, status string, result map[string]any) error {
	if identity == nil || identity.AccountID == "" || identity.DeviceID == "" {
		return kerrors.Unauthorized("DEVICE_CONNECTION_INVALID", "device connection is not authenticated")
	}
	commandID = normalizeRequiredID(commandID)
	status = strings.ToLower(strings.TrimSpace(status))
	if commandID == "" || !oneOf(status, "acknowledged", "completed", "failed") {
		return invalidArgument("command id or status is invalid")
	}
	return mapCrossDeviceError(uc.repo.UpdateDeviceCommand(ctx, identity.AccountID, identity.DeviceID, commandID, status, result))
}

func (uc *CrossDeviceUsecase) TouchDevice(ctx context.Context, identity *DeviceConnectionIdentity) error {
	if identity == nil || identity.AccountID == "" || identity.DeviceID == "" {
		return kerrors.Unauthorized("DEVICE_CONNECTION_INVALID", "device connection is not authenticated")
	}
	return uc.repo.TouchDevice(ctx, identity.AccountID, identity.DeviceID)
}

func (uc *CrossDeviceUsecase) UpsertPushEndpoint(ctx context.Context, authorization string, endpoint *PushEndpoint) (*PushEndpoint, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if endpoint == nil {
		return nil, invalidArgument("push endpoint is required")
	}
	endpoint.AccountID = account.ID
	endpoint.ID = normalizeOptionalID(endpoint.ID)
	if endpoint.ID == "" {
		endpoint.ID = uuid.NewString()
	}
	endpoint.DeviceID = normalizeRequiredID(endpoint.DeviceID)
	endpoint.Provider = strings.ToLower(strings.TrimSpace(endpoint.Provider))
	endpoint.Token = strings.TrimSpace(endpoint.Token)
	endpoint.Locale = strings.TrimSpace(endpoint.Locale)
	if endpoint.DeviceID == "" || endpoint.Provider != "expo" || endpoint.Token == "" {
		return nil, invalidArgument("device id, supported provider, and push token are required")
	}
	if !within(endpoint.Token, 8192) || !within(endpoint.Locale, 32) {
		return nil, invalidArgument("push endpoint metadata is too long")
	}
	result, err := uc.repo.UpsertPushEndpoint(ctx, endpoint)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CreateWorkspace(ctx context.Context, authorization string, workspace *Workspace) (*Workspace, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if workspace == nil {
		return nil, invalidArgument("workspace is required")
	}
	workspace.AccountID = account.ID
	workspace.ID = normalizeOptionalID(workspace.ID)
	if workspace.ID == "" {
		workspace.ID = uuid.NewString()
	}
	workspace.ProjectID = normalizeOptionalID(workspace.ProjectID)
	workspace.Type = strings.ToLower(strings.TrimSpace(workspace.Type))
	workspace.Name = strings.TrimSpace(workspace.Name)
	workspace.OwnerDeviceID = normalizeOptionalID(workspace.OwnerDeviceID)
	workspace.SourceDeviceID = normalizeOptionalID(workspace.SourceDeviceID)
	workspace.ClientMutationID = normalizeOptionalID(workspace.ClientMutationID)
	if workspace.GatewayProtocolVersion <= 0 {
		workspace.GatewayProtocolVersion = 1
	}
	if !oneOf(workspace.Type, "local_ref", "sandbox") || workspace.Name == "" {
		return nil, invalidArgument("workspace type and name are required")
	}
	if workspace.Type == "local_ref" && workspace.OwnerDeviceID == "" {
		return nil, invalidArgument("local workspaces require an owner device")
	}
	if workspace.Type == "sandbox" && workspace.OwnerDeviceID != "" {
		return nil, invalidArgument("sandbox workspaces cannot have a desktop owner")
	}
	if workspace.GatewayProtocolVersion > 1000 || !within(workspace.Name, 200) || !within(workspace.ClientMutationID, 160) {
		return nil, invalidArgument("workspace metadata is invalid")
	}
	workspace.State = "ready"
	if workspace.Type == "sandbox" {
		workspace.State = "creating"
	}
	result, err := uc.repo.CreateWorkspace(ctx, workspace)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ListWorkspaces(ctx context.Context, authorization string, includeUnavailable bool) ([]*Workspace, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	return uc.repo.ListWorkspaces(ctx, account.ID, includeUnavailable)
}

func (uc *CrossDeviceUsecase) GetWorkspace(ctx context.Context, authorization, workspaceID string) (*Workspace, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	workspaceID = normalizeRequiredID(workspaceID)
	if workspaceID == "" {
		return nil, invalidArgument("workspace id is required")
	}
	result, err := uc.repo.GetWorkspace(ctx, account.ID, workspaceID)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CreateSession(ctx context.Context, authorization string, session *Session) (*Session, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, invalidArgument("session is required")
	}
	session.AccountID = account.ID
	session.ID = normalizeOptionalID(session.ID)
	if session.ID == "" {
		session.ID = uuid.NewString()
	}
	normalizeSession(session)
	if err := validateSession(session); err != nil {
		return nil, err
	}
	result, err := uc.repo.CreateSession(ctx, session)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ListSessions(ctx context.Context, authorization string, options SessionListOptions) ([]*Session, bool, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, err
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 || options.Limit > MaxSessionPageSize {
		options.Limit = 30
	}
	return uc.repo.ListSessions(ctx, account.ID, options)
}

func (uc *CrossDeviceUsecase) GetSession(ctx context.Context, authorization, sessionID string) (*Session, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	sessionID = normalizeRequiredID(sessionID)
	if sessionID == "" {
		return nil, invalidArgument("session id is required")
	}
	result, err := uc.repo.GetSession(ctx, account.ID, sessionID)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) UpdateSession(ctx context.Context, authorization string, update SessionUpdate) (*Session, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	update.SessionID = normalizeRequiredID(update.SessionID)
	update.SourceDeviceID = normalizeOptionalID(update.SourceDeviceID)
	update.ClientMutationID = normalizeOptionalID(update.ClientMutationID)
	if update.SessionID == "" || update.ExpectedVersion <= 0 {
		return nil, invalidArgument("session id and expected version are required")
	}
	if update.Title != nil {
		value := strings.TrimSpace(*update.Title)
		update.Title = &value
	}
	if update.Model != nil {
		value := strings.TrimSpace(*update.Model)
		update.Model = &value
	}
	if update.ReasoningEffort != nil {
		value := strings.ToLower(strings.TrimSpace(*update.ReasoningEffort))
		update.ReasoningEffort = &value
	}
	if update.PermissionMode != nil {
		value := strings.ToLower(strings.TrimSpace(*update.PermissionMode))
		update.PermissionMode = &value
	}
	if update.WorkspaceID != nil {
		value := normalizeOptionalID(*update.WorkspaceID)
		if strings.TrimSpace(*update.WorkspaceID) != "" && value == "" {
			return nil, invalidArgument("workspace id is invalid")
		}
		update.WorkspaceID = &value
	}
	if update.RuntimeID != nil {
		value := strings.TrimSpace(*update.RuntimeID)
		update.RuntimeID = &value
	}
	if (update.Title != nil && !within(*update.Title, 240)) || (update.Model != nil && !within(*update.Model, 160)) ||
		(update.ReasoningEffort != nil && !within(*update.ReasoningEffort, 40)) ||
		(update.PermissionMode != nil && !within(*update.PermissionMode, 40)) ||
		(update.RuntimeID != nil && !within(*update.RuntimeID, 80)) || !within(update.ClientMutationID, 160) {
		return nil, invalidArgument("session metadata is too long")
	}
	result, err := uc.repo.UpdateSession(ctx, account.ID, update)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CreateMessage(ctx context.Context, authorization string, message *Message) (*Message, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if message == nil {
		return nil, invalidArgument("message is required")
	}
	message.AccountID = account.ID
	message.ID = normalizeOptionalID(message.ID)
	if message.ID == "" {
		message.ID = uuid.NewString()
	}
	message.SessionID = normalizeRequiredID(message.SessionID)
	message.Role = strings.ToLower(strings.TrimSpace(message.Role))
	message.Status = strings.ToLower(strings.TrimSpace(message.Status))
	message.SourceDeviceID = normalizeOptionalID(message.SourceDeviceID)
	message.ClientMutationID = normalizeOptionalID(message.ClientMutationID)
	if message.Status == "" {
		message.Status = "completed"
	}
	if message.SessionID == "" || !oneOf(message.Role, "user", "assistant", "system", "tool") ||
		!oneOf(message.Status, "pending", "streaming", "completed", "failed", "cancelled") {
		return nil, invalidArgument("message session, role, or status is invalid")
	}
	if message.Content == nil && len(message.Parts) == 0 {
		return nil, invalidArgument("message content or parts are required")
	}
	if !within(message.ClientMutationID, 160) {
		return nil, invalidArgument("client mutation id is too long")
	}
	result, err := uc.repo.CreateMessage(ctx, message)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ListMessages(ctx context.Context, authorization, sessionID string, options MessageListOptions) ([]*Message, bool, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, err
	}
	sessionID = normalizeRequiredID(sessionID)
	if sessionID == "" {
		return nil, false, invalidArgument("session id is required")
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 || options.Limit > MaxMessagePageSize {
		options.Limit = 50
	}
	items, more, err := uc.repo.ListMessages(ctx, account.ID, sessionID, options)
	return items, more, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CreateAgentRun(ctx context.Context, authorization string, run *AgentRun) (*AgentRun, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, invalidArgument("agent run is required")
	}
	run.AccountID = account.ID
	run.ID = normalizeOptionalID(run.ID)
	if run.ID == "" {
		run.ID = uuid.NewString()
	}
	run.SessionID = normalizeRequiredID(run.SessionID)
	run.ExecutionTarget = strings.ToLower(strings.TrimSpace(run.ExecutionTarget))
	run.TargetDeviceID = normalizeOptionalID(run.TargetDeviceID)
	run.WorkspaceID = normalizeOptionalID(run.WorkspaceID)
	run.RuntimeID = strings.TrimSpace(run.RuntimeID)
	run.Model = strings.TrimSpace(run.Model)
	run.ReasoningEffort = strings.ToLower(strings.TrimSpace(run.ReasoningEffort))
	run.PermissionMode = strings.ToLower(strings.TrimSpace(run.PermissionMode))
	run.DispatchMode = strings.ToLower(strings.TrimSpace(run.DispatchMode))
	run.SourceDeviceID = normalizeOptionalID(run.SourceDeviceID)
	run.ClientMutationID = normalizeOptionalID(run.ClientMutationID)
	if run.RuntimeID == "" {
		run.RuntimeID = "astraflow"
	}
	if run.PermissionMode == "" {
		run.PermissionMode = "default"
	}
	if run.DispatchMode == "" {
		run.DispatchMode = "relay"
	}
	if run.SessionID == "" || !oneOf(run.ExecutionTarget, "cloud", "desktop") {
		return nil, invalidArgument("run session and execution target are required")
	}
	if run.ExecutionTarget == "desktop" && run.TargetDeviceID == "" {
		return nil, invalidArgument("desktop runs require a target device")
	}
	if run.ExecutionTarget == "cloud" && run.WorkspaceID == "" {
		return nil, invalidArgument("cloud runs require a workspace")
	}
	if !oneOf(run.DispatchMode, "relay", "local_origin") {
		return nil, invalidArgument("run dispatch mode is invalid")
	}
	if run.DispatchMode == "local_origin" &&
		(run.ExecutionTarget != "desktop" || run.SourceDeviceID == "" || run.SourceDeviceID != run.TargetDeviceID) {
		return nil, invalidArgument("local-origin runs must be created by their target desktop device")
	}
	if !within(run.RuntimeID, 80) || !within(run.Model, 160) || !within(run.ReasoningEffort, 40) || !within(run.PermissionMode, 40) || !within(run.ClientMutationID, 160) {
		return nil, invalidArgument("run metadata is too long")
	}
	run.Status = "queued"
	if run.ExecutionTarget == "desktop" {
		run.Status = "waiting_device"
		if run.DispatchMode == "local_origin" {
			run.Status = "running"
		}
	}
	result, err := uc.repo.CreateAgentRun(ctx, run)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) GetAgentRun(ctx context.Context, authorization, runID string) (*AgentRun, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	if runID == "" {
		return nil, invalidArgument("run id is required")
	}
	result, err := uc.repo.GetAgentRun(ctx, account.ID, runID)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ListAgentRuns(ctx context.Context, authorization string, options AgentRunListOptions) ([]*AgentRun, bool, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, err
	}
	if strings.TrimSpace(options.SessionID) != "" {
		options.SessionID = normalizeRequiredID(options.SessionID)
		if options.SessionID == "" {
			return nil, false, invalidArgument("session id is invalid")
		}
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 || options.Limit > MaxAgentRunPageSize {
		options.Limit = 30
	}
	items, more, err := uc.repo.ListAgentRuns(ctx, account.ID, options)
	return items, more, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) CancelAgentRun(ctx context.Context, authorization, runID, sourceDeviceID, mutationID string) (*AgentRun, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	if runID == "" {
		return nil, invalidArgument("run id is required")
	}
	result, err := uc.repo.CancelAgentRun(ctx, account.ID, runID, normalizeOptionalID(sourceDeviceID), normalizeOptionalID(mutationID))
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) AppendAgentRunEvents(ctx context.Context, authorization string, options AppendAgentRunEventsOptions, events []*AgentRunEvent) (int, *AgentRun, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return 0, nil, err
	}
	options, err = prepareAgentRunEvents(account.ID, options, events)
	if err != nil {
		return 0, nil, err
	}
	accepted, run, err := uc.repo.AppendAgentRunEvents(ctx, account.ID, options, events)
	return accepted, run, mapCrossDeviceError(err)
}

func prepareAgentRunEvents(accountID string, options AppendAgentRunEventsOptions, events []*AgentRunEvent) (AppendAgentRunEventsOptions, error) {
	options.RunID = normalizeRequiredID(options.RunID)
	options.RunStatus = strings.ToLower(strings.TrimSpace(options.RunStatus))
	options.RuntimeSessionRef = strings.TrimSpace(options.RuntimeSessionRef)
	options.ErrorCode = strings.TrimSpace(options.ErrorCode)
	options.ErrorMessage = strings.TrimSpace(options.ErrorMessage)
	if options.RunID == "" || len(events) == 0 || len(events) > MaxAgentEventBatchSize {
		return options, invalidArgument("run id and between 1 and 100 events are required")
	}
	if options.RunStatus != "" && !validRunStatus(options.RunStatus) {
		return options, invalidArgument("run status is invalid")
	}
	if !within(options.RuntimeSessionRef, 512) || !within(options.ErrorCode, 120) || !within(options.ErrorMessage, 2000) {
		return options, invalidArgument("run result metadata is too long")
	}
	seenIDs := make(map[string]struct{}, len(events))
	seenSeq := make(map[int64]struct{}, len(events))
	for _, event := range events {
		if event == nil {
			return options, invalidArgument("agent event is required")
		}
		event.AccountID = accountID
		event.RunID = options.RunID
		event.EventID = normalizeRequiredID(event.EventID)
		event.Type = strings.TrimSpace(event.Type)
		event.ProducerType = strings.ToLower(strings.TrimSpace(event.ProducerType))
		event.ProducerID = normalizeOptionalID(event.ProducerID)
		if event.EventID == "" || event.Seq <= 0 || event.Type == "" || !oneOf(event.ProducerType, "desktop", "worker", "server") {
			return options, invalidArgument("agent event id, sequence, type, and producer are required")
		}
		if _, ok := seenIDs[event.EventID]; ok {
			return options, invalidArgument("agent event ids must be unique within a batch")
		}
		if _, ok := seenSeq[event.Seq]; ok {
			return options, invalidArgument("agent event sequences must be unique within a batch")
		}
		seenIDs[event.EventID] = struct{}{}
		seenSeq[event.Seq] = struct{}{}
		if event.OccurredAt.IsZero() {
			event.OccurredAt = time.Now().UTC()
		}
		if event.OccurredAt.After(time.Now().UTC().Add(10 * time.Minute)) {
			return options, invalidArgument("agent event timestamp is too far in the future")
		}
		event.Action = actionFromEvent(event)
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Seq < events[j].Seq })
	return options, nil
}

func (uc *CrossDeviceUsecase) ListAgentRunEvents(ctx context.Context, authorization, runID string, afterSeq int64, limit int) ([]*AgentRunEvent, int64, bool, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, 0, false, err
	}
	runID = normalizeRequiredID(runID)
	if runID == "" || afterSeq < 0 {
		return nil, 0, false, invalidArgument("run id and a non-negative sequence are required")
	}
	if limit <= 0 || limit > MaxRunEventPageSize {
		limit = 100
	}
	events, last, more, err := uc.repo.ListAgentRunEvents(ctx, account.ID, runID, afterSeq, limit)
	return events, last, more, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ResolveAgentAction(ctx context.Context, authorization string, resolution AgentActionResolution) (*AgentAction, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	resolution.RunID = normalizeRequiredID(resolution.RunID)
	resolution.ActionID = normalizeRequiredID(resolution.ActionID)
	resolution.Resolution = strings.ToLower(strings.TrimSpace(resolution.Resolution))
	resolution.SourceDeviceID = normalizeOptionalID(resolution.SourceDeviceID)
	resolution.ClientMutationID = normalizeOptionalID(resolution.ClientMutationID)
	if resolution.RunID == "" || resolution.ActionID == "" || resolution.ExpectedVersion <= 0 ||
		!oneOf(resolution.Resolution, "approved", "denied", "submitted") {
		return nil, invalidArgument("action id, expected version, and resolution are required")
	}
	result, err := uc.repo.ResolveAgentAction(ctx, account.ID, resolution)
	return result, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) ListAgentActions(ctx context.Context, authorization, runID string, pendingOnly bool) ([]*AgentAction, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	if runID == "" {
		return nil, invalidArgument("run id is required")
	}
	items, err := uc.repo.ListAgentActions(ctx, account.ID, runID, pendingOnly)
	return items, mapCrossDeviceError(err)
}

func (uc *CrossDeviceUsecase) PullSyncEvents(ctx context.Context, authorization string, after int64, limit int) ([]*SyncEvent, bool, bool, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, false, err
	}
	if after < 0 {
		return nil, false, false, invalidArgument("sync cursor must not be negative")
	}
	if limit <= 0 || limit > MaxSyncEventPageSize {
		limit = 100
	}
	return uc.repo.PullSyncEvents(ctx, account.ID, after, limit)
}

func (uc *CrossDeviceUsecase) GetSyncSnapshot(ctx context.Context, authorization string, includeArchived bool) (*SyncSnapshot, error) {
	account, err := uc.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	devices, err := uc.repo.ListDevices(ctx, account.ID, false)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	workspaces, err := uc.repo.ListWorkspaces(ctx, account.ID, true)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	sessions := make([]*Session, 0, MaxSessionPageSize)
	for offset := 0; ; offset += MaxSessionPageSize {
		page, more, err := uc.repo.ListSessions(ctx, account.ID, SessionListOptions{
			Offset: offset, Limit: MaxSessionPageSize, IncludeArchived: includeArchived,
		})
		if err != nil {
			return nil, mapCrossDeviceError(err)
		}
		sessions = append(sessions, page...)
		if !more {
			break
		}
	}
	runs := make([]*AgentRun, 0, MaxAgentRunPageSize)
	for offset := 0; ; offset += MaxAgentRunPageSize {
		page, more, err := uc.repo.ListAgentRuns(ctx, account.ID, AgentRunListOptions{
			Offset: offset, Limit: MaxAgentRunPageSize, ActiveOnly: true,
		})
		if err != nil {
			return nil, mapCrossDeviceError(err)
		}
		runs = append(runs, page...)
		if !more {
			break
		}
	}
	actions, err := uc.repo.ListAgentActions(ctx, account.ID, "", true)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	cursor, err := uc.repo.LatestSyncCursor(ctx, account.ID)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return &SyncSnapshot{
		Account: account, Devices: devices, Workspaces: workspaces, Sessions: sessions,
		ActiveRuns: runs, PendingActions: actions, Cursor: cursor, SchemaVersion: 1,
	}, nil
}

func (uc *CrossDeviceUsecase) authenticate(ctx context.Context, authorization string) (*Account, error) {
	if strings.TrimSpace(authorization) == "" {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "UCloud OAuth login is required")
	}
	identity, err := uc.identity.Resolve(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if identity == nil || strings.TrimSpace(identity.Provider) == "" || strings.TrimSpace(identity.Subject) == "" {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "authenticated account identity is unavailable")
	}
	provider := strings.ToLower(strings.TrimSpace(identity.Provider))
	subject := strings.TrimSpace(identity.Subject)
	account := &Account{
		ID:          deterministicAccountID(provider, subject),
		Provider:    provider,
		Subject:     subject,
		Email:       strings.TrimSpace(identity.Email),
		DisplayName: strings.TrimSpace(identity.DisplayName),
		TenantID:    strings.TrimSpace(identity.TenantID),
		Status:      "active",
	}
	result, err := uc.repo.EnsureAccount(ctx, account)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("CROSS_DEVICE_UNAVAILABLE", "account state could not be loaded")
	}
	if result.Status != "active" {
		return nil, kerrors.Forbidden("ACCOUNT_SUSPENDED", "account is not active")
	}
	return result, nil
}

func deterministicAccountID(provider, subject string) string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("astraflow-account:"+provider+":"+subject)).String()
}

func normalizeSession(session *Session) {
	session.WorkspaceID = normalizeOptionalID(session.WorkspaceID)
	session.Mode = strings.ToLower(strings.TrimSpace(session.Mode))
	session.Title = strings.TrimSpace(session.Title)
	session.RuntimeID = strings.TrimSpace(session.RuntimeID)
	session.Model = strings.TrimSpace(session.Model)
	session.ReasoningEffort = strings.ToLower(strings.TrimSpace(session.ReasoningEffort))
	session.PermissionMode = strings.ToLower(strings.TrimSpace(session.PermissionMode))
	session.SourceDeviceID = normalizeOptionalID(session.SourceDeviceID)
	session.ClientMutationID = normalizeOptionalID(session.ClientMutationID)
	if session.RuntimeID == "" {
		session.RuntimeID = "astraflow"
	}
	if session.PermissionMode == "" {
		session.PermissionMode = "default"
	}
}

func validateSession(session *Session) error {
	if !oneOf(session.Mode, "chat", "image", "video", "audio") {
		return invalidArgument("session mode must be chat, image, video, or audio")
	}
	if !within(session.ID, 128) || !within(session.Title, 240) || !within(session.RuntimeID, 80) ||
		!within(session.Model, 160) || !within(session.ReasoningEffort, 40) || !within(session.PermissionMode, 40) ||
		!within(session.ClientMutationID, 160) {
		return invalidArgument("session metadata is too long")
	}
	return nil
}

func actionFromEvent(event *AgentRunEvent) *AgentAction {
	actionType := ""
	switch event.Type {
	case "agent.permission.requested", "permission.requested":
		actionType = "permission"
	case "agent.user_input.requested", "user_input.requested":
		actionType = "user_input"
	default:
		return nil
	}
	actionID, _ := event.Payload["action_id"].(string)
	actionID = normalizeOptionalID(actionID)
	if actionID == "" {
		actionID = uuid.NewString()
	}
	request, _ := event.Payload["request"].(map[string]any)
	var expiresAt *time.Time
	if raw, ok := event.Payload["expires_at"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			expiresAt = &parsed
		}
	}
	return &AgentAction{
		ID: actionID, AccountID: event.AccountID, RunID: event.RunID, EventSeq: event.Seq,
		Type: actionType, Status: "pending", Request: request, Version: 1, ExpiresAt: expiresAt,
	}
}

func validRunStatus(status string) bool {
	return oneOf(status, "queued", "waiting_device", "running", "waiting_approval", "waiting_input", "completed", "failed", "cancelled")
}

func mapCrossDeviceError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrCrossDeviceNotFound):
		return kerrors.NotFound("NOT_FOUND", "cross-device resource was not found")
	case errors.Is(err, ErrCrossDeviceConflict):
		return kerrors.Conflict("CONFLICT", "cross-device resource changed or is in an incompatible state")
	case errors.Is(err, ErrAgentEventSequence):
		return kerrors.Conflict("EVENT_SEQUENCE_CONFLICT", "agent event sequence must continue from the persisted sequence")
	default:
		return kerrors.ServiceUnavailable("CROSS_DEVICE_UNAVAILABLE", "cross-device state could not be saved")
	}
}

func invalidArgument(message string) error {
	return kerrors.BadRequest("INVALID_ARGUMENT", message)
}

func normalizeRequiredID(value string) string {
	value = strings.TrimSpace(value)
	if !within(value, 128) {
		return ""
	}
	return value
}

func normalizeOptionalID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return normalizeRequiredID(value)
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func within(value string, max int) bool {
	return utf8.RuneCountInString(value) <= max
}

func (event *AgentRunEvent) String() string {
	return fmt.Sprintf("%s#%d", event.RunID, event.Seq)
}
