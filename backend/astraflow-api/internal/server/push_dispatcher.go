package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"astraflow-api/internal/biz"
)

const defaultExpoPushEndpoint = "https://exp.host/--/api/v2/push/send"

type PushDispatcher struct {
	logger       *slog.Logger
	repo         biz.PushDeliveryRepo
	httpClient   *http.Client
	expoEndpoint string
	pollInterval time.Duration
	leaseTime    time.Duration
	batchSize    int

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

type expoPushRequest struct {
	To    string         `json:"to"`
	Title string         `json:"title"`
	Body  string         `json:"body"`
	Data  map[string]any `json:"data"`
	Sound string         `json:"sound,omitempty"`
}

type expoPushResponse struct {
	Data struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

func NewPushDispatcher(logger *slog.Logger, repo biz.PushDeliveryRepo) (*PushDispatcher, error) {
	endpoint := strings.TrimSpace(os.Getenv("ASTRAFLOW_EXPO_PUSH_ENDPOINT"))
	if endpoint == "" {
		endpoint = defaultExpoPushEndpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackPushHost(parsed.Hostname()))) {
		return nil, errors.New("ASTRAFLOW_EXPO_PUSH_ENDPOINT must use HTTPS outside localhost")
	}
	return &PushDispatcher{
		logger: logger, repo: repo,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		expoEndpoint: endpoint,
		pollInterval: 2 * time.Second,
		leaseTime:    time.Minute,
		batchSize:    25,
	}, nil
}

func (dispatcher *PushDispatcher) Start(parent context.Context) error {
	dispatcher.mu.Lock()
	if dispatcher.cancel != nil {
		dispatcher.mu.Unlock()
		return errors.New("push dispatcher is already running")
	}
	ctx, cancel := context.WithCancel(parent)
	dispatcher.cancel = cancel
	dispatcher.done = make(chan struct{})
	done := dispatcher.done
	dispatcher.mu.Unlock()
	defer close(done)

	ticker := time.NewTicker(dispatcher.pollInterval)
	defer ticker.Stop()
	for {
		if err := dispatcher.dispatchBatch(ctx); err != nil && !errors.Is(err, context.Canceled) {
			dispatcher.logger.Error("push delivery batch failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (dispatcher *PushDispatcher) Stop(ctx context.Context) error {
	dispatcher.mu.Lock()
	cancel, done := dispatcher.cancel, dispatcher.done
	dispatcher.cancel = nil
	dispatcher.mu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (dispatcher *PushDispatcher) dispatchBatch(ctx context.Context) error {
	deliveries, err := dispatcher.repo.ClaimPushDeliveries(ctx, dispatcher.batchSize, dispatcher.leaseTime)
	if err != nil {
		return err
	}
	for _, delivery := range deliveries {
		if err := dispatcher.dispatchOne(ctx, delivery); err != nil {
			dispatcher.logger.Warn("push delivery failed", "delivery_id", delivery.ID, "provider", delivery.Provider, "error", err)
		}
	}
	return nil
}

func (dispatcher *PushDispatcher) dispatchOne(ctx context.Context, delivery *biz.PushDelivery) error {
	if delivery == nil {
		return errors.New("push delivery is missing")
	}
	if delivery.Provider != "expo" {
		message := fmt.Sprintf("push provider %q is not configured", delivery.Provider)
		return errors.Join(errors.New(message), dispatcher.repo.NackPushDelivery(ctx, delivery.ID, message, time.Now().UTC(), true, false))
	}
	payload, err := json.Marshal(expoPushRequest{
		To: delivery.Token, Title: delivery.Title, Body: delivery.Body,
		Data: delivery.Data, Sound: "default",
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, dispatcher.expoEndpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := dispatcher.httpClient.Do(request)
	if err != nil {
		return dispatcher.retry(ctx, delivery, err.Error(), false)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if readErr != nil {
		return dispatcher.retry(ctx, delivery, readErr.Error(), false)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		permanent := response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests
		return dispatcher.retry(ctx, delivery, fmt.Sprintf("Expo push returned HTTP %d", response.StatusCode), permanent)
	}
	result := expoPushResponse{}
	if err := json.Unmarshal(body, &result); err != nil {
		return dispatcher.retry(ctx, delivery, "Expo push returned an invalid response", false)
	}
	if result.Data.Status != "ok" {
		code := strings.TrimSpace(result.Data.Details.Error)
		message := strings.TrimSpace(result.Data.Message)
		if message == "" {
			message = "Expo push rejected the notification"
		}
		disable := code == "DeviceNotRegistered"
		permanent := disable || code == "MessageTooBig" || code == "MismatchSenderId" || code == "InvalidCredentials"
		return dispatcher.nack(ctx, delivery, message, permanent, disable)
	}
	return dispatcher.repo.CompletePushDelivery(ctx, delivery.ID)
}

func (dispatcher *PushDispatcher) retry(ctx context.Context, delivery *biz.PushDelivery, message string, permanent bool) error {
	return dispatcher.nack(ctx, delivery, message, permanent || delivery.Attempts >= 8, false)
}

func (dispatcher *PushDispatcher) nack(ctx context.Context, delivery *biz.PushDelivery, message string, permanent, disable bool) error {
	delay := time.Minute
	for attempt := 1; attempt < delivery.Attempts && delay < 6*time.Hour; attempt++ {
		delay *= 2
	}
	if delay > 6*time.Hour {
		delay = 6 * time.Hour
	}
	repoErr := dispatcher.repo.NackPushDelivery(ctx, delivery.ID, message, time.Now().UTC().Add(delay), permanent, disable)
	if repoErr != nil {
		return errors.Join(errors.New(message), repoErr)
	}
	return errors.New(message)
}

func isLoopbackPushHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
