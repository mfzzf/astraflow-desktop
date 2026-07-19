# Codex independent review

Baseline: `@openai/codex` 0.144.5,
`@agentclientprotocol/codex-acp` 1.1.4, ACP SDK 1.2.1, with generated
app-server types checked against the pinned CLI.

The final update check found `@openai/codex` 0.144.6 while this repository is
intentionally pinned to 0.144.5. Codex was outside the requested implementation
focus, so the runtime was not silently upgraded; the generated contract remains
exactly aligned with 0.144.5.

The public `codex` ACP path remains the supported product integration. Core
sessions, streaming, reasoning, shell/files/MCP, images, approvals, Plan, Goal,
Fast, compaction, review commands, Skills, subagents, usage, auth/logout,
notifications, Markdown/audit export, local transport, and Sandbox transport
are implemented. Dynamic Agent capabilities remain authoritative.

Review fixes shared with all runtimes include scoped provider permissions,
fail-closed mode synchronization, complete rejection choices, discoverable
inactive Plan, accurate capability metadata, local-settings Sandbox rejection,
and visible-activity export.

`codex-direct` is a hidden experimental app-server mapper. It no longer claims
provider-native resume or compaction because it uses ephemeral process/thread
lifecycle. The richer app-server-only surface (turn steer, hook trust UI,
account administration, native rollback/fork/history, MCP OAuth/resource
management, and detached review controls) is not claimed as ACP parity.

Codex cloud execution, ChatGPT organization administration, billing,
entitlements, connectors, IDE-specific UI, and official desktop-only UX are
platform surfaces rather than local ACP runtime capabilities.
