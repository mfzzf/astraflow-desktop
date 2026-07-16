# Subagent 05 Coupling and Architecture Review - 2026-07-05

Scope: static review of coupling between UI, route handlers, local storage, Electron, UCloud/OpenAPI, generated model metadata, agent runtimes, chat/session persistence, and sandbox/codebox concerns.

Verification: static review only. I did not change application code, run a build, or start the dev server.

## Findings

### High: `studio-db` is a cross-domain persistence and service hub

Evidence:
- `lib/studio-db.ts:1` imports `better-sqlite3`, Node filesystem/crypto APIs, shared file-storage cleanup, MCP types, CodeBox types, Skill Marketplace types, and Studio types in one module.
- `lib/studio-db.ts:507` through `lib/studio-db.ts:760` defines one schema map for sessions, local projects, messages, settings, permission rules, session sandboxes, session files, installed skills, skill syncs, CodeBox volumes/sandboxes, MCP servers/secrets/registry rows, and image generation tables.
- `lib/studio-db.ts:839` through `lib/studio-db.ts:863` creates a singleton SQLite connection from process env/current working directory and runs schema initialization/migration/reconciliation as an import-time service dependency.
- `lib/studio-db.ts:3213` through `lib/studio-db.ts:3240` deletes session rows and also removes media files and generated/attachment directories.
- `lib/studio-db.ts:4256` through `lib/studio-db.ts:4461` stores OAuth tokens, CodeBox GitHub tokens, and ModelVerse API keys in the same settings table helpers.
- `lib/studio-db.ts:4488` through `lib/studio-db.ts:4525` stores the selected UCloud project beside all other app state.

Why this is tightly coupled:
Every bounded context depends on one singleton module that knows DB schema, filesystem layout, secrets, credentials, chat messages, MCP, skills, CodeBox, sandboxes, and media. A schema or storage change in one area risks touching unrelated routes and runtimes. Tests cannot easily swap persistence because consumers import concrete functions that close over the singleton database and filesystem side effects.

Refactor seams:
- Extract `lib/db/connection.ts` for connection, migrations, and transaction helpers only.
- Split repositories by ownership: `sessions/messages`, `local-projects/files`, `credentials/projects`, `skills/mcp`, `codebox`, and each media generation library.
- Move destructive file cleanup out of repository deletes into an application service transaction such as `deleteStudioSessionCascade`.

### High: Chat UI, session persistence, run orchestration, SSE, and agent event shape are coupled end to end

Evidence:
- `components/studio-chat-workbench.tsx:930` through `components/studio-chat-workbench.tsx:1112` reads/writes chat model, runtime, environment, and reasoning effort directly in `localStorage`.
- `components/studio-chat-workbench.tsx:1266` through `components/studio-chat-workbench.tsx:1503` hard-codes route URLs and payloads for runtimes, model settings, projects, sessions, messages, chat runs, permissions, skills, and MCP servers.
- `hooks/use-studio-chat-run.ts:54` through `hooks/use-studio-chat-run.ts:56` opens `/api/studio/chat/events?sessionId=...`, while `hooks/use-studio-chat-run.ts:143` through `hooks/use-studio-chat-run.ts:145` binds directly to `"snapshot"` and `"done"` event names.
- `app/api/studio/chat/route.ts:57` through `app/api/studio/chat/route.ts:65` both persists session chat preferences and starts the agent run.
- `lib/studio-chat-runner.ts` imports runtime adapters for side effects, maps DB messages to unified `AgentMessage` values, reads session/project state, and pulls attachment descriptions from the sandbox module.
- `lib/agent/run-orchestrator.ts:54` through `lib/agent/run-orchestrator.ts:74` keeps run state/listeners in global maps, and `lib/agent/run-orchestrator.ts:1093` through `lib/agent/run-orchestrator.ts:1128` creates the streaming assistant message directly in the DB-backed message store.
- `lib/agent/run-orchestrator.ts:601` through `lib/agent/run-orchestrator.ts:725` converts runtime events into persisted `StudioMessageActivity` and `StudioMessagePart` shapes.
- `app/api/studio/chat/events/route.ts:118` through `app/api/studio/chat/events/route.ts:135` serializes the same live snapshot shape as SSE events.

Why this is tightly coupled:
The browser component, route handlers, run orchestration, DB schema, and runtime event schema all know each other's exact shapes. Changing a message part, runtime event, session preference, or transport name cascades through UI storage, HTTP helpers, route validation, run accumulation, persistence, and SSE consumers. It also makes unit testing hard because starting a run creates DB messages and depends on global process state.

Refactor seams:
- Create a chat application service with injected `SessionRepository`, `MessageRepository`, `RunStore`, and `AgentRuntimeRegistry`.
- Define a typed `ChatRunEvent`/`ChatRunSnapshot` protocol in one module and project runtime events into that protocol before persistence.
- Move browser fetch code into typed client hooks so the component consumes commands such as `startRun`, `saveMessage`, and `subscribeRun`.

