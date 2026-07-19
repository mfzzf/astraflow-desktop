package server

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"astraflow-api/internal/biz"
)

type AutomationScheduler struct {
	logger       *slog.Logger
	usecase      *biz.AutomationUsecase
	schedulerID  string
	pollInterval time.Duration
	leaseTime    time.Duration

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

func NewAutomationScheduler(logger *slog.Logger, usecase *biz.AutomationUsecase) *AutomationScheduler {
	id := strings.TrimSpace(os.Getenv("HOSTNAME"))
	if id == "" {
		id = "astraflow-api"
	}
	return &AutomationScheduler{
		logger: logger, usecase: usecase, schedulerID: "automation-" + id,
		pollInterval: 2 * time.Second, leaseTime: time.Minute,
	}
}

func (scheduler *AutomationScheduler) Start(parent context.Context) error {
	scheduler.mu.Lock()
	if scheduler.cancel != nil {
		scheduler.mu.Unlock()
		return errors.New("automation scheduler is already running")
	}
	ctx, cancel := context.WithCancel(parent)
	scheduler.cancel = cancel
	scheduler.done = make(chan struct{})
	done := scheduler.done
	scheduler.mu.Unlock()
	defer close(done)
	ticker := time.NewTicker(scheduler.pollInterval)
	defer ticker.Stop()
	for {
		if err := scheduler.runOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			scheduler.logger.Error("automation scheduler cycle failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (scheduler *AutomationScheduler) Stop(ctx context.Context) error {
	scheduler.mu.Lock()
	cancel, done := scheduler.cancel, scheduler.done
	scheduler.cancel = nil
	scheduler.mu.Unlock()
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

func (scheduler *AutomationScheduler) runOnce(ctx context.Context) error {
	automation, err := scheduler.usecase.ClaimScheduledRun(ctx, scheduler.schedulerID, scheduler.leaseTime)
	if err != nil {
		if errors.Is(err, biz.ErrCloudWorkerNoWork) {
			return nil
		}
		return err
	}
	if err := scheduler.usecase.MaterializeScheduledRun(ctx, automation, scheduler.schedulerID); err != nil {
		_ = scheduler.usecase.FailScheduledRun(ctx, automation.ID, scheduler.schedulerID, err)
		return err
	}
	return nil
}
