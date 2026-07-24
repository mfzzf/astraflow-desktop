package biz

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	MaxAnalyticsBatchSize = 100
	MaxAnalyticsDays      = 90
)

type AnalyticsEvent struct {
	EventID       string
	SessionID     string
	AnonymousID   string
	UserIDHash    string
	EventName     string
	EventType     string
	Path          string
	TargetType    string
	TargetID      string
	TargetLabel   string
	ChannelSlug   string
	ClientVersion string
	Platform      string
	Locale        string
	ScreenWidth   int
	ScreenHeight  int
	OccurredAt    time.Time
}

type AnalyticsTrendPoint struct {
	Date        time.Time
	EventCount  int64
	UniqueUsers int64
}

type AnalyticsRankedItem struct {
	Key         string
	Label       string
	EventCount  int64
	UniqueUsers int64
}

type AnalyticsRecentEvent struct {
	EventName   string
	TargetLabel string
	Path        string
	ChannelSlug string
	Platform    string
	OccurredAt  time.Time
}

type AnalyticsOverview struct {
	PeriodDays          int
	StartAt             time.Time
	EndAt               time.Time
	TotalEvents         int64
	UniqueUsers         int64
	UniqueSessions      int64
	TodayEvents         int64
	DailyActiveUsers    int64
	MonthlyActiveUsers  int64
	TotalUsers          int64
	TotalTerminals      int64
	TotalStudioSessions int64
	Trend               []*AnalyticsTrendPoint
	TopEvents           []*AnalyticsRankedItem
	TopPages            []*AnalyticsRankedItem
	Channels            []*AnalyticsRankedItem
	RecentEvents        []*AnalyticsRecentEvent
	AgentUsage          []*AnalyticsRankedItem
	ClientVersions      []*AnalyticsRankedItem
	Platforms           []*AnalyticsRankedItem
}

type AnalyticsOverviewOptions struct {
	StartAt     time.Time
	EndAt       time.Time
	ChannelSlug string
}

type AnalyticsRepo interface {
	CollectEvents(context.Context, []*AnalyticsEvent) (int, error)
	GetOverview(context.Context, AnalyticsOverviewOptions) (*AnalyticsOverview, error)
}

type AnalyticsUsecase struct {
	repo          AnalyticsRepo
	adminVerifier AdminVerifier
}

func NewAnalyticsUsecase(repo AnalyticsRepo, adminVerifier AdminVerifier) *AnalyticsUsecase {
	return &AnalyticsUsecase{repo: repo, adminVerifier: adminVerifier}
}

func (uc *AnalyticsUsecase) CollectEvents(ctx context.Context, events []*AnalyticsEvent) (int, error) {
	// Collection is intentionally anonymous-capable. Authentication is not a
	// reliable prerequisite for measuring installed terminals and app usage.
	if len(events) == 0 || len(events) > MaxAnalyticsBatchSize {
		return 0, kerrors.BadRequest("INVALID_ARGUMENT", "events must contain between 1 and 100 items")
	}

	now := time.Now().UTC()
	for _, event := range events {
		if event == nil {
			return 0, kerrors.BadRequest("INVALID_ARGUMENT", "analytics event is required")
		}
		normalizeAnalyticsEvent(event)
		if err := validateAnalyticsEvent(event, now); err != nil {
			return 0, err
		}
	}

	accepted, err := uc.repo.CollectEvents(ctx, events)
	if err != nil {
		return 0, kerrors.ServiceUnavailable("ANALYTICS_UNAVAILABLE", "analytics events could not be saved")
	}
	return accepted, nil
}

