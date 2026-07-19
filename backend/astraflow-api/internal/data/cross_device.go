package data

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type crossDeviceRepo struct {
	data *Data
}

func NewCrossDeviceRepo(data *Data) biz.CrossDeviceRepo {
	return &crossDeviceRepo{data: data}
}

func (repo *crossDeviceRepo) EnsureAccount(ctx context.Context, account *biz.Account) (*biz.Account, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	row := repo.data.db.QueryRow(ctx, `
		INSERT INTO accounts (id, provider, subject, email, display_name, tenant_id, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'active')
		ON CONFLICT (provider, subject) DO UPDATE SET
			email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE accounts.email END,
			display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE accounts.display_name END,
			tenant_id = CASE WHEN EXCLUDED.tenant_id <> '' THEN EXCLUDED.tenant_id ELSE accounts.tenant_id END,
			updated_at = now()
		RETURNING id, provider, subject, email, display_name, tenant_id, status, created_at, updated_at
	`, account.ID, account.Provider, account.Subject, account.Email, account.DisplayName, account.TenantID)
	result := &biz.Account{}
	if err := row.Scan(&result.ID, &result.Provider, &result.Subject, &result.Email, &result.DisplayName, &result.TenantID, &result.Status, &result.CreatedAt, &result.UpdatedAt); err != nil {
		return nil, err
	}
	return result, nil
}

func (repo *crossDeviceRepo) RegisterDevice(ctx context.Context, device *biz.Device, mutationID string) (*biz.Device, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, device.AccountID, mutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getDeviceTx(ctx, tx, device.AccountID, existingID)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}

	capabilities, err := encodeJSON(device.Capabilities, `{}`)
	if err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO devices (
			id, account_id, type, name, platform, app_version, protocol_version,
			capabilities, public_key, last_seen_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		ON CONFLICT (id) DO UPDATE SET
			type = EXCLUDED.type, name = EXCLUDED.name, platform = EXCLUDED.platform,
			app_version = EXCLUDED.app_version, protocol_version = EXCLUDED.protocol_version,
			capabilities = EXCLUDED.capabilities, public_key = EXCLUDED.public_key,
			last_seen_at = now(), version = devices.version + 1, updated_at = now()
		WHERE devices.account_id = EXCLUDED.account_id AND devices.revoked_at IS NULL
		RETURNING id, account_id, type, name, platform, app_version, protocol_version,
			capabilities, public_key, last_seen_at, revoked_at, version, created_at, updated_at
	`, device.ID, device.AccountID, device.Type, device.Name, device.Platform, device.AppVersion,
		device.ProtocolVersion, capabilities, device.PublicKey)
	result, err := scanDevice(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, result.AccountID, "device", result.ID, "device.upserted", result.Version, deviceSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, result.AccountID, mutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ListDevices(ctx context.Context, accountID string, includeRevoked bool) ([]*biz.Device, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, type, name, platform, app_version, protocol_version,
			capabilities, public_key, last_seen_at, revoked_at, version, created_at, updated_at
		FROM devices
		WHERE account_id = $1 AND ($2 OR revoked_at IS NULL)
		ORDER BY revoked_at NULLS FIRST, last_seen_at DESC, id
	`, accountID, includeRevoked)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	devices := make([]*biz.Device, 0)
	for rows.Next() {
		device, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (repo *crossDeviceRepo) RevokeDevice(ctx context.Context, accountID, deviceID string, expectedVersion int64) (*biz.Device, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		UPDATE devices SET revoked_at = COALESCE(revoked_at, now()), version = version + 1, updated_at = now()
		WHERE id = $1 AND account_id = $2 AND version = $3 AND revoked_at IS NULL
		RETURNING id, account_id, type, name, platform, app_version, protocol_version,
			capabilities, public_key, last_seen_at, revoked_at, version, created_at, updated_at
	`, deviceID, accountID, expectedVersion)
	result, err := scanDevice(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, lookupErr := getDeviceTx(ctx, tx, accountID, deviceID); errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, biz.ErrCrossDeviceNotFound
		}
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE push_endpoints SET enabled = false, updated_at = now() WHERE account_id = $1 AND device_id = $2`, accountID, deviceID); err != nil {
		return nil, err
	}
	runRows, err := tx.Query(ctx, `
		UPDATE agent_runs SET
			status = 'cancelled', completed_at = COALESCE(completed_at, now()),
			error_code = 'DEVICE_REVOKED',
			error_message = 'The target Desktop device was revoked.',
			updated_at = now()
		WHERE account_id = $1 AND target_device_id = $2
			AND status IN ('queued', 'waiting_device', 'running', 'waiting_approval', 'waiting_input')
		RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
	`, accountID, deviceID)
	if err != nil {
		return nil, err
	}
	cancelledRuns := make([]*biz.AgentRun, 0)
	for runRows.Next() {
		run, scanErr := scanAgentRun(runRows)
		if scanErr != nil {
			runRows.Close()
			return nil, scanErr
		}
		cancelledRuns = append(cancelledRuns, run)
	}
	if err := runRows.Err(); err != nil {
		runRows.Close()
		return nil, err
	}
	runRows.Close()
	for _, run := range cancelledRuns {
		if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.updated", run.LastEventSeq, runSyncPayload(run)); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE device_commands SET status = 'cancelled', completed_at = now() WHERE account_id = $1 AND device_id = $2 AND status IN ('pending', 'leased')`, accountID, deviceID); err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "device", deviceID, "device.revoked", result.Version, deviceSyncPayload(result)); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) IssueDeviceConnectionToken(ctx context.Context, accountID, deviceID string, tokenHash [32]byte, expiresAt time.Time) error {
	if repo.data.db == nil {
		return fmt.Errorf("database is not configured")
	}
	result, err := repo.data.db.Exec(ctx, `
		INSERT INTO device_connection_tokens (token_hash, account_id, device_id, expires_at)
		SELECT $1, account_id, id, $4
		FROM devices
		WHERE account_id = $2 AND id = $3 AND type = 'desktop' AND revoked_at IS NULL
	`, tokenHash[:], accountID, deviceID, expiresAt)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return biz.ErrCrossDeviceNotFound
	}
	_, _ = repo.data.db.Exec(ctx, `DELETE FROM device_connection_tokens WHERE expires_at < now() - interval '5 minutes'`)
	return nil
}

