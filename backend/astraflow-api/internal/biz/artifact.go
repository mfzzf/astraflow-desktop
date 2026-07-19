package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
)

const (
	maxArtifactBytes         = int64(2 * 1024 * 1024 * 1024)
	defaultArtifactPageSize  = 30
	maxArtifactPageSize      = 100
	defaultUploadTTL         = 15 * time.Minute
	defaultDownloadTTL       = 10 * time.Minute
	defaultArtifactRetention = 30 * 24 * time.Hour
)

type ArtifactUpload struct {
	ID               string
	ArtifactID       string
	AccountID        string
	SessionID        string
	RunID            string
	Kind             string
	FileName         string
	MimeType         string
	Size             int64
	SHA256           string
	ObjectKey        string
	SourceDeviceID   string
	Status           string
	ClientMutationID string
	ExpiresAt        time.Time
	CompletedAt      *time.Time
	CreatedAt        time.Time
	UploadURL        string
	UploadHeaders    map[string]string
}

type Artifact struct {
	ID                string
	AccountID         string
	SessionID         string
	RunID             string
	Kind              string
	FileName          string
	MimeType          string
	Size              int64
	SHA256            string
	ObjectKey         string
	SourceDeviceID    string
	RetentionUntil    *time.Time
	CreatedAt         time.Time
	DownloadURL       string
	DownloadExpiresAt *time.Time
}

type ArtifactShare struct {
	ID         string
	AccountID  string
	ArtifactID string
	Token      string
	ShareURL   string
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	CreatedAt  time.Time
}

type ArtifactListOptions struct {
	SessionID string
	RunID     string
	Offset    int
	Limit     int
}

type ObjectPresign struct {
	URL       string
	Headers   map[string]string
	ExpiresAt time.Time
}

type ArtifactObjectStore interface {
	PresignUpload(context.Context, string, string, string, int64, time.Duration) (*ObjectPresign, error)
	VerifyUpload(context.Context, string, int64, string) error
	PresignDownload(context.Context, string, string, time.Duration) (*ObjectPresign, error)
	PublicShareURL(string) string
}

type ArtifactRepo interface {
	CreateArtifactUpload(context.Context, *ArtifactUpload) (*ArtifactUpload, error)
	GetArtifactUpload(context.Context, string, string) (*ArtifactUpload, error)
	CompleteArtifactUpload(context.Context, string, string, string) (*Artifact, error)
	ListArtifacts(context.Context, string, ArtifactListOptions) ([]*Artifact, bool, error)
	GetArtifact(context.Context, string, string) (*Artifact, error)
	CreateArtifactShare(context.Context, string, string, [sha256.Size]byte, time.Time) (*ArtifactShare, error)
	RevokeArtifactShare(context.Context, string, string, string) (*ArtifactShare, error)
	GetSharedArtifact(context.Context, [sha256.Size]byte) (*Artifact, error)
}

type ArtifactUsecase struct {
	crossDevice *CrossDeviceUsecase
	repo        ArtifactRepo
	objects     ArtifactObjectStore
}

func NewArtifactUsecase(crossDevice *CrossDeviceUsecase, repo ArtifactRepo, objects ArtifactObjectStore) *ArtifactUsecase {
	return &ArtifactUsecase{crossDevice: crossDevice, repo: repo, objects: objects}
}

func (uc *ArtifactUsecase) CreateUpload(ctx context.Context, authorization string, upload *ArtifactUpload) (*ArtifactUpload, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if upload == nil {
		return nil, invalidArgument("artifact upload is required")
	}
	upload.AccountID = account.ID
	upload.ID = normalizeOptionalID(upload.ID)
	if upload.ID == "" {
		upload.ID = uuid.NewString()
	}
	upload.ArtifactID = normalizeOptionalID(upload.ArtifactID)
	if upload.ArtifactID == "" {
		upload.ArtifactID = uuid.NewString()
	}
	upload.SessionID = normalizeRequiredID(upload.SessionID)
	upload.RunID = normalizeOptionalID(upload.RunID)
	upload.SourceDeviceID = normalizeOptionalID(upload.SourceDeviceID)
	upload.ClientMutationID = normalizeOptionalID(upload.ClientMutationID)
	upload.Kind = strings.ToLower(strings.TrimSpace(upload.Kind))
	upload.FileName = strings.TrimSpace(upload.FileName)
	upload.MimeType = strings.ToLower(strings.TrimSpace(upload.MimeType))
	upload.SHA256 = strings.ToLower(strings.TrimSpace(upload.SHA256))
	if upload.MimeType == "" {
		upload.MimeType = "application/octet-stream"
	}
	if upload.SessionID == "" || upload.FileName == "" || upload.Size < 0 || upload.Size > maxArtifactBytes ||
		!oneOf(upload.Kind, "attachment", "artifact", "file", "image", "video", "audio") ||
		!validSHA256(upload.SHA256) || strings.ContainsAny(upload.FileName, "/\\\x00\r\n") {
		return nil, invalidArgument("artifact upload metadata is invalid")
	}
	if !within(upload.FileName, 240) || !within(upload.MimeType, 160) || !within(upload.ClientMutationID, 160) {
		return nil, invalidArgument("artifact upload metadata is too long")
	}
	upload.ObjectKey = "accounts/" + account.ID + "/artifacts/" + upload.ArtifactID + "/" + upload.FileName
	upload.Status = "pending"
	upload.ExpiresAt = time.Now().UTC().Add(defaultUploadTTL)
	result, err := uc.repo.CreateArtifactUpload(ctx, upload)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	presign, err := uc.objects.PresignUpload(ctx, result.ObjectKey, result.MimeType, result.SHA256, result.Size, time.Until(result.ExpiresAt))
	if err != nil {
		return nil, kerrors.ServiceUnavailable("OBJECT_STORAGE_UNAVAILABLE", "artifact upload storage is unavailable")
	}
	result.UploadURL = presign.URL
	result.UploadHeaders = presign.Headers
	result.ExpiresAt = presign.ExpiresAt
	return result, nil
}

