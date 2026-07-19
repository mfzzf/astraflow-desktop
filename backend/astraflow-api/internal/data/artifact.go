package data

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type artifactRepo struct {
	data *Data
}

func NewArtifactRepo(data *Data) biz.ArtifactRepo {
	return &artifactRepo{data: data}
}

func (repo *artifactRepo) CreateArtifactUpload(ctx context.Context, upload *biz.ArtifactUpload) (*biz.ArtifactUpload, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, upload.AccountID, upload.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getArtifactUploadTxForUpdate(ctx, tx, upload.AccountID, existingID)
		if err != nil {
			return nil, err
		}
		// A client mutation identifies the logical upload, not a single short-lived
		// presigned URL. Renew pending uploads so an offline client can safely retry
		// after the original URL has expired without creating duplicate artifacts.
		if result.Status == "pending" {
			if _, err := tx.Exec(ctx, `
				UPDATE artifact_uploads SET expires_at = $3
				WHERE account_id = $1 AND id = $2 AND status = 'pending'
			`, upload.AccountID, existingID, upload.ExpiresAt); err != nil {
				return nil, err
			}
			result.ExpiresAt = upload.ExpiresAt
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, upload.AccountID, upload.SourceDeviceID, true); err != nil {
		return nil, err
	}
	if _, err := getSessionTx(ctx, tx, upload.AccountID, upload.SessionID); errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	} else if err != nil {
		return nil, err
	}
	if upload.RunID != "" {
		run, err := getAgentRunTx(ctx, tx, upload.AccountID, upload.RunID, false)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, biz.ErrCrossDeviceNotFound
		}
		if err != nil {
			return nil, err
		}
		if run.SessionID != upload.SessionID {
			return nil, biz.ErrCrossDeviceConflict
		}
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO artifact_uploads (
			id, account_id, session_id, run_id, artifact_id, kind, file_name,
			mime_type, size, sha256, object_key, source_device_id, status,
			client_mutation_id, expires_at
		) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11,
			NULLIF($12, ''), 'pending', $13, $14)
		RETURNING id, artifact_id, account_id, session_id, COALESCE(run_id, ''),
			kind, file_name, mime_type, size, sha256, object_key,
			COALESCE(source_device_id, ''), status, client_mutation_id,
			expires_at, completed_at, created_at
	`, upload.ID, upload.AccountID, upload.SessionID, upload.RunID, upload.ArtifactID,
		upload.Kind, upload.FileName, upload.MimeType, upload.Size, upload.SHA256,
		upload.ObjectKey, upload.SourceDeviceID, upload.ClientMutationID, upload.ExpiresAt)
	result, err := scanArtifactUpload(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if err := finishMutation(ctx, tx, upload.AccountID, upload.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *artifactRepo) GetArtifactUpload(ctx context.Context, accountID, uploadID string) (*biz.ArtifactUpload, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := scanArtifactUpload(repo.data.db.QueryRow(ctx, artifactUploadSelect+` WHERE account_id = $1 AND id = $2`, accountID, uploadID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *artifactRepo) CompleteArtifactUpload(ctx context.Context, accountID, uploadID, sourceDeviceID string) (*biz.Artifact, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	upload, err := getArtifactUploadTxForUpdate(ctx, tx, accountID, uploadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	if upload.Status == "completed" {
		artifact, err := getArtifactTx(ctx, tx, accountID, upload.ArtifactID)
		if err != nil {
			return nil, err
		}
		return artifact, tx.Commit(ctx)
	}
	if upload.Status != "pending" || upload.ExpiresAt.Before(time.Now().UTC()) {
		return nil, biz.ErrCrossDeviceConflict
	}
	if err := ensureOwnedDevice(ctx, tx, accountID, sourceDeviceID, true); err != nil {
		return nil, err
	}
	retention := time.Now().UTC().Add(30 * 24 * time.Hour)
	row := tx.QueryRow(ctx, `
		INSERT INTO artifacts (
			id, account_id, session_id, run_id, kind, file_name, mime_type,
			size, sha256, object_key, source_device_id, retention_until
		) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10,
			NULLIF($11, ''), $12)
		RETURNING id, account_id, COALESCE(session_id, ''), COALESCE(run_id, ''),
			kind, file_name, mime_type, size, sha256, object_key,
			COALESCE(source_device_id, ''), retention_until, created_at
	`, upload.ArtifactID, accountID, upload.SessionID, upload.RunID, upload.Kind,
		upload.FileName, upload.MimeType, upload.Size, upload.SHA256, upload.ObjectKey,
		firstValue(sourceDeviceID, upload.SourceDeviceID), retention)
	artifact, err := scanArtifact(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE artifact_uploads SET status = 'completed', completed_at = now()
		WHERE account_id = $1 AND id = $2
	`, accountID, uploadID); err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "artifact", artifact.ID, "artifact.created", 1, artifactSyncPayload(artifact)); err != nil {
		return nil, err
	}
	return artifact, tx.Commit(ctx)
}

