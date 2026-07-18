# ACP v1 compliance implementation

Date: 2026-07-18

## Scope and delivery plan

The implementation was split into four parallel workstreams:

1. Build a requirement matrix from the official ACP v1 documentation and the Configurable LLM Providers RFD.
2. Audit and repair the Desktop ACP client, including capability negotiation, lifecycle control, cancellation, filesystem/terminal hosting, transports, and event mapping.
3. Audit and repair the bundled `astraflow-acp` agent runtime, including replay, lifecycle methods, configuration, cancellation, and provider routing.
4. Preserve protocol-native data through the Studio event, persistence, and rendering layers, then verify the integrated behavior with conformance and runtime tests.

ACP support is capability-driven. Omitted optional capabilities are treated as unsupported; features are not inferred from Desktop or Sandbox runtime version strings.

## Coverage matrix

| ACP area | Desktop client and Studio UI | AstraFlow agent runtime | Verification |
| --- | --- | --- | --- |
| Overview / JSON-RPC flow | Uses the ACP SDK connection and method registry; preserves request, response, notification, and JSON-RPC cancellation semantics. | Uses the ACP SDK agent application and typed method registry. | `tests/acp-v1-conformance.test.ts`; runtime smoke tests |
| Initialization | Sends ACP v1, implementation metadata, and truthful local/remote client capabilities; accepts older negotiated versions and rejects only versions newer than the client supports. | Saves client capabilities and gates form elicitation on `elicitation.form`; advertises only implemented capabilities and content types. | Initialize/version/capability conformance tests |
| Authentication | Supports advertised agent-managed methods only, automatically recovers from `auth_required`, exposes manual authenticate and capability-gated logout controls, and clears HTTP/WebSocket cookies on logout. Client-side setup methods are never sent to `authenticate`. | Advertises `authMethods: []` and no logout capability because the bundled runtime requires no ACP authentication. | Auth-required retry conformance test |
| Session setup | Capability-gates `session/resume`, `session/load`, MCP transports, and additional directories. Load notifications are observed before the load response and state-bearing replay is reconciled; historical transcript chunks are intentionally not imported into Studio's local durable transcript. | Implements new/load/resume and standard stdio MCP servers; rejects unsupported transports during setup instead of ignoring them. Load replays user, assistant, thought, tool-call, and tool-result history before returning, while resume does not replay. | Runtime replay and stdio MCP tests |
| Session list | Provides a capability-gated, cwd-filtered paginated session browser. A listed session can be continued in a separate Studio chat; the provider binding is persisted, its original cwd is enforced, and an explicit selection cannot silently fall back to a new provider session. The live control snapshot renders title/timestamp plus Codex thread status, archive/close state, goal metadata, and Claude rate-limit warnings. | Implements cwd-bound opaque cursors, deterministic 50-item pages, titles, timestamps, cwd, and additional directories, and publishes live title/timestamp updates after every persisted turn. | Continuation, metadata, persistence, and runtime pagination tests |
| Session delete / close | Provides capability-gated close/delete actions and confirmation for destructive deletion. Deleting local Studio history first deletes the corresponding agent session when supported, retains local history on remote failure, and preserves a provider session while another Studio chat still references it. Transport cleanup calls `session/close` when available. | Implements idempotent close/delete, cancels active work, waits for prompt cleanup, and removes deleted checkpoints from list results. | Session-deletion and runtime lifecycle tests |
| Prompt turn | Sends protocol-native prompt blocks and consumes ordered session updates until the prompt stop response. Standard message IDs remain opaque and distinct; Codex commentary/final-answer phases remain separate; refusal and provider-limit stop reasons produce user-visible feedback. | Merges the inbound JSON-RPC request signal with `session/cancel`, streams updates, publishes cumulative `usage_update` plus prompt-response usage, and maps turn limits, token limits, and cancellation to `max_turn_requests`, `max_tokens`, and `cancelled`. | Client conformance, stop-reason, and runtime prompt tests |
| Cancellation | Supplies `cancellationSignal` for prompt and all agent-to-client requests, sends `$/cancel_request` through the SDK, sends `session/cancel`, and releases pending permissions, elicitation, and terminals. Explicit UI cancellation also installs a bounded process-teardown fallback for non-cooperative agents. | Propagates request cancellation through Pi, MCP, permission, and user-input work and waits for deterministic cleanup. | Cancellation conformance and runtime cancellation tests |
| Content | Preserves and renders text, image, audio, embedded resource, and resource-link blocks, including annotations and `_meta`; prompt media is gated by advertised capabilities. Untrusted text, binary, collection, depth, and raw-payload sizes are bounded and credential-shaped values are redacted before persistence or UI responses. | Advertises image support only when the selected model accepts images and replays persisted supported content blocks. | Structured-event, bounds/redaction, and capability tests |
| Tool calls | Preserves replacement vs patch semantics, title, `ToolKind`, four-state ACP status, locations, structured content, raw input/output, and nested `_meta`; attributes Claude and AstraFlow child tools to their parent task and surfaces structured Codex errors. The UI distinguishes pending approval from in-progress work, maps every `ToolKind` including `switch_mode`, and honors Codex `is_mcp_tool_call`. | Continues publishing ACP tool calls/updates and permission requests with stable IDs. | Structured-event, tool-label, and runtime tool tests |
| Agent plan | Supports stable replacement plans and experimental identified items/markdown/file plan updates and removal without conflating concurrent plans. Plan priority is a closed union and is rendered on every prioritized item. | Publishes stable ACP plans through the Pi plan forwarder and accepts high/medium/low priority per item. | Plan identity/removal and Studio plan tests |
| Session config options | Renders ordered select/group/boolean controls, sends the boolean discriminator, replaces state with the complete response, and tracks agent notifications. Open controls and slash-command discovery refresh live agent-pushed mode, config, and command state. Config options supersede legacy modes in the UI. | Implements mode, model, and thought-level config options, returns complete state, persists session selections, and proactively publishes complete config snapshots after direct config changes and provider-driven normalization. | Runtime config test |
| Session modes | Supports the legacy mode API only when config options are absent and validates advertised mode IDs. | Keeps the transitional legacy mode response synchronized with the mode config option. | Runtime mode test |
| Slash commands | Preserves agent-provided command descriptors and live command updates in runtime state and Studio command discovery. Agent-advertised commands take precedence over colliding built-ins, skills, and MCP commands and are delivered to the runtime without client-side reinterpretation. | Publishes `/status`, `/review`, and `/plan` on new/load/resume and gives each command executable runtime semantics. | Focused Studio command-precedence, skill-invocation, and runtime command tests |
| File system | Exposes local filesystem methods only on local transports; requires absolute paths and confines canonical paths and symlinks to authorized roots; honors one-based line windows and limit zero. | Treats cwd and negotiated additional directories as authorized workspace roots. | Line-window conformance and runtime path-security tests |
| Terminals | Capability-gates all terminal methods, validates session ownership/cwd, supports create/output/wait/kill/release, removes aborted waiters, flushes trailing decoder state, and enforces exact UTF-8 byte limits across split multibyte chunks. | Runs Pi coding tools in-process behind ACP permission requests; it does not advertise or call client terminal methods. | UTF-8 limit, aborted-waiter, and runtime backend tests |
| Extensibility | Preserves `_meta` on requests, responses, notifications, plan entries, commands, command inputs, content annotations, and implementation data; keeps unknown provider protocol strings open; bounds/redacts opaque values. Consumes Codex/Claude provider metadata, attaches a valid W3C `traceparent` to session setup, and sends actionable Desktop session identity and permission feedback without dead permission-mode metadata. | Echoes the bounded Desktop session identity for correlation and consumes permission-denial feedback while keeping AstraFlow metadata under `_meta.astraflow`. | Structured content/tool, metadata, trace-context, and conformance tests |
| Transports | Supports stdio plus SDK Streamable HTTP and WebSocket transports; remote transports do not receive Desktop filesystem/terminal capabilities; shared in-memory cookie state supports auth/logout. | Bundled local runtime remains stdio; remote Sandbox uses WebSocket ACP. | Transport capability conformance tests and existing remote smoke coverage |
| Schema | Uses the exact pinned `@agentclientprotocol/sdk` generated schema and method registry instead of duplicating protocol DTOs. | Uses the same SDK schema and handlers. | Typecheck and runtime schema validation |
| Configurable LLM providers | Implements the required two-phase order on one exact connection and process: `initialize` → `providers/list/set/disable` → `session/new/load` → `prompt`. Controls are available before the first session starts, provider operations are serialized, secret headers are password-only and never retained client-side, provider URLs reject embedded credentials, and required providers cannot be disabled. | Implements process-scoped `providers/list`, `providers/set`, and idempotent `providers/disable`; applies base URL, open protocol type, and headers to subsequent model calls; never persists or echoes headers. | Prepared-connection race tests and runtime provider routing/redaction test |

