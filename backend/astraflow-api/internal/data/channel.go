package data

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type channelRepo struct {
	data   *Data
	aead   cipher.AEAD
	keyErr error
}

func NewChannelRepo(data *Data) biz.ChannelRepo {
	repo := &channelRepo{data: data}
	repo.aead, repo.keyErr = loadChannelSecretCipher()
	return repo
}

func (r *channelRepo) ListChannels(ctx context.Context, options biz.ChannelListOptions) ([]*biz.Channel, int, error) {
	if r.data.db == nil {
		return nil, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	query := `%` + options.Query + `%`
	rows, err := r.data.db.Query(ctx, `
		SELECT id, slug, name, status, oauth_client_id,
			oauth_client_secret_ciphertext IS NOT NULL, enabled_features,
			restrict_models, allowed_model_ids, revision, created_at, updated_at,
			count(*) OVER()
		FROM distribution_channels
		WHERE ($1 = '' OR slug ILIKE $2 OR name ILIKE $2)
		  AND ($3 = '' OR status = $3)
		ORDER BY updated_at DESC, slug ASC
		OFFSET $4 LIMIT $5
	`, options.Query, query, options.Status, options.Offset, options.Limit)
	if err != nil {
		return nil, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "channels could not be loaded")
	}
	defer rows.Close()
	channels := make([]*biz.Channel, 0)
	total := 0
	for rows.Next() {
		channel := &biz.Channel{}
		if err := rows.Scan(
			&channel.ID, &channel.Slug, &channel.Name, &channel.Status,
			&channel.OAuthClientID, &channel.OAuthClientSecretConfigured,
			&channel.EnabledFeatures, &channel.RestrictModels, &channel.AllowedModelIDs,
			&channel.Revision, &channel.CreatedAt, &channel.UpdatedAt, &total,
		); err != nil {
			return nil, 0, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "channels could not be loaded")
		}
		channels = append(channels, channel)
	}
	return channels, total, rows.Err()
}

func (r *channelRepo) GetChannel(ctx context.Context, id string) (*biz.Channel, error) {
	return r.getChannel(ctx, "id", id)
}

func (r *channelRepo) GetChannelBySlug(ctx context.Context, slug string) (*biz.Channel, error) {
	return r.getChannel(ctx, "slug", slug)
}

func (r *channelRepo) getChannel(ctx context.Context, field, value string) (*biz.Channel, error) {
	if r.data.db == nil {
		return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	if value == "" {
		return nil, kerrors.NotFound("CHANNEL_NOT_FOUND", "channel was not found")
	}
	where := "id = $1"
	if field == "slug" {
		where = "slug = $1"
	}
	channel := &biz.Channel{}
	var ciphertext, nonce []byte
	err := r.data.db.QueryRow(ctx, `
		SELECT id, slug, name, status, oauth_client_id,
			oauth_client_secret_ciphertext, oauth_client_secret_nonce,
			enabled_features, restrict_models, allowed_model_ids,
			revision, created_at, updated_at
		FROM distribution_channels WHERE `+where, value).Scan(
		&channel.ID, &channel.Slug, &channel.Name, &channel.Status,
		&channel.OAuthClientID, &ciphertext, &nonce, &channel.EnabledFeatures,
		&channel.RestrictModels, &channel.AllowedModelIDs, &channel.Revision,
		&channel.CreatedAt, &channel.UpdatedAt,
	)
	if err != nil {
		return nil, mapChannelError(err)
	}
	channel.OAuthClientSecretConfigured = len(ciphertext) > 0
	if len(ciphertext) > 0 {
		secret, err := r.decryptSecret(ciphertext, nonce)
		if err != nil {
			return nil, err
		}
		channel.OAuthClientSecret = secret
	}
	return channel, nil
}

func (r *channelRepo) CreateChannel(ctx context.Context, channel *biz.Channel) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	if channel.ID == "" {
		channel.ID = uuid.NewString()
	}
	channel.CreatedAt = time.Now().UTC()
	channel.UpdatedAt = channel.CreatedAt
	channel.Revision = 1
	ciphertext, nonce, err := r.encryptSecret(channel.OAuthClientSecret)
	if err != nil {
		return err
	}
	_, err = r.data.db.Exec(ctx, `
		INSERT INTO distribution_channels (
			id, slug, name, status, oauth_client_id,
			oauth_client_secret_ciphertext, oauth_client_secret_nonce,
			enabled_features, restrict_models, allowed_model_ids,
			revision, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`, channel.ID, channel.Slug, channel.Name, channel.Status, channel.OAuthClientID,
		ciphertext, nonce, channel.EnabledFeatures, channel.RestrictModels,
		channel.AllowedModelIDs, channel.Revision, channel.CreatedAt, channel.UpdatedAt)
	if err != nil {
		return mapChannelError(err)
	}
	channel.OAuthClientSecretConfigured = channel.OAuthClientSecret != ""
	return nil
}

