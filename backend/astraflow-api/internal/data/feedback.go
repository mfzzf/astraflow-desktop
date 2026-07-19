package data

import (
	"context"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
			messages, reporter_email, client_version, platform, locale,
			channel_slug, status, created_at, updated_at
		) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5, NULLIF($6, ''), $7, $8, $9, $10, $11, 'new', $12, $12)
	`, feedback.ID, feedback.SessionID, feedback.TargetMessageID, feedback.EntryPoint,
		feedback.Description, feedback.MessagesJSON, feedback.ReporterEmail,
		feedback.ClientVersion, feedback.Platform, feedback.Locale, feedback.ChannelSlug, feedback.CreatedAt)
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

func (r *feedbackRepo) ListFeedbacks(ctx context.Context, options biz.FeedbackListOptions) ([]*biz.Feedback, int, int, error) {
	if r.data.db == nil {
		return nil, 0, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	query := `%` + options.Query + `%`
	rows, err := r.data.db.Query(ctx, `
		SELECT f.id, COALESCE(f.session_id, ''), COALESCE(f.target_message_id, ''),
			f.entry_point, f.description, f.reporter_email, f.client_version,
			f.platform, f.locale, f.channel_slug, f.status, f.assignee,
			count(fi.id)::int, f.created_at, f.updated_at,
			count(*) OVER()::int,
			count(*) FILTER (WHERE f.status IN ('new','reviewing')) OVER()::int
		FROM feedbacks f
		LEFT JOIN feedback_images fi ON fi.feedback_id = f.id
		WHERE ($1 = '' OR f.description ILIKE $2 OR f.reporter_email ILIKE $2 OR f.id ILIKE $2)
		  AND ($3 = '' OR f.status = $3)
		  AND ($4 = '' OR f.channel_slug = $4)
		GROUP BY f.id
		ORDER BY f.created_at DESC
		OFFSET $5 LIMIT $6
	`, options.Query, query, options.Status, options.ChannelSlug, options.Offset, options.Limit)
	if err != nil {
		return nil, 0, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback could not be loaded")
	}
	defer rows.Close()
	items := make([]*biz.Feedback, 0)
	total, open := 0, 0
	for rows.Next() {
		feedback := &biz.Feedback{}
		if err := rows.Scan(
			&feedback.ID, &feedback.SessionID, &feedback.TargetMessageID,
			&feedback.EntryPoint, &feedback.Description, &feedback.ReporterEmail,
			&feedback.ClientVersion, &feedback.Platform, &feedback.Locale,
			&feedback.ChannelSlug, &feedback.Status, &feedback.Assignee,
			&feedback.ImageCount, &feedback.CreatedAt, &feedback.UpdatedAt,
			&total, &open,
		); err != nil {
			return nil, 0, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback could not be loaded")
		}
		items = append(items, feedback)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback could not be loaded")
	}
	return items, total, open, nil
}

func (r *feedbackRepo) GetFeedback(ctx context.Context, id string) (*biz.Feedback, error) {
	if r.data.db == nil {
		return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	feedback := &biz.Feedback{}
	err := r.data.db.QueryRow(ctx, `
		SELECT f.id, COALESCE(f.session_id, ''), COALESCE(f.target_message_id, ''),
			f.entry_point, f.description, COALESCE(f.messages, ''), f.reporter_email,
			f.client_version, f.platform, f.locale, f.channel_slug, f.status,
			f.assignee, f.admin_note, count(fi.id)::int, f.created_at, f.updated_at
		FROM feedbacks f
		LEFT JOIN feedback_images fi ON fi.feedback_id = f.id
		WHERE f.id = $1
		GROUP BY f.id
	`, id).Scan(
		&feedback.ID, &feedback.SessionID, &feedback.TargetMessageID,
		&feedback.EntryPoint, &feedback.Description, &feedback.MessagesJSON,
		&feedback.ReporterEmail, &feedback.ClientVersion, &feedback.Platform,
		&feedback.Locale, &feedback.ChannelSlug, &feedback.Status,
		&feedback.Assignee, &feedback.AdminNote, &feedback.ImageCount,
		&feedback.CreatedAt, &feedback.UpdatedAt,
	)
	if err != nil {
		return nil, mapFeedbackError(err)
	}
	rows, err := r.data.db.Query(ctx, `
		SELECT id, file_name, mime_type, byte_size FROM feedback_images
		WHERE feedback_id=$1 ORDER BY created_at ASC, id ASC
	`, id)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback images could not be loaded")
	}
	defer rows.Close()
	for rows.Next() {
		image := &biz.FeedbackImage{}
		if err := rows.Scan(&image.ID, &image.Name, &image.MimeType, &image.ByteSize); err != nil {
			return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback images could not be loaded")
		}
		feedback.Images = append(feedback.Images, image)
	}
	return feedback, nil
}

func (r *feedbackRepo) UpdateFeedback(ctx context.Context, feedback *biz.Feedback) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	result, err := r.data.db.Exec(ctx, `
		UPDATE feedbacks SET status=$2, assignee=$3, admin_note=$4, updated_at=now()
		WHERE id=$1
	`, feedback.ID, feedback.Status, feedback.Assignee, feedback.AdminNote)
	if err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback could not be updated")
	}
	if result.RowsAffected() == 0 {
		return kerrors.NotFound("FEEDBACK_NOT_FOUND", "feedback was not found")
	}
	return nil
}

func (r *feedbackRepo) GetFeedbackImage(ctx context.Context, feedbackID, imageID string) (*biz.FeedbackImage, error) {
	if r.data.db == nil {
		return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	image := &biz.FeedbackImage{}
	err := r.data.db.QueryRow(ctx, `
		SELECT id, file_name, mime_type, byte_size, content
		FROM feedback_images WHERE id=$1 AND feedback_id=$2
	`, imageID, feedbackID).Scan(&image.ID, &image.Name, &image.MimeType, &image.ByteSize, &image.Content)
	if err != nil {
		return nil, mapFeedbackError(err)
	}
	return image, nil
}

func mapFeedbackError(err error) error {
	if err == pgx.ErrNoRows {
		return kerrors.NotFound("FEEDBACK_NOT_FOUND", "feedback was not found")
	}
	return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "feedback operation failed")
}
