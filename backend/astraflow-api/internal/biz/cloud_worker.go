package biz

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
)

const (
	defaultWorkerLease = 60 * time.Second
	minWorkerLease     = 15 * time.Second
	maxWorkerLease     = 5 * time.Minute
)

var ErrCloudWorkerNoWork = errors.New("cloud worker queue is empty")

type CloudWorkerAuthenticator interface {
	Authenticate(string) error
}

type CloudWorkspaceLease struct {
	Workspace      *Workspace
	AccountID      string
	Repository     map[string]any
	LeaseToken     string
	LeaseExpiresAt time.Time
}

type CloudRunLease struct {
	Run            *AgentRun
	Workspace      *Workspace
	Session        *Session
	Messages       []*Message
	Artifacts      []*Artifact
	Actions        []*AgentAction
	AccountID      string
	LeaseToken     string
	LeaseExpiresAt time.Time
}

type CloudRunLeaseState struct {
	Run            *AgentRun
	Actions        []*AgentAction
	LeaseExpiresAt time.Time
}

type CloudRunLeaseContext struct {
	AccountID string
	SessionID string
}

type CloudWorkerRepo interface {
	ClaimCloudWorkspace(context.Context, string, [sha256.Size]byte, time.Time) (*CloudWorkspaceLease, error)
	CompleteCloudWorkspace(context.Context, string, string, [sha256.Size]byte, string, string, string) (*Workspace, error)
	ClaimCloudRun(context.Context, string, [sha256.Size]byte, time.Time) (*CloudRunLease, error)
	RenewCloudRun(context.Context, string, string, [sha256.Size]byte, time.Time) (*CloudRunLeaseState, error)
	CloudRunLeaseContext(context.Context, string, string, [sha256.Size]byte) (*CloudRunLeaseContext, error)
	AppendCloudRunEvents(context.Context, string, string, [sha256.Size]byte, AppendAgentRunEventsOptions, []*AgentRunEvent) (int, *AgentRun, error)
}

type CloudWorkerUsecase struct {
	auth     CloudWorkerAuthenticator
	repo     CloudWorkerRepo
	artifact ArtifactRepo
	objects  ArtifactObjectStore
}

func NewCloudWorkerUsecase(auth CloudWorkerAuthenticator, repo CloudWorkerRepo, artifact ArtifactRepo, objects ArtifactObjectStore) *CloudWorkerUsecase {
	return &CloudWorkerUsecase{auth: auth, repo: repo, artifact: artifact, objects: objects}
}

func (uc *CloudWorkerUsecase) ClaimWorkspace(ctx context.Context, authorization, workerID string, leaseSeconds int) (*CloudWorkspaceLease, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	workerID = normalizeRequiredID(workerID)
	if workerID == "" {
		return nil, invalidArgument("worker id is required")
	}
	token, hash, expiresAt, err := newWorkerLease(leaseSeconds)
	if err != nil {
		return nil, err
	}
	lease, err := uc.repo.ClaimCloudWorkspace(ctx, workerID, hash, expiresAt)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	lease.LeaseToken = token
	lease.LeaseExpiresAt = expiresAt
	return lease, nil
}

func (uc *CloudWorkerUsecase) CompleteWorkspace(ctx context.Context, authorization, workspaceID, workerID, token, state, sandboxID, errorMessage string) (*Workspace, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	workspaceID = normalizeRequiredID(workspaceID)
	workerID = normalizeRequiredID(workerID)
	state = strings.ToLower(strings.TrimSpace(state))
	sandboxID = strings.TrimSpace(sandboxID)
	errorMessage = strings.TrimSpace(errorMessage)
	if workspaceID == "" || workerID == "" || !oneOf(state, "ready", "unavailable") ||
		(state == "ready" && sandboxID == "") || !within(sandboxID, 512) || !within(errorMessage, 2000) {
		return nil, invalidArgument("workspace completion metadata is invalid")
	}
	hash, err := workerLeaseHash(token)
	if err != nil {
		return nil, err
	}
	workspace, err := uc.repo.CompleteCloudWorkspace(ctx, workspaceID, workerID, hash, state, sandboxID, errorMessage)
	return workspace, mapCloudWorkerError(err)
}

