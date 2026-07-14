# AstraFlow Code Sandbox Template

Builds the `astraflow-code` template from the CodeHatch code-server image.

The template includes:

- code-server on port `8080`
- AstraFlow Workspace Gateway on port `8787` after Desktop bootstrap
- OpenSSH server and websocat for VS Code Remote SSH over port `8081`
- long-lived Sandbox filesystem workspace at `/workspace`
- Node.js 22, npm, git, gh, jq, tmux, docker.io
- The pinned AstraFlow Python runtime and document dependencies under
  `/opt/astraflow/python`
- LibreOffice Impress, Poppler, Tesseract OCR, Noto CJK fonts, and the shared
  Node document packages under `/node_modules`
- Starship prompt initialized for bash
- Claude Code, Codex, and opencode CLIs
- Claude Code and Codex ACP adapters for Studio's remote Agent transport
- AstraFlow Agent's pinned `astraflow-acp` DeepAgents/LangGraph runtime under
  `/opt/astraflow/astraflow-acp`
- Claude Code, ChatGPT, opencode, Python, debugpy, ESLint, Prettier, and GitHub PR code-server extensions

Default resources:

- 8 vCPU
- 8192 MiB RAM

## Build

```bash
cd sandbox_template/code
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
UCLOUD_SANDBOX_API_KEY=... \
UCLOUD_SANDBOX_DOMAIN=cn-wlcb.sandbox.ucloudai.com \
UCLOUD_SANDBOX_TEMPLATE_CPU_COUNT=8 \
UCLOUD_SANDBOX_TEMPLATE_MEMORY_MB=8192 \
.venv/bin/python build_template.py
```

Do not include the wildcard prefix in the domain; use
`cn-wlcb.sandbox.ucloudai.com`, not `*.cn-wlcb.sandbox.ucloudai.com`.

Extension installation intentionally runs during the template build with
`--force`, so already-installed extensions are reinstalled or updated. If any
`code-server --install-extension` command fails, the build fails instead of
publishing a partially configured template.

Starship is installed as the final template layer so existing cached layers for
the heavier runtime and extension setup remain reusable.

The base image's npm is used only while assembling dependency trees during the
template build. The published runtime resolves `/usr/local/bin/node` first and
the final build layer verifies Node.js 22 plus every pinned Agent CLI version.

The Workspace Gateway is installed at
`/opt/astraflow/workspace-gateway`. It is intentionally not started by the
template: AstraFlow Desktop starts it after `Sandbox.connect()` with the stable
workspace path, Sandbox identity, and a short-lived bearer token. Its only
unauthenticated endpoint is the loopback readiness probe at `/healthz`; all
`/v1/*` HTTP and terminal WebSocket endpoints require the bearer token.
Studio starts AstraFlow Agent, Codex, Claude Code, and OpenCode inside the Sandbox through
one-time-ticket ACP WebSocket connections exposed by this Gateway. The Agent
process inherits only the runtime-specific ModelVerse variables allowlisted by
the Gateway; the Gateway bearer token is never forwarded to the Agent process.
ModelVerse credentials are not written to the Sandbox profile, CLI auth files,
code-server environment, or terminal environment; Desktop sends them only in
the one-time Agent connection request. For Claude Code and OpenCode, the
Gateway keeps the credential in a per-run loopback proxy instead of exposing
it to the child process. The proxy supplies upstream authorization and streams
model responses; it also answers Claude Code's token-count compatibility
request locally and removes unsupported context-management fields.
`astraflow-acp` removes the ModelVerse key from its process environment before
initializing any filesystem or shell backend, persists resumable checkpoints
outside the workspace, and routes permission, user-input, and local MCP calls
back to Desktop over ACP.

## Auto-resume persistence smoke test

After publishing the updated template and creating a CodeBox, verify the
long-lived Sandbox persistence contract with:

```bash
ASTRAFLOW_CONFIRM_PAUSE_SMOKE=1 \
ASTRAFLOW_CODEBOX_SANDBOX_ID=<sandbox-id> \
UCLOUD_SANDBOX_API_KEY=<sandbox-api-key> \
bun run smoke:codebox-auto-resume
```

The command creates an isolated Git repository under the workspace, leaves
both dirty and untracked files, pauses the selected Sandbox, reconnects to
trigger auto resume, verifies every file, and removes only its own test
directory. It never calls `Sandbox.kill`. Do not run it against a Sandbox with
an active terminal or Agent run because the test intentionally pauses it.
For a legacy CodeBox that still uses `/root/workspace`, also set
`ASTRAFLOW_CODEBOX_WORKSPACE_PATH=/root/workspace`.

The Agent CLIs are pinned in `template.py`; update them deliberately alongside
the matching runtime packages in the root `package.json` rather than installing
the npm `latest` tags during a template build.
