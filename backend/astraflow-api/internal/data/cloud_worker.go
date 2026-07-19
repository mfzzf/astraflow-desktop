package data

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	"github.com/jackc/pgx/v5"
)

type cloudWorkerRepo struct {
	data *Data
}

func NewCloudWorkerRepo(data *Data) biz.CloudWorkerRepo {
	return &cloudWorkerRepo{data: data}
}

func (repo *cloudWorkerRepo) ClaimCloudWorkspace(ctx context.Context, workerID string, tokenHash [sha256.Size]byte, expiresAt time.Time) (*biz.CloudWorkspaceLease, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	workspace := &biz.Workspace{}
	var repository []byte
	row := repo.data.db.QueryRow(ctx, `
		WITH candidate AS (
			SELECT id FROM workspaces
			WHERE type = 'sandbox' AND state = 'creating'
				AND (lease_expires_at IS NULL OR lease_expires_at <= now())
			ORDER BY created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE workspaces workspace SET
			lease_owner = $1, lease_expires_at = $2, lease_token_hash = $3,
			last_error = '', updated_at = now()
		FROM candidate
		WHERE workspace.id = candidate.id
		RETURNING workspace.id, workspace.account_id, COALESCE(workspace.project_id, ''),
			workspace.type, workspace.name, workspace.sandbox_id,
			workspace.gateway_protocol_version, workspace.state,
			COALESCE(workspace.owner_device_id, ''), workspace.created_at, workspace.updated_at,
			COALESCE((SELECT project.repo_metadata FROM projects project WHERE project.id = workspace.project_id), '{}'::jsonb)
	`, workerID, expiresAt, tokenHash[:])
	if err := row.Scan(&workspace.ID, &workspace.AccountID, &workspace.ProjectID, &workspace.Type,
		&workspace.Name, &workspace.SandboxID, &workspace.GatewayProtocolVersion, &workspace.State,
		&workspace.OwnerDeviceID, &workspace.CreatedAt, &workspace.UpdatedAt, &repository); errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCloudWorkerNoWork
	} else if err != nil {
		return nil, err
	}
	metadata := map[string]any{}
	if err := decodeJSON(repository, &metadata); err != nil {
		return nil, err
	}
	return &biz.CloudWorkspaceLease{Workspace: workspace, AccountID: workspace.AccountID, Repository: metadata, LeaseExpiresAt: expiresAt}, nil
}

func (repo *cloudWorkerRepo) CompleteCloudWorkspace(ctx context.Context, workspaceID, workerID string, tokenHash [sha256.Size]byte, state, sandboxID, errorMessage string) (*biz.Workspace, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		UPDATE workspaces SET
			state = $4, sandbox_id = CASE WHEN $4 = 'ready' THEN $5 ELSE sandbox_id END,
			last_error = $6, lease_owner = '', lease_expires_at = NULL,
			lease_token_hash = NULL, updated_at = now()
		WHERE id = $1 AND lease_owner = $2 AND lease_token_hash = $3
			AND lease_expires_at > now() AND type = 'sandbox' AND state = 'creating'
		RETURNING id, account_id, COALESCE(project_id, ''), type, name, sandbox_id,
			gateway_protocol_version, state, COALESCE(owner_device_id, ''), created_at, updated_at
	`, workspaceID, workerID, tokenHash[:], state, sandboxID, errorMessage)
	workspace, err := scanWorkspace(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendSyncEvent(ctx, tx, workspace.AccountID, "workspace", workspace.ID, "workspace.updated", 1, workspaceSyncPayload(workspace)); err != nil {
		return nil, err
	}
	return workspace, tx.Commit(ctx)
}

func (repo *cloudWorkerRepo) ClaimCloudRun(ctx context.Context, workerID string, tokenHash [sha256.Size]byte, expiresAt time.Time) (*biz.CloudRunLease, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		WITH candidate AS (
			SELECT run.id FROM agent_runs run
			JOIN workspaces workspace ON workspace.id = run.workspace_id AND workspace.account_id = run.account_id
			WHERE run.execution_target = 'cloud'
				AND run.status IN ('queued', 'running', 'waiting_approval', 'waiting_input')
				AND workspace.type = 'sandbox' AND workspace.state = 'ready'
				AND (run.lease_expires_at IS NULL OR run.lease_expires_at <= now())
			ORDER BY run.created_at, run.id
			FOR UPDATE OF run SKIP LOCKED
			LIMIT 1
		)
		UPDATE agent_runs run SET
			lease_owner = $1, lease_expires_at = $2, lease_token_hash = $3,
			status = CASE WHEN run.status = 'queued' THEN 'running' ELSE run.status END,
			started_at = COALESCE(run.started_at, now()), updated_at = now()
		FROM candidate
		WHERE run.id = candidate.id
		RETURNING run.id, run.account_id, run.session_id, run.execution_target,
			COALESCE(run.target_device_id, ''), COALESCE(run.workspace_id, ''), run.status,
			run.runtime_id, run.model, run.reasoning_effort, run.permission_mode,
			run.return_artifacts, run.runtime_session_ref, run.last_event_seq, run.started_at, run.completed_at,
			run.error_code, run.error_message, run.created_at, run.updated_at
	`, workerID, expiresAt, tokenHash[:])
	run, err := scanAgentRun(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCloudWorkerNoWork
	}
	if err != nil {
		return nil, err
	}
	lease, err := loadCloudRunLease(ctx, tx, run)
	if err != nil {
		return nil, err
	}
	lease.LeaseExpiresAt = expiresAt
	if err := appendSyncEvent(ctx, tx, run.AccountID, "agent_run", run.ID, "agent_run.leased", run.LastEventSeq, runSyncPayload(run)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return lease, nil
}

func (repo *cloudWorkerRepo) RenewCloudRun(ctx context.Context, runID, workerID string, tokenHash [sha256.Size]byte, expiresAt time.Time) (*biz.CloudRunLeaseState, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `
		UPDATE agent_runs SET
			lease_expires_at = CASE WHEN status IN ('completed', 'failed', 'cancelled') THEN lease_expires_at ELSE $4 END,
			updated_at = CASE WHEN status IN ('completed', 'failed', 'cancelled') THEN updated_at ELSE now() END
		WHERE id = $1 AND lease_owner = $2 AND lease_token_hash = $3 AND lease_expires_at > now()
		RETURNING id, account_id, session_id, execution_target, COALESCE(target_device_id, ''),
			COALESCE(workspace_id, ''), status, runtime_id, model, reasoning_effort,
			permission_mode, return_artifacts, runtime_session_ref, last_event_seq, started_at, completed_at,
			error_code, error_message, created_at, updated_at
	`, runID, workerID, tokenHash[:], expiresAt)
	run, err := scanAgentRun(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return nil, err
	}
	actions, err := loadRunActions(ctx, tx, run.AccountID, run.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &biz.CloudRunLeaseState{Run: run, Actions: actions, LeaseExpiresAt: expiresAt}, nil
}

func (repo *cloudWorkerRepo) CloudRunLeaseContext(ctx context.Context, runID, workerID string, tokenHash [sha256.Size]byte) (*biz.CloudRunLeaseContext, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	result := &biz.CloudRunLeaseContext{}
	err := repo.data.db.QueryRow(ctx, `
		SELECT account_id, session_id FROM agent_runs
		WHERE id = $1 AND execution_target = 'cloud' AND lease_owner = $2
			AND lease_token_hash = $3 AND lease_expires_at > now()
	`, runID, workerID, tokenHash[:]).Scan(&result.AccountID, &result.SessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, biz.ErrCrossDeviceConflict
	}
	return result, err
}