func (uc *CloudWorkerUsecase) ClaimRun(ctx context.Context, authorization, workerID string, leaseSeconds int) (*CloudRunLease, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	workerID = normalizeRequiredID(workerID)
	if workerID == "" {
		return nil, invalidArgument("worker id is required")
	}
	token, hash, expiresAt, err := newWorkerLease(leaseSeconds)
	if err != nil {
		return nil, err
	}
	lease, err := uc.repo.ClaimCloudRun(ctx, workerID, hash, expiresAt)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	for _, artifact := range lease.Artifacts {
		presign, err := uc.objects.PresignDownload(ctx, artifact.ObjectKey, artifact.FileName, defaultDownloadTTL)
		if err != nil {
			return nil, kerrors.ServiceUnavailable("OBJECT_STORAGE_UNAVAILABLE", "run attachments could not be prepared")
		}
		artifact.DownloadURL = presign.URL
		artifact.DownloadExpiresAt = &presign.ExpiresAt
	}
	lease.LeaseToken = token
	lease.LeaseExpiresAt = expiresAt
	return lease, nil
}

func (uc *CloudWorkerUsecase) RenewRun(ctx context.Context, authorization, runID, workerID, token string, leaseSeconds int) (*CloudRunLeaseState, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	workerID = normalizeRequiredID(workerID)
	if runID == "" || workerID == "" {
		return nil, invalidArgument("run id and worker id are required")
	}
	hash, err := workerLeaseHash(token)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().UTC().Add(normalizeWorkerLease(leaseSeconds))
	state, err := uc.repo.RenewCloudRun(ctx, runID, workerID, hash, expiresAt)
	return state, mapCloudWorkerError(err)
}

func (uc *CloudWorkerUsecase) AppendRunEvents(ctx context.Context, authorization, runID, workerID, token string, options AppendAgentRunEventsOptions, events []*AgentRunEvent) (int, *AgentRun, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return 0, nil, err
	}
	runID = normalizeRequiredID(runID)
	workerID = normalizeRequiredID(workerID)
	if runID == "" || workerID == "" {
		return 0, nil, invalidArgument("run id and worker id are required")
	}
	hash, err := workerLeaseHash(token)
	if err != nil {
		return 0, nil, err
	}
	leaseContext, err := uc.repo.CloudRunLeaseContext(ctx, runID, workerID, hash)
	if err != nil {
		return 0, nil, mapCloudWorkerError(err)
	}
	options.RunID = runID
	options, err = prepareAgentRunEvents(leaseContext.AccountID, options, events)
	if err != nil {
		return 0, nil, err
	}
	accepted, run, err := uc.repo.AppendCloudRunEvents(ctx, runID, workerID, hash, options, events)
	return accepted, run, mapCloudWorkerError(err)
}

func (uc *CloudWorkerUsecase) CreateRunArtifactUpload(
	ctx context.Context,
	authorization string,
	runID string,
	workerID string,
	token string,
	upload *ArtifactUpload,
) (*ArtifactUpload, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	workerID = normalizeRequiredID(workerID)
	if runID == "" || workerID == "" || upload == nil {
		return nil, invalidArgument("run, worker, and artifact upload are required")
	}
	hash, err := workerLeaseHash(token)
	if err != nil {
		return nil, err
	}
	leaseContext, err := uc.repo.CloudRunLeaseContext(ctx, runID, workerID, hash)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	upload.ID = normalizeOptionalID(upload.ID)
	if upload.ID == "" {
		upload.ID = uuid.NewString()
	}
	upload.ArtifactID = normalizeOptionalID(upload.ArtifactID)
	if upload.ArtifactID == "" {
		upload.ArtifactID = uuid.NewString()
	}
	upload.Kind = strings.ToLower(strings.TrimSpace(upload.Kind))
	upload.FileName = strings.TrimSpace(upload.FileName)
	upload.MimeType = strings.ToLower(strings.TrimSpace(upload.MimeType))
	upload.SHA256 = strings.ToLower(strings.TrimSpace(upload.SHA256))
	upload.ClientMutationID = normalizeOptionalID(upload.ClientMutationID)
	if upload.MimeType == "" {
		upload.MimeType = "application/octet-stream"
	}
	if upload.FileName == "" || upload.Size < 0 || upload.Size > maxArtifactBytes ||
		!oneOf(upload.Kind, "artifact", "file", "image", "video", "audio") ||
		!validSHA256(upload.SHA256) || strings.ContainsAny(upload.FileName, "/\\\x00\r\n") ||
		!within(upload.FileName, 240) || !within(upload.MimeType, 160) || !within(upload.ClientMutationID, 160) {
		return nil, invalidArgument("cloud artifact upload metadata is invalid")
	}
	upload.AccountID = leaseContext.AccountID
	upload.SessionID = leaseContext.SessionID
	upload.RunID = runID
	upload.ObjectKey = "accounts/" + leaseContext.AccountID + "/artifacts/" + upload.ArtifactID + "/" + upload.FileName
	upload.Status = "pending"
	upload.ExpiresAt = time.Now().UTC().Add(defaultUploadTTL)
	result, err := uc.artifact.CreateArtifactUpload(ctx, upload)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	presign, err := uc.objects.PresignUpload(ctx, result.ObjectKey, result.MimeType, result.SHA256, result.Size, time.Until(result.ExpiresAt))
	if err != nil {
		return nil, kerrors.ServiceUnavailable("OBJECT_STORAGE_UNAVAILABLE", "cloud artifact upload storage is unavailable")
	}
	result.UploadURL = presign.URL
	result.UploadHeaders = presign.Headers
	result.ExpiresAt = presign.ExpiresAt
	return result, nil
}

