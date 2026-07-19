package data

import (
	"context"
	"errors"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type automationRepo struct {
	data *Data
}

func NewAutomationRepo(data *Data) biz.AutomationRepo {
	return &automationRepo{data: data}
}

func (repo *automationRepo) CreateAutomation(ctx context.Context, automation *biz.CloudAutomation) (*biz.CloudAutomation, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, automation.AccountID, automation.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getAutomationTx(ctx, tx, automation.AccountID, existingID, false)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, automation.AccountID, automation.SourceDeviceID, true); err != nil {
		return nil, err
	}
	var workspaceType, workspaceState string
	if err := tx.QueryRow(ctx, `
		SELECT type, state FROM workspaces WHERE account_id = $1 AND id = $2
	`, automation.AccountID, automation.WorkspaceID).Scan(&workspaceType, &workspaceState); errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	} else if err != nil {
		return nil, err
	}
	if workspaceType != "sandbox" || workspaceState == "deleted" || workspaceState == "unavailable" {
		return nil, biz.ErrCrossDeviceConflict
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO cloud_automations (
			id, account_id, workspace_id, name, prompt, runtime_id, model,
			reasoning_effort, permission_mode, schedule_kind, schedule_expression,
			time_zone, enabled, next_run_at, source_device_id, client_mutation_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
			$13, $14, NULLIF($15, ''), $16)
		RETURNING `+automationColumns+`
	`, automation.ID, automation.AccountID, automation.WorkspaceID, automation.Name,
		automation.Prompt, automation.RuntimeID, automation.Model, automation.ReasoningEffort,
		automation.PermissionMode, automation.ScheduleKind, automation.ScheduleExpression,
		automation.TimeZone, automation.Enabled, automation.NextRunAt, automation.SourceDeviceID,
		automation.ClientMutationID)
	result, err := scanAutomation(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if err := appendSyncEvent(ctx, tx, result.AccountID, "automation", result.ID, "automation.created", result.Version, automationSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, result.AccountID, automation.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *automationRepo) GetAutomation(ctx context.Context, accountID, automationID string) (*biz.CloudAutomation, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := scanAutomation(repo.data.db.QueryRow(ctx, `SELECT `+automationColumns+` FROM cloud_automations WHERE account_id = $1 AND id = $2`, accountID, automationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *automationRepo) ListAutomations(ctx context.Context, accountID string, options biz.AutomationListOptions) ([]*biz.CloudAutomation, bool, error) {
	if repo.data.db == nil {
		return nil, false, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT `+automationColumns+` FROM cloud_automations
		WHERE account_id = $1
		ORDER BY updated_at DESC, id
		OFFSET $2 LIMIT $3
	`, accountID, options.Offset, options.Limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]*biz.CloudAutomation, 0, options.Limit+1)
	for rows.Next() {
		item, err := scanAutomation(rows)
		if err != nil {
			return nil, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(items) > options.Limit
	if more {
		items = items[:options.Limit]
	}
	return items, more, nil
}

func (repo *automationRepo) SetAutomationEnabled(ctx context.Context, accountID, automationID string, expectedVersion int64, enabled bool, nextRunAt *time.Time, sourceDeviceID, mutationID string) (*biz.CloudAutomation, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, accountID, mutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getAutomationTx(ctx, tx, accountID, existingID, false)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, accountID, sourceDeviceID, true); err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		UPDATE cloud_automations SET
			enabled = $4, next_run_at = $5, version = version + 1,
			lease_owner = '', lease_expires_at = NULL, last_error = '', updated_at = now()
		WHERE account_id = $1 AND id = $2 AND version = $3
		RETURNING `+automationColumns+`
	`, accountID, automationID, expectedVersion, enabled, nextRunAt)
	result, err := scanAutomation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, lookupErr := getAutomationTx(ctx, tx, accountID, automationID, false); errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, biz.ErrCrossDeviceNotFound
		}
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "automation", automationID, "automation.updated", result.Version, automationSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, accountID, mutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *automationRepo) ClaimDueAutomation(ctx context.Context, schedulerID string, leaseExpiresAt time.Time) (*biz.CloudAutomation, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	row := repo.data.db.QueryRow(ctx, `
		WITH candidate AS (
			SELECT id FROM cloud_automations
			WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now()
				AND (lease_expires_at IS NULL OR lease_expires_at <= now())
			ORDER BY next_run_at, created_at, id
			FOR UPDATE SKIP LOCKED LIMIT 1
		)
		UPDATE cloud_automations automation SET
			lease_owner = $1, lease_expires_at = $2, last_error = '', updated_at = now()
		FROM candidate WHERE automation.id = candidate.id
		RETURNING `+automationColumns+`
	`, schedulerID, leaseExpiresAt)
	result, err := scanAutomation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCloudWorkerNoWork
	}
	return result, err
}

func (repo *automationRepo) MaterializeAutomationRun(ctx context.Context, automation *biz.CloudAutomation, schedulerID string, scheduledFor time.Time, nextRunAt *time.Time) error {
	tx, err := repo.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	current, err := getClaimedAutomationTx(ctx, tx, automation.ID, schedulerID)
	if err != nil {
		return err
	}
	if current.NextRunAt == nil || !current.NextRunAt.Equal(scheduledFor) {
		return biz.ErrCrossDeviceConflict
	}
	var workspaceState string
	if err := tx.QueryRow(ctx, `
		SELECT state FROM workspaces
		WHERE id = $1 AND account_id = $2 AND type = 'sandbox'
	`, current.WorkspaceID, current.AccountID).Scan(&workspaceState); errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	} else if err != nil {
		return err
	}
	if workspaceState != "ready" && workspaceState != "paused" {
		return biz.ErrCrossDeviceConflict
	}
	occurrence := current.ID + "\x00" + scheduledFor.UTC().Format(time.RFC3339Nano)
	sessionID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("session\x00"+occurrence)).String()
	messageID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("message\x00"+occurrence)).String()
	runID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("run\x00"+occurrence)).String()
	session, err := scanSession(tx.QueryRow(ctx, `
		INSERT INTO sessions (
			id, account_id, workspace_id, mode, title, runtime_id, model,
			reasoning_effort, permission_mode
		) VALUES ($1, $2, $3, 'chat', $4, $5, $6, $7, $8)
		RETURNING id, account_id, COALESCE(workspace_id, ''), mode, title, runtime_id, model,
			reasoning_effort, permission_mode, version, pinned_at, archived_at,
			created_at, updated_at, deleted_at
	`, sessionID, current.AccountID, current.WorkspaceID,
		current.Name+" · "+scheduledFor.In(mustLocation(current.TimeZone)).Format("2006-01-02 15:04"),
		current.RuntimeID, current.Model, current.ReasoningEffort, current.PermissionMode))
	if err != nil {
		return normalizeConstraintError(err)
	}
	content, _ := encodeJSON(map[string]any{"text": current.Prompt, "automation_id": current.ID}, `{}`)
	parts, _ := encodeJSON([]map[string]any{{"type": "text", "text": current.Prompt}}, `[]`)
	message, err := scanMessage(tx.QueryRow(ctx, `
		INSERT INTO messages (
			id, account_id, session_id, role, status, content_projection, parts_projection
		) VALUES ($1, $2, $3, 'user', 'completed', $4, $5)
		RETURNING id, account_id, session_id, role, status, content_projection,
			parts_projection, client_mutation_id, COALESCE(source_device_id, ''), created_at, updated_at
	`, messageID, current.AccountID, sessionID, content, parts))
	if err != nil {
		return normalizeConstraintError(err)
	}
	run, err := scanAgentRun(tx.QueryRow(ctx, `
		INSERT INTO agent_runs (
			id, account_id, session_id, execution_target, workspace_id, status,
			runtime_id, model, reasoning_effort, permission_mode
		) VALUES ($1, $2, $3, 'cloud', $4, 'queued', $5, $6, $7, $8)
		RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
	`, runID, current.AccountID, sessionID, current.WorkspaceID, current.RuntimeID,
		current.Model, current.ReasoningEffort, current.PermissionMode))
	if err != nil {
		return normalizeConstraintError(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cloud_automation_runs (automation_id, run_id, session_id, scheduled_for)
		VALUES ($1, $2, $3, $4)
	`, current.ID, run.ID, session.ID, scheduledFor); err != nil {
		return normalizeConstraintError(err)
	}
	row := tx.QueryRow(ctx, `
		UPDATE cloud_automations SET
			last_run_at = $3, next_run_at = $4,
			enabled = CASE WHEN $4::timestamptz IS NULL THEN false ELSE enabled END,
			lease_owner = '', lease_expires_at = NULL, last_error = '',
			version = version + 1, updated_at = now()
		WHERE id = $1 AND lease_owner = $2
		RETURNING `+automationColumns+`
	`, current.ID, schedulerID, scheduledFor, nextRunAt)
	updated, err := scanAutomation(row)
	if err != nil {
		return err
	}
	if err := appendSyncEvent(ctx, tx, current.AccountID, "session", session.ID, "session.created", session.Version, sessionSyncPayload(session)); err != nil {
		return err
	}
	if err := appendSyncEvent(ctx, tx, current.AccountID, "message", message.ID, "message.created", 0, messageSyncPayload(message)); err != nil {
		return err
	}
	if err := appendSyncEvent(ctx, tx, current.AccountID, "agent_run", run.ID, "agent_run.created", 0, runSyncPayload(run)); err != nil {
		return err
	}
	if err := appendSyncEvent(ctx, tx, current.AccountID, "automation", current.ID, "automation.triggered", updated.Version, automationSyncPayload(updated)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo *automationRepo) FailAutomationClaim(ctx context.Context, automationID, schedulerID, message string, retryAt time.Time) error {
	if repo.data.db == nil {
		return fmt.Errorf("database is not configured")
	}
	result, err := repo.data.db.Exec(ctx, `
		UPDATE cloud_automations SET
			lease_owner = '', lease_expires_at = $3, last_error = left($4, 2000), updated_at = now()
		WHERE id = $1 AND lease_owner = $2
	`, automationID, schedulerID, retryAt, message)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return biz.ErrCrossDeviceConflict
	}
	return nil
}