## Primary implementation surfaces

- Desktop ACP client: `lib/agent/acp/acp-runtime.ts`
- Protocol-neutral events and persistence: `lib/agent/events.ts`, `lib/agent/run-orchestrator.ts`, `lib/agent/structured-content.ts`, `lib/studio-db/helpers.ts`
- Studio controls and rendering: `components/studio-chat/acp-controls.tsx`, `components/studio-message-parts/plan-todo.tsx`, `components/studio-message-parts/tool.tsx`, `lib/agent/acp/session-presentation.ts`
- ACP control route: `app/api/studio/agent-runtimes/[runtimeId]/acp/route.ts`
- Bundled agent: `runtime/astraflow-acp/src/agent.mjs`
- Runtime persistence and hosted operations: `runtime/astraflow-acp/src/session-store.mjs`, `runtime/astraflow-acp/src/backend.mjs`, `runtime/astraflow-acp/src/mcp-tools.mjs`

## Verification commands

```bash
bun test tests/acp-v1-conformance.test.ts tests/acp-stop-reason.test.ts tests/acp-session-deletion.test.ts tests/acp-session-continuation.test.ts
bun test tests/agent-structured-events.test.ts tests/agent-usage.test.ts
bun test tests/studio-slash-commands.test.ts tests/studio-tool-labels.test.ts tests/studio-plan.test.ts
bun run test:studio-skill-invocation
bun run smoke:astraflow-acp
bun tests/fixtures/agent/replay.ts
bun run typecheck
bun run lint
git diff --check
```

No build or development server is required for this protocol change.

## Normative references

- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [ACP v1 schema](https://agentclientprotocol.com/protocol/v1/schema)
- [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP v1 extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)
- [Configurable LLM Providers RFD](https://agentclientprotocol.com/rfds/custom-llm-endpoint)
