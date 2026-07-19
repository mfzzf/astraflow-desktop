package biz

import (
	"testing"
	"time"
)

func TestNextAutomationOccurrenceDailyUsesConfiguredTimeZone(t *testing.T) {
	automation := &CloudAutomation{
		ScheduleKind:       "daily",
		ScheduleExpression: "18:30",
		TimeZone:           "Asia/Shanghai",
	}

	next, err := nextAutomationOccurrence(automation, time.Date(2026, 7, 19, 9, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("nextAutomationOccurrence() error = %v", err)
	}
	want := time.Date(2026, 7, 19, 10, 30, 0, 0, time.UTC)
	if next == nil || !next.Equal(want) {
		t.Fatalf("nextAutomationOccurrence() = %v, want %v", next, want)
	}

	next, err = nextAutomationOccurrence(automation, time.Date(2026, 7, 19, 11, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("nextAutomationOccurrence() next day error = %v", err)
	}
	want = time.Date(2026, 7, 20, 10, 30, 0, 0, time.UTC)
	if next == nil || !next.Equal(want) {
		t.Fatalf("nextAutomationOccurrence() next day = %v, want %v", next, want)
	}
}

func TestNextAutomationOccurrenceIntervalBounds(t *testing.T) {
	after := time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)
	valid := &CloudAutomation{ScheduleKind: "interval", ScheduleExpression: "300", TimeZone: "UTC"}
	next, err := nextAutomationOccurrence(valid, after)
	if err != nil {
		t.Fatalf("nextAutomationOccurrence() error = %v", err)
	}
	want := after.Add(5 * time.Minute)
	if next == nil || !next.Equal(want) {
		t.Fatalf("nextAutomationOccurrence() = %v, want %v", next, want)
	}

	for _, expression := range []string{"299", "2592001", "invalid"} {
		automation := &CloudAutomation{ScheduleKind: "interval", ScheduleExpression: expression, TimeZone: "UTC"}
		if _, err := nextAutomationOccurrence(automation, after); err == nil {
			t.Fatalf("nextAutomationOccurrence(%q) error = nil", expression)
		}
	}
}

func TestNextAutomationOccurrenceOnceMustBeFuture(t *testing.T) {
	after := time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)
	automation := &CloudAutomation{
		ScheduleKind:       "once",
		ScheduleExpression: "2026-07-19T00:05:00Z",
		TimeZone:           "UTC",
	}
	next, err := nextAutomationOccurrence(automation, after)
	if err != nil {
		t.Fatalf("nextAutomationOccurrence() error = %v", err)
	}
	if next == nil || !next.Equal(after.Add(5*time.Minute)) {
		t.Fatalf("nextAutomationOccurrence() = %v", next)
	}

	next, err = nextAutomationOccurrence(automation, after.Add(10*time.Minute))
	if err != nil {
		t.Fatalf("nextAutomationOccurrence() expired error = %v", err)
	}
	if next != nil {
		t.Fatalf("nextAutomationOccurrence() expired = %v, want nil", next)
	}
}