func (repo *artifactRepo) ListArtifacts(ctx context.Context, accountID string, options biz.ArtifactListOptions) ([]*biz.Artifact, bool, error) {
	if repo.data.db == nil {
		return nil, false, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, artifactSelect+`
		WHERE account_id = $1
			AND ($2 = '' OR session_id = $2)
			AND ($3 = '' OR run_id = $3)
		ORDER BY created_at DESC, id DESC
		OFFSET $4 LIMIT $5
	`, accountID, options.SessionID, options.RunID, options.Offset, options.Limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]*biz.Artifact, 0, options.Limit+1)
	for rows.Next() {
		item, err := scanArtifact(rows)
		if err != nil {
			return nil, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(items) > options.Limit
	if more {
		items = items[:options.Limit]
	}
	return items, more, nil
}

func (repo *artifactRepo) GetArtifact(ctx context.Context, accountID, artifactID string) (*biz.Artifact, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := scanArtifact(repo.data.db.QueryRow(ctx, artifactSelect+` WHERE account_id = $1 AND id = $2`, accountID, artifactID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *artifactRepo) CreateArtifactShare(ctx context.Context, accountID, artifactID string, tokenHash [sha256.Size]byte, expiresAt time.Time) (*biz.ArtifactShare, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := getArtifactTx(ctx, tx, accountID, artifactID); errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	} else if err != nil {
		return nil, err
	}
	shareID := uuid.NewString()
	row := tx.QueryRow(ctx, `
		INSERT INTO artifact_shares (id, account_id, artifact_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, account_id, artifact_id, expires_at, revoked_at, created_at
	`, shareID, accountID, artifactID, tokenHash[:], expiresAt)
	share, err := scanArtifactShare(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	return share, tx.Commit(ctx)
}

func (repo *artifactRepo) RevokeArtifactShare(ctx context.Context, accountID, artifactID, shareID string) (*biz.ArtifactShare, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	row := repo.data.db.QueryRow(ctx, `
		UPDATE artifact_shares SET revoked_at = COALESCE(revoked_at, now())
		WHERE account_id = $1 AND artifact_id = $2 AND id = $3
		RETURNING id, account_id, artifact_id, expires_at, revoked_at, created_at
	`, accountID, artifactID, shareID)
	share, err := scanArtifactShare(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return share, err
}

func (repo *artifactRepo) GetSharedArtifact(ctx context.Context, tokenHash [sha256.Size]byte) (*biz.Artifact, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	row := repo.data.db.QueryRow(ctx, artifactSelect+`
		JOIN artifact_shares share ON share.artifact_id = artifacts.id
		WHERE share.token_hash = $1 AND share.revoked_at IS NULL AND share.expires_at > now()
			AND (artifacts.retention_until IS NULL OR artifacts.retention_until > now())
	`, tokenHash[:])
	artifact, err := scanArtifact(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return artifact, err
}

func (repo *artifactRepo) begin(ctx context.Context) (pgx.Tx, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	return repo.data.db.BeginTx(ctx, pgx.TxOptions{})
}

const artifactUploadSelect = `
	SELECT id, artifact_id, account_id, session_id, COALESCE(run_id, ''),
		kind, file_name, mime_type, size, sha256, object_key,
		COALESCE(source_device_id, ''), status, client_mutation_id,
		expires_at, completed_at, created_at
	FROM artifact_uploads`

func scanArtifactUpload(row scanner) (*biz.ArtifactUpload, error) {
	upload := &biz.ArtifactUpload{}
	err := row.Scan(&upload.ID, &upload.ArtifactID, &upload.AccountID, &upload.SessionID,
		&upload.RunID, &upload.Kind, &upload.FileName, &upload.MimeType, &upload.Size,
		&upload.SHA256, &upload.ObjectKey, &upload.SourceDeviceID, &upload.Status,
		&upload.ClientMutationID, &upload.ExpiresAt, &upload.CompletedAt, &upload.CreatedAt)
	return upload, err
}

func getArtifactUploadTx(ctx context.Context, tx pgx.Tx, accountID, uploadID string) (*biz.ArtifactUpload, error) {
	return scanArtifactUpload(tx.QueryRow(ctx, artifactUploadSelect+` WHERE account_id = $1 AND id = $2`, accountID, uploadID))
}

func getArtifactUploadTxForUpdate(ctx context.Context, tx pgx.Tx, accountID, uploadID string) (*biz.ArtifactUpload, error) {
	return scanArtifactUpload(tx.QueryRow(ctx, artifactUploadSelect+` WHERE account_id = $1 AND id = $2 FOR UPDATE`, accountID, uploadID))
}

const artifactSelect = `
	SELECT artifacts.id, artifacts.account_id, COALESCE(artifacts.session_id, ''),
		COALESCE(artifacts.run_id, ''), artifacts.kind, artifacts.file_name,
		artifacts.mime_type, artifacts.size, artifacts.sha256, artifacts.object_key,
		COALESCE(artifacts.source_device_id, ''), artifacts.retention_until,
		artifacts.created_at
	FROM artifacts`

func scanArtifact(row scanner) (*biz.Artifact, error) {
	artifact := &biz.Artifact{}
	err := row.Scan(&artifact.ID, &artifact.AccountID, &artifact.SessionID, &artifact.RunID,
		&artifact.Kind, &artifact.FileName, &artifact.MimeType, &artifact.Size,
		&artifact.SHA256, &artifact.ObjectKey, &artifact.SourceDeviceID,
		&artifact.RetentionUntil, &artifact.CreatedAt)
	return artifact, err
}

func getArtifactTx(ctx context.Context, tx pgx.Tx, accountID, artifactID string) (*biz.Artifact, error) {
	return scanArtifact(tx.QueryRow(ctx, artifactSelect+` WHERE account_id = $1 AND id = $2`, accountID, artifactID))
}

func scanArtifactShare(row scanner) (*biz.ArtifactShare, error) {
	share := &biz.ArtifactShare{}
	err := row.Scan(&share.ID, &share.AccountID, &share.ArtifactID, &share.ExpiresAt, &share.RevokedAt, &share.CreatedAt)
	return share, err
}

func artifactSyncPayload(artifact *biz.Artifact) map[string]any {
	return map[string]any{
		"id": artifact.ID, "session_id": artifact.SessionID, "run_id": artifact.RunID,
		"kind": artifact.Kind, "file_name": artifact.FileName, "mime_type": artifact.MimeType,
		"size": artifact.Size, "sha256": artifact.SHA256, "source_device_id": artifact.SourceDeviceID,
		"retention_until": artifact.RetentionUntil, "created_at": artifact.CreatedAt,
	}
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