func (repo *crossDeviceRepo) ConsumeDeviceConnectionToken(ctx context.Context, tokenHash [32]byte) (*biz.DeviceConnectionIdentity, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	identity := &biz.DeviceConnectionIdentity{}
	err = tx.QueryRow(ctx, `
		UPDATE device_connection_tokens
		SET used_at = now()
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING account_id, device_id
	`, tokenHash[:]).Scan(&identity.AccountID, &identity.DeviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		SELECT public_key
		FROM devices
		WHERE account_id = $1 AND id = $2 AND type = 'desktop' AND revoked_at IS NULL
	`, identity.AccountID, identity.DeviceID).Scan(&identity.PublicKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	return identity, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ClaimDeviceCommands(ctx context.Context, accountID, deviceID string, limit int) ([]*biz.DeviceCommand, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, `
		WITH candidates AS (
			SELECT id
			FROM device_commands
			WHERE account_id = $1 AND device_id = $2
				AND (
					status = 'pending'
					OR (status IN ('leased', 'acknowledged') AND lease_expires_at < now())
				)
			ORDER BY created_at, id
			LIMIT $3
			FOR UPDATE SKIP LOCKED
		), claimed AS (
			UPDATE device_commands AS command SET
				status = 'leased', attempts = command.attempts + 1,
				lease_expires_at = now() + interval '30 seconds'
			FROM candidates
			WHERE command.id = candidates.id
			RETURNING command.id, command.account_id, command.device_id,
				COALESCE(command.run_id, ''), command.type, command.payload,
				command.status, command.attempts, command.created_at
		)
		SELECT * FROM claimed ORDER BY created_at, id
	`, accountID, deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	commands := make([]*biz.DeviceCommand, 0, limit)
	for rows.Next() {
		command := &biz.DeviceCommand{}
		var payload []byte
		if err := rows.Scan(&command.ID, &command.AccountID, &command.DeviceID, &command.RunID,
			&command.Type, &payload, &command.Status, &command.Attempts, &command.CreatedAt); err != nil {
			return nil, err
		}
		if err := decodeJSON(payload, &command.Payload); err != nil {
			return nil, err
		}
		commands = append(commands, command)
	}
	return commands, rows.Err()
}

func (repo *crossDeviceRepo) UpdateDeviceCommand(ctx context.Context, accountID, deviceID, commandID, status string, result map[string]any) error {
	tx, err := repo.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	encoded, err := encodeJSON(result, `{}`)
	if err != nil {
		return err
	}
	var commandType, runID string
	err = tx.QueryRow(ctx, `
		UPDATE device_commands SET
			status = $4, result = $5,
			acknowledged_at = CASE WHEN $4 = 'acknowledged' THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
			completed_at = CASE WHEN $4 IN ('completed', 'failed') THEN COALESCE(completed_at, now()) ELSE completed_at END,
			lease_expires_at = CASE
				WHEN $4 = 'acknowledged' THEN now() + interval '60 seconds'
				ELSE NULL
			END
		WHERE account_id = $1 AND device_id = $2 AND id = $3
			AND (
				(status = 'leased' AND $4 IN ('acknowledged', 'completed', 'failed'))
				OR (status = 'acknowledged' AND $4 IN ('completed', 'failed'))
				OR status = $4
			)
		RETURNING type, COALESCE(run_id, '')
	`, accountID, deviceID, commandID, status, encoded).Scan(&commandType, &runID)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "device_command", commandID, "device_command."+status, 1, map[string]any{
		"id": commandID, "device_id": deviceID, "status": status, "result": result,
	}); err != nil {
		return err
	}
	if status == "failed" && commandType == "start_run" && runID != "" {
		row := tx.QueryRow(ctx, `
			UPDATE agent_runs SET
				status = 'failed', completed_at = COALESCE(completed_at, now()),
				error_code = 'DESKTOP_RUN_START_FAILED',
				error_message = 'Desktop could not start the requested Agent run.',
				updated_at = now()
			WHERE account_id = $1 AND id = $2
				AND status IN ('queued', 'waiting_device', 'running')
			RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
				COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
				permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
				error_code, error_message, created_at, updated_at
		`, accountID, runID)
		run, runErr := scanAgentRun(row)
		if runErr != nil && !errors.Is(runErr, pgx.ErrNoRows) {
			return runErr
		}
		if runErr == nil {
			if err := appendSyncEvent(ctx, tx, accountID, "agent_run", run.ID, "agent_run.updated", run.LastEventSeq, runSyncPayload(run)); err != nil {
				return err
			}
			if err := enqueuePushNotification(ctx, tx, accountID, run.ID, "run:"+run.ID+":failed", "run_failed", "Task needs attention", "Open AstraFlow to review the task."); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func (repo *crossDeviceRepo) TouchDevice(ctx context.Context, accountID, deviceID string) error {
	if repo.data.db == nil {
		return fmt.Errorf("database is not configured")
	}
	result, err := repo.data.db.Exec(ctx, `
		UPDATE devices SET last_seen_at = now(), updated_at = now()
		WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL
	`, accountID, deviceID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return biz.ErrCrossDeviceNotFound
	}
	return nil
}

func (repo *crossDeviceRepo) UpsertPushEndpoint(ctx context.Context, endpoint *biz.PushEndpoint) (*biz.PushEndpoint, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := ensureOwnedDevice(ctx, tx, endpoint.AccountID, endpoint.DeviceID, false); err != nil {
		return nil, err
	}
	ciphertext, nonce, err := encryptPushToken(endpoint.Token)
	if err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO push_endpoints (id, account_id, device_id, provider, token_ciphertext, token_nonce, locale, enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (device_id, provider) DO UPDATE SET
			token_ciphertext = EXCLUDED.token_ciphertext, token_nonce = EXCLUDED.token_nonce,
			locale = EXCLUDED.locale, enabled = EXCLUDED.enabled, updated_at = now()
		WHERE push_endpoints.account_id = EXCLUDED.account_id
		RETURNING id, account_id, device_id, provider, locale, enabled, created_at, updated_at
	`, endpoint.ID, endpoint.AccountID, endpoint.DeviceID, endpoint.Provider, ciphertext, nonce, endpoint.Locale, endpoint.Enabled)
	result := &biz.PushEndpoint{}
	if err := row.Scan(&result.ID, &result.AccountID, &result.DeviceID, &result.Provider, &result.Locale, &result.Enabled, &result.CreatedAt, &result.UpdatedAt); errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	} else if err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, endpoint.AccountID, "push_endpoint", result.ID, "push_endpoint.upserted", 1, map[string]any{
		"id": result.ID, "device_id": result.DeviceID, "provider": result.Provider, "locale": result.Locale, "enabled": result.Enabled,
	}); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) CreateWorkspace(ctx context.Context, workspace *biz.Workspace) (*biz.Workspace, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, workspace.AccountID, workspace.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getWorkspaceTx(ctx, tx, workspace.AccountID, existingID)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, workspace.AccountID, workspace.SourceDeviceID, true); err != nil {
		return nil, err
	}
	if err := ensureOwnedProject(ctx, tx, workspace.AccountID, workspace.ProjectID, true); err != nil {
		return nil, err
	}
	if workspace.OwnerDeviceID != "" {
		if err := ensureTargetDesktop(ctx, tx, workspace.AccountID, workspace.OwnerDeviceID); err != nil {
			return nil, err
		}
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO workspaces (
			id, account_id, project_id, type, name, gateway_protocol_version, state, owner_device_id
		) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, NULLIF($8, ''))
		RETURNING id, account_id, COALESCE(project_id, ''), type, name, sandbox_id,
			gateway_protocol_version, state, COALESCE(owner_device_id, ''), created_at, updated_at
	`, workspace.ID, workspace.AccountID, workspace.ProjectID, workspace.Type, workspace.Name,
		workspace.GatewayProtocolVersion, workspace.State, workspace.OwnerDeviceID)
	result, err := scanWorkspace(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if err := appendSyncEvent(ctx, tx, result.AccountID, "workspace", result.ID, "workspace.created", 1, workspaceSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, result.AccountID, workspace.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ListWorkspaces(ctx context.Context, accountID string, includeUnavailable bool) ([]*biz.Workspace, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, COALESCE(project_id, ''), type, name, sandbox_id,
			gateway_protocol_version, state, COALESCE(owner_device_id, ''), created_at, updated_at
		FROM workspaces
		WHERE account_id = $1 AND state <> 'deleted' AND ($2 OR state <> 'unavailable')
		ORDER BY updated_at DESC, id
	`, accountID, includeUnavailable)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*biz.Workspace, 0)
	for rows.Next() {
		workspace, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, workspace)
	}
	return items, rows.Err()
}

