package service

import (
	"context"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type AnalyticsService struct {
	v1.UnimplementedAnalyticsServiceServer
	uc *biz.AnalyticsUsecase
}

func NewAnalyticsService(uc *biz.AnalyticsUsecase) *AnalyticsService {
	return &AnalyticsService{uc: uc}
}

func (s *AnalyticsService) CollectEvents(ctx context.Context, req *v1.CollectAnalyticsEventsRequest) (*v1.CollectAnalyticsEventsResponse, error) {
	events := make([]*biz.AnalyticsEvent, 0, len(req.GetEvents()))
	for _, event := range req.GetEvents() {
		occurredAt := time.Time{}
		if event.GetOccurredAt() != nil {
			occurredAt = event.GetOccurredAt().AsTime()
		}
		events = append(events, &biz.AnalyticsEvent{
			EventID: event.GetEventId(), SessionID: event.GetSessionId(), AnonymousID: event.GetAnonymousId(),
			UserIDHash: event.GetUserIdHash(), EventName: event.GetEventName(), EventType: event.GetEventType(),
			Path: event.GetPath(), TargetType: event.GetTargetType(), TargetID: event.GetTargetId(),
			TargetLabel: event.GetTargetLabel(), ChannelSlug: event.GetChannelSlug(), ClientVersion: event.GetClientVersion(),
			Platform: event.GetPlatform(), Locale: event.GetLocale(), ScreenWidth: int(event.GetScreenWidth()),
			ScreenHeight: int(event.GetScreenHeight()), OccurredAt: occurredAt,
		})
	}
	accepted, err := s.uc.CollectEvents(ctx, authorizationFromContext(ctx), events)
	if err != nil {
		return nil, err
	}
	return &v1.CollectAnalyticsEventsResponse{AcceptedCount: int32(accepted)}, nil
}

func (s *AnalyticsService) GetOverview(ctx context.Context, req *v1.GetAnalyticsOverviewRequest) (*v1.AnalyticsOverview, error) {
	overview, err := s.uc.GetOverview(ctx, authorizationFromContext(ctx), int(req.GetDays()), req.GetChannelSlug())
	if err != nil {
		return nil, err
	}
	result := &v1.AnalyticsOverview{
		PeriodDays: int32(overview.PeriodDays), StartAt: timestamppb.New(overview.StartAt), EndAt: timestamppb.New(overview.EndAt),
		TotalEvents: overview.TotalEvents, UniqueUsers: overview.UniqueUsers, UniqueSessions: overview.UniqueSessions,
		TodayEvents: overview.TodayEvents,
	}
	for _, item := range overview.Trend {
		result.Trend = append(result.Trend, &v1.AnalyticsTrendPoint{
			Date: timestamppb.New(item.Date), EventCount: item.EventCount, UniqueUsers: item.UniqueUsers,
		})
	}
	result.TopEvents = toAnalyticsRankedItems(overview.TopEvents)
	result.TopPages = toAnalyticsRankedItems(overview.TopPages)
	result.Channels = toAnalyticsRankedItems(overview.Channels)
	for _, item := range overview.RecentEvents {
		result.RecentEvents = append(result.RecentEvents, &v1.AnalyticsRecentEvent{
			EventName: item.EventName, TargetLabel: item.TargetLabel, Path: item.Path,
			ChannelSlug: item.ChannelSlug, Platform: item.Platform, OccurredAt: timestamppb.New(item.OccurredAt),
		})
	}
	return result, nil
}

func toAnalyticsRankedItems(items []*biz.AnalyticsRankedItem) []*v1.AnalyticsRankedItem {
	result := make([]*v1.AnalyticsRankedItem, 0, len(items))
	for _, item := range items {
		result = append(result, &v1.AnalyticsRankedItem{
			Key: item.Key, Label: item.Label, EventCount: item.EventCount, UniqueUsers: item.UniqueUsers,
		})
	}
	return result
}
