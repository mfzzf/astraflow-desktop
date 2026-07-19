package service

import (
	"context"
	"strconv"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type FeedbackService struct {
	v1.UnimplementedFeedbackServiceServer

	uc *biz.FeedbackUsecase
}

func NewFeedbackService(uc *biz.FeedbackUsecase) *FeedbackService {
	return &FeedbackService{uc: uc}
}

func (s *FeedbackService) CreateFeedback(ctx context.Context, req *v1.CreateFeedbackRequest) (*v1.CreateFeedbackResponse, error) {
	images := make([]*biz.FeedbackImage, 0, len(req.GetImages()))
	for _, image := range req.GetImages() {
		images = append(images, &biz.FeedbackImage{
			Name:     image.GetName(),
			MimeType: image.GetMimeType(),
			Content:  image.GetContent(),
		})
	}

	feedback, err := s.uc.CreateFeedback(ctx, authorizationFromContext(ctx), &biz.Feedback{
		SessionID:       req.GetSessionId(),
		TargetMessageID: req.GetTargetMessageId(),
		EntryPoint:      req.GetEntryPoint(),
		Description:     req.GetDescription(),
		MessagesJSON:    req.GetMessagesJson(),
		Images:          images,
		ReporterEmail:   req.GetReporterEmail(),
		ClientVersion:   req.GetClientVersion(),
		Platform:        req.GetPlatform(),
		Locale:          req.GetLocale(),
		ChannelSlug:     req.GetChannelSlug(),
	})
	if err != nil {
		return nil, err
	}

	return &v1.CreateFeedbackResponse{
		FeedbackId: feedback.ID,
		CreatedAt:  timestamppb.New(feedback.CreatedAt),
	}, nil
}

func (s *FeedbackService) ListFeedbacks(ctx context.Context, req *v1.ListFeedbacksRequest) (*v1.ListFeedbacksResponse, error) {
	pageSize := int(req.GetPageSize())
	offset := parsePageToken(req.GetPageToken())
	feedbacks, total, open, err := s.uc.ListFeedbacks(ctx, authorizationFromContext(ctx), biz.FeedbackListOptions{
		Query: req.GetQuery(), Status: req.GetStatus(), ChannelSlug: req.GetChannelSlug(),
		Offset: offset, Limit: pageSize,
	})
	if err != nil {
		return nil, err
	}
	items := make([]*v1.FeedbackSummary, 0, len(feedbacks))
	for _, feedback := range feedbacks {
		items = append(items, toFeedbackSummary(feedback))
	}
	actualPageSize := pageSize
	if actualPageSize <= 0 || actualPageSize > 100 {
		actualPageSize = 25
	}
	nextToken := ""
	if offset+len(items) < total {
		nextToken = strconv.Itoa(offset + actualPageSize)
	}
	return &v1.ListFeedbacksResponse{
		Feedbacks: items, NextPageToken: nextToken, TotalSize: int32(total), OpenSize: int32(open),
	}, nil
}

func (s *FeedbackService) GetFeedback(ctx context.Context, req *v1.GetFeedbackRequest) (*v1.FeedbackDetail, error) {
	feedback, err := s.uc.GetFeedback(ctx, authorizationFromContext(ctx), req.GetFeedbackId())
	if err != nil {
		return nil, err
	}
	return toFeedbackDetail(feedback), nil
}

func (s *FeedbackService) UpdateFeedback(ctx context.Context, req *v1.UpdateFeedbackRequest) (*v1.FeedbackDetail, error) {
	feedback, err := s.uc.UpdateFeedback(ctx, authorizationFromContext(ctx), &biz.Feedback{
		ID: req.GetFeedbackId(), Status: req.GetStatus(), Assignee: req.GetAssignee(), AdminNote: req.GetAdminNote(),
	})
	if err != nil {
		return nil, err
	}
	return toFeedbackDetail(feedback), nil
}

func (s *FeedbackService) GetFeedbackImage(ctx context.Context, req *v1.GetFeedbackImageRequest) (*v1.FeedbackImageContent, error) {
	image, err := s.uc.GetFeedbackImage(ctx, authorizationFromContext(ctx), req.GetFeedbackId(), req.GetImageId())
	if err != nil {
		return nil, err
	}
	return &v1.FeedbackImageContent{Name: image.Name, MimeType: image.MimeType, Content: image.Content}, nil
}

func toFeedbackSummary(feedback *biz.Feedback) *v1.FeedbackSummary {
	return &v1.FeedbackSummary{
		Id: feedback.ID, SessionId: feedback.SessionID, TargetMessageId: feedback.TargetMessageID,
		EntryPoint: feedback.EntryPoint, Description: feedback.Description,
		ReporterEmail: feedback.ReporterEmail, ClientVersion: feedback.ClientVersion,
		Platform: feedback.Platform, Locale: feedback.Locale, ChannelSlug: feedback.ChannelSlug,
		Status: feedback.Status, Assignee: feedback.Assignee, ImageCount: int32(feedback.ImageCount),
		CreatedAt: timestamppb.New(feedback.CreatedAt), UpdatedAt: timestamppb.New(feedback.UpdatedAt),
	}
}

func toFeedbackDetail(feedback *biz.Feedback) *v1.FeedbackDetail {
	images := make([]*v1.FeedbackImageMetadata, 0, len(feedback.Images))
	for _, image := range feedback.Images {
		images = append(images, &v1.FeedbackImageMetadata{
			Id: image.ID, Name: image.Name, MimeType: image.MimeType, ByteSize: image.ByteSize,
		})
	}
	return &v1.FeedbackDetail{
		Summary: toFeedbackSummary(feedback), MessagesJson: feedback.MessagesJSON,
		AdminNote: feedback.AdminNote, Images: images,
	}
}