func (repo *crossDeviceRepo) GetWorkspace(ctx context.Context, accountID, workspaceID string) (*biz.Workspace, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := getWorkspaceRow(ctx, repo.data.db, accountID, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *crossDeviceRepo) CreateSession(ctx context.Context, session *biz.Session) (*biz.Session, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, session.AccountID, session.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getSessionTx(ctx, tx, session.AccountID, existingID)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, session.AccountID, session.SourceDeviceID, true); err != nil {
		return nil, err
	}
	if err := ensureOwnedWorkspace(ctx, tx, session.AccountID, session.WorkspaceID, true); err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO sessions (
			id, account_id, workspace_id, mode, title, runtime_id, model, reasoning_effort, permission_mode
		) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9)
		RETURNING id, account_id, COALESCE(workspace_id, ''), mode, title, runtime_id, model,
			reasoning_effort, permission_mode, version, pinned_at, archived_at, created_at, updated_at, deleted_at
	`, session.ID, session.AccountID, session.WorkspaceID, session.Mode, session.Title, session.RuntimeID,
		session.Model, session.ReasoningEffort, session.PermissionMode)
	result, err := scanSession(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if err := appendSyncEvent(ctx, tx, session.AccountID, "session", result.ID, "session.created", result.Version, sessionSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, session.AccountID, session.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ListSessions(ctx context.Context, accountID string, options biz.SessionListOptions) ([]*biz.Session, bool, error) {
	if repo.data.db == nil {
		return nil, false, fmt.Errorf("database is not configured")
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, COALESCE(workspace_id, ''), mode, title, runtime_id, model,
			reasoning_effort, permission_mode, version, pinned_at, archived_at, created_at, updated_at, deleted_at
		FROM sessions
		WHERE account_id = $1 AND deleted_at IS NULL AND ($2 OR archived_at IS NULL)
		ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id
		LIMIT $3 OFFSET $4
	`, accountID, options.IncludeArchived, options.Limit+1, options.Offset)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]*biz.Session, 0, options.Limit+1)
	for rows.Next() {
		item, err := scanSession(rows)
		if err != nil {
			return nil, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(items) > options.Limit
	if hasMore {
		items = items[:options.Limit]
	}
	return items, hasMore, nil
}

func (repo *crossDeviceRepo) GetSession(ctx context.Context, accountID, sessionID string) (*biz.Session, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result, err := getSessionRow(ctx, repo.data.db, accountID, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceNotFound
	}
	return result, err
}

func (repo *crossDeviceRepo) UpdateSession(ctx context.Context, accountID string, update biz.SessionUpdate) (*biz.Session, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, accountID, update.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getSessionTx(ctx, tx, accountID, existingID)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, accountID, update.SourceDeviceID, true); err != nil {
		return nil, err
	}
	if update.WorkspaceID != nil {
		if err := ensureOwnedWorkspace(ctx, tx, accountID, *update.WorkspaceID, true); err != nil {
			return nil, err
		}
	}
	row := tx.QueryRow(ctx, `
		UPDATE sessions SET
			title = COALESCE($4::text, title),
			pinned_at = CASE WHEN $5::boolean IS NULL THEN pinned_at WHEN $5 THEN COALESCE(pinned_at, now()) ELSE NULL END,
			archived_at = CASE WHEN $6::boolean IS NULL THEN archived_at WHEN $6 THEN COALESCE(archived_at, now()) ELSE NULL END,
			model = COALESCE($7::text, model),
			reasoning_effort = COALESCE($8::text, reasoning_effort),
			permission_mode = COALESCE($9::text, permission_mode),
			workspace_id = CASE WHEN $10::text IS NULL THEN workspace_id ELSE NULLIF($10, '') END,
			runtime_id = COALESCE($11::text, runtime_id),
			version = version + 1, updated_at = now()
		WHERE id = $1 AND account_id = $2 AND version = $3 AND deleted_at IS NULL
		RETURNING id, account_id, COALESCE(workspace_id, ''), mode, title, runtime_id, model,
			reasoning_effort, permission_mode, version, pinned_at, archived_at, created_at, updated_at, deleted_at
	`, update.SessionID, accountID, update.ExpectedVersion, update.Title, update.Pinned, update.Archived,
		update.Model, update.ReasoningEffort, update.PermissionMode, update.WorkspaceID, update.RuntimeID)
	result, err := scanSession(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, lookupErr := getSessionTx(ctx, tx, accountID, update.SessionID); errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, biz.ErrCrossDeviceNotFound
		}
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, accountID, "session", result.ID, "session.updated", result.Version, sessionSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, accountID, update.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) CreateMessage(ctx context.Context, message *biz.Message) (*biz.Message, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if existingID, ok, err := beginMutation(ctx, tx, message.AccountID, message.ClientMutationID); err != nil {
		return nil, err
	} else if ok {
		result, err := getMessageTx(ctx, tx, message.AccountID, existingID)
		if err != nil {
			return nil, err
		}
		return result, tx.Commit(ctx)
	}
	if err := ensureOwnedDevice(ctx, tx, message.AccountID, message.SourceDeviceID, true); err != nil {
		return nil, err
	}
	if err := ensureOwnedSession(ctx, tx, message.AccountID, message.SessionID); err != nil {
		return nil, err
	}
	content, err := encodeJSON(message.Content, `{}`)
	if err != nil {
		return nil, err
	}
	parts, err := encodeJSON(message.Parts, `[]`)
	if err != nil {
		return nil, err
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO messages (
			id, account_id, session_id, role, status, content_projection, parts_projection,
			client_mutation_id, source_device_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''))
		RETURNING id, account_id, session_id, role, status, content_projection,
			parts_projection, client_mutation_id, COALESCE(source_device_id, ''), created_at, updated_at
	`, message.ID, message.AccountID, message.SessionID, message.Role, message.Status, content, parts,
		message.ClientMutationID, message.SourceDeviceID)
	result, err := scanMessage(row)
	if err != nil {
		return nil, normalizeConstraintError(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET updated_at = now() WHERE id = $1 AND account_id = $2`, result.SessionID, result.AccountID); err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, result.AccountID, "message", result.ID, "message.created", 1, messageSyncPayload(result)); err != nil {
		return nil, err
	}
	if err := finishMutation(ctx, tx, result.AccountID, message.ClientMutationID, result.ID); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (repo *crossDeviceRepo) ListMessages(ctx context.Context, accountID, sessionID string, options biz.MessageListOptions) ([]*biz.Message, bool, error) {
	if repo.data.db == nil {
		return nil, false, fmt.Errorf("database is not configured")
	}
	if _, err := getSessionRow(ctx, repo.data.db, accountID, sessionID); errors.Is(err, pgx.ErrNoRows) {
		return nil, false, biz.ErrCrossDeviceNotFound
	} else if err != nil {
		return nil, false, err
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT id, account_id, session_id, role, status, content_projection,
			parts_projection, client_mutation_id, COALESCE(source_device_id, ''), created_at, updated_at
		FROM messages
		WHERE account_id = $1 AND session_id = $2
		ORDER BY created_at DESC, id DESC
		OFFSET $3 LIMIT $4
	`, accountID, sessionID, options.Offset, options.Limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]*biz.Message, 0, options.Limit+1)
	for rows.Next() {
		item, err := scanMessage(rows)
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

func (repo *crossDeviceRepo) PullSyncEvents(ctx context.Context, accountID string, after int64, limit int) ([]*biz.SyncEvent, bool, bool, error) {
	if repo.data.db == nil {
		return nil, false, false, fmt.Errorf("database is not configured")
	}
	var oldest, latest int64
	if err := repo.data.db.QueryRow(ctx, `
		SELECT COALESCE(min(cursor), 0), COALESCE(max(cursor), 0)
		FROM sync_events WHERE account_id = $1
	`, accountID).Scan(&oldest, &latest); err != nil {
		return nil, false, false, err
	}
	if after > 0 && ((oldest > 0 && after < oldest) || after > latest) {
		return nil, false, true, nil
	}
	rows, err := repo.data.db.Query(ctx, `
		SELECT cursor, event_id, account_id, aggregate_type, aggregate_id, entity_version,
			event_type, payload, created_at
		FROM sync_events
		WHERE account_id = $1 AND cursor > $2
		ORDER BY cursor
		LIMIT $3
	`, accountID, after, limit+1)
	if err != nil {
		return nil, false, false, err
	}
	defer rows.Close()
	events := make([]*biz.SyncEvent, 0, limit+1)
	for rows.Next() {
		event := &biz.SyncEvent{SchemaVersion: 1}
		var payload []byte
		if err := rows.Scan(&event.Cursor, &event.EventID, &event.AccountID, &event.AggregateType, &event.AggregateID,
			&event.EntityVersion, &event.EventType, &payload, &event.OccurredAt); err != nil {
			return nil, false, false, err
		}
		if err := decodeJSON(payload, &event.Payload); err != nil {
			return nil, false, false, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, false, false, err
	}
	hasMore := len(events) > limit
	if hasMore {
		events = events[:limit]
	}
	return events, hasMore, false, nil
}

func (repo *crossDeviceRepo) LatestSyncCursor(ctx context.Context, accountID string) (int64, error) {
	if repo.data.db == nil {
		return 0, fmt.Errorf("database is not configured")
	}
	var cursor int64
	err := repo.data.db.QueryRow(ctx, `SELECT COALESCE(max(cursor), 0) FROM sync_events WHERE account_id = $1`, accountID).Scan(&cursor)
	return cursor, err
}

func (repo *crossDeviceRepo) begin(ctx context.Context) (pgx.Tx, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	return repo.data.db.BeginTx(ctx, pgx.TxOptions{})
}

type scanner interface {
	Scan(...any) error
}

func scanDevice(row scanner) (*biz.Device, error) {
	device := &biz.Device{}
	var capabilities []byte
	err := row.Scan(&device.ID, &device.AccountID, &device.Type, &device.Name, &device.Platform,
		&device.AppVersion, &device.ProtocolVersion, &capabilities, &device.PublicKey,
		&device.LastSeenAt, &device.RevokedAt, &device.Version, &device.CreatedAt, &device.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if err := decodeJSON(capabilities, &device.Capabilities); err != nil {
		return nil, err
	}
	return device, nil
}

func getDeviceTx(ctx context.Context, tx pgx.Tx, accountID, id string) (*biz.Device, error) {
	return scanDevice(tx.QueryRow(ctx, `
		SELECT id, account_id, type, name, platform, app_version, protocol_version,
			capabilities, public_key, last_seen_at, revoked_at, version, created_at, updated_at
		FROM devices WHERE account_id = $1 AND id = $2
	`, accountID, id))
}

func scanSession(row scanner) (*biz.Session, error) {
	session := &biz.Session{}
	err := row.Scan(&session.ID, &session.AccountID, &session.WorkspaceID, &session.Mode, &session.Title,
		&session.RuntimeID, &session.Model, &session.ReasoningEffort, &session.PermissionMode,
		&session.Version, &session.PinnedAt, &session.ArchivedAt, &session.CreatedAt, &session.UpdatedAt, &session.DeletedAt)
	return session, err
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getSessionRow(ctx context.Context, db queryRower, accountID, id string) (*biz.Session, error) {
	return scanSession(db.QueryRow(ctx, `
		SELECT id, account_id, COALESCE(workspace_id, ''), mode, title, runtime_id, model,
			reasoning_effort, permission_mode, version, pinned_at, archived_at, created_at, updated_at, deleted_at
		FROM sessions WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL
	`, accountID, id))
}

func getSessionTx(ctx context.Context, tx pgx.Tx, accountID, id string) (*biz.Session, error) {
	return getSessionRow(ctx, tx, accountID, id)
}

func scanMessage(row scanner) (*biz.Message, error) {
	message := &biz.Message{}
	var content, parts []byte
	err := row.Scan(&message.ID, &message.AccountID, &message.SessionID, &message.Role, &message.Status,
		&content, &parts, &message.ClientMutationID, &message.SourceDeviceID, &message.CreatedAt, &message.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if err := decodeJSON(content, &message.Content); err != nil {
		return nil, err
	}
	if err := decodeJSON(parts, &message.Parts); err != nil {
		return nil, err
	}
	return message, nil
}

func getMessageTx(ctx context.Context, tx pgx.Tx, accountID, id string) (*biz.Message, error) {
	return scanMessage(tx.QueryRow(ctx, `
		SELECT id, account_id, session_id, role, status, content_projection,
			parts_projection, client_mutation_id, COALESCE(source_device_id, ''), created_at, updated_at
		FROM messages WHERE account_id = $1 AND id = $2
	`, accountID, id))
}

func scanWorkspace(row scanner) (*biz.Workspace, error) {
	workspace := &biz.Workspace{}
	err := row.Scan(&workspace.ID, &workspace.AccountID, &workspace.ProjectID, &workspace.Type,
		&workspace.Name, &workspace.SandboxID, &workspace.GatewayProtocolVersion, &workspace.State,
		&workspace.OwnerDeviceID, &workspace.CreatedAt, &workspace.UpdatedAt)
	return workspace, err
}

func getWorkspaceRow(ctx context.Context, db queryRower, accountID, workspaceID string) (*biz.Workspace, error) {
	return scanWorkspace(db.QueryRow(ctx, `
		SELECT id, account_id, COALESCE(project_id, ''), type, name, sandbox_id,
			gateway_protocol_version, state, COALESCE(owner_device_id, ''), created_at, updated_at
		FROM workspaces WHERE account_id = $1 AND id = $2 AND state <> 'deleted'
	`, accountID, workspaceID))
}

func getWorkspaceTx(ctx context.Context, tx pgx.Tx, accountID, workspaceID string) (*biz.Workspace, error) {
	return getWorkspaceRow(ctx, tx, accountID, workspaceID)
}

func ensureOwnedDevice(ctx context.Context, tx pgx.Tx, accountID, deviceID string, optional bool) error {
	if deviceID == "" && optional {
		return nil
	}
	var found bool
	err := tx.QueryRow(ctx, `SELECT true FROM devices WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`, accountID, deviceID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	return err
}

func ensureOwnedWorkspace(ctx context.Context, tx pgx.Tx, accountID, workspaceID string, optional bool) error {
	if workspaceID == "" && optional {
		return nil
	}
	var found bool
	err := tx.QueryRow(ctx, `SELECT true FROM workspaces WHERE account_id = $1 AND id = $2 AND state <> 'deleted'`, accountID, workspaceID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	return err
}

func ensureOwnedProject(ctx context.Context, tx pgx.Tx, accountID, projectID string, optional bool) error {
	if projectID == "" && optional {
		return nil
	}
	var found bool
	err := tx.QueryRow(ctx, `SELECT true FROM projects WHERE account_id = $1 AND id = $2`, accountID, projectID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	return err
}

func ensureOwnedSession(ctx context.Context, tx pgx.Tx, accountID, sessionID string) error {
	var found bool
	err := tx.QueryRow(ctx, `SELECT true FROM sessions WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`, accountID, sessionID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return biz.ErrCrossDeviceNotFound
	}
	return err
}

func beginMutation(ctx context.Context, tx pgx.Tx, accountID, mutationID string) (string, bool, error) {
	if mutationID == "" {
		return "", false, nil
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, accountID+":"+mutationID); err != nil {
		return "", false, err
	}
	var result []byte
	err := tx.QueryRow(ctx, `SELECT result FROM client_mutations WHERE account_id = $1 AND client_mutation_id = $2`, accountID, mutationID).Scan(&result)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	decoded := struct {
		EntityID string `json:"entity_id"`
	}{}
	if err := json.Unmarshal(result, &decoded); err != nil || decoded.EntityID == "" {
		return "", false, fmt.Errorf("invalid stored client mutation result")
	}
	return decoded.EntityID, true, nil
}

func finishMutation(ctx context.Context, tx pgx.Tx, accountID, mutationID, entityID string) error {
	if mutationID == "" {
		return nil
	}
	result, err := json.Marshal(map[string]string{"entity_id": entityID})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO client_mutations (account_id, client_mutation_id, result)
		VALUES ($1, $2, $3)
	`, accountID, mutationID, result)
	return err
}