func (repo *automationRepo) begin(ctx context.Context) (pgx.Tx, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	return repo.data.db.BeginTx(ctx, pgx.TxOptions{})
}

const automationColumns = `
	id, account_id, workspace_id, name, prompt, runtime_id, model,
	reasoning_effort, permission_mode, schedule_kind, schedule_expression,
	time_zone, enabled, next_run_at, last_run_at, version,
	COALESCE(source_device_id, ''), client_mutation_id, lease_owner,
	lease_expires_at, last_error, created_at, updated_at`

func scanAutomation(row scanner) (*biz.CloudAutomation, error) {
	automation := &biz.CloudAutomation{}
	err := row.Scan(&automation.ID, &automation.AccountID, &automation.WorkspaceID,
		&automation.Name, &automation.Prompt, &automation.RuntimeID, &automation.Model,
		&automation.ReasoningEffort, &automation.PermissionMode, &automation.ScheduleKind,
		&automation.ScheduleExpression, &automation.TimeZone, &automation.Enabled,
		&automation.NextRunAt, &automation.LastRunAt, &automation.Version,
		&automation.SourceDeviceID, &automation.ClientMutationID, &automation.LeaseOwner,
		&automation.LeaseExpiresAt, &automation.LastError, &automation.CreatedAt, &automation.UpdatedAt)
	return automation, err
}

