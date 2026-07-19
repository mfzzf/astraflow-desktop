package data

import (
	"context"
	"crypto/subtle"
	"os"
	"strings"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

type envAdminVerifier struct{}

func NewAdminVerifier() biz.AdminVerifier {
	return &envAdminVerifier{}
}

func (v *envAdminVerifier) VerifyAdmin(_ context.Context, authorization string) error {
	expected := strings.TrimSpace(os.Getenv("ASTRAFLOW_ADMIN_API_KEY"))
	if expected == "" {
		return kerrors.ServiceUnavailable("ADMIN_AUTH_UNAVAILABLE", "admin authentication is not configured")
	}
	provided := strings.TrimSpace(authorization)
	if len(provided) >= 7 && strings.EqualFold(provided[:7], "Bearer ") {
		provided = strings.TrimSpace(provided[7:])
	} else {
		provided = ""
	}
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return kerrors.Unauthorized("UNAUTHENTICATED", "a valid admin API key is required")
	}
	return nil
}