func (uc *ArtifactUsecase) CompleteUpload(ctx context.Context, authorization, uploadID, sourceDeviceID, mutationID string) (*Artifact, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	uploadID = normalizeRequiredID(uploadID)
	if uploadID == "" {
		return nil, invalidArgument("upload id is required")
	}
	upload, err := uc.repo.GetArtifactUpload(ctx, account.ID, uploadID)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	if upload.Status == "pending" {
		if upload.ExpiresAt.Before(time.Now().UTC()) {
			return nil, kerrors.Conflict("UPLOAD_EXPIRED", "artifact upload has expired")
		}
		if err := uc.objects.VerifyUpload(ctx, upload.ObjectKey, upload.Size, upload.SHA256); err != nil {
			return nil, kerrors.Conflict("UPLOAD_VERIFICATION_FAILED", "uploaded object size or SHA-256 does not match")
		}
	}
	artifact, err := uc.repo.CompleteArtifactUpload(ctx, account.ID, uploadID, normalizeOptionalID(sourceDeviceID))
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return uc.withDownload(ctx, artifact)
}

func (uc *ArtifactUsecase) ListArtifacts(ctx context.Context, authorization string, options ArtifactListOptions) ([]*Artifact, bool, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, err
	}
	options.SessionID = normalizeOptionalID(options.SessionID)
	options.RunID = normalizeOptionalID(options.RunID)
	if options.Offset < 0 || (options.SessionID == "" && options.RunID == "") {
		return nil, false, invalidArgument("artifact session or run filter is required")
	}
	if options.Limit <= 0 || options.Limit > maxArtifactPageSize {
		options.Limit = defaultArtifactPageSize
	}
	items, more, err := uc.repo.ListArtifacts(ctx, account.ID, options)
	if err != nil {
		return nil, false, mapCrossDeviceError(err)
	}
	for _, item := range items {
		if _, err := uc.withDownload(ctx, item); err != nil {
			return nil, false, err
		}
	}
	return items, more, nil
}

func (uc *ArtifactUsecase) GetArtifact(ctx context.Context, authorization, artifactID string) (*Artifact, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	artifact, err := uc.repo.GetArtifact(ctx, account.ID, normalizeRequiredID(artifactID))
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return uc.withDownload(ctx, artifact)
}

func (uc *ArtifactUsecase) CreateShare(ctx context.Context, authorization, artifactID string, expiresIn int) (*ArtifactShare, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	artifactID = normalizeRequiredID(artifactID)
	if artifactID == "" {
		return nil, invalidArgument("artifact id is required")
	}
	if expiresIn <= 0 {
		expiresIn = 24 * 60 * 60
	}
	if expiresIn < 60 || expiresIn > 30*24*60*60 {
		return nil, invalidArgument("artifact share duration is invalid")
	}
	tokenBytes := make([]byte, 32)
	if _, err := randRead(tokenBytes); err != nil {
		return nil, kerrors.InternalServer("TOKEN_GENERATION_FAILED", "artifact share token could not be generated")
	}
	token := base64RawURLEncode(tokenBytes)
	hash := sha256.Sum256([]byte(token))
	share, err := uc.repo.CreateArtifactShare(ctx, account.ID, artifactID, hash, time.Now().UTC().Add(time.Duration(expiresIn)*time.Second))
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	share.Token = token
	share.ShareURL = uc.objects.PublicShareURL(token)
	return share, nil
}

func (uc *ArtifactUsecase) RevokeShare(ctx context.Context, authorization, artifactID, shareID string) (*ArtifactShare, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	share, err := uc.repo.RevokeArtifactShare(ctx, account.ID, normalizeRequiredID(artifactID), normalizeRequiredID(shareID))
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return share, nil
}

func (uc *ArtifactUsecase) GetSharedArtifact(ctx context.Context, token string) (*Artifact, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 || len(token) > 128 {
		return nil, kerrors.NotFound("NOT_FOUND", "artifact share was not found")
	}
	hash := sha256.Sum256([]byte(token))
	artifact, err := uc.repo.GetSharedArtifact(ctx, hash)
	if err != nil {
		return nil, mapCrossDeviceError(err)
	}
	return uc.withDownload(ctx, artifact)
}

func (uc *ArtifactUsecase) withDownload(ctx context.Context, artifact *Artifact) (*Artifact, error) {
	if artifact == nil {
		return nil, kerrors.NotFound("NOT_FOUND", "artifact was not found")
	}
	presign, err := uc.objects.PresignDownload(ctx, artifact.ObjectKey, artifact.FileName, defaultDownloadTTL)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("OBJECT_STORAGE_UNAVAILABLE", "artifact download storage is unavailable")
	}
	artifact.DownloadURL = presign.URL
	artifact.DownloadExpiresAt = &presign.ExpiresAt
	return artifact, nil
}

func ParseArtifactPageToken(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(value)
	if err != nil || offset < 0 {
		return 0, invalidArgument("artifact page token is invalid")
	}
	return offset, nil
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

// Small wrappers keep the security-sensitive token construction consistent
// with the device-token implementation without exposing shared helpers.
var randRead = func(buffer []byte) (int, error) { return rand.Read(buffer) }

func base64RawURLEncode(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }
