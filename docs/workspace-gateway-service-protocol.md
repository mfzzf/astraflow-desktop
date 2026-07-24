# Workspace Gateway service lifecycle protocol

## Contract

Workspace Gateway advertises `service.lifecycle.v2` in both `/v1/health` and
`/v1/workspace`. Desktop must treat the capability as a protocol contract, not
infer support from a runtime version string.
`service.lifecycle.v2` replaces the ownerless lifecycle contract. Desktop
verifies the capability before every
service API call so an older Gateway cannot silently ignore owner parameters.

Authenticated endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/services` | Start or idempotently replay an owner-scoped service spec |
| `GET` | `/v1/services?ownerSessionId=...` | List that owner's service manifests |
| `GET` | `/v1/services/:id?ownerSessionId=...` | Inspect one owner-matched service |
| `GET` | `/v1/services/:id/logs?ownerSessionId=...` | Read owner-matched bounded stdout/stderr |
| `DELETE` | `/v1/services/:id?ownerSessionId=...` | Stop the owner-matched lifecycle scope |

Desktop exposes only session-scoped relay routes to the renderer:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/studio/sessions/:sessionId/services` | List services for the session's current Sandbox workspace |
| `GET` | `/api/studio/sessions/:sessionId/services/:id/logs` | Read bounded logs |
| `DELETE` | `/api/studio/sessions/:sessionId/services/:id` | Stop the service |

The relay resolves `sandboxId`, `workspacePath`, and `ownerSessionId` from the
authenticated Studio session. The renderer cannot submit those identities, and
service ids must be UUIDs before they reach the Gateway. Gateway requires the
owner on every operation and returns `SERVICE_NOT_FOUND` when the service
belongs to another session. Ownerless manifests from an older template are not
loaded or listed. Deleting a Studio session stops all active services for that
owner on a best-effort basis; one failed stop cannot target or delete another
session's service.

`POST` accepts a Desktop-supplied `ownerSessionId`, one foreground command, a
workspace-confined cwd/entry path, an optional port and health path, a required
idempotency key, an optional artifact revision, and an explicit replacement
service id. Name locks, idempotency, replacement, list/log/stop, and artifact
identity are scoped by that owner. The service environment is rebuilt from
Gateway-owned `PATH`, private `HOME`/`TMPDIR`, `LANG`, and `PORT`.
Request-provided environment names must be one of `BROWSER`, `CI`, `DEBUG`,
`FLASK_DEBUG`, `FLASK_ENV`, `FORCE_COLOR`, `HOST`, `HOSTNAME`, `NODE_ENV`,
`NO_COLOR`, `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`, or `UVICORN_HOST`,
or use a public client prefix: `ASTRO_PUBLIC_`, `NEXT_PUBLIC_`, `PUBLIC_`,
`REACT_APP_`, or `VITE_`. Secret-like names are rejected even when they use an
otherwise allowed public prefix.

## Lifecycle guarantees

- A name + identical spec is reused; a changed spec requires
  `replaceServiceId`.
- Replacement is committed only after the new instance is healthy and the
  previous lifecycle scope explicitly reports `stopped`. If the previous scope
  cannot be reaped, Gateway stops the new instance and returns
  `502 SERVICE_REPLACE_FAILED`; if rollback also cannot be reaped, the error
  explicitly reports both groups as unresolved.
- TCP health or a 2xx/3xx HTTP health response must pass before status becomes
  `healthy`.
- The listener must bind `0.0.0.0` or `::`, and its socket owner must be in the
  root command's managed process group. Linux verifies ownership through
  procfs; macOS uses the system `lsof`.
- Failure, timeout, cancellation, explicit stop, and Gateway shutdown send TERM
  then KILL to the owned POSIX process group. A stop that cannot prove the scope
  was reaped returns `failed` with `SERVICE_REAP_FAILED`; it never reports a
  false `stopped` result.
- Logs and manifests live in the Gateway state root, not the selected workspace.
- Restart recovery persists a stale manifest as `failed` with
  `GATEWAY_RESTART_UNVERIFIED`. It never adopts or signals the persisted PID
  because start time and ownership can no longer be proven.
- Response logs are bounded and service commands cannot use background wrappers
  such as `nohup`, `tmux`, shell `&`, or `setsid`.

The authenticated health and workspace responses include a
`serviceLifecycle` descriptor. On Linux and macOS,
`service.lifecycle.v2` reports an ownership scope of `process_group`; it does
not claim to contain a descendant that programmatically creates a new
session/process group. Common daemon/background command syntax is rejected, and
an early root-command exit fails the start and reaps the original group. The
remote Sandbox/VM teardown remains the outer containment boundary for an
adversarial detached descendant. Windows does not advertise
`service.lifecycle.v2` until a Job Object supervisor is available; POST fails
closed with `SERVICE_LIFECYCLE_UNSUPPORTED`.

## Gateway model-proxy boundary

AstraFlow, Codex, Claude Code, and OpenCode Agent processes in the remote VM
receive per-run loopback proxy credentials instead of the ModelVerse credential
passed to Workspace Gateway.
Before opening the upstream connection, Gateway accepts only a
credential-free public HTTP(S) origin on the protocol's default port, resolves
every DNS answer, rejects private/special-use/metadata or
mixed-public-private results, and pins the validated address for the request
lifetime. Redirects cannot change the validated origin. Gateway child
environments are rebuilt from a runtime allowlist and never inherit the
Gateway token or the complete service environment.

## Desktop and Pi path

`sandbox_start_service` is registered only for a remote Sandbox workspace whose
Studio session is explicitly in Full Access. It is absent from Default and
legacy-readonly `tools/list`; direct invocation also fails closed with an
explicit “interactive services require Full Access” error. Default can still
auto-preview sanitized, scripts-off static HTML. A dedicated service-process
sandbox is required before interactive services can be enabled in Default,
because the current service supervisor intentionally starts its process
directly in the remote VM.

In Full Access, Pi discovers the service tool through the versioned AstraFlow
host-tool manifest, calls it through the ACP MCP bridge, and receives
`service.v1` structured content. Both `tools/list` and `tools/call` recheck the
live `service.lifecycle.v2` capability, so an older or replaced Gateway cannot
leave a stale callable tool behind.
Changing a session from Full Access to Default/legacy-readonly, or rebinding
it away from its current Sandbox workspace, first lists and stops every
service owned by that session in the old workspace. PATCH serializes cleanup
with service startup, checks for an active run before and after cleanup, and
does not commit when listing, stopping, or process reaping remains unresolved.
Service startup rechecks both the live permission and captured workspace after
acquiring the same lock. A stale run launch must also match the current
workspace, runtime, and permission snapshot before it can enter `queued`.
Mobile channels cannot synchronously downgrade or take over a remote Full
Access session; the user must switch it to Default through Desktop first.
Session deletion keeps best-effort cleanup semantics.
Desktop derives the public URL from the current owned Sandbox connection only
after Gateway health succeeds. Loopback, credentialed, non-HTTP, or
text-extracted URLs are never previewed.

The right panel keys a service preview by `serviceId` and `artifactKey`.
Revisions refresh the existing tab; closing an auto-opened tab suppresses
future auto-open for that service/artifact until the user explicitly opens it.
The service activity card uses the relay routes for “View logs” and “Stop
service”; it does not reconstruct those actions from display text.

## Verification

```bash
node --test runtime/workspace-gateway/test/*.test.mjs
bun test tests/astraflow-runtime-parity.test.ts \
  tests/studio-workspace-service.test.ts \
  tests/studio-session-service-transition.test.ts \
  tests/studio-workspace-service-cleanup.test.ts
bun run test:studio-workspaces
```
