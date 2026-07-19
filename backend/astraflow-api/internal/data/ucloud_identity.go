package data

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	identityCacheTTL = time.Minute
	maxIdentityCache = 2048
)

type ucloudIdentityResolver struct {
	client   *http.Client
	endpoint string
	mu       sync.Mutex
	cache    map[[sha256.Size]byte]cachedIdentity
}

type cachedIdentity struct {
	identity  biz.AuthenticatedIdentity
	expiresAt time.Time
}

type ucloudUserInfoResponse struct {
	RetCode int              `json:"RetCode"`
	Message string           `json:"Message"`
	DataSet []ucloudUserInfo `json:"DataSet"`
}

type ucloudUserInfo struct {
	UserID      int64  `json:"UserId"`
	UserEmail   string `json:"UserEmail"`
	UserName    string `json:"UserName"`
	CompanyName string `json:"CompanyName"`
}

func NewUCloudIdentityResolver(data *Data) biz.IdentityResolver {
	return &ucloudIdentityResolver{
		client: data.marketHTTPClient, endpoint: data.ucloudMarketEndpoint,
		cache: make(map[[sha256.Size]byte]cachedIdentity),
	}
}

func (resolver *ucloudIdentityResolver) Resolve(ctx context.Context, authorization string) (*biz.AuthenticatedIdentity, error) {
	authorization = strings.TrimSpace(authorization)
	if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") || strings.TrimSpace(authorization[7:]) == "" {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "a valid UCloud OAuth bearer token is required")
	}
	key := sha256.Sum256([]byte(authorization))
	if identity, ok := resolver.cached(key, time.Now()); ok {
		return identity, nil
	}

	body, err := json.Marshal(map[string]string{"Action": "GetUserInfo"})
	if err != nil {
		return nil, identityUnavailable()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, resolver.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, identityUnavailable()
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", "application/json")

	response, err := resolver.client.Do(request)
	if err != nil {
		return nil, identityUnavailable()
	}
	defer response.Body.Close()
	payload := ucloudUserInfoResponse{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, identityUnavailable()
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden || payload.RetCode != 0 {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "UCloud OAuth token is invalid or expired")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, identityUnavailable()
	}
	if len(payload.DataSet) == 0 || payload.DataSet[0].UserID <= 0 {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "UCloud OAuth account identity is unavailable")
	}
	user := payload.DataSet[0]
	displayName := strings.TrimSpace(user.UserName)
	if displayName == "" {
		displayName = strings.TrimSpace(user.CompanyName)
	}
	identity := &biz.AuthenticatedIdentity{
		Provider: "ucloud", Subject: strconv.FormatInt(user.UserID, 10),
		Email: strings.TrimSpace(user.UserEmail), DisplayName: displayName,
	}
	resolver.store(key, *identity, time.Now())
	return identity, nil
}

func (resolver *ucloudIdentityResolver) cached(key [sha256.Size]byte, now time.Time) (*biz.AuthenticatedIdentity, bool) {
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	item, ok := resolver.cache[key]
	if !ok || !item.expiresAt.After(now) {
		return nil, false
	}
	identity := item.identity
	return &identity, true
}

func (resolver *ucloudIdentityResolver) store(key [sha256.Size]byte, identity biz.AuthenticatedIdentity, now time.Time) {
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if resolver.cache == nil {
		resolver.cache = make(map[[sha256.Size]byte]cachedIdentity)
	}
	if len(resolver.cache) >= maxIdentityCache {
		for cachedKey, item := range resolver.cache {
			if !item.expiresAt.After(now) {
				delete(resolver.cache, cachedKey)
			}
		}
		if len(resolver.cache) >= maxIdentityCache {
			resolver.cache = make(map[[sha256.Size]byte]cachedIdentity)
		}
	}
	resolver.cache[key] = cachedIdentity{identity: identity, expiresAt: now.Add(identityCacheTTL)}
}

func identityUnavailable() error {
	return kerrors.ServiceUnavailable("OAUTH_UNAVAILABLE", "UCloud OAuth identity lookup is unavailable")
}
