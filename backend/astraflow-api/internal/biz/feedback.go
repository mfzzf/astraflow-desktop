package biz

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	FeedbackEntryPointMessageAction = "message_action"
	FeedbackEntryPointTitlebar      = "titlebar"
	MaxFeedbackDescriptionRunes     = 4000
	MaxFeedbackImages               = 3
	MaxFeedbackImageBytes           = 5 * 1024 * 1024
)

var allowedFeedbackImageTypes = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
	"image/gif":  {},
}

type FeedbackImage struct {
	ID       string
	Name     string
	MimeType string
	Content  []byte
}

type Feedback struct {
	ID              string
	SessionID       string
	TargetMessageID string
	EntryPoint      string
	Description     string
	MessagesJSON    string
	Images          []*FeedbackImage
	ReporterEmail   string
	ClientVersion   string
	Platform        string
	Locale          string
	CreatedAt       time.Time
}

type FeedbackRepo interface {
	CreateFeedback(context.Context, *Feedback) error
}

type OAuthVerifier interface {
	Verify(context.Context, string) error
}

type FeedbackUsecase struct {
	repo     FeedbackRepo
	verifier OAuthVerifier
}

func NewFeedbackUsecase(repo FeedbackRepo, verifier OAuthVerifier) *FeedbackUsecase {
	return &FeedbackUsecase{repo: repo, verifier: verifier}
}

func (uc *FeedbackUsecase) CreateFeedback(ctx context.Context, authorization string, feedback *Feedback) (*Feedback, error) {
	if strings.TrimSpace(authorization) == "" {
		return nil, kerrors.Unauthorized("UNAUTHENTICATED", "UCloud OAuth login is required")
	}
	if err := uc.verifier.Verify(ctx, authorization); err != nil {
		return nil, err
	}
	if err := normalizeAndValidateFeedback(feedback); err != nil {
		return nil, err
	}
	if err := uc.repo.CreateFeedback(ctx, feedback); err != nil {
		return nil, kerrors.ServiceUnavailable("FEEDBACK_UNAVAILABLE", "feedback could not be saved")
	}
	return feedback, nil
}

func normalizeAndValidateFeedback(feedback *Feedback) error {
	feedback.SessionID = strings.TrimSpace(feedback.SessionID)
	feedback.TargetMessageID = strings.TrimSpace(feedback.TargetMessageID)
	feedback.EntryPoint = strings.TrimSpace(feedback.EntryPoint)
	feedback.Description = strings.TrimSpace(feedback.Description)
	feedback.ReporterEmail = strings.TrimSpace(feedback.ReporterEmail)
	feedback.ClientVersion = strings.TrimSpace(feedback.ClientVersion)
	feedback.Platform = strings.TrimSpace(feedback.Platform)
	feedback.Locale = strings.TrimSpace(feedback.Locale)

	if feedback.SessionID == "" {
		return kerrors.BadRequest("INVALID_ARGUMENT", "session_id is required")
	}
	if utf8.RuneCountInString(feedback.SessionID) > 120 || utf8.RuneCountInString(feedback.TargetMessageID) > 120 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "session or message identifier is too long")
	}
	if feedback.EntryPoint != FeedbackEntryPointMessageAction && feedback.EntryPoint != FeedbackEntryPointTitlebar {
		return kerrors.BadRequest("INVALID_ARGUMENT", "entry_point is invalid")
	}
	if feedback.EntryPoint == FeedbackEntryPointMessageAction && feedback.TargetMessageID == "" {
		return kerrors.BadRequest("INVALID_ARGUMENT", "target_message_id is required for message feedback")
	}
	if feedback.Description == "" || utf8.RuneCountInString(feedback.Description) > MaxFeedbackDescriptionRunes {
		return kerrors.BadRequest("INVALID_ARGUMENT", "description must be between 1 and 4000 characters")
	}
	var messages []json.RawMessage
	if feedback.MessagesJSON == "" || json.Unmarshal([]byte(feedback.MessagesJSON), &messages) != nil || len(messages) == 0 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "messages_json must contain a non-empty JSON array")
	}
	if utf8.RuneCountInString(feedback.ReporterEmail) > 320 ||
		utf8.RuneCountInString(feedback.ClientVersion) > 64 ||
		utf8.RuneCountInString(feedback.Platform) > 64 ||
		utf8.RuneCountInString(feedback.Locale) > 16 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "feedback client metadata is too long")
	}
	if len(feedback.Images) > MaxFeedbackImages {
		return kerrors.New(413, "PAYLOAD_TOO_LARGE", "at most 3 feedback images are allowed")
	}
	for _, image := range feedback.Images {
		image.Name = strings.TrimSpace(image.Name)
		image.MimeType = strings.ToLower(strings.TrimSpace(image.MimeType))
		if image.Name == "" {
			return kerrors.BadRequest("INVALID_ARGUMENT", "image name is required")
		}
		if utf8.RuneCountInString(image.Name) > 255 {
			return kerrors.BadRequest("INVALID_ARGUMENT", "image name is too long")
		}
		if _, ok := allowedFeedbackImageTypes[image.MimeType]; !ok {
			return kerrors.BadRequest("INVALID_ARGUMENT", "unsupported feedback image type")
		}
		if len(image.Content) == 0 || len(image.Content) > MaxFeedbackImageBytes {
			return kerrors.New(413, "PAYLOAD_TOO_LARGE", "feedback image must be at most 5 MiB")
		}
	}
	return nil
}
