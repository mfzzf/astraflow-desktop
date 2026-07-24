package biz

import (
	"context"
	"testing"
	"time"
)

type analyticsRepoStub struct {
	events  []*AnalyticsEvent
	options AnalyticsOverviewOptions
}

func (repo *analyticsRepoStub) CollectEvents(_ context.Context, events []*AnalyticsEvent) (int, error) {
	repo.events = events
	return len(events), nil
}

func (repo *analyticsRepoStub) GetOverview(_ context.Context, options AnalyticsOverviewOptions) (*AnalyticsOverview, error) {
	repo.options = options
	return &AnalyticsOverview{}, nil
}

func validAnalyticsEvent() *AnalyticsEvent {
	return &AnalyticsEvent{
		EventID: "event-1", SessionID: "session-1", AnonymousID: "anonymous-1",
		EventName: "click.button.send", EventType: "click", Path: "/studio",
		OccurredAt: time.Now().UTC(),
	}
}

func TestCollectAnalyticsEventsNormalizesAndPersists(t *testing.T) {
	repo := &analyticsRepoStub{}
	uc := NewAnalyticsUsecase(repo, adminVerifierStub{})
	event := validAnalyticsEvent()
	event.ChannelSlug = ""

	accepted, err := uc.CollectEvents(context.Background(), []*AnalyticsEvent{event})
	if err != nil {
		t.Fatalf("CollectEvents() error = %v", err)
	}
	if accepted != 1 || len(repo.events) != 1 {
		t.Fatalf("CollectEvents() accepted = %d, persisted = %d", accepted, len(repo.events))
	}
	if event.ChannelSlug != "default" {
		t.Fatalf("CollectEvents() channel = %q, want default", event.ChannelSlug)
	}
}

func TestCollectAnalyticsEventsAllowsAnonymousCollection(t *testing.T) {
	repo := &analyticsRepoStub{}
	uc := NewAnalyticsUsecase(repo, adminVerifierStub{})

	accepted, err := uc.CollectEvents(context.Background(), []*AnalyticsEvent{validAnalyticsEvent()})
	if err != nil {
		t.Fatalf("CollectEvents() error = %v", err)
	}
	if accepted != 1 {
		t.Fatalf("CollectEvents() accepted = %d, want 1", accepted)
	}
}

func TestCollectAnalyticsEventsAcceptsOperationalEventTypes(t *testing.T) {
	for _, eventType := range []string{"active", "agent", "click", "session"} {
		t.Run(eventType, func(t *testing.T) {
			repo := &analyticsRepoStub{}
			uc := NewAnalyticsUsecase(repo, adminVerifierStub{})
			event := validAnalyticsEvent()
			event.EventType = eventType

			if _, err := uc.CollectEvents(context.Background(), []*AnalyticsEvent{event}); err != nil {
				t.Fatalf("CollectEvents() error = %v", err)
			}
		})
	}
}

func TestCollectAnalyticsEventsValidation(t *testing.T) {
	tests := []struct {
		name   string
		events []*AnalyticsEvent
	}{
		{name: "empty batch", events: nil},
		{name: "unsupported event", events: func() []*AnalyticsEvent {
			event := validAnalyticsEvent()
			event.EventType = "view"
			return []*AnalyticsEvent{event}
		}()},
		{name: "query path", events: func() []*AnalyticsEvent {
			event := validAnalyticsEvent()
			event.Path = "studio"
			return []*AnalyticsEvent{event}
		}()},
		{name: "future timestamp", events: func() []*AnalyticsEvent {
			event := validAnalyticsEvent()
			event.OccurredAt = time.Now().UTC().Add(11 * time.Minute)
			return []*AnalyticsEvent{event}
		}()},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			uc := NewAnalyticsUsecase(&analyticsRepoStub{}, adminVerifierStub{})
			if _, err := uc.CollectEvents(context.Background(), test.events); err == nil {
				t.Fatal("CollectEvents() error = nil, want validation error")
			}
		})
	}
}

func TestGetAnalyticsOverviewDefaultsPeriod(t *testing.T) {
	repo := &analyticsRepoStub{}
	uc := NewAnalyticsUsecase(repo, adminVerifierStub{})

	overview, err := uc.GetOverview(context.Background(), "Bearer admin", 0, " Partner-A ")
	if err != nil {
		t.Fatalf("GetOverview() error = %v", err)
	}
	if overview.PeriodDays != 30 {
		t.Fatalf("GetOverview() period = %d, want 30", overview.PeriodDays)
	}
	if repo.options.ChannelSlug != "partner-a" {
		t.Fatalf("GetOverview() channel = %q, want partner-a", repo.options.ChannelSlug)
	}
}
