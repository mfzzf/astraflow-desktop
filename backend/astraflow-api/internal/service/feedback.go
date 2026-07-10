package service

import (
	"context"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"github.com/go-kratos/kratos/v3/transport"
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
	authorization := ""
	if tr, ok := transport.FromServerContext(ctx); ok {
		authorization = tr.RequestHeader().Get("Authorization")
	}

	images := make([]*biz.FeedbackImage, 0, len(req.GetImages()))
	for _, image := range req.GetImages() {
		images = append(images, &biz.FeedbackImage{
			Name:     image.GetName(),
			MimeType: image.GetMimeType(),
			Content:  image.GetContent(),
		})
	}

	feedback, err := s.uc.CreateFeedback(ctx, authorization, &biz.Feedback{
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
	})
	if err != nil {
		return nil, err
	}

	return &v1.CreateFeedbackResponse{
		FeedbackId: feedback.ID,
		CreatedAt:  timestamppb.New(feedback.CreatedAt),
	}, nil
}