func getAutomationTx(ctx context.Context, tx pgx.Tx, accountID, automationID string, forUpdate bool) (*biz.CloudAutomation, error) {
	query := `SELECT ` + automationColumns + ` FROM cloud_automations WHERE account_id = $1 AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	return scanAutomation(tx.QueryRow(ctx, query, accountID, automationID))
}

func getClaimedAutomationTx(ctx context.Context, tx pgx.Tx, automationID, schedulerID string) (*biz.CloudAutomation, error) {
	result, err := scanAutomation(tx.QueryRow(ctx, `
		SELECT `+automationColumns+` FROM cloud_automations
		WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now()
		FOR UPDATE
	`, automationID, schedulerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	return result, err
}

func automationSyncPayload(automation *biz.CloudAutomation) map[string]any {
	return map[string]any{
		"id": automation.ID, "workspace_id": automation.WorkspaceID,
		"name": automation.Name, "runtime_id": automation.RuntimeID, "model": automation.Model,
		"schedule_kind": automation.ScheduleKind, "schedule_expression": automation.ScheduleExpression,
		"time_zone": automation.TimeZone, "enabled": automation.Enabled,
		"next_run_at": automation.NextRunAt, "last_run_at": automation.LastRunAt,
		"version": automation.Version, "last_error": automation.LastError, "updated_at": automation.UpdatedAt,
	}
}

func mustLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return location
}
