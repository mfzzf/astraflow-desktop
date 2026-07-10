package data

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const ucloudAPIEndpoint = "https://api.ucloud.cn/"

type ucloudOAuthVerifier struct {
	client *http.Client
}

type ucloudOAuthResponse struct {
	RetCode int    `json:"RetCode"`
	Message string `json:"Message"`
}

func NewUCloudOAuthVerifier() biz.OAuthVerifier {
	return &ucloudOAuthVerifier{client: &http.Client{Timeout: 5 * time.Second}}
}

func (v *ucloudOAuthVerifier) Verify(ctx context.Context, authorization string) error {
	authorization = strings.TrimSpace(authorization)
	if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") || strings.TrimSpace(authorization[7:]) == "" {
		return kerrors.Unauthorized("UNAUTHENTICATED", "a valid UCloud OAuth bearer token is required")
	}

	body, err := json.Marshal(map[string]any{"Action": "GetProjectList"})
	if err != nil {
		return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "unable to validate UCloud OAuth token")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ucloudAPIEndpoint, bytes.NewReader(body))
	if err != nil {
		return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "unable to validate UCloud OAuth token")
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", "application/json")

	response, err := v.client.Do(req)
	if err != nil {
		return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth validation is unavailable")
	}
	defer response.Body.Close()

	payload := ucloudOAuthResponse{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth returned an invalid response")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden || payload.RetCode != 0 {
		return kerrors.Unauthorized("UNAUTHENTICATED", "UCloud OAuth token is invalid or expired")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth validation is unavailable")
	}
	return nil
}
