package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"astraflow-api/internal/biz"
)

type pushRepoStub struct {
	completedID string
	nackedID    string
	permanent   bool
	disabled    bool
}

func (*pushRepoStub) ClaimPushDeliveries(context.Context, int, time.Duration) ([]*biz.PushDelivery, error) {
	return nil, nil
}

func (repo *pushRepoStub) CompletePushDelivery(_ context.Context, id string) error {
	repo.completedID = id
	return nil
}

func (repo *pushRepoStub) NackPushDelivery(_ context.Context, id, _ string, _ time.Time, permanent, disabled bool) error {
	repo.nackedID = id
	repo.permanent = permanent
	repo.disabled = disabled
	return nil
}

func TestPushDispatcherSendsMetadataOnlyExpoPayload(t *testing.T) {
	repo := &pushRepoStub{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode push body: %v", err)
		}
		if body["to"] != "ExponentPushToken[test]" || body["title"] != "Task completed" {
			t.Fatalf("push payload = %#v", body)
		}
		data, ok := body["data"].(map[string]any)
		if !ok || data["run_id"] != "run-1" || data["event_type"] != "run_completed" {
			t.Fatalf("push data = %#v", body["data"])
		}
		for _, forbidden := range []string{"prompt", "content", "tool", "terminal", "output"} {
			if _, exists := body[forbidden]; exists {
				t.Fatalf("push payload contains forbidden field %q", forbidden)
			}
			if _, exists := data[forbidden]; exists {
				t.Fatalf("push data contains forbidden field %q", forbidden)
			}
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"data":{"status":"ok","id":"ticket"}}`)
	}))
	defer server.Close()
	dispatcher := testPushDispatcher(repo, server.URL)
	delivery := testPushDelivery()
	if err := dispatcher.dispatchOne(t.Context(), delivery); err != nil {
		t.Fatalf("dispatchOne() error = %v", err)
	}
	if repo.completedID != delivery.ID || repo.nackedID != "" {
		t.Fatalf("repo state = %#v", repo)
	}
}

func TestPushDispatcherDisablesUnregisteredExpoEndpoint(t *testing.T) {
	repo := &pushRepoStub{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"data":{"status":"error","message":"not registered","details":{"error":"DeviceNotRegistered"}}}`)
	}))
	defer server.Close()
	dispatcher := testPushDispatcher(repo, server.URL)
	delivery := testPushDelivery()
	if err := dispatcher.dispatchOne(t.Context(), delivery); err == nil {
		t.Fatal("dispatchOne() error = nil, want rejected delivery")
	}
	if repo.nackedID != delivery.ID || !repo.permanent || !repo.disabled {
		t.Fatalf("repo state = %#v", repo)
	}
}

func testPushDispatcher(repo biz.PushDeliveryRepo, endpoint string) *PushDispatcher {
	return &PushDispatcher{
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo:         repo,
		httpClient:   &http.Client{Timeout: time.Second},
		expoEndpoint: endpoint,
		pollInterval: time.Second,
		leaseTime:    time.Minute,
		batchSize:    10,
	}
}

func testPushDelivery() *biz.PushDelivery {
	return &biz.PushDelivery{
		ID: "delivery-1", Provider: "expo", Token: "ExponentPushToken[test]",
		Title: "Task completed", Body: "Your task is ready.", Attempts: 1,
		Data: map[string]any{"run_id": "run-1", "event_type": "run_completed"},
	}
}