### High: Agent runtime registration is side-effect bootstrapped and runtime IDs are spread across layers

Evidence:
- `lib/agent/runtime.ts:50` through `lib/agent/runtime.ts:88` stores runtime registrations in a `globalThis` registry.
- `lib/studio-chat-runner.ts:9` and `lib/studio-chat-runner.ts:10` import runtime adapters only for registration side effects.
- `app/api/studio/agent-runtimes/route.ts:3` through `app/api/studio/agent-runtimes/route.ts:5` imports `@/lib/studio-chat-runner` so listing runtime info indirectly triggers adapter registration.
- `lib/agent/adapters/astraflow-runtime.ts:710` through `lib/agent/adapters/astraflow-runtime.ts:731` declares and registers the AstraFlow runtime in the adapter module.
- `lib/agent/adapters/acp-runtimes.ts:601` through `lib/agent/adapters/acp-runtimes.ts:627` registers ACP runtimes from probe results.
- `lib/agent-model-settings-shared.ts:3` through `lib/agent-model-settings-shared.ts:10`, `lib/agent-model-settings.ts:26` through `lib/agent-model-settings.ts:43`, and `app/api/studio/agent-model-settings/route.ts:37` through `app/api/studio/agent-model-settings/route.ts:43` all hard-code the same runtime set.
- `components/agent-runtime-icons.tsx:13` through `components/agent-runtime-icons.tsx:44` hard-codes runtime icon behavior.

Why this is tightly coupled:
Adding, removing, or renaming a runtime is not localized. It requires edits in the runtime adapter, global registry bootstrap path, persisted settings schema/defaults, API validation, and UI icon logic. Because registration happens by import side effect, a route or test can observe an empty or partial registry if it imports `lib/agent/runtime` without the same bootstrap path.

Refactor seams:
- Add an explicit `bootstrapAgentRuntimes()` module that registers all runtime descriptors once and is called by route/runtime entry points.
- Make runtime descriptors carry settings defaults, capability metadata, optional icon key, and supported model protocols.
- Derive settings schemas from the descriptor list or validate with a generic runtime-id map rather than fixed object keys.

### High: CodeBox runtime combines E2B, ModelVerse credentials, GitHub auth, shell setup, SSH, code-server, persistence, and terminals

Evidence:
- `lib/codebox-runtime.ts:12` through `lib/codebox-runtime.ts:42` imports the E2B `Sandbox` SDK, sandbox runtime config, ModelVerse config, stored ModelVerse/GitHub/OAuth credentials, and CodeBox DB record functions.
- `lib/codebox-runtime.ts:140` through `lib/codebox-runtime.ts:170` derives owner identity from the selected ModelVerse API key and OAuth email.
- `lib/codebox-runtime.ts:440` through `lib/codebox-runtime.ts:457` injects ModelVerse and GitHub tokens into remote environment variables.
- `lib/codebox-runtime.ts:671` through `lib/codebox-runtime.ts:719` writes Codex/opencode/ModelVerse agent configuration files into the sandbox.
- `lib/codebox-runtime.ts:122` through `lib/codebox-runtime.ts:138` stores terminal sessions in a process-global map, while `lib/codebox-runtime.ts:1540` through `lib/codebox-runtime.ts:1624` streams/resizes/kills E2B PTY sessions.
- `lib/codebox-runtime.ts:1627` through `lib/codebox-runtime.ts:1707` creates the sandbox, clones repos, starts code-server, and upserts DB records in one function.
- `lib/codebox-runtime.ts:1732` through `lib/codebox-runtime.ts:1847` handles pause/resume/sync/kill while touching DB records and reconnecting to E2B.
- `components/codebox-page.tsx:158` through `components/codebox-page.tsx:187`, `components/codebox-page.tsx:616` through `components/codebox-page.tsx:752`, and `components/codebox-page.tsx:2038` through `components/codebox-page.tsx:2168` hard-code the CodeBox API endpoints, workspace URL rules, SSH flow, and terminal SSE protocol in the page component.

Why this is tightly coupled:
The CodeBox service has no clear boundary between product use cases and provider details. Template IDs, ports, credential wiring, remote shell scripts, code-server assumptions, DB persistence, and UI HTTP/SSE contracts all live in the same change path. Testing a rename, terminal, or SSH flow requires either real E2B behavior or extensive global monkey-patching.

Refactor seams:
- Introduce `CodeBoxService` for use cases and inject `SandboxGateway`, `CodeBoxRepository`, `CredentialProvider`, and `TerminalSessionStore`.
- Move remote setup scripts into versioned templates/assets with small script-rendering helpers.
- Put browser CodeBox requests behind `useCodeBoxClient()` and keep the page focused on UI state.

