package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	defaultNativeOAuthAuthorizationEndpoint = "https://oauth2.ucloud.cn/authorize"
	defaultNativeOAuthTokenEndpoint         = "https://oauth2.ucloud.cn/token"
	defaultNativeOAuthScopes                = "openid email offline_access full_access"
	defaultNativeOAuthRedirectURIs          = "astraflow://oauth/callback https://astraflow-desktop.modelverse.cn/mobile/oauth/callback"
)

type ucloudNativeOAuthClient struct {
	client *http.Client
}

func NewNativeOAuthClient() biz.NativeOAuthClient {
	return &ucloudNativeOAuthClient{client: &http.Client{Timeout: 30 * time.Second}}
}

func (client *ucloudNativeOAuthClient) Config() (*biz.NativeOAuthConfig, error) {
	clientID := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_CLIENT_ID"))
	if clientID == "" || strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET")) == "" {
		return nil, fmt.Errorf("native OAuth client credentials are not configured")
	}
	endpoint := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_AUTHORIZATION_ENDPOINT"))
	if endpoint == "" {
		endpoint = defaultNativeOAuthAuthorizationEndpoint
	}
	scopeValue := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_SCOPES"))
	if scopeValue == "" {
		scopeValue = defaultNativeOAuthScopes
	}
	redirectValue := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_REDIRECT_URIS"))
	if redirectValue == "" {
		redirectValue = defaultNativeOAuthRedirectURIs
	}
	return &biz.NativeOAuthConfig{
		AuthorizationEndpoint: endpoint,
		ClientID:              clientID,
		Scopes:                strings.Fields(scopeValue),
		AllowedRedirectURIs:   strings.Fields(redirectValue),
	}, nil
}

func (client *ucloudNativeOAuthClient) ExchangeCode(ctx context.Context, code, redirectURI, codeVerifier string) (*biz.OAuthTokens, error) {
	config, secret, err := nativeOAuthCredentials(client)
	if err != nil {
		return nil, err
	}
	return client.requestToken(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {config.ClientID},
		"client_secret": {secret},
		"redirect_uri":  {redirectURI},
		"code_verifier": {codeVerifier},
	})
}

func (client *ucloudNativeOAuthClient) RefreshToken(ctx context.Context, refreshToken string) (*biz.OAuthTokens, error) {
	config, secret, err := nativeOAuthCredentials(client)
	if err != nil {
		return nil, err
	}
	return client.requestToken(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {config.ClientID},
		"client_secret": {secret},
	})
}

func nativeOAuthCredentials(client *ucloudNativeOAuthClient) (*biz.NativeOAuthConfig, string, error) {
	config, err := client.Config()
	if err != nil {
		return nil, "", kerrors.ServiceUnavailable("NATIVE_OAUTH_UNAVAILABLE", "native OAuth is not configured")
	}
	return config, strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET")), nil
}

func (client *ucloudNativeOAuthClient) requestToken(ctx context.Context, form url.Values) (*biz.OAuthTokens, error) {
	endpoint := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_OAUTH_TOKEN_ENDPOINT"))
	if endpoint == "" {
		endpoint = defaultNativeOAuthTokenEndpoint
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, kerrors.InternalServer("NATIVE_OAUTH_UNAVAILABLE", "could not create OAuth token request")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := client.client.Do(request)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("NATIVE_OAUTH_UNAVAILABLE", "UCloud OAuth token service is unavailable")
	}
	defer response.Body.Close()
	payload := channelOAuthTokenResponse{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, kerrors.ServiceUnavailable("NATIVE_OAUTH_UNAVAILABLE", "UCloud OAuth returned an invalid response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || payload.Error != "" || payload.AccessToken == "" {
		message := strings.TrimSpace(payload.ErrorDescription)
		if message == "" {
			message = strings.TrimSpace(payload.Error)
		}
		if message == "" {
			message = fmt.Sprintf("UCloud OAuth token request failed with HTTP %d", response.StatusCode)
		}
		return nil, kerrors.BadRequest("NATIVE_OAUTH_EXCHANGE_FAILED", message)
	}
	return &biz.OAuthTokens{
		AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken,
		TokenType: payload.TokenType, ExpiresIn: payload.ExpiresIn, IDToken: payload.IDToken,
	}, nil
}
