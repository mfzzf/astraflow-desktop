package service

import (
	"context"
	"strconv"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type ArtifactService struct {
	v1.UnimplementedArtifactServiceServer
	uc *biz.ArtifactUsecase
}

func NewArtifactService(uc *biz.ArtifactUsecase) *ArtifactService {
	return &ArtifactService{uc: uc}
}

func (service *ArtifactService) CreateUpload(ctx context.Context, request *v1.CreateArtifactUploadRequest) (*v1.ArtifactUpload, error) {
	upload, err := service.uc.CreateUpload(ctx, authorizationFromContext(ctx), &biz.ArtifactUpload{
		ID: request.GetUploadId(), ArtifactID: request.GetArtifactId(), SessionID: request.GetSessionId(),
		RunID: request.GetRunId(), Kind: request.GetKind(), FileName: request.GetFileName(),
		MimeType: request.GetMimeType(), Size: request.GetSize(), SHA256: request.GetSha256(),
		SourceDeviceID: request.GetSourceDeviceId(), ClientMutationID: request.GetClientMutationId(),
	})
	if err != nil {
		return nil, err
	}
	return toArtifactUploadDTO(upload), nil
}

func (service *ArtifactService) CompleteUpload(ctx context.Context, request *v1.CompleteArtifactUploadRequest) (*v1.Artifact, error) {
	artifact, err := service.uc.CompleteUpload(ctx, authorizationFromContext(ctx), request.GetUploadId(), request.GetSourceDeviceId(), request.GetClientMutationId())
	if err != nil {
		return nil, err
	}
	return toArtifactDTO(artifact), nil
}

func (service *ArtifactService) ListArtifacts(ctx context.Context, request *v1.ListArtifactsRequest) (*v1.ListArtifactsResponse, error) {
	offset, err := biz.ParseArtifactPageToken(request.GetPageToken())
	if err != nil {
		return nil, err
	}
	limit := int(request.GetPageSize())
	artifacts, more, err := service.uc.ListArtifacts(ctx, authorizationFromContext(ctx), biz.ArtifactListOptions{
		SessionID: request.GetSessionId(), RunID: request.GetRunId(), Offset: offset, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	response := &v1.ListArtifactsResponse{Artifacts: make([]*v1.Artifact, 0, len(artifacts))}
	for _, artifact := range artifacts {
		response.Artifacts = append(response.Artifacts, toArtifactDTO(artifact))
	}
	if more {
		if limit <= 0 || limit > 100 {
			limit = 30
		}
		response.NextPageToken = strconv.Itoa(offset + limit)
	}
	return response, nil
}

func (service *ArtifactService) GetArtifact(ctx context.Context, request *v1.GetArtifactRequest) (*v1.Artifact, error) {
	artifact, err := service.uc.GetArtifact(ctx, authorizationFromContext(ctx), request.GetArtifactId())
	if err != nil {
		return nil, err
	}
	return toArtifactDTO(artifact), nil
}

func (service *ArtifactService) CreateArtifactShare(ctx context.Context, request *v1.CreateArtifactShareRequest) (*v1.ArtifactShare, error) {
	share, err := service.uc.CreateShare(ctx, authorizationFromContext(ctx), request.GetArtifactId(), int(request.GetExpiresInSeconds()))
	if err != nil {
		return nil, err
	}
	return toArtifactShareDTO(share), nil
}

func (service *ArtifactService) RevokeArtifactShare(ctx context.Context, request *v1.RevokeArtifactShareRequest) (*v1.ArtifactShare, error) {
	share, err := service.uc.RevokeShare(ctx, authorizationFromContext(ctx), request.GetArtifactId(), request.GetShareId())
	if err != nil {
		return nil, err
	}
	return toArtifactShareDTO(share), nil
}

func (service *ArtifactService) GetSharedArtifact(ctx context.Context, request *v1.GetSharedArtifactRequest) (*v1.Artifact, error) {
	artifact, err := service.uc.GetSharedArtifact(ctx, request.GetShareToken())
	if err != nil {
		return nil, err
	}
	return toArtifactDTO(artifact), nil
}

func toArtifactUploadDTO(upload *biz.ArtifactUpload) *v1.ArtifactUpload {
	if upload == nil {
		return nil
	}
	return &v1.ArtifactUpload{
		Id: upload.ID, ArtifactId: upload.ArtifactID, SessionId: upload.SessionID, RunId: upload.RunID,
		FileName: upload.FileName, MimeType: upload.MimeType, Size: upload.Size, Sha256: upload.SHA256,
		Status: upload.Status, UploadUrl: upload.UploadURL, UploadHeaders: upload.UploadHeaders,
		ExpiresAt: timestamppb.New(upload.ExpiresAt),
	}
}

func toArtifactDTO(artifact *biz.Artifact) *v1.Artifact {
	if artifact == nil {
		return nil
	}
	result := &v1.Artifact{
		Id: artifact.ID, SessionId: artifact.SessionID, RunId: artifact.RunID, Kind: artifact.Kind,
		FileName: artifact.FileName, MimeType: artifact.MimeType, Size: artifact.Size, Sha256: artifact.SHA256,
		SourceDeviceId: artifact.SourceDeviceID, CreatedAt: timestamppb.New(artifact.CreatedAt),
		DownloadUrl: artifact.DownloadURL,
	}
	if artifact.RetentionUntil != nil {
		result.RetentionUntil = timestamppb.New(*artifact.RetentionUntil)
	}
	if artifact.DownloadExpiresAt != nil {
		result.DownloadExpiresAt = timestamppb.New(*artifact.DownloadExpiresAt)
	}
	return result
}

func toArtifactShareDTO(share *biz.ArtifactShare) *v1.ArtifactShare {
	if share == nil {
		return nil
	}
	result := &v1.ArtifactShare{
		Id: share.ID, ArtifactId: share.ArtifactID, ShareUrl: share.ShareURL,
		ExpiresAt: timestamppb.New(share.ExpiresAt), CreatedAt: timestamppb.New(share.CreatedAt),
	}
	if share.RevokedAt != nil {
		result.RevokedAt = timestamppb.New(*share.RevokedAt)
	}
	return result
}
