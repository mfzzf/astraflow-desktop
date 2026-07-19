package data

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const ucloudAPIEndpoint = "https://api.ucloud.cn/"

const (
	oauthVerificationCacheTTL = time.Minute
	maxOAuthVerificationCache = 2048
)

type ucloudOAuthVerifier struct {
	client *http.Client
	mu     sync.Mutex
	valid  map[[sha256.Size]byte]time.Time
}

type ucloudOAuthResponse struct {
	RetCode int    `json:"RetCode"`
	Message string `json:"Message"`
}

func NewUCloudOAuthVerifier() biz.OAuthVerifier {
	return &ucloudOAuthVerifier{
		client: &http.Client{Timeout: 5 * time.Second},
		valid:  make(map[[sha256.Size]byte]time.Time),
	}
}

func (v *ucloudOAuthVerifier) Verify(ctx context.Context, authorization string) error {
	authorization = strings.TrimSpace(authorization)
	if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") || strings.TrimSpace(authorization[7:]) == "" {
		return kerrors.Unauthorized("UNAUTHENTICATED", "a valid UCloud OAuth bearer token is required")
	}
	cacheKey := sha256.Sum256([]byte(authorization))
	if v.isCached(cacheKey, time.Now()) {
		return nil
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
	v.cache(cacheKey, time.Now())
	return nil
}

func (v *ucloudOAuthVerifier) isCached(key [sha256.Size]byte, now time.Time) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	expiresAt, ok := v.valid[key]
	return ok && expiresAt.After(now)
}

func (v *ucloudOAuthVerifier) cache(key [sha256.Size]byte, now time.Time) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.valid == nil {
		v.valid = make(map[[sha256.Size]byte]time.Time)
	}
	if len(v.valid) >= maxOAuthVerificationCache {
		for cachedKey, expiresAt := range v.valid {
			if !expiresAt.After(now) {
				delete(v.valid, cachedKey)
			}
		}
		if len(v.valid) >= maxOAuthVerificationCache {
			v.valid = make(map[[sha256.Size]byte]time.Time)
		}
	}
	v.valid[key] = now.Add(oauthVerificationCacheTTL)
}
