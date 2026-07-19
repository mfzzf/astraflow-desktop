# Cross-runtime review

## Blocking findings and resolutions

| Finding | Resolution |
| --- | --- |
| Provider `allow_always` choices were persisted as a broad project-level `execute` rule. | Fixed. Provider ACP/direct decisions are returned verbatim and neither match nor create broad Studio rules. Rule lookup and persistence are opt-in only for AstraFlow-owned permission choices. |
| A failed ACP permission-mode downgrade could continue the prompt. | Fixed fail-closed. A failed `setMode`/`setConfigOption` releases the run slot, emits an error, and never sends the prompt. |
| Only one reject choice was visible. | Fixed. All provider options retain their order and scoped labels; the ordinary one-shot reject keeps the feedback field. |
| Claude Plan and other provider-selected modes were reset before every prompt. | Fixed. Studio posture sync runs only when the Studio permission mode changes; explicit and Agent-pushed provider mode/config changes remain active. |
| Sandbox could silently claim to use this Mac's CLI credentials/settings. | Fixed. That combination now fails before Agent startup with an actionable Modelverse/local-workspace message, and the settings copy explains the boundary. |
| Claude raw SDK events could be lost during startup/session replacement. | Fixed with bounded per-session startup and replacement buffering plus replay. |
| Claude notifications polluted Assistant Markdown. | Fixed. Notifications retain metadata in `run_meta` and do not become transcript text. |

## Product consistency resolutions

- The shared Agent session panel is mounted inside Claude and OpenCode vendor
  controls, exposing advertised list/resume/close/delete/logout/provider/config
  operations without restoring the removed standalone ACP composer button.
- Static public ACP capabilities no longer under-report Codex/OpenCode transport,
  resume, MCP, Skills, Sandbox, or subagent support; live handshake data still
  narrows provider-specific controls.
- Codex Plan remains discoverable while inactive.
- Markdown export now includes visible tools, plans, file changes, permissions,
  user-input decisions, subagents, and media status while excluding reasoning,
  raw tool payloads, tool output, and secret answers.

## Explicit boundaries

- Desktop-only stdio/host MCP bridges cannot be injected into a remote Agent
  that does not advertise ACP MCP bridging. HTTP/SSE remains available when the
  Sandbox can reach it.
- Provider-native undo/redo/rewind varies by adapter; AstraFlow does not label its
  workspace restore as provider-native history.
- Runtime commands, modes, models, agents, and authentication methods remain
  handshake-driven because versions, accounts, models, OS, and workspaces alter
  what the Agent advertises.