func (uc *CloudWorkerUsecase) CompleteRunArtifactUpload(
	ctx context.Context,
	authorization string,
	runID string,
	workerID string,
	token string,
	uploadID string,
) (*Artifact, error) {
	if err := uc.auth.Authenticate(authorization); err != nil {
		return nil, err
	}
	runID = normalizeRequiredID(runID)
	workerID = normalizeRequiredID(workerID)
	uploadID = normalizeRequiredID(uploadID)
	if runID == "" || workerID == "" || uploadID == "" {
		return nil, invalidArgument("run, worker, lease, and upload are required")
	}
	hash, err := workerLeaseHash(token)
	if err != nil {
		return nil, err
	}
	leaseContext, err := uc.repo.CloudRunLeaseContext(ctx, runID, workerID, hash)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	upload, err := uc.artifact.GetArtifactUpload(ctx, leaseContext.AccountID, uploadID)
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	if upload.RunID != runID || upload.SessionID != leaseContext.SessionID || upload.Status != "pending" || upload.ExpiresAt.Before(time.Now().UTC()) {
		return nil, kerrors.Conflict("UPLOAD_CONFLICT", "cloud artifact upload is invalid or expired")
	}
	if err := uc.objects.VerifyUpload(ctx, upload.ObjectKey, upload.Size, upload.SHA256); err != nil {
		return nil, kerrors.Conflict("UPLOAD_VERIFICATION_FAILED", "uploaded cloud artifact does not match its declared digest")
	}
	artifact, err := uc.artifact.CompleteArtifactUpload(ctx, leaseContext.AccountID, uploadID, "")
	if err != nil {
		return nil, mapCloudWorkerError(err)
	}
	presign, err := uc.objects.PresignDownload(ctx, artifact.ObjectKey, artifact.FileName, defaultDownloadTTL)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("OBJECT_STORAGE_UNAVAILABLE", "cloud artifact download could not be prepared")
	}
	artifact.DownloadURL = presign.URL
	artifact.DownloadExpiresAt = &presign.ExpiresAt
	return artifact, nil
}

func newWorkerLease(seconds int) (string, [sha256.Size]byte, time.Time, error) {
	tokenBytes := make([]byte, 32)
	if _, err := randRead(tokenBytes); err != nil {
		return "", [sha256.Size]byte{}, time.Time{}, kerrors.InternalServer("TOKEN_GENERATION_FAILED", "worker lease could not be generated")
	}
	token := base64RawURLEncode(tokenBytes)
	return token, sha256.Sum256([]byte(token)), time.Now().UTC().Add(normalizeWorkerLease(seconds)), nil
}

func workerLeaseHash(token string) ([sha256.Size]byte, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 || len(token) > 128 {
		return [sha256.Size]byte{}, kerrors.Unauthorized("INVALID_LEASE", "a valid worker lease is required")
	}
	return sha256.Sum256([]byte(token)), nil
}

func normalizeWorkerLease(seconds int) time.Duration {
	duration := time.Duration(seconds) * time.Second
	if duration < minWorkerLease || duration > maxWorkerLease {
		return defaultWorkerLease
	}
	return duration
}

func mapCloudWorkerError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrCloudWorkerNoWork):
		return kerrors.NotFound("NO_WORK", "cloud worker queue is empty")
	case errors.Is(err, ErrCrossDeviceNotFound):
		return kerrors.NotFound("NOT_FOUND", "cloud worker resource was not found")
	case errors.Is(err, ErrCrossDeviceConflict):
		return kerrors.Conflict("LEASE_CONFLICT", "cloud worker lease is invalid or expired")
	case errors.Is(err, ErrAgentEventSequence):
		return kerrors.Conflict("EVENT_SEQUENCE_CONFLICT", "agent event sequence must continue from the persisted sequence")
	default:
		return kerrors.ServiceUnavailable("CLOUD_WORKER_UNAVAILABLE", "cloud worker state could not be saved")
	}
}
