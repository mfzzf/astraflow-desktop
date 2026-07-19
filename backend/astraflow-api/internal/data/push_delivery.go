package data

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type pushDeliveryRepo struct {
	data *Data
}

func NewPushDeliveryRepo(data *Data) biz.PushDeliveryRepo {
	return &pushDeliveryRepo{data: data}
}

func (repo *pushDeliveryRepo) ClaimPushDeliveries(ctx context.Context, limit int, leaseDuration time.Duration) ([]*biz.PushDelivery, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if leaseDuration < 10*time.Second || leaseDuration > 10*time.Minute {
		leaseDuration = time.Minute
	}
	rows, err := repo.data.db.Query(ctx, `
		WITH candidates AS (
			SELECT notification.id
			FROM push_notifications AS notification
			JOIN push_endpoints AS endpoint ON endpoint.id = notification.push_endpoint_id
			JOIN devices AS device ON device.id = endpoint.device_id
			WHERE notification.status IN ('pending', 'leased')
				AND notification.next_attempt_at <= now()
				AND (notification.status = 'pending' OR notification.lease_expires_at < now())
				AND endpoint.enabled
				AND device.revoked_at IS NULL
			ORDER BY notification.next_attempt_at, notification.created_at, notification.id
			FOR UPDATE OF notification SKIP LOCKED
			LIMIT $1
		), claimed AS (
			UPDATE push_notifications AS notification SET
				status = 'leased', attempts = attempts + 1,
				lease_expires_at = now() + make_interval(secs => $2),
				last_error = ''
			FROM candidates
			WHERE notification.id = candidates.id
			RETURNING notification.id, notification.account_id,
				notification.push_endpoint_id, COALESCE(notification.run_id, ''),
				notification.event_type, notification.title, notification.body,
				notification.data, notification.attempts
		)
		SELECT claimed.id, claimed.account_id, claimed.push_endpoint_id,
			claimed.run_id, claimed.event_type, endpoint.provider,
			endpoint.token_ciphertext, endpoint.token_nonce,
			claimed.title, claimed.body, claimed.data, claimed.attempts
		FROM claimed
		JOIN push_endpoints AS endpoint ON endpoint.id = claimed.push_endpoint_id
	`, limit, int(leaseDuration/time.Second))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deliveries := make([]*biz.PushDelivery, 0, limit)
	for rows.Next() {
		delivery := &biz.PushDelivery{}
		var ciphertext, nonce, encodedData []byte
		if err := rows.Scan(&delivery.ID, &delivery.AccountID, &delivery.PushEndpointID,
			&delivery.RunID, &delivery.EventType, &delivery.Provider, &ciphertext, &nonce,
			&delivery.Title, &delivery.Body, &encodedData, &delivery.Attempts); err != nil {
			return nil, err
		}
		token, err := decryptPushToken(ciphertext, nonce)
		if err != nil {
			return nil, err
		}
		delivery.Token = token
		if err := json.Unmarshal(encodedData, &delivery.Data); err != nil {
			return nil, err
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, rows.Err()
}

func (repo *pushDeliveryRepo) CompletePushDelivery(ctx context.Context, deliveryID string) error {
	if repo.data.db == nil {
		return fmt.Errorf("database is not configured")
	}
	result, err := repo.data.db.Exec(ctx, `
		UPDATE push_notifications SET
			status = 'completed', completed_at = now(), lease_expires_at = NULL,
			last_error = ''
		WHERE id = $1 AND status = 'leased'
	`, deliveryID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return biz.ErrCrossDeviceConflict
	}
	return nil
}

func (repo *pushDeliveryRepo) NackPushDelivery(
	ctx context.Context,
	deliveryID string,
	message string,
	retryAt time.Time,
	permanent bool,
	disableEndpoint bool,
) error {
	if repo.data.db == nil {
		return fmt.Errorf("database is not configured")
	}
	tx, err := repo.data.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	status := "pending"
	if permanent {
		status = "failed"
	}
	var endpointID string
	result := tx.QueryRow(ctx, `
		UPDATE push_notifications SET
			status = $2, next_attempt_at = $3, lease_expires_at = NULL,
			last_error = left($4, 1000),
			completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
		WHERE id = $1 AND status = 'leased'
		RETURNING push_endpoint_id
	`, deliveryID, status, retryAt, message)
	if err := result.Scan(&endpointID); errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceConflict
	} else if err != nil {
		return err
	}
	if disableEndpoint {
		if _, err := tx.Exec(ctx, `UPDATE push_endpoints SET enabled = false, updated_at = now() WHERE id = $1`, endpointID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func enqueuePushNotification(
	ctx context.Context,
	tx pgx.Tx,
	accountID string,
	runID string,
	dedupeKey string,
	eventType string,
	title string,
	body string,
) error {
	// Deliberately keep notification payloads metadata-only. Never pass prompts,
	// tool parameters, terminal output, file names, or model output here.
	data, err := json.Marshal(map[string]any{"run_id": runID, "event_type": eventType})
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		SELECT endpoint.id
		FROM push_endpoints AS endpoint
		JOIN devices AS device ON device.id = endpoint.device_id
		WHERE endpoint.account_id = $1 AND endpoint.enabled AND device.revoked_at IS NULL
	`, accountID)
	if err != nil {
		return err
	}
	endpointIDs := make([]string, 0)
	for rows.Next() {
		var endpointID string
		if err := rows.Scan(&endpointID); err != nil {
			rows.Close()
			return err
		}
		endpointIDs = append(endpointIDs, endpointID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, endpointID := range endpointIDs {
		id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(endpointID+"\x00"+dedupeKey)).String()
		if _, err := tx.Exec(ctx, `
			INSERT INTO push_notifications (
				id, account_id, push_endpoint_id, run_id, dedupe_key,
				event_type, title, body, data
			) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9)
			ON CONFLICT (push_endpoint_id, dedupe_key) DO NOTHING
		`, id, accountID, endpointID, runID, dedupeKey, eventType, title, body, data); err != nil {
			return err
		}
	}
	return nil
}
