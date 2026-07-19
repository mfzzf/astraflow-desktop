package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	ChannelStatusDraft    = "draft"
	ChannelStatusActive   = "active"
	ChannelStatusDisabled = "disabled"
	channelOAuthFlowTTL   = 5 * time.Minute
)

var (
	channelSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`)
	allowedFeatures    = map[string]struct{}{
		"models": {}, "skills": {}, "automations": {}, "mobile": {},
		"codebox": {}, "files": {}, "chat": {}, "image": {},
		"video": {}, "audio": {},
	}
)

type Channel struct {
	ID                          string
	Slug                        string
	Name                        string
	Status                      string
	OAuthClientID               string
	OAuthClientSecret           string
	OAuthClientSecretConfigured bool
	EnabledFeatures             []string
	RestrictModels              bool
	AllowedModelIDs             []string
	Revision                    int64
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
}

type ChannelOAuthFlow struct {
	StateHash   string
	ChannelID   string
	RedirectURI string
	ExpiresAt   time.Time
}

type OAuthTokens struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int64
	IDToken      string
}

type ChannelListOptions struct {
	Query  string
	Status string
	Offset int
	Limit  int
}

type ChannelRepo interface {
	ListChannels(context.Context, ChannelListOptions) ([]*Channel, int, error)
	GetChannel(context.Context, string) (*Channel, error)
	GetChannelBySlug(context.Context, string) (*Channel, error)
	CreateChannel(context.Context, *Channel) error
	UpdateChannel(context.Context, *Channel, bool) error
	DeleteChannel(context.Context, string) error
	CreateOAuthFlow(context.Context, *ChannelOAuthFlow) error
	ConsumeOAuthFlow(context.Context, string, string, string) error
}

type AdminVerifier interface {
	VerifyAdmin(context.Context, string) error
}

type ChannelOAuthClient interface {
	ExchangeCode(context.Context, string, string, string, string) (*OAuthTokens, error)
	RefreshToken(context.Context, string, string, string) (*OAuthTokens, error)
}

type ChannelUsecase struct {
	repo          ChannelRepo
	adminVerifier AdminVerifier
	oauthClient   ChannelOAuthClient
}

func NewChannelUsecase(repo ChannelRepo, adminVerifier AdminVerifier, oauthClient ChannelOAuthClient) *ChannelUsecase {
	return &ChannelUsecase{repo: repo, adminVerifier: adminVerifier, oauthClient: oauthClient}
}

func (uc *ChannelUsecase) ListChannels(ctx context.Context, authorization string, options ChannelListOptions) ([]*Channel, int, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, 0, err
	}
	options.Query = strings.TrimSpace(options.Query)
	options.Status = strings.TrimSpace(options.Status)
	if options.Status != "" && !validChannelStatus(options.Status) {
		return nil, 0, kerrors.BadRequest("INVALID_ARGUMENT", "channel status is invalid")
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 || options.Limit > 100 {
		options.Limit = 25
	}
	return uc.repo.ListChannels(ctx, options)
}

func (uc *ChannelUsecase) GetChannel(ctx context.Context, authorization, id string) (*Channel, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	return uc.repo.GetChannel(ctx, strings.TrimSpace(id))
}

func (uc *ChannelUsecase) CreateChannel(ctx context.Context, authorization string, channel *Channel) (*Channel, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	if err := normalizeAndValidateChannel(channel, true); err != nil {
		return nil, err
	}
	if err := uc.repo.CreateChannel(ctx, channel); err != nil {
		return nil, err
	}
	return channel, nil
}

func (uc *ChannelUsecase) UpdateChannel(ctx context.Context, authorization string, channel *Channel, clearSecret bool) (*Channel, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	if strings.TrimSpace(channel.ID) == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "channel_id is required")
	}
	if clearSecret && strings.TrimSpace(channel.OAuthClientSecret) != "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "cannot set and clear the OAuth client secret together")
	}
	if err := normalizeAndValidateChannel(channel, false); err != nil {
		return nil, err
	}
	current, err := uc.repo.GetChannel(ctx, channel.ID)
	if err != nil {
		return nil, err
	}
	secretConfigured := current.OAuthClientSecret != ""
	if clearSecret {
		secretConfigured = false
	}
	if channel.OAuthClientSecret != "" {
		secretConfigured = true
	}
	if channel.Status == ChannelStatusActive && (channel.OAuthClientID == "" || !secretConfigured) {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "active channels require OAuth client credentials")
	}
	if err := uc.repo.UpdateChannel(ctx, channel, clearSecret); err != nil {
		return nil, err
	}
	return uc.repo.GetChannel(ctx, channel.ID)
}

func (uc *ChannelUsecase) DeleteChannel(ctx context.Context, authorization, id string) error {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return err
	}
	return uc.repo.DeleteChannel(ctx, strings.TrimSpace(id))
}

func (uc *ChannelUsecase) GetRuntimeConfig(ctx context.Context, slug string) (*Channel, error) {
	channel, err := uc.repo.GetChannelBySlug(ctx, strings.TrimSpace(slug))
	if err != nil {
		return nil, err
	}
	if channel.Status != ChannelStatusActive {
		return nil, kerrors.NotFound("CHANNEL_NOT_FOUND", "channel is not active")
	}
	channel.OAuthClientSecret = ""
	return channel, nil
}

func (uc *ChannelUsecase) StartOAuth(ctx context.Context, slug, redirectURI string) (string, string, time.Time, error) {
	channel, err := uc.getOAuthChannel(ctx, slug)
	if err != nil {
		return "", "", time.Time{}, err
	}
	redirectURI, err = validateLoopbackRedirectURI(redirectURI)
	if err != nil {
		return "", "", time.Time{}, err
	}
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		return "", "", time.Time{}, kerrors.InternalServer("OAUTH_UNAVAILABLE", "could not create OAuth state")
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)
	expiresAt := time.Now().UTC().Add(channelOAuthFlowTTL)
	if err := uc.repo.CreateOAuthFlow(ctx, &ChannelOAuthFlow{
		StateHash:   hashOAuthState(state),
		ChannelID:   channel.ID,
		RedirectURI: redirectURI,
		ExpiresAt:   expiresAt,
	}); err != nil {
		return "", "", time.Time{}, err
	}
	query := url.Values{
		"client_id":     {channel.OAuthClientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {"openid email offline_access full_access"},
		"state":         {state},
	}
	return "https://oauth2.ucloud.cn/authorize?" + query.Encode(), state, expiresAt, nil
}

func (uc *ChannelUsecase) ExchangeOAuthCode(ctx context.Context, slug, state, code, redirectURI string) (*OAuthTokens, error) {
	channel, err := uc.getOAuthChannel(ctx, slug)
	if err != nil {
		return nil, err
	}
	redirectURI, err = validateLoopbackRedirectURI(redirectURI)
	if err != nil {
		return nil, err
	}
	state = strings.TrimSpace(state)
	code = strings.TrimSpace(code)
	if state == "" || code == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "OAuth state and code are required")
	}
	if err := uc.repo.ConsumeOAuthFlow(ctx, hashOAuthState(state), channel.ID, redirectURI); err != nil {
		return nil, err
	}
	return uc.oauthClient.ExchangeCode(ctx, channel.OAuthClientID, channel.OAuthClientSecret, code, redirectURI)
}

func (uc *ChannelUsecase) RefreshOAuthToken(ctx context.Context, slug, refreshToken string) (*OAuthTokens, error) {
	channel, err := uc.getOAuthChannel(ctx, slug)
	if err != nil {
		return nil, err
	}
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "refresh_token is required")
	}
	return uc.oauthClient.RefreshToken(ctx, channel.OAuthClientID, channel.OAuthClientSecret, refreshToken)
}

func (uc *ChannelUsecase) getOAuthChannel(ctx context.Context, slug string) (*Channel, error) {
	channel, err := uc.repo.GetChannelBySlug(ctx, strings.TrimSpace(slug))
	if err != nil {
		return nil, err
	}
	if channel.Status != ChannelStatusActive || channel.OAuthClientID == "" || channel.OAuthClientSecret == "" {
		return nil, kerrors.New(412, "CHANNEL_OAUTH_UNAVAILABLE", "channel OAuth is not configured")
	}
	return channel, nil
}

func normalizeAndValidateChannel(channel *Channel, requireSecret bool) error {
	channel.ID = strings.TrimSpace(channel.ID)
	channel.Slug = strings.ToLower(strings.TrimSpace(channel.Slug))
	channel.Name = strings.TrimSpace(channel.Name)
	channel.Status = strings.ToLower(strings.TrimSpace(channel.Status))
	channel.OAuthClientID = strings.TrimSpace(channel.OAuthClientID)
	channel.OAuthClientSecret = strings.TrimSpace(channel.OAuthClientSecret)
	channel.EnabledFeatures = normalizeUniqueStrings(channel.EnabledFeatures)
	channel.AllowedModelIDs = normalizeUniqueStrings(channel.AllowedModelIDs)

	if !channelSlugPattern.MatchString(channel.Slug) {
		return kerrors.BadRequest("INVALID_ARGUMENT", "slug must be 3-64 lowercase letters, digits, or hyphens")
	}
	if channel.Name == "" || len([]rune(channel.Name)) > 120 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "channel name must be between 1 and 120 characters")
	}
	if !validChannelStatus(channel.Status) {
		return kerrors.BadRequest("INVALID_ARGUMENT", "channel status is invalid")
	}
	if len(channel.OAuthClientID) > 256 || len(channel.OAuthClientSecret) > 2048 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "OAuth credentials are too long")
	}
	if requireSecret && channel.Status == ChannelStatusActive && (channel.OAuthClientID == "" || channel.OAuthClientSecret == "") {
		return kerrors.BadRequest("INVALID_ARGUMENT", "active channels require OAuth client credentials")
	}
	for _, feature := range channel.EnabledFeatures {
		if _, ok := allowedFeatures[feature]; !ok {
			return kerrors.BadRequest("INVALID_ARGUMENT", "enabled_features contains an unknown feature")
		}
	}
	if channel.RestrictModels && len(channel.AllowedModelIDs) == 0 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "restricted channels require at least one model")
	}
	if len(channel.AllowedModelIDs) > 500 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "at most 500 models may be configured")
	}
	return nil
}

func normalizeUniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func validChannelStatus(status string) bool {
	return status == ChannelStatusDraft || status == ChannelStatusActive || status == ChannelStatusDisabled
}

func validateLoopbackRedirectURI(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Fragment != "" {
		return "", kerrors.BadRequest("INVALID_ARGUMENT", "redirect_uri must be an HTTP loopback URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "localhost" && host != "127.0.0.1" && host != "[::1]" && host != "::1" {
		return "", kerrors.BadRequest("INVALID_ARGUMENT", "redirect_uri must use a loopback host")
	}
	if parsed.Port() == "" {
		return "", kerrors.BadRequest("INVALID_ARGUMENT", "redirect_uri must include a port")
	}
	return parsed.String(), nil
}

func hashOAuthState(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])
}
