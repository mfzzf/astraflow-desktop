package data

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func identityTestResolver(fn roundTripFunc) *ucloudIdentityResolver {
	return &ucloudIdentityResolver{
		client: &http.Client{Transport: fn}, endpoint: "https://identity.test/",
		cache: make(map[[32]byte]cachedIdentity),
	}
}

func TestUCloudIdentityResolverUsesStableUserID(t *testing.T) {
	requests := 0
	resolver := identityTestResolver(func(request *http.Request) (*http.Response, error) {
		requests++
		var payload map[string]string
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["Action"] != "GetUserInfo" {
			t.Fatalf("Action = %q, want GetUserInfo", payload["Action"])
		}
		return oauthResponse(http.StatusOK, `{"RetCode":0,"DataSet":[{"UserId":42,"UserEmail":"person@example.com","UserName":"Person"}]}`), nil
	})

	for range 2 {
		identity, err := resolver.Resolve(context.Background(), "Bearer valid")
		if err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		if identity.Provider != "ucloud" || identity.Subject != "42" || identity.Email != "person@example.com" {
			t.Fatalf("Resolve() identity = %#v", identity)
		}
	}
	if requests != 1 {
		t.Fatalf("identity lookup requests = %d, want 1", requests)
	}
}

func TestUCloudIdentityResolverRejectsMissingUser(t *testing.T) {
	resolver := identityTestResolver(func(*http.Request) (*http.Response, error) {
		return oauthResponse(http.StatusOK, `{"RetCode":0,"DataSet":[]}`), nil
	})
	if _, err := resolver.Resolve(t.Context(), "Bearer valid"); err == nil {
		t.Fatal("Resolve() error = nil, want missing identity error")
	}
}
