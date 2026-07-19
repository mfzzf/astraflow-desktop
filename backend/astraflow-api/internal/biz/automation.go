package biz

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/google/uuid"
)

type CloudAutomation struct {
	ID                 string
	AccountID          string
	WorkspaceID        string
	Name               string
	Prompt             string
	RuntimeID          string
	Model              string
	ReasoningEffort    string
	PermissionMode     string
	ScheduleKind       string
	ScheduleExpression string
	TimeZone           string
	Enabled            bool
	NextRunAt          *time.Time
	LastRunAt          *time.Time
	Version            int64
	SourceDeviceID     string
	ClientMutationID   string
	LeaseOwner         string
	LeaseExpiresAt     *time.Time
	LastError          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type AutomationListOptions struct {
	Offset int
	Limit  int
}

type AutomationRepo interface {
	CreateAutomation(context.Context, *CloudAutomation) (*CloudAutomation, error)
	GetAutomation(context.Context, string, string) (*CloudAutomation, error)
	ListAutomations(context.Context, string, AutomationListOptions) ([]*CloudAutomation, bool, error)
	SetAutomationEnabled(context.Context, string, string, int64, bool, *time.Time, string, string) (*CloudAutomation, error)
	ClaimDueAutomation(context.Context, string, time.Time) (*CloudAutomation, error)
	MaterializeAutomationRun(context.Context, *CloudAutomation, string, time.Time, *time.Time) error
	FailAutomationClaim(context.Context, string, string, string, time.Time) error
}

type AutomationUsecase struct {
	crossDevice *CrossDeviceUsecase
	repo        AutomationRepo
}

func NewAutomationUsecase(crossDevice *CrossDeviceUsecase, repo AutomationRepo) *AutomationUsecase {
	return &AutomationUsecase{crossDevice: crossDevice, repo: repo}
}

func (uc *AutomationUsecase) CreateAutomation(ctx context.Context, authorization string, automation *CloudAutomation) (*CloudAutomation, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	if automation == nil {
		return nil, invalidArgument("automation is required")
	}
	automation.ID = normalizeOptionalID(automation.ID)
	if automation.ID == "" {
		automation.ID = uuid.NewString()
	}
	automation.AccountID = account.ID
	automation.WorkspaceID = normalizeRequiredID(automation.WorkspaceID)
	automation.SourceDeviceID = normalizeOptionalID(automation.SourceDeviceID)
	automation.ClientMutationID = normalizeOptionalID(automation.ClientMutationID)
	automation.Name = strings.TrimSpace(automation.Name)
	automation.Prompt = strings.TrimSpace(automation.Prompt)
	automation.RuntimeID = strings.ToLower(strings.TrimSpace(automation.RuntimeID))
	automation.Model = strings.TrimSpace(automation.Model)
	automation.ReasoningEffort = strings.ToLower(strings.TrimSpace(automation.ReasoningEffort))
	automation.PermissionMode = strings.ToLower(strings.TrimSpace(automation.PermissionMode))
	automation.ScheduleKind = strings.ToLower(strings.TrimSpace(automation.ScheduleKind))
	automation.ScheduleExpression = strings.TrimSpace(automation.ScheduleExpression)
	automation.TimeZone = strings.TrimSpace(automation.TimeZone)
	if automation.RuntimeID == "" {
		automation.RuntimeID = "astraflow"
	}
	if automation.PermissionMode == "" {
		automation.PermissionMode = "default"
	}
	if automation.TimeZone == "" {
		automation.TimeZone = "UTC"
	}
	if automation.WorkspaceID == "" || automation.Name == "" || automation.Prompt == "" ||
		!oneOf(automation.RuntimeID, "astraflow", "codex", "claude", "claude-code", "opencode") ||
		!oneOf(automation.PermissionMode, "default", "plan", "full", "ask", "auto", "readonly", "full_access") ||
		!oneOf(automation.ScheduleKind, "once", "daily", "interval") ||
		!within(automation.Name, 160) || !within(automation.Prompt, 20000) || !within(automation.Model, 200) ||
		!within(automation.ScheduleExpression, 160) || !within(automation.TimeZone, 100) || !within(automation.ClientMutationID, 160) {
		return nil, invalidArgument("automation metadata is invalid")
	}
	if automation.Enabled {
		next, err := nextAutomationOccurrence(automation, time.Now().UTC())
		if err != nil || next == nil {
			return nil, invalidArgument("automation schedule is invalid or no longer in the future")
		}
		automation.NextRunAt = next
	} else if _, err := nextAutomationOccurrence(automation, time.Now().UTC()); err != nil {
		return nil, invalidArgument("automation schedule is invalid")
	}
	result, err := uc.repo.CreateAutomation(ctx, automation)
	return result, mapAutomationError(err)
}

func (uc *AutomationUsecase) ListAutomations(ctx context.Context, authorization string, options AutomationListOptions) ([]*CloudAutomation, bool, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, false, err
	}
	if options.Offset < 0 {
		return nil, false, invalidArgument("automation page token is invalid")
	}
	if options.Limit <= 0 || options.Limit > 100 {
		options.Limit = 50
	}
	items, more, err := uc.repo.ListAutomations(ctx, account.ID, options)
	return items, more, mapAutomationError(err)
}

