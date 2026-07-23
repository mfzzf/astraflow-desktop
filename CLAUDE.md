# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AstraFlow Desktop is UCloud's AI-agent desktop app: a Next.js 16 (App Router, React 19) frontend wrapped in Electron, with a Go (Kratos) backend under `backend/astraflow-api` (a git submodule with its own `CLAUDE.md`). Bun is the package manager.

Also read `AGENTS.md` — it contains binding UCloud OpenAPI call conventions, PostgreSQL migration rules, and a long list of frontend layout/UX pitfalls (fixed-height shell scrolling, `min-h-0 flex-1` wrappers, Sonner-vs-Alert, table centering, chat-page mounting). Follow it as written.

## Commands

```bash
bun run lint            # ESLint (flat config)
bun run typecheck       # tsc via typescript7 native compiler — the default typecheck
bun run format          # Prettier on **/*.{ts,tsx}
```

- `lint` + `typecheck` are the default verification commands. Do **not** run `bun run build` or start the dev server unless the user explicitly asks.
- Two TypeScript toolchains: the `typescript` package must stay on 6.x (Next/ESLint depend on its JS API); `typecheck` uses the `typescript7` npm alias (native compiler). `typecheck:ts6` runs the legacy check.
- shadcn components: `bunx --bun shadcn@latest add <component>` from the repo root (style `radix-luma`, icons from remixicon; primitives land in `components/ui/`).
- This Next.js version is `16.3.0-preview` with breaking changes — read `node_modules/next/dist/docs/` before writing Next-specific code rather than relying on prior knowledge.

### Tests

Playwright E2E only (`tests/e2e/`, chromium, 1 worker, expects the app on `http://localhost:3011`):

```bash
bun playwright test tests/e2e/permission-mode.spec.ts        # one file
bun playwright test -g "name substring"                      # filter by title
```

Agent-adapter replay fixtures live in `tests/fixtures/agent/*` (recorded events per runtime + `version-compatibility-matrix.ts`). The built-in agent checks are `bun run test:astraflow-agent` and `bun run smoke:pi-agent`; external runtime checks use the ACP and expert-agent smoke scripts.

### Electron / codegen / data

```bash
bun run electron:dev                  # Electron against the dev server
bun run electron:dist                 # full package (builds Next standalone first)
bun run codegen:{audio,image,video,astraflow-api}-openapi   # regenerate lib/generated/* from openapi/
bun run experts:import                # WorkBuddy expert data sync (backend migration/0002_*.mjs)
docker compose -f docker-compose-local-dev.yml up           # Postgres 17 for the Go backend
```

## Architecture

### Chat/agent request flow (the core path)

UI (`components/studio-chat/*`) → `POST /api/studio/chat` (`app/api/studio/chat/route.ts`) → `startStudioChatRun` in `lib/studio-chat-runner.ts` → an `AgentRuntime` from the registry in `lib/agent/runtime.ts` → tools from `lib/ai/tools/*` wrapped by the permission gateway → model provider. Events, permission requests (HITL), and user-input requests stream back over SSE via `app/api/studio/chat/{events,permission,user-input}`.

- **Runtimes** are pluggable adapters in `lib/agent/adapters/`: `astraflow-runtime.ts` is the default and uses the bundled Pi-powered AstraFlow ACP runtime for both local and remote workspaces. Local Default launches the whole ACP/Pi process inside the OS sandbox; remote workspaces connect through the Workspace Gateway. Other adapters are `claude-native-runtime.ts`, `codex-direct-runtime.ts`, `opencode-native-runtime.ts`, and ACP-based agents (`acp-runtimes.ts`, `lib/agent/acp/`).
- **Tools**: Pi-native `bash`, `read`, `write`, and `edit` run inside `runtime/astraflow-acp`; `lib/ai/tools/astraflow-sandbox.ts` owns remote Sandbox service lifecycle plus file transfer (the image is built from `sandbox_template/code/`). Other host tools include `media-generation.ts` (image/video/audio via per-model OpenAPI specs in `openapi/`), `web.ts` (safe search/fetch), `user-input.ts` (HITL), and MCP tools.
- **HITL plumbing**: `lib/agent/permission-{gateway,broker,policy}.ts` and `user-input-broker.ts`; bash safety in `lib/agent/bash-security.ts` and friends.
- **Model access**: `lib/modelverse-pi.ts` creates Pi model descriptors and provider payload transforms for UCloud ModelVerse; shared endpoint configuration is in `modelverse-config.ts`, keys in `modelverse-api-keys.ts`, and the lower-level OpenAI-compatible helpers remain in `lib/modelverse-openai.ts`.

