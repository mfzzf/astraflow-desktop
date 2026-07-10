package data

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func oauthTestVerifier(fn roundTripFunc) *ucloudOAuthVerifier {
	return &ucloudOAuthVerifier{client: &http.Client{Transport: fn}}
}

func oauthResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestUCloudOAuthVerifierAcceptsValidToken(t *testing.T) {
	verifier := oauthTestVerifier(func(request *http.Request) (*http.Response, error) {
		if got := request.Header.Get("Authorization"); got != "Bearer valid" {
			t.Fatalf("Authorization = %q", got)
		}
		return oauthResponse(http.StatusOK, `{"RetCode":0}`), nil
	})

	if err := verifier.Verify(t.Context(), "Bearer valid"); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
}

func TestUCloudOAuthVerifierRejectsInvalidToken(t *testing.T) {
	verifier := oauthTestVerifier(func(*http.Request) (*http.Response, error) {
		return oauthResponse(http.StatusOK, `{"RetCode":174,"Message":"Token not found"}`), nil
	})

	err := verifier.Verify(t.Context(), "Bearer invalid")
	if got := kerrors.FromError(err).Code; got != http.StatusUnauthorized {
		t.Fatalf("Verify() code = %d, want %d", got, http.StatusUnauthorized)
	}
}

func TestUCloudOAuthVerifierReportsUnavailable(t *testing.T) {
	verifier := oauthTestVerifier(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network unavailable")
	})

	err := verifier.Verify(t.Context(), "Bearer token")
	if got := kerrors.FromError(err).Code; got != http.StatusServiceUnavailable {
		t.Fatalf("Verify() code = %d, want %d", got, http.StatusServiceUnavailable)
	}
}