func (uc *AutomationUsecase) SetAutomationEnabled(ctx context.Context, authorization, automationID string, expectedVersion int64, enabled bool, sourceDeviceID, mutationID string) (*CloudAutomation, error) {
	account, err := uc.crossDevice.authenticate(ctx, authorization)
	if err != nil {
		return nil, err
	}
	automationID = normalizeRequiredID(automationID)
	sourceDeviceID = normalizeOptionalID(sourceDeviceID)
	mutationID = normalizeOptionalID(mutationID)
	if automationID == "" || expectedVersion <= 0 || !within(mutationID, 160) {
		return nil, invalidArgument("automation id, version, and mutation are invalid")
	}
	current, err := uc.repo.GetAutomation(ctx, account.ID, automationID)
	if err != nil {
		return nil, mapAutomationError(err)
	}
	var next *time.Time
	if enabled {
		next, err = nextAutomationOccurrence(current, time.Now().UTC())
		if err != nil || next == nil {
			return nil, kerrors.Conflict("AUTOMATION_SCHEDULE_EXPIRED", "automation schedule has no future occurrence")
		}
	}
	result, err := uc.repo.SetAutomationEnabled(ctx, account.ID, automationID, expectedVersion, enabled, next, sourceDeviceID, mutationID)
	return result, mapAutomationError(err)
}

func (uc *AutomationUsecase) ClaimScheduledRun(ctx context.Context, schedulerID string, leaseDuration time.Duration) (*CloudAutomation, error) {
	if schedulerID = normalizeRequiredID(schedulerID); schedulerID == "" {
		return nil, invalidArgument("scheduler id is required")
	}
	if leaseDuration < 10*time.Second || leaseDuration > 10*time.Minute {
		leaseDuration = time.Minute
	}
	automation, err := uc.repo.ClaimDueAutomation(ctx, schedulerID, time.Now().UTC().Add(leaseDuration))
	return automation, err
}

func (uc *AutomationUsecase) MaterializeScheduledRun(ctx context.Context, automation *CloudAutomation, schedulerID string) error {
	if automation == nil || automation.NextRunAt == nil {
		return invalidArgument("claimed automation is invalid")
	}
	scheduledFor := automation.NextRunAt.UTC()
	next, err := nextAutomationOccurrence(automation, time.Now().UTC().Add(time.Second))
	if automation.ScheduleKind == "once" {
		next = nil
		err = nil
	}
	if err != nil {
		return err
	}
	return uc.repo.MaterializeAutomationRun(ctx, automation, schedulerID, scheduledFor, next)
}

func (uc *AutomationUsecase) FailScheduledRun(ctx context.Context, automationID, schedulerID string, cause error) error {
	message := "automation run could not be materialized"
	if cause != nil {
		message = cause.Error()
	}
	return uc.repo.FailAutomationClaim(ctx, automationID, schedulerID, message, time.Now().UTC().Add(time.Minute))
}

func nextAutomationOccurrence(automation *CloudAutomation, after time.Time) (*time.Time, error) {
	location, err := time.LoadLocation(automation.TimeZone)
	if err != nil {
		return nil, err
	}
	switch automation.ScheduleKind {
	case "once":
		value, err := time.Parse(time.RFC3339, automation.ScheduleExpression)
		if err != nil {
			return nil, err
		}
		value = value.UTC()
		if !value.After(after) {
			return nil, nil
		}
		return &value, nil
	case "interval":
		seconds, err := strconv.Atoi(automation.ScheduleExpression)
		if err != nil || seconds < 300 || seconds > 30*24*60*60 {
			return nil, errors.New("automation interval must be between 300 and 2592000 seconds")
		}
		value := after.UTC().Add(time.Duration(seconds) * time.Second)
		return &value, nil
	case "daily":
		parsed, err := time.Parse("15:04", automation.ScheduleExpression)
		if err != nil {
			return nil, err
		}
		localAfter := after.In(location)
		value := time.Date(localAfter.Year(), localAfter.Month(), localAfter.Day(), parsed.Hour(), parsed.Minute(), 0, 0, location)
		if !value.After(localAfter) {
			value = time.Date(localAfter.Year(), localAfter.Month(), localAfter.Day()+1, parsed.Hour(), parsed.Minute(), 0, 0, location)
		}
		utc := value.UTC()
		return &utc, nil
	default:
		return nil, errors.New("unsupported automation schedule")
	}
}

func ParseAutomationPageToken(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	offset, err := strconv.Atoi(value)
	if err != nil || offset < 0 {
		return 0, invalidArgument("automation page token is invalid")
	}
	return offset, nil
}

func mapAutomationError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrCloudWorkerNoWork):
		return kerrors.NotFound("NO_AUTOMATION_DUE", "no automation is due")
	case errors.Is(err, ErrCrossDeviceNotFound):
		return kerrors.NotFound("AUTOMATION_NOT_FOUND", "automation or workspace was not found")
	case errors.Is(err, ErrCrossDeviceConflict):
		return kerrors.Conflict("AUTOMATION_CONFLICT", "automation version, lease, or workspace state conflicts")
	default:
		return kerrors.ServiceUnavailable("AUTOMATION_UNAVAILABLE", "automation state could not be saved")
	}
}