func (repo *cloudWorkerRepo) AppendCloudRunEvents(ctx context.Context, runID, workerID string, tokenHash [sha256.Size]byte, options biz.AppendAgentRunEventsOptions, events []*biz.AgentRunEvent) (int, *biz.AgentRun, error) {
	tx, err := repo.begin(ctx)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx)
	var accountID string
	err = tx.QueryRow(ctx, `
		SELECT account_id FROM agent_runs
		WHERE id = $1 AND execution_target = 'cloud' AND lease_owner = $2
			AND lease_token_hash = $3 AND lease_expires_at > now()
		FOR UPDATE
	`, runID, workerID, tokenHash[:]).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, biz.ErrCrossDeviceConflict
	}
	if err != nil {
		return 0, nil, err
	}
	accepted, run, err := appendAgentRunEventsTx(ctx, tx, accountID, options, events)
	if err != nil {
		return 0, nil, err
	}
	if terminalRunStatus(run.Status) {
		if _, err := tx.Exec(ctx, `
			UPDATE agent_runs SET lease_owner = '', lease_expires_at = NULL, lease_token_hash = NULL
			WHERE account_id = $1 AND id = $2
		`, accountID, run.ID); err != nil {
			return 0, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, nil, err
	}
	return accepted, run, nil
}

func (repo *cloudWorkerRepo) begin(ctx context.Context) (pgx.Tx, error) {
	if repo.data.db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	return repo.data.db.BeginTx(ctx, pgx.TxOptions{})
}

func loadCloudRunLease(ctx context.Context, tx pgx.Tx, run *biz.AgentRun) (*biz.CloudRunLease, error) {
	workspace, err := getWorkspaceTx(ctx, tx, run.AccountID, run.WorkspaceID)
	if err != nil {
		return nil, err
	}
	session, err := getSessionTx(ctx, tx, run.AccountID, run.SessionID)
	if err != nil {
		return nil, err
	}
	messages, err := loadRunMessages(ctx, tx, run.AccountID, run.SessionID)
	if err != nil {
		return nil, err
	}
	artifacts, err := loadRunArtifacts(ctx, tx, run.AccountID, run.SessionID, run.ID)
	if err != nil {
		return nil, err
	}
	actions, err := loadRunActions(ctx, tx, run.AccountID, run.ID)
	if err != nil {
		return nil, err
	}
	return &biz.CloudRunLease{
		Run: run, Workspace: workspace, Session: session, Messages: messages,
		Artifacts: artifacts, Actions: actions, AccountID: run.AccountID,
	}, nil
}

func loadRunMessages(ctx context.Context, tx pgx.Tx, accountID, sessionID string) ([]*biz.Message, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, account_id, session_id, role, status, content_projection,
			parts_projection, client_mutation_id, COALESCE(source_device_id, ''), created_at, updated_at
		FROM (
			SELECT * FROM messages WHERE account_id = $1 AND session_id = $2
			ORDER BY created_at DESC, id DESC LIMIT 200
		) recent
		ORDER BY created_at, id
	`, accountID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*biz.Message, 0)
	for rows.Next() {
		item, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadRunArtifacts(ctx context.Context, tx pgx.Tx, accountID, sessionID, runID string) ([]*biz.Artifact, error) {
	rows, err := tx.Query(ctx, artifactSelect+`
		WHERE artifacts.account_id = $1 AND artifacts.session_id = $2
			AND (artifacts.run_id IS NULL OR artifacts.run_id = $3)
			AND (artifacts.retention_until IS NULL OR artifacts.retention_until > now())
		ORDER BY artifacts.created_at, artifacts.id
	`, accountID, sessionID, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*biz.Artifact, 0)
	for rows.Next() {
		item, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadRunActions(ctx context.Context, tx pgx.Tx, accountID, runID string) ([]*biz.AgentAction, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, account_id, run_id, event_seq, type, status, request_payload,
			resolution_payload, version, expires_at, resolved_at, created_at
		FROM agent_actions WHERE account_id = $1 AND run_id = $2
		ORDER BY event_seq, id
	`, accountID, runID)
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
