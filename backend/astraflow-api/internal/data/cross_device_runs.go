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

func (repo *crossDeviceRepo) CreateAgentRun(ctx context.Context, run *biz.AgentRun) (*biz.AgentRun, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, run.AccountID, run.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getAgentRunTx(ctx, tx, run.AccountID, existingID, false)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, run.AccountID, run.SourceDeviceID, true); err != nil {
		return nil, err
	}
	session, err := getSessionTx(ctx, tx, run.AccountID, run.SessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	if run.ExecutionTarget == "desktop" && run.DispatchMode != "local_origin" {
		if err := ensureTargetDesktop(ctx, tx, run.AccountID, run.TargetDeviceID); err != nil {
			return nil, err
		}
	} else {
		if session.WorkspaceID != "" && run.WorkspaceID != session.WorkspaceID {
			return nil, biz.ErrCrossDeviceConflict
		}
		if err := ensureTargetSandbox(ctx, tx, run.AccountID, run.WorkspaceID); err != nil {
			return nil, err
		}
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO agent_runs (
			id, account_id, session_id, execution_target, target_device_id, workspace_id,
			status, runtime_id, model, reasoning_effort, permission_mode, return_artifacts
		) VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, $8, $9, $10, $11, $12)
		RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
	`, run.ID, run.AccountID, run.SessionID, run.ExecutionTarget, run.TargetDeviceID, run.WorkspaceID,
		run.Status, run.RuntimeID, run.Model, run.ReasoningEffort, run.PermissionMode, run.ReturnArtifacts)
	result, err := scanAgentRun(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if run.ExecutionTarget == "desktop" {
		if err := insertDeviceCommand(ctx, tx, result, "start_run", runSyncPayload(result)); err != nil {
			return nil, err
		}
	}
	if err := appendSyncEvent(ctx, tx, result.AccountID, "agent_run", result.ID, "agent_run.created", 0, runSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, result.AccountID, run.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) GetAgentRun(ctx context.Context, accountID, runID string) (*biz.AgentRun, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := getAgentRunRow(ctx, repo.data.db, accountID, runID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *crossDeviceRepo) ListAgentRuns(ctx context.Context, accountID string, options biz.AgentRunListOptions) ([]*biz.AgentRun, bool, error) {
	if repo.data.db == nil {
		return nil, false, fmt.Errorf("database is not configured")
	}
	if options.SessionID != "" {
		if _, err := getSessionRow(ctx, repo.data.db, accountID, options.SessionID); errors.Is(err, pgx.ErrNoRows) {
			return nil, false, biz.ErrCrossDeviceNotFound
		} else if err != nil {
			return nil, false, err
		}
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
		FROM agent_runs
		WHERE account_id = $1
			AND ($2 = '' OR session_id = $2)
			AND (NOT $3 OR status IN ('queued', 'waiting_device', 'running', 'waiting_approval', 'waiting_input'))
		ORDER BY updated_at DESC, id DESC
		OFFSET $4 LIMIT $5
	`, accountID, options.SessionID, options.ActiveOnly, options.Offset, options.Limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]*biz.AgentRun, 0, options.Limit+1)
	for rows.Next() {
		item, err := scanAgentRun(rows)
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

func (repo *crossDeviceRepo) CancelAgentRun(ctx context.Context, accountID, runID, sourceDeviceID, mutationID string) (*biz.AgentRun, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, accountID, mutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getAgentRunTx(ctx, tx, accountID, existingID, false)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, accountID, sourceDeviceID, true); err != nil {
		return nil, err
	}
	run, err := getAgentRunTx(ctx, tx, accountID, runID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	if !terminalRunStatus(run.Status) {
		row := tx.QueryRow(ctx, `
			UPDATE agent_runs SET status = 'cancelled', completed_at = now(), updated_at = now()
			WHERE account_id = $1 AND id = $2
			RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
				COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
				permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
				error_code, error_message, created_at, updated_at
		`, accountID, runID)
		run, err = scanAgentRun(row)
		if err != nil {
			return nil, err
		}
		if run.ExecutionTarget == "desktop" {
			if err := insertDeviceCommand(ctx, tx, run, "cancel_run", map[string]any{"run_id": run.ID}); err != nil {
				return nil, err
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE device_commands SET status = 'cancelled', completed_at = now()
			WHERE account_id = $1 AND run_id = $2 AND type = 'start_run' AND status IN ('pending', 'leased')
		`, accountID, runID); err != nil {
			return nil, err
		}
		if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.cancelled", run.LastEventSeq, runSyncPayload(run)); err != nil {
			return nil, err
		}
	}
	if err := finishMutation(ctx, tx, accountID, mutationID, run.ID); err != nil {
		return nil, err
	}
	return run, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) AppendAgentRunEvents(
	ctx context.Context,
	accountID string,
	options biz.AppendAgentRunEventsOptions,
	events []*biz.AgentRunEvent,
) (int, *biz.AgentRun, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx)
	accepted, run, err := appendAgentRunEventsTx(ctx, tx, accountID, options, events)
	if err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, nil, err
	}
	return accepted, run, nil
}

func appendAgentRunEventsTx(
	ctx context.Context,
	tx pgx.Tx,
	accountID string,
	options biz.AppendAgentRunEventsOptions,
	events []*biz.AgentRunEvent,
) (int, *biz.AgentRun, error) {
	run, err := getAgentRunTx(ctx, tx, accountID, options.RunID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return 0, nil, err
	}

	accepted := 0
	lastSeq := run.LastEventSeq
	for _, event := range events {
		if event.Seq <= lastSeq {
			var existingID string
			err := tx.QueryRow(ctx, `SELECT event_id FROM agent_run_events WHERE run_id = $1 AND seq = $2`, run.ID, event.Seq).Scan(&existingID)
			if err != nil || existingID != event.EventID {
				return 0, nil, biz.ErrAgentEventSequence
			}
			continue
		}
		if terminalRunStatus(run.Status) || event.Seq != lastSeq+1 {
			return 0, nil, biz.ErrAgentEventSequence
		}
		payload, err := encodeJSON(event.Payload, `{}`)
		if err != nil {
			return 0, nil, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO agent_run_events (
				run_id, account_id, seq, event_id, type, payload, producer_type, producer_id, occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, run.ID, accountID, event.Seq, event.EventID, event.Type, payload,
			event.ProducerType, event.ProducerID, event.OccurredAt); err != nil {
			return 0, nil, normalizeConstraintError(err)
		}
		if event.Action != nil {
			if err := insertAgentAction(ctx, tx, event.Action); err != nil {
				return 0, nil, err
			}
			waitingStatus := "waiting_approval"
			if event.Action.Type == "user_input" {
				waitingStatus = "waiting_input"
			}
			options.RunStatus = waitingStatus
		}
		if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.event", event.Seq, eventSyncPayload(event)); err != nil {
			return 0, nil, err
		}
		accepted++
		lastSeq = event.Seq
	}

	previousStatus := run.Status
	nextStatus := previousStatus
	if options.RunStatus != "" {
		if !validRunTransition(run.Status, options.RunStatus) {
			return 0, nil, biz.ErrCrossDeviceConflict
		}
		nextStatus = options.RunStatus
	} else if accepted > 0 && (run.Status == "queued" || run.Status == "waiting_device") {
		nextStatus = "running"
	}
	terminal := terminalRunStatus(nextStatus)
	row := tx.QueryRow(ctx, `
		UPDATE agent_runs SET
			status = $3,
			runtime_session_ref = CASE WHEN $4 = '' THEN runtime_session_ref ELSE $4 END,
			last_event_seq = $5,
			started_at = CASE WHEN $5 > 0 THEN COALESCE(started_at, now()) ELSE started_at END,
			completed_at = CASE WHEN $6 THEN COALESCE(completed_at, now()) ELSE NULL END,
			error_code = $7, error_message = $8, updated_at = now()
		WHERE account_id = $1 AND id = $2
		RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
	`, accountID, run.ID, nextStatus, options.RuntimeSessionRef, lastSeq, terminal, options.ErrorCode, options.ErrorMessage)
	run, err = scanAgentRun(row)
	if err != nil {
		return 0, nil, err
	}
	if accepted > 0 || nextStatus != previousStatus || options.RuntimeSessionRef != "" {
		if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.updated", run.LastEventSeq, runSyncPayload(run)); err != nil {
			return 0, nil, err
		}
	}
	if nextStatus != previousStatus && (nextStatus == "completed" || nextStatus == "failed") {
		title := "Task completed"
		body := "Your AstraFlow task is ready to review."
		eventType := "run_completed"
		if nextStatus == "failed" {
			title = "Task needs attention"
			body = "Open AstraFlow to review the task."
			eventType = "run_failed"
		}
		if err := enqueuePushNotification(ctx, tx, accountID, run.ID, "run:"+run.ID+":"+nextStatus, eventType, title, body); err != nil {
			return 0, nil, err
		}
	}
	return accepted, run, nil
}

func (repo *crossDeviceRepo) ListAgentRunEvents(ctx context.Context, accountID, runID string, afterSeq int64, limit int) ([]*biz.AgentRunEvent, int64, bool, error) {
	if repo.data.db == nil {
		return nil, 0, false, fmt.Errorf("database is not configured")
	}
	run, err := getAgentRunRow(ctx, repo.data.db, accountID, runID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, false, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, 0, false, err
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT run_id, account_id, event_id, seq, type, payload, producer_type, producer_id, occurred_at
		FROM agent_run_events
		WHERE account_id = $1 AND run_id = $2 AND seq > $3
		ORDER BY seq
		LIMIT $4
	`, accountID, runID, afterSeq, limit+1)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	items := make([]*biz.AgentRunEvent, 0, limit+1)
	for rows.Next() {
		event, err := scanAgentRunEvent(rows)
		if err != nil {
			return nil, 0, false, err
		}
		items = append(items, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, run.LastEventSeq, hasMore, nil
}

func (repo *crossDeviceRepo) ResolveAgentAction(ctx context.Context, accountID string, resolution biz.AgentActionResolution) (*biz.AgentAction, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, accountID, resolution.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getAgentActionTx(ctx, tx, accountID, resolution.RunID, existingID, false)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, accountID, resolution.SourceDeviceID, true); err != nil {
		return nil, err
	}
	action, err := getAgentActionTx(ctx, tx, accountID, resolution.RunID, resolution.ActionID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	if action.Status != "pending" || action.Version != resolution.ExpectedVersion ||
		(action.ExpiresAt != nil && !action.ExpiresAt.After(time.Now())) {
		return nil, biz.ErrCrossDeviceConflict
	}
	payload, err := encodeJSON(resolution.Payload, `{}`)
	if err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		UPDATE agent_actions SET
			status = $5, resolution_payload = $6, version = version + 1, resolved_at = now()
		WHERE account_id = $1 AND run_id = $2 AND id = $3 AND version = $4 AND status = 'pending'
		RETURNING id, account_id, run_id, event_seq, type, status, request_payload,
			resolution_payload, version, expires_at, resolved_at, created_at
	`, accountID, resolution.RunID, resolution.ActionID, resolution.ExpectedVersion, resolution.Resolution, payload)
	action, err = scanAgentAction(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	run, err := getAgentRunTx(ctx, tx, accountID, resolution.RunID, true)
	if err != nil {
		return nil, err
	}
	if run.Status == "waiting_approval" || run.Status == "waiting_input" {
		if _, err := tx.Exec(ctx, `UPDATE agent_runs SET status = 'running', updated_at = now() WHERE account_id = $1 AND id = $2`, accountID, run.ID); err != nil {
			return nil, err
		}
		run.Status = "running"
	}
	if run.ExecutionTarget == "desktop" {
		if err := insertDeviceCommand(ctx, tx, run, "resolve_action", actionSyncPayload(action)); err != nil {
			return nil, err
		}
	}
	if err := appendSyncEvent(ctx, tx, accountID, "agent_action", action.ID, "agent_action.resolved", action.Version, actionSyncPayload(action)); err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.updated", run.LastEventSeq, runSyncPayload(run)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, accountID, resolution.ClientMutationID, action.ID); err != nil {
		return nil, err
	}
	return action, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ListAgentActions(ctx context.Context, accountID, runID string, pendingOnly bool) ([]*biz.AgentAction, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	if runID != "" {
		if _, err := getAgentRunRow(ctx, repo.data.db, accountID, runID, false); errors.Is(err, pgx.ErrNoRows) {
			return nil, biz.ErrCrossDeviceNotFound
		} else if err != nil {
			return nil, err
		}
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, run_id, event_seq, type, status, request_payload,
			resolution_payload, version, expires_at, resolved_at, created_at
		FROM agent_actions
		WHERE account_id = $1
			AND ($2 = '' OR run_id = $2)
			AND (NOT $3 OR status = 'pending')
		ORDER BY created_at, id
	`, accountID, runID, pendingOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*biz.AgentAction, 0)
	for rows.Next() {
		item, err := scanAgentAction(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ensureTargetDesktop(ctx context.Context, tx pgx.Tx, accountID, deviceID string) error {
	var deviceType string
	err := tx.QueryRow(ctx, `SELECT type FROM devices WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`, accountID, deviceID).Scan(&deviceType)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return err
	}
	if deviceType != "desktop" {
		return biz.ErrCrossDeviceConflict
	}
	return nil
}

func ensureTargetSandbox(ctx context.Context, tx pgx.Tx, accountID, workspaceID string) error {
	var workspaceType, state string
	err := tx.QueryRow(ctx, `SELECT type, state FROM workspaces WHERE account_id = $1 AND id = $2`, accountID, workspaceID).Scan(&workspaceType, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return err
	}
	if workspaceType != "sandbox" || state == "deleted" || state == "unavailable" {
		return biz.ErrCrossDeviceConflict
	}
	return nil
}

func insertDeviceCommand(ctx context.Context, tx pgx.Tx, run *biz.AgentRun, commandType string, payload any) error {
	encoded, err := encodeJSON(payload, `{}`)
	if err != nil {
		return err
	}
	commandID := uuid.NewString()
	if _, err := tx.Exec(ctx, `
		INSERT INTO device_commands (id, account_id, device_id, run_id, type, payload)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, commandID, run.AccountID, run.TargetDeviceID, run.ID, commandType, encoded); err != nil {
		return err
	}
	return appendSyncEvent(ctx, tx, run.AccountID, "device_command", commandID, "device_command.created", 1, map[string]any{
		"id": commandID, "device_id": run.TargetDeviceID, "run_id": run.ID, "type": commandType, "status": "pending",
	})
}

func insertAgentAction(ctx context.Context, tx pgx.Tx, action *biz.AgentAction) error {
	request, err := encodeJSON(action.Request, `{}`)
	if err != nil {
		return err
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO agent_actions (
			id, account_id, run_id, event_seq, type, status, request_payload, version, expires_at
		) VALUES ($1, $2, $3, $4, $5, 'pending', $6, 1, $7)
		RETURNING created_at
	`, action.ID, action.AccountID, action.RunID, action.EventSeq, action.Type, request, action.ExpiresAt)
	if err := row.Scan(&action.CreatedAt); err != nil {
		return normalizeConstraintError(err)
	}
	if err := appendSyncEvent(ctx, tx, action.AccountID, "agent_action", action.ID, "agent_action.created", 1, actionSyncPayload(action)); err != nil {
		return err
	}
	eventType := "approval_required"
	title := "Approval required"
	body := "A task is waiting for your approval."
	if action.Type == "user_input" {
		eventType = "input_required"
		title = "Input required"
		body = "A task is waiting for your response."
	}
	if err := enqueuePushNotification(ctx, tx, action.AccountID, action.RunID, "action:"+action.ID, eventType, title, body); err != nil {
		return err
	}
	return nil
}

func scanAgentRun(row scanner) (*biz.AgentRun, error) {
	run := &biz.AgentRun{}
	err := row.Scan(&run.ID, &run.AccountID, &run.SessionID, &run.ExecutionTarget, &run.TargetDeviceID,
		&run.WorkspaceID, &run.Status, &run.RuntimeID, &run.Model, &run.ReasoningEffort,
		&run.PermissionMode, &run.ReturnArtifacts, &run.RuntimeSessionRef, &run.LastEventSeq, &run.StartedAt, &run.CompletedAt,
		&run.ErrorCode, &run.ErrorMessage, &run.CreatedAt, &run.UpdatedAt)
	return run, err
}

func getAgentRunRow(ctx context.Context, db queryRower, accountID, id string, forUpdate bool) (*biz.AgentRun, error) {
	query := `
		SELECT id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
		FROM agent_runs WHERE account_id = $1 AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	return scanAgentRun(db.QueryRow(ctx, query, accountID, id))
}

func getAgentRunTx(ctx context.Context, tx pgx.Tx, accountID, id string, forUpdate bool) (*biz.AgentRun, error) {
	return getAgentRunRow(ctx, tx, accountID, id, forUpdate)
}

func scanAgentRunEvent(row scanner) (*biz.AgentRunEvent, error) {
	event := &biz.AgentRunEvent{}
	var payload []byte
	if err := row.Scan(&event.RunID, &event.AccountID, &event.EventID, &event.Seq, &event.Type,
		&payload, &event.ProducerType, &event.ProducerID, &event.OccurredAt); err != nil {
		return nil, err
	}
	if err := decodeJSON(payload, &event.Payload); err != nil {
		return nil, err
	}
	return event, nil
}

func scanAgentAction(row scanner) (*biz.AgentAction, error) {
	action := &biz.AgentAction{}
	var request, resolution []byte
	if err := row.Scan(&action.ID, &action.AccountID, &action.RunID, &action.EventSeq, &action.Type,
		&action.Status, &request, &resolution, &action.Version, &action.ExpiresAt, &action.ResolvedAt, &action.CreatedAt); err != nil {
		return nil, err
	}
	if err := decodeJSON(request, &action.Request); err != nil {
		return nil, err
	}
	if err := decodeJSON(resolution, &action.Resolution); err != nil {
		return nil, err
	}
	return action, nil
}

func getAgentActionTx(ctx context.Context, tx pgx.Tx, accountID, runID, actionID string, forUpdate bool) (*biz.AgentAction, error) {
	query := `
		SELECT id, account_id, run_id, event_seq, type, status, request_payload,
			resolution_payload, version, expires_at, resolved_at, created_at
		FROM agent_actions WHERE account_id = $1 AND run_id = $2 AND id = $3`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	return scanAgentAction(tx.QueryRow(ctx, query, accountID, runID, actionID))
}

func terminalRunStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

func validRunTransition(from, to string) bool {
	if from == to {
		return true
	}
	if terminalRunStatus(from) {
		return false
	}
	switch to {
	case "running":
		return from == "queued" || from == "waiting_device" || from == "waiting_approval" || from == "waiting_input"
	case "waiting_approval", "waiting_input":
		return from == "running" || from == "queued" || from == "waiting_device"
	case "completed", "failed", "cancelled":
		return true
	case "queued":
		return from == "queued"
	case "waiting_device":
		return from == "waiting_device"
	default:
		return false
	}
}

func runSyncPayload(run *biz.AgentRun) map[string]any {
	return map[string]any{
		"id": run.ID, "session_id": run.SessionID, "execution_target": run.ExecutionTarget,
		"target_device_id": run.TargetDeviceID, "workspace_id": run.WorkspaceID, "status": run.Status,
		"runtime_id": run.RuntimeID, "model": run.Model, "reasoning_effort": run.ReasoningEffort,
		"permission_mode": run.PermissionMode, "runtime_session_ref": run.RuntimeSessionRef,
		"return_artifacts": run.ReturnArtifacts,
		"last_event_seq":   run.LastEventSeq, "started_at": run.StartedAt, "completed_at": run.CompletedAt,
		"error_code": run.ErrorCode, "error_message": run.ErrorMessage, "updated_at": run.UpdatedAt,
	}
}

func eventSyncPayload(event *biz.AgentRunEvent) map[string]any {
	return map[string]any{
		"event_id": event.EventID, "run_id": event.RunID, "seq": event.Seq, "type": event.Type,
		"payload": event.Payload, "producer_type": event.ProducerType, "producer_id": event.ProducerID,
		"occurred_at": event.OccurredAt,
	}
}

func actionSyncPayload(action *biz.AgentAction) map[string]any {
	return map[string]any{
		"id": action.ID, "run_id": action.RunID, "event_seq": action.EventSeq, "type": action.Type,
		"status": action.Status, "request": action.Request, "resolution": action.Resolution,
		"version": action.Version, "expires_at": action.ExpiresAt, "resolved_at": action.ResolvedAt,
	}
}
