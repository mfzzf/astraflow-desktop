package data

import (
	"crypto/sha256"
	"crypto/subtle"
	"os"
	"strings"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type cloudWorkerAuthenticator struct {
	tokenHash  [sha256.Size]byte
	configured bool
}

func NewCloudWorkerAuthenticator() biz.CloudWorkerAuthenticator {
	token := strings.TrimSpace(os.Getenv("ASTRAFLOW_CLOUD_WORKER_TOKEN"))
	return &cloudWorkerAuthenticator{
		tokenHash:  sha256.Sum256([]byte(token)),
		configured: len(token) >= 32,
	}
}

func (auth *cloudWorkerAuthenticator) Authenticate(authorization string) error {
	if auth == nil || !auth.configured {
		return kerrors.ServiceUnavailable("CLOUD_WORKER_AUTH_UNAVAILABLE", "cloud worker authentication is not configured")
	}
	prefix, token, found := strings.Cut(strings.TrimSpace(authorization), " ")
	if !found || !strings.EqualFold(prefix, "Bearer") || strings.TrimSpace(token) == "" {
		return kerrors.Unauthorized("UNAUTHENTICATED", "a valid cloud worker bearer token is required")
	}
	actual := sha256.Sum256([]byte(strings.TrimSpace(token)))
	if subtle.ConstantTimeCompare(actual[:], auth.tokenHash[:]) != 1 {
		return kerrors.Unauthorized("UNAUTHENTICATED", "a valid cloud worker bearer token is required")
	}
	return nil
}
