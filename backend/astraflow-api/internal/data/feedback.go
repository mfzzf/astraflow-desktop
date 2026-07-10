package data

import (
	"context"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	"github.com/google/uuid"
)

type feedbackRepo struct {
	data *Data
}

func NewFeedbackRepo(data *Data) biz.FeedbackRepo {
	return &feedbackRepo{data: data}
}

func (r *feedbackRepo) CreateFeedback(ctx context.Context, feedback *biz.Feedback) error {
	if r.data.db == nil {
		return fmt.Errorf("database is not configured")
	}

	tx, err := r.data.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if feedback.ID == "" {
		feedback.ID = uuid.NewString()
	}
	if feedback.CreatedAt.IsZero() {
		feedback.CreatedAt = time.Now().UTC()
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO feedbacks (
			id, session_id, target_message_id, entry_point, description,
			messages, reporter_email, client_version, platform, locale, created_at
		) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
	`, feedback.ID, feedback.SessionID, feedback.TargetMessageID, feedback.EntryPoint,
		feedback.Description, feedback.MessagesJSON, feedback.ReporterEmail,
		feedback.ClientVersion, feedback.Platform, feedback.Locale, feedback.CreatedAt)
	if err != nil {
		return err
	}

	for _, image := range feedback.Images {
		if image.ID == "" {
			image.ID = uuid.NewString()
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO feedback_images (
				id, feedback_id, file_name, mime_type, byte_size, content, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, image.ID, feedback.ID, image.Name, image.MimeType, len(image.Content), image.Content, feedback.CreatedAt)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