func appendSyncEvent(ctx context.Context, tx pgx.Tx, accountID, aggregateType, aggregateID, eventType string, version int64, payload any) error {
	encoded, err := encodeJSON(payload, `{}`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO sync_events (
			event_id, account_id, aggregate_type, aggregate_id, event_type, entity_version, payload
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, uuid.NewString(), accountID, aggregateType, aggregateID, eventType, version, encoded)
	return err
}

func encodeJSON(value any, fallback string) ([]byte, error) {
	if value == nil {
		return []byte(fallback), nil
	}
	return json.Marshal(value)
}

func decodeJSON(data []byte, target any) error {
	if len(data) == 0 {
		data = []byte(`{}`)
	}
	return json.Unmarshal(data, target)
}

func normalizeConstraintError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "violates unique constraint") {
		return biz.ErrCrossDeviceConflict
	}
	if strings.Contains(err.Error(), "violates foreign key constraint") {
		return biz.ErrCrossDeviceNotFound
	}
	return err
}

func deviceSyncPayload(device *biz.Device) map[string]any {
	return map[string]any{
		"id": device.ID, "type": device.Type, "name": device.Name, "platform": device.Platform,
		"app_version": device.AppVersion, "protocol_version": device.ProtocolVersion,
		"capabilities": device.Capabilities, "last_seen_at": device.LastSeenAt,
		"revoked_at": device.RevokedAt, "version": device.Version,
	}
}