func (r *channelRepo) UpdateChannel(ctx context.Context, channel *biz.Channel, clearSecret bool) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	var ciphertext, nonce []byte
	var err error
	setSecret := channel.OAuthClientSecret != ""
	if setSecret {
		ciphertext, nonce, err = r.encryptSecret(channel.OAuthClientSecret)
		if err != nil {
			return err
		}
	}
	result, err := r.data.db.Exec(ctx, `
		UPDATE distribution_channels SET
			slug=$2, name=$3, status=$4, oauth_client_id=$5,
			oauth_client_secret_ciphertext = CASE
				WHEN $6 THEN $7 WHEN $8 THEN NULL ELSE oauth_client_secret_ciphertext END,
			oauth_client_secret_nonce = CASE
				WHEN $6 THEN $9 WHEN $8 THEN NULL ELSE oauth_client_secret_nonce END,
			enabled_features=$10, restrict_models=$11, allowed_model_ids=$12,
			revision=revision+1, updated_at=now()
		WHERE id=$1
	`, channel.ID, channel.Slug, channel.Name, channel.Status, channel.OAuthClientID,
		setSecret, ciphertext, clearSecret, nonce, channel.EnabledFeatures,
		channel.RestrictModels, channel.AllowedModelIDs)
	if err != nil {
		return mapChannelError(err)
	}
	if result.RowsAffected() == 0 {
		return kerrors.NotFound("CHANNEL_NOT_FOUND", "channel was not found")
	}
	return nil
}

func (r *channelRepo) DeleteChannel(ctx context.Context, id string) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	result, err := r.data.db.Exec(ctx, `DELETE FROM distribution_channels WHERE id=$1 AND status='draft'`, id)
	if err != nil {
		return mapChannelError(err)
	}
	if result.RowsAffected() == 0 {
		return kerrors.New(412, "CHANNEL_DELETE_REJECTED", "only draft channels can be deleted")
	}
	return nil
}

func (r *channelRepo) CreateOAuthFlow(ctx context.Context, flow *biz.ChannelOAuthFlow) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	tx, err := r.data.db.Begin(ctx)
	if err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "OAuth flow could not be stored")
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM channel_oauth_flows WHERE expires_at < now() OR consumed_at IS NOT NULL`); err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "OAuth flow could not be stored")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO channel_oauth_flows (state_hash, channel_id, redirect_uri, expires_at)
		VALUES ($1,$2,$3,$4)
	`, flow.StateHash, flow.ChannelID, flow.RedirectURI, flow.ExpiresAt); err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "OAuth flow could not be stored")
	}
	if err := tx.Commit(ctx); err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "OAuth flow could not be stored")
	}
	return nil
}

func (r *channelRepo) ConsumeOAuthFlow(ctx context.Context, stateHash, channelID, redirectURI string) error {
	if r.data.db == nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	result, err := r.data.db.Exec(ctx, `
		UPDATE channel_oauth_flows SET consumed_at=now()
		WHERE state_hash=$1 AND channel_id=$2 AND redirect_uri=$3
		  AND consumed_at IS NULL AND expires_at > now()
	`, stateHash, channelID, redirectURI)
	if err != nil {
		return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "OAuth flow could not be verified")
	}
	if result.RowsAffected() == 0 {
		return kerrors.BadRequest("INVALID_OAUTH_STATE", "OAuth state is invalid, expired, or already used")
	}
	return nil
}

func loadChannelSecretCipher() (cipher.AEAD, error) {
	raw := strings.TrimSpace(os.Getenv("ASTRAFLOW_CHANNEL_SECRET_KEY"))
	if raw == "" {
		return nil, fmt.Errorf("ASTRAFLOW_CHANNEL_SECRET_KEY is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		key, err = base64.RawStdEncoding.DecodeString(raw)
	}
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("ASTRAFLOW_CHANNEL_SECRET_KEY must be a base64-encoded 32-byte key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func (r *channelRepo) encryptSecret(secret string) ([]byte, []byte, error) {
	if secret == "" {
		return nil, nil, nil
	}
	if r.keyErr != nil {
		return nil, nil, kerrors.ServiceUnavailable("CHANNEL_ENCRYPTION_UNAVAILABLE", r.keyErr.Error())
	}
	nonce := make([]byte, r.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, kerrors.InternalServer("CHANNEL_ENCRYPTION_FAILED", "OAuth secret could not be encrypted")
	}
	return r.aead.Seal(nil, nonce, []byte(secret), nil), nonce, nil
}

func (r *channelRepo) decryptSecret(ciphertext, nonce []byte) (string, error) {
	if r.keyErr != nil {
		return "", kerrors.ServiceUnavailable("CHANNEL_ENCRYPTION_UNAVAILABLE", r.keyErr.Error())
	}
	plaintext, err := r.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", kerrors.ServiceUnavailable("CHANNEL_DECRYPTION_FAILED", "OAuth secret could not be decrypted")
	}
	return string(plaintext), nil
}

func mapChannelError(err error) error {
	if err == pgx.ErrNoRows {
		return kerrors.NotFound("CHANNEL_NOT_FOUND", "channel was not found")
	}
	var pgErr *pgconn.PgError
	if ok := errors.As(err, &pgErr); ok && pgErr.Code == "23505" {
		return kerrors.Conflict("CHANNEL_ALREADY_EXISTS", "a channel with this slug already exists")
	}
	return kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "channel operation failed")
}