### Medium: Media generation routes own OpenAPI adapters, provider calls, DB lifecycle, and media storage

Evidence:
- `app/api/studio/sessions/[sessionId]/image-generations/route.ts:5` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:32` imports auth, image OpenAPI registry helpers, ModelVerse API key access, shared generation helpers, media storage, and image DB functions.
- `lib/image-openapi.ts:1` through `lib/image-openapi.ts:16`, `lib/audio-openapi.ts:1` through `lib/audio-openapi.ts:11`, and `lib/video-openapi.ts:1` through `lib/video-openapi.ts:7` cast generated OpenAPI field metadata directly into Studio UI/domain field types.
- `app/api/studio/sessions/[sessionId]/image-generations/route.ts:238` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:283` builds OpenAI edit multipart payloads, and `app/api/studio/sessions/[sessionId]/image-generations/route.ts:286` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:310` builds Gemini payloads.
- `app/api/studio/sessions/[sessionId]/image-generations/route.ts:585` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:600` performs provider HTTP calls.
- `app/api/studio/sessions/[sessionId]/image-generations/route.ts:750` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:792` resolves the server-side OpenAPI operation and fields, while `app/api/studio/sessions/[sessionId]/image-generations/route.ts:810` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:842` chooses adapter-specific payloads.
- `app/api/studio/sessions/[sessionId]/image-generations/route.ts:913` through `app/api/studio/sessions/[sessionId]/image-generations/route.ts:964` saves outputs to media storage and DB rows.
- Video and audio routes repeat the same broad ownership: `app/api/studio/sessions/[sessionId]/video-generations/route.ts:1` through `app/api/studio/sessions/[sessionId]/video-generations/route.ts:47`, `app/api/studio/sessions/[sessionId]/video-generations/route.ts:1276` through `app/api/studio/sessions/[sessionId]/video-generations/route.ts:1338`, `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:1` through `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:38`, and `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:745` through `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:959`.

Why this is tightly coupled:
Route handlers are acting as controllers, provider adapters, generated OpenAPI interpreters, job runners, persistence services, and media storage services. Any ModelVerse/OpenAPI or storage change is likely to cascade across route code and UI assumptions. It also blocks focused tests because provider payload builders and DB updates are not isolated.

Refactor seams:
- Create modality services such as `ImageGenerationService`, `VideoGenerationService`, and `AudioGenerationService` with pure provider adapter functions.
- Keep generated OpenAPI metadata behind a `ProviderOperationRegistry` that returns validated operation descriptors.
- Move DB/media writes behind `GenerationRepository` and `MediaStorageGateway`, and use a consistent job lifecycle for async providers.

### Medium: UCloud project context and error handling are duplicated across routes and split with browser local storage

Evidence:
- `app/api/model-square/route.ts:389` through `app/api/model-square/route.ts:442` gets UCloud credentials, resolves project context, and calls `ListUFSquareModel`.
- `app/api/studio/image/models/route.ts:125` through `app/api/studio/image/models/route.ts:145`, `app/api/skills/route.ts:59` through `app/api/skills/route.ts:100`, and `app/api/skills/[slug]/route.ts:45` through `app/api/skills/[slug]/route.ts:86` repeat credentials, project resolution, UCloud action calls, and local error mapping.
- `lib/modelverse-api-keys.ts:306` through `lib/modelverse-api-keys.ts:330` resolves a project by listing all UCloud projects and falling back to the default.
- `lib/studio-db.ts:4488` through `lib/studio-db.ts:4525` persists selected project in SQLite settings.
- `lib/project-selection.ts:1` through `lib/project-selection.ts:31` also defines a browser `localStorage` key plus a custom project-changed event.
- `components/account-settings-dialog.tsx:129` through `components/account-settings-dialog.tsx:136` and `components/navbar.tsx:149` through `components/navbar.tsx:155` both write local storage and dispatch the same event after saving the project through `/api/studio/projects`.
- Project consumers manually listen for the browser event, for example `components/model-square-page.tsx:1170` through `components/model-square-page.tsx:1184`, `components/studio-image-workbench.tsx:340` through `components/studio-image-workbench.tsx:352`, and `components/studio-chat-workbench.tsx:4975` through `components/studio-chat-workbench.tsx:4988`.

Why this is tightly coupled:
Project selection has two persistence channels: server SQLite for route behavior and browser local storage/events for refresh behavior. UCloud product routes separately reconstruct credentials, project fallback order, and error envelopes. Changing project context or RetCode handling requires edits across many route handlers and UI listeners.

Refactor seams:
- Introduce a server-side `UCloudRequestContext` helper that returns `{ credentials, projectId, user? }` and centralizes RetCode/error response mapping.
- Expose typed clients/hooks that subscribe to a single project-selection store, rather than every page wiring custom events.
- Keep local storage as a cache of server state only if needed, with one synchronization module.