func sessionSyncPayload(session *biz.Session) map[string]any {
	return map[string]any{
		"id": session.ID, "workspace_id": session.WorkspaceID, "mode": session.Mode, "title": session.Title,
		"runtime_id": session.RuntimeID, "model": session.Model, "reasoning_effort": session.ReasoningEffort,
		"permission_mode": session.PermissionMode, "version": session.Version, "pinned_at": session.PinnedAt,
		"archived_at": session.ArchivedAt, "updated_at": session.UpdatedAt,
	}
}

func messageSyncPayload(message *biz.Message) map[string]any {
	return map[string]any{
		"id": message.ID, "session_id": message.SessionID, "role": message.Role, "status": message.Status,
		"content": message.Content, "parts": message.Parts, "created_at": message.CreatedAt,
	}
}

func workspaceSyncPayload(workspace *biz.Workspace) map[string]any {
	return map[string]any{
		"id": workspace.ID, "project_id": workspace.ProjectID, "type": workspace.Type, "name": workspace.Name,
		"sandbox_id": workspace.SandboxID, "gateway_protocol_version": workspace.GatewayProtocolVersion,
		"state": workspace.State, "owner_device_id": workspace.OwnerDeviceID, "updated_at": workspace.UpdatedAt,
	}
}

func encryptPushToken(token string) ([]byte, []byte, error) {
	key, err := pushTokenEncryptionKey()
	if err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return aead.Seal(nil, nonce, []byte(token), nil), nonce, nil
}

func decryptPushToken(ciphertext, nonce []byte) (string, error) {
	key, err := pushTokenEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(nonce) != aead.NonceSize() {
		return "", errors.New("push token nonce is invalid")
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("push token could not be decrypted")
	}
	return string(plaintext), nil
}

func pushTokenEncryptionKey() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("ASTRAFLOW_PUSH_TOKEN_SECRET_KEY"))
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("ASTRAFLOW_PUSH_TOKEN_SECRET_KEY must be a base64-encoded 32-byte key")
	}
	return key, nil
}