### UCloud OpenAPI (OAuth-first)

In API route handlers, follow `app/api/model-square/route.ts`: `getUCloudCredentials()` (local OAuth Bearer token, `lib/ucloud-credentials.ts`) then `callUCloudAction()` (`lib/ucloud.ts`). Do not introduce `UCLOUD_PUBLIC_KEY`/`UCLOUD_PRIVATE_KEY` or AccessKey signature paths for product APIs. Resolve `ProjectId` via `resolveModelverseProjectId()` preferring `getStudioModelverseApiKey()?.projectId || credentials.projectId`. Skill discovery uses public `DescribeSkillMarketV2` with `Backend: "DevPortal"`; skill detail uses `DescribeSkillDetail` with `Backend: "SkillLab"`. Treat `RetCode: 299` as an IAM/ProjectId issue before touching auth mode.

### Persistence

The frontend's own store is **SQLite** (`better-sqlite3`) in `lib/studio-db/` (sessions, messages, projects, agents, api-keys, permissions, mcp, skills, media…), path from `ASTRAFLOW_SQLITE_PATH`. Media/files on disk via `lib/studio-file-storage.ts` / `studio-media-storage.ts`. The Postgres in docker-compose belongs to the Go backend only.

### App shell

`app/layout.tsx` → `components/app-shell.tsx` (persistent client shell; `/login` and `/settings/*` render bare) → `components/desktop-shell/desktop-app-shell.tsx` (left sidebar + side/bottom panels). Panel state is jotai atoms in `lib/app-shell/store.ts`. Main surfaces: `app/studio/[mode]/[sessionId]` (agent workbench), `explore` (the Models page — keep first nav items `Models` and `SKILLS`), `skills`, `files`, `codebox` (sandbox/terminal). Styling is Tailwind v4 (CSS-first, no JS config) with tokens in `app/shell-tokens.css`.

### Electron

`electron/main.cjs` boots the Next server (dev: `bun run dev`; packaged: standalone `server.js` via `utilityProcess.fork` on a random port) and points a `BrowserWindow` at it. It injects `ASTRAFLOW_SQLITE_PATH`, `ASTRAFLOW_STUDIO_{FILES,SKILLS}_PATH`, and a keychain-encrypted `ASTRAFLOW_SECRET_KEY`. Workspace terminals run in the remote Sandbox through Workspace Gateway HTTP/WSS; Electron does not host a local `node-pty` or side-panel workspace-file IPC path. `electron/preload.cjs` exposes `window.astraflowDesktop` via contextBridge (contextIsolation on).

### Go backend (`backend/astraflow-api`)

Kratos v3 + protobuf/buf + wire, Postgres via pgx. Serves the Expert system (`api/astraflow/v1/expert.proto`) on HTTP `:8000` / gRPC `:9000`; the frontend uses the generated SDK in `lib/generated/astraflow-api/`, configured through `lib/astraflow-api.ts` (`ASTRAFLOW_API_BASE_URL`). Regenerate it with `bun run codegen:astraflow-api`. Schema migrations are numbered `NNNN_name.{up,down}.sql` pairs in `backend/astraflow-api/migration/` — plain psql-runnable SQL, updated in the same change as any schema-affecting code, treated as the source of truth for deployment.

## Conventions

- Path alias `@/*` → repo root.
- State: jotai. Toasts: Sonner (use for transient success/validation/error feedback; inline Alert only for persistent/blocking state).
- Chat UI building blocks come from `components/ai-elements/` and `components/prompt-kit/` registries — install component entries only, no demo API routes.
- When syncing `useChat` with local chat history, hydrate only on active-session-id change and return the previous sessions array when nothing changed (avoids max-update-depth loops).
