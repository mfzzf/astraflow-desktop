package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type ucloudChannelOAuthClient struct {
	client *http.Client
}

type channelOAuthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	TokenType        string `json:"token_type"`
	ExpiresIn        int64  `json:"expires_in"`
	IDToken          string `json:"id_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func NewChannelOAuthClient() biz.ChannelOAuthClient {
	return &ucloudChannelOAuthClient{client: &http.Client{Timeout: 30 * time.Second}}
}

func (c *ucloudChannelOAuthClient) ExchangeCode(ctx context.Context, clientID, clientSecret, code, redirectURI string) (*biz.OAuthTokens, error) {
	return c.requestToken(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"redirect_uri":  {redirectURI},
	})
}

func (c *ucloudChannelOAuthClient) RefreshToken(ctx context.Context, clientID, clientSecret, refreshToken string) (*biz.OAuthTokens, error) {
	return c.requestToken(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
	})
}

func (c *ucloudChannelOAuthClient) requestToken(ctx context.Context, form url.Values) (*biz.OAuthTokens, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.ucloud.cn/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, kerrors.InternalServer("OAUTH_UNAVAILABLE", "could not create OAuth token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.client.Do(req)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth token service is unavailable")
	}
	defer response.Body.Close()
	payload := channelOAuthTokenResponse{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth returned an invalid response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || payload.Error != "" || payload.AccessToken == "" {
		message := strings.TrimSpace(payload.ErrorDescription)
		if message == "" {
			message = strings.TrimSpace(payload.Error)
		}
		if message == "" {
			message = fmt.Sprintf("UCloud OAuth token request failed with HTTP %d", response.StatusCode)
		}
		return nil, kerrors.BadRequest("OAUTH_EXCHANGE_FAILED", message)
	}
	return &biz.OAuthTokens{
		AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken,
		TokenType: payload.TokenType, ExpiresIn: payload.ExpiresIn, IDToken: payload.IDToken,
	}, nil
}