func (uc *AnalyticsUsecase) GetOverview(ctx context.Context, authorization string, days int, channelSlug string) (*AnalyticsOverview, error) {
	if err := uc.adminVerifier.VerifyAdmin(ctx, authorization); err != nil {
		return nil, err
	}
	if days <= 0 {
		days = 30
	}
	if days > MaxAnalyticsDays {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "days must not exceed 90")
	}
	channelSlug = strings.ToLower(strings.TrimSpace(channelSlug))
	if utf8.RuneCountInString(channelSlug) > 64 {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "channel slug is too long")
	}

	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(days - 1))
	overview, err := uc.repo.GetOverview(ctx, AnalyticsOverviewOptions{
		StartAt: start, EndAt: now, ChannelSlug: channelSlug,
	})
	if err != nil {
		return nil, kerrors.ServiceUnavailable("ANALYTICS_UNAVAILABLE", "analytics overview could not be loaded")
	}
	overview.PeriodDays = days
	overview.StartAt = start
	overview.EndAt = now
	return overview, nil
}

func normalizeAnalyticsEvent(event *AnalyticsEvent) {
	event.EventID = strings.TrimSpace(event.EventID)
	event.SessionID = strings.TrimSpace(event.SessionID)
	event.AnonymousID = strings.TrimSpace(event.AnonymousID)
	event.UserIDHash = strings.TrimSpace(event.UserIDHash)
	event.EventName = strings.TrimSpace(event.EventName)
	event.EventType = strings.ToLower(strings.TrimSpace(event.EventType))
	event.Path = strings.TrimSpace(event.Path)
	event.TargetType = strings.ToLower(strings.TrimSpace(event.TargetType))
	event.TargetID = strings.TrimSpace(event.TargetID)
	event.TargetLabel = strings.TrimSpace(event.TargetLabel)
	event.ChannelSlug = strings.ToLower(strings.TrimSpace(event.ChannelSlug))
	event.ClientVersion = strings.TrimSpace(event.ClientVersion)
	event.Platform = strings.ToLower(strings.TrimSpace(event.Platform))
	event.Locale = strings.TrimSpace(event.Locale)
	if event.ChannelSlug == "" {
		event.ChannelSlug = "default"
	}
}

func validateAnalyticsEvent(event *AnalyticsEvent, now time.Time) error {
	if event.EventID == "" || event.SessionID == "" || event.AnonymousID == "" || event.EventName == "" {
		return kerrors.BadRequest("INVALID_ARGUMENT", "event, session, anonymous, and event name identifiers are required")
	}
	switch event.EventType {
	case "active", "agent", "click", "session":
	default:
		return kerrors.BadRequest("INVALID_ARGUMENT", "analytics event type is not supported")
	}
	if event.Path == "" || !strings.HasPrefix(event.Path, "/") {
		return kerrors.BadRequest("INVALID_ARGUMENT", "analytics path must be an absolute application path")
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = now
	}
	if event.OccurredAt.After(now.Add(10*time.Minute)) || event.OccurredAt.Before(now.AddDate(0, 0, -90)) {
		return kerrors.BadRequest("INVALID_ARGUMENT", "analytics event timestamp is outside the accepted range")
	}
	if event.ScreenWidth < 0 || event.ScreenHeight < 0 || event.ScreenWidth > 100000 || event.ScreenHeight > 100000 {
		return kerrors.BadRequest("INVALID_ARGUMENT", "analytics screen dimensions are invalid")
	}

	limits := []struct {
		value string
		max   int
	}{
		{event.EventID, 120}, {event.SessionID, 120}, {event.AnonymousID, 120},
		{event.UserIDHash, 128}, {event.EventName, 160}, {event.Path, 512},
		{event.TargetType, 64}, {event.TargetID, 160}, {event.TargetLabel, 240},
		{event.ChannelSlug, 64}, {event.ClientVersion, 64}, {event.Platform, 64}, {event.Locale, 32},
	}
	for _, limit := range limits {
		if utf8.RuneCountInString(limit.value) > limit.max {
			return kerrors.BadRequest("INVALID_ARGUMENT", "analytics event metadata is too long")
		}
	}
	return nil
}
