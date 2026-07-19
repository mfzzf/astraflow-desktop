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
	ByteSize int64
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
	ChannelSlug     string
	Status          string
	Assignee        string
	AdminNote       string
	ImageCount      int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type FeedbackRepo interface {
	CreateFeedback(context.Context, *Feedback) error
	ListFeedbacks(context.Context, FeedbackListOptions) ([]*Feedback, int, int, error)
	GetFeedback(context.Context, string) (*Feedback, error)
	UpdateFeedback(context.Context, *Feedback) error
	GetFeedbackImage(context.Context, string, string) (*FeedbackImage, error)
}

type FeedbackListOptions struct {
	Query       string
	Status      string
	ChannelSlug string
	Offset      int
	Limit       int
}

type OAuthVerifier interface {
	Verify(context.Context, string) error
}

type FeedbackUsecase struct {
	repo          FeedbackRepo
	verifier      OAuthVerifier
	adminVerifier AdminVerifier
}

func NewFeedbackUsecase(repo FeedbackRepo, verifier OAuthVerifier, adminVerifier AdminVerifier) *FeedbackUsecase {
	return &FeedbackUsecase{repo: repo, verifier: verifier, adminVerifier: adminVerifier}
}

func (uc *FeedbackUsecase) ListFeedbacks(ctx context.Context, authorization string, options FeedbackListOptions) ([]*Feedback, int, int, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, 0, 0, err
	}
	options.Query = strings.TrimSpace(options.Query)
	options.Status = strings.TrimSpace(options.Status)
	options.ChannelSlug = strings.TrimSpace(options.ChannelSlug)
	if options.Status != "" && !validFeedbackStatus(options.Status) {
		return nil, 0, 0, kerrors.BadRequest("INVALID_ARGUMENT", "feedback status is invalid")
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Limit <= 0 || options.Limit > 100 {
		options.Limit = 25
	}
	return uc.repo.ListFeedbacks(ctx, options)
}

func (uc *FeedbackUsecase) GetFeedback(ctx context.Context, authorization, id string) (*Feedback, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	return uc.repo.GetFeedback(ctx, strings.TrimSpace(id))
}

func (uc *FeedbackUsecase) UpdateFeedback(ctx context.Context, authorization string, feedback *Feedback) (*Feedback, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	feedback.ID = strings.TrimSpace(feedback.ID)
	feedback.Status = strings.TrimSpace(feedback.Status)
	feedback.Assignee = strings.TrimSpace(feedback.Assignee)
	feedback.AdminNote = strings.TrimSpace(feedback.AdminNote)
	if feedback.ID == "" || !validFeedbackStatus(feedback.Status) {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "feedback id or status is invalid")
	}
	if utf8.RuneCountInString(feedback.Assignee) > 120 || utf8.RuneCountInString(feedback.AdminNote) > 8000 {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "feedback workflow metadata is too long")
	}
	if err := uc.repo.UpdateFeedback(ctx, feedback); err != nil {
		return nil, err
	}
	return uc.repo.GetFeedback(ctx, feedback.ID)
}

func (uc *FeedbackUsecase) GetFeedbackImage(ctx context.Context, authorization, feedbackID, imageID string) (*FeedbackImage, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	return uc.repo.GetFeedbackImage(ctx, strings.TrimSpace(feedbackID), strings.TrimSpace(imageID))
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
	feedback.MessagesJSON = strings.TrimSpace(feedback.MessagesJSON)
	feedback.ReporterEmail = strings.TrimSpace(feedback.ReporterEmail)
	feedback.ClientVersion = strings.TrimSpace(feedback.ClientVersion)
	feedback.Platform = strings.TrimSpace(feedback.Platform)
	feedback.Locale = strings.TrimSpace(feedback.Locale)
	feedback.ChannelSlug = strings.ToLower(strings.TrimSpace(feedback.ChannelSlug))
	if feedback.ChannelSlug == "" {
		feedback.ChannelSlug = "default"
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
	if feedback.SessionID == "" {
		if feedback.EntryPoint != FeedbackEntryPointTitlebar || feedback.TargetMessageID != "" || feedback.MessagesJSON != "" {
			return kerrors.BadRequest("INVALID_ARGUMENT", "session data is invalid without session_id")
		}
	} else {
		var messages []json.RawMessage
		if feedback.MessagesJSON == "" || json.Unmarshal([]byte(feedback.MessagesJSON), &messages) != nil || messages == nil {
			return kerrors.BadRequest("INVALID_ARGUMENT", "messages_json must contain a JSON array")
		}
	}
	if feedback.Description == "" || utf8.RuneCountInString(feedback.Description) > MaxFeedbackDescriptionRunes {
		return kerrors.BadRequest("INVALID_ARGUMENT", "description must be between 1 and 4000 characters")
	}
	if utf8.RuneCountInString(feedback.ReporterEmail) > 320 ||
		utf8.RuneCountInString(feedback.ClientVersion) > 64 ||
		utf8.RuneCountInString(feedback.Platform) > 64 ||
		utf8.RuneCountInString(feedback.Locale) > 16 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "feedback client metadata is too long")
	}
	if utf8.RuneCountInString(feedback.ChannelSlug) > 64 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "channel slug is too long")
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

func validFeedbackStatus(status string) bool {
	return status == "new" || status == "reviewing" || status == "resolved" || status == "closed"
}