### Medium: Electron capability boundaries are manually mirrored and directly consumed by UI

Evidence:
- `electron/preload.cjs:25` through `electron/preload.cjs:73` exposes a broad `window.astraflowDesktop` bridge for updates, external URLs, folder picking, side-panel filesystem reads, browser data clearing, terminal lifecycle, terminal events, and close-tab commands.
- `electron/main.cjs:581` through `electron/main.cjs:622` creates local terminal sessions with `node-pty` and emits terminal data/exit events.
- `electron/main.cjs:1154` through `electron/main.cjs:1221` registers IPC channels that must match the preload bridge names exactly.
- `types/astraflow-desktop.d.ts:63` through `types/astraflow-desktop.d.ts:94` manually repeats the bridge contract for TypeScript consumers.
- UI components call the bridge directly: `components/app-sidebar.tsx:839` through `components/app-sidebar.tsx:854` uses `pickFolder`, `components/studio-chat-workbench.tsx:3794` through `components/studio-chat-workbench.tsx:3932` uses side-panel file APIs, `components/studio-chat-workbench.tsx:4418` through `components/studio-chat-workbench.tsx:4425` clears browser data, and `components/studio-terminal-panel.tsx:457` through `components/studio-terminal-panel.tsx:508` manages terminal sessions.
- Server routes also perform desktop OS actions directly through Node, for example `lib/open-folder.ts:1` through `lib/open-folder.ts:30`, `app/api/studio/files/open-folder/route.ts:55` through `app/api/studio/files/open-folder/route.ts:90`, and `app/api/studio/local-projects/open-folder/route.ts:15` through `app/api/studio/local-projects/open-folder/route.ts:60`.

Why this is tightly coupled:
The IPC contract is duplicated in main, preload, ambient types, and UI call sites. Desktop-only capabilities leak into page components and route handlers, so testing or running outside Electron depends on optional `window.astraflowDesktop` branches and Node OS commands. A channel rename or payload shape change cascades through several layers.

Refactor seams:
- Define the desktop bridge contract once in a shared module and generate or import it from preload/main/type declarations.
- Add a `desktopCapabilities` client wrapper/hook so React components call semantic operations, not IPC-shaped methods.
- Keep OS shell actions behind a `DesktopGateway` interface with Electron and Node-route implementations.

### Medium: Session sandbox output is stringly coupled to DB records and message rendering

Evidence:
- `lib/astraflow-session-sandbox.ts:1` through `lib/astraflow-session-sandbox.ts:27` imports the E2B `Sandbox` SDK, sandbox env helpers, Studio DB message/file/sandbox functions, and local file storage in one module.
- `lib/astraflow-session-sandbox.ts:146` through `lib/astraflow-session-sandbox.ts:165` rewrites message attachment metadata after a file is uploaded to the sandbox.
- `lib/astraflow-session-sandbox.ts:168` through `lib/astraflow-session-sandbox.ts:215` creates/connects E2B sandboxes and upserts/touches DB sandbox records.
- `lib/astraflow-session-sandbox.ts:218` through `lib/astraflow-session-sandbox.ts:240` reads local files, writes them to sandbox paths, and updates both file rows and message attachments.
- `lib/ai/tools/astraflow-sandbox.ts:807` through `lib/ai/tools/astraflow-sandbox.ts:846` saves generated sandbox files to the local file library and returns a Markdown/plain-text result containing labels such as `Sandbox path`, `Bytes`, `SHA256`, and `Download`.
- `lib/astraflow-sandbox-runtime.ts:263` through `lib/astraflow-sandbox-runtime.ts:300` formats code execution results as labeled text sections, and `lib/astraflow-sandbox-runtime.ts:369` through `lib/astraflow-sandbox-runtime.ts:378` does the same for shell commands.
- `components/studio-message-parts-renderer.tsx:940` through `components/studio-message-parts-renderer.tsx:999` parses those labels and sections with regex/string matching to recover fields, URLs, stdout, stderr, results, and errors.

Why this is tightly coupled:
Sandbox execution, file synchronization, local persistence, message attachment mutation, and UI rendering all depend on the same textual output contract. A wording or section-label change in a tool/runtime can break rich rendering. The sandbox module is also hard to test without the E2B SDK and real Studio DB/file storage.

Refactor seams:
- Return structured sandbox tool results alongside display text, for example a `StudioSandboxResult` object embedded in a message part.
- Keep sandbox lifecycle in `SessionSandboxService` with injected `SandboxGateway`, `SessionFileRepository`, and `MessageRepository`.
- Let the renderer consume typed `tool_result.metadata` or a dedicated `sandbox` message part instead of parsing human-readable text.
