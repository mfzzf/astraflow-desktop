package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"net/http/httptest"
	"testing"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

func TestDeviceRelayContextOutlivesOrdinaryRequestTimeout(t *testing.T) {
	requestContext, cancelRequest := context.WithCancel(context.Background())
	relayContext, cancelRelay := newDeviceRelayContext(requestContext)
	cancelRequest()
	defer cancelRelay()
	select {
	case <-relayContext.Done():
		t.Fatalf("relay context ended with request context: %v", relayContext.Err())
	default:
	}
	cancelRelay()
	if relayContext.Err() != context.Canceled {
		t.Fatalf("relay context error = %v, want canceled", relayContext.Err())
	}
}

func TestDeviceRelayChallengeVerification(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	deviceID := "device-1"
	challenge := "challenge"
	signed := []byte("astraflow-device-relay-v1:" + deviceID + ":" + challenge)
	signature := ed25519.Sign(privateKey, signed)
	if err := verifyDeviceChallenge(
		base64.StdEncoding.EncodeToString(der), deviceID, challenge,
		base64.StdEncoding.EncodeToString(signature),
	); err != nil {
		t.Fatalf("verifyDeviceChallenge() error = %v", err)
	}
	if err := verifyDeviceChallenge(
		base64.StdEncoding.EncodeToString(der), deviceID, "other",
		base64.StdEncoding.EncodeToString(signature),
	); err == nil {
		t.Fatal("verifyDeviceChallenge() error = nil for mismatched challenge")
	}
}

func TestDeviceRelayRequiresDeviceAuthorizationScheme(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/device-relay", nil)
	request.Header.Set("Authorization", "Device short-lived-token")
	if got := deviceTokenFromRequest(request); got != "short-lived-token" {
		t.Fatalf("deviceTokenFromRequest() = %q", got)
	}
	request.Header.Set("Authorization", "Bearer oauth-token")
	if got := deviceTokenFromRequest(request); got != "" {
		t.Fatalf("deviceTokenFromRequest() bearer = %q, want empty", got)
	}
}

func TestDeviceRelayDistinguishesRevocationFromTransientFailure(t *testing.T) {
	if !deviceAccessRevoked(kerrors.NotFound("NOT_FOUND", "revoked")) {
		t.Fatal("NotFound device state should close the relay")
	}
	if deviceAccessRevoked(kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "retry")) {
		t.Fatal("transient device lookup failure should not be treated as revocation")
	}
}
