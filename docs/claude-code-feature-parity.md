# Claude Code feature parity

This document is the compatibility contract for AstraFlow's pinned Claude Code
integrations:

- `claude-code`: `@agentclientprotocol/claude-agent-acp` over ACP, used for the
  product-facing Claude Code runtime.
- `claude-native`: `@anthropic-ai/claude-agent-sdk`, retained as the direct SDK
  runtime and mapper test surface. The SDK is pinned to `0.3.215`.

The source of truth is the pinned package behavior plus Anthropic's current
[Claude Code features](https://code.claude.com/docs/en/features-overview),
[commands](https://code.claude.com/docs/en/commands), and
[Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) documentation.
Runtime-published capabilities and commands always win over this inventory.

## Product parity matrix

| Claude Code capability | AstraFlow implementation |
| --- | --- |
| Multi-turn sessions | Provider session IDs are persisted per Studio chat and resumed through ACP load/resume. The direct SDK runtime now resumes its recorded SDK session instead of rebuilding context from a transcript recap. |
| Resume, branch, and fork | ACP session list/load/resume/delete/close are implemented. Claude's ACP `session/fork` creates a new provider session and a new Studio chat. `/branch`, `/fork`, `/resume`, and other runtime commands remain available when advertised by Claude. |
| Plan mode | The live Claude `mode` config is rendered in the composer. Plan can be toggled with the control or `Shift+Tab`; `ExitPlanMode` and adapter mode updates keep the UI synchronized. |
| Permission modes | Every adapter-published mode is selectable, including `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`, and `auto` when the selected model supports it. Tool approval is rendered with ACP permission options and AstraFlow's approval broker. |
| Model, effort, fast mode, and main agent | ACP session config options are rendered from the adapter rather than hard-coded. This includes model-dependent effort values, Fast mode, and filesystem-defined custom main-thread agents. |
| Dynamic slash commands | `supportedCommands()` and mid-session `commands_changed` updates replace the cached command list. Skills, plugins, and version/plan-specific commands therefore appear only when the pinned Claude runtime actually supports them. |
| Context compaction | `/compact`, automatic compaction boundaries, success, failure, cancellation, and post-compaction context usage render as one structured progress lifecycle. |
| Structured tasks and plans | Claude's current `TaskCreate`, `TaskUpdate`, `TaskList`, and `TaskGet` tools are accumulated into a stable structured plan instead of appearing as unrelated raw JSON tool cards. Legacy `TodoWrite` remains supported. |
| Subagents and background work | Agent/Task tool calls, nested parent IDs, progress summaries, terminal states, and background subagent output map into AstraFlow's subagent cards and side panel. Claude's replace-semantics background-task snapshot is also shown in the live composer controls. |
| Tools, terminals, and edit review | ACP filesystem and terminal methods are implemented with workspace scoping, live output, cancellation, permission checks, diffs, and file-change events. Claude tool summaries use the same compact Synara-style activity surface as other runtimes. |
| Images, file mentions, and extra directories | ACP image and embedded-context prompt capabilities are honored. File/folder mentions and authorized additional workspace roots are forwarded with the prompt/session. |
| MCP and elicitation | Installed Studio MCP servers and AstraFlow Skills are attached for both Modelverse and local-settings sessions. Form elicitation and `AskUserQuestion` use the shared user-input panel. In Sandbox, HTTP/SSE servers work when reachable from the Sandbox; Desktop-only stdio and host-tool bridges cannot cross isolation unless the Agent advertises ACP MCP bridging, which the pinned Claude adapter does not. URL elicitation is not advertised by the pinned adapter. |
| CLAUDE.md, rules, memory, Skills, agents, hooks, plugins | The Claude adapter/SDK loads user, project, and local filesystem settings using Claude Code's normal discovery rules. Runtime command refreshes surface newly discovered commands and skills. Hook start, progress, and completion frames are bridged from the SDK extension channel into normal AstraFlow tool activity. Plugin installation progress and persistence failures are also surfaced. |
| Authentication and usage limits | Preconfigured local Claude credentials, Modelverse gateway authentication, logout, authentication status, session usage, context window, and Claude rate-limit metadata are preserved. The pinned adapter exposes interactive Claude login only through ACP's unstable terminal-auth method; AstraFlow does not advertise that method because it has no secure PTY-auth handoff. |
| Active goals and prompt suggestions | Claude's active `/goal` state and generated next-prompt suggestions are bridged from raw SDK events. The composer shows goal condition/iterations and lets the user adopt a suggested prompt. |
| Generated tool summaries | `tool_use_summary` frames update the final tool in the summarized batch, so Claude's semantic summary replaces raw protocol titles in the compact activity surface. |
| File checkpoints and rewind | Both integrations enable Claude file checkpoint capture and replay user-message UUIDs. The direct SDK mapper records checkpoint IDs. The product-facing ACP adapter does not expose `Query.rewindFiles()`, so AstraFlow only offers its provider-independent per-message workspace restore; it does not claim Claude-native conversation/file rewind or `/undo`/`/redo` parity. |
| Streaming and prompt lifecycle | Partial text, thinking, tool input/output, cancellation, terminal progress, subagent progress, retry/notification metadata, and final stop reasons stream without rebuilding completed content. The ACP adapter keeps a persistent streaming-input query and serializes provider turns; Desktop still presents one active composer run at a time. |
| Structured output | The Claude Agent SDK supports JSON-schema output, but the pinned Claude ACP adapter has no session/prompt field for it. The hidden `claude-native` adapter remains an experimental mapper surface and is not a second product runtime. Structured output is therefore recorded as unavailable through the product ACP contract instead of being simulated with a prompt. |
| Channels, teams, and dynamic workflows | Runtime-published commands, tasks, subagents, background work, and metadata are rendered. Native channel transport, team messaging/control, workflow phase control, and human-origin metadata are not exposed by the pinned ACP adapter, so AstraFlow does not advertise them as native parity. |

## Plan mode contract

Plan mode is a session mode, not a hard-coded AstraFlow prompt. The pinned
Claude ACP adapter advertises it through both `modes.availableModes` and the
`mode` session config option. AstraFlow therefore:

1. Reads the live mode list instead of assuming Plan is available.
2. Switches through `session/set_config_option` when the adapter publishes the
   `mode` option, with `session/set_mode` as the protocol fallback.
3. Keeps the composer state synchronized from `current_mode_update` and
   `config_option_update` notifications, including mode changes made by
   `EnterPlanMode` and `ExitPlanMode`.
4. Exposes the same `Shift+Tab` shortcut as Claude Code.
5. Leaves plan approval to Claude's `ExitPlanMode` permission request. The
   adapter only offers modes supported by the active model, and AstraFlow sends
   the selected ACP permission option back without translating it into a
   synthetic chat response.

The current pinned runtime does not advertise `/plan` in its headless slash
command list on every installation. AstraFlow does not fabricate that command;
the Plan control remains available because the session mode is the authoritative
ACP capability.

## Local and Sandbox command contract

Claude commands are discovered after `session/new`, before the first prompt.
The full `available_commands_update` payload replaces the prior list, including
argument hints and extension metadata. The same rule applies to local stdio and
Sandbox WebSocket transports. Sandbox must also pass through the Claude session
metadata that enables hook events, prompt suggestions, file checkpoints,
subagent summaries, and filtered `_claude/sdkMessage` notifications. A Sandbox
cannot inherit this Mac's `~/.claude` credentials or settings; AstraFlow rejects
that combination before starting the Agent and requires Modelverse or a local
workspace.

`scripts/smoke-acp.ts claude-code` verifies the installed adapter publishes a
non-empty command list, exposes `/compact`, and can enter and leave Plan mode.
The Workspace Gateway tests separately prove that command descriptors, Plan
config changes, raw Claude SDK events, and `/compact` prompts cross the Sandbox
ACP WebSocket unchanged.

## Platform-dependent commands

Claude publishes commands dynamically because availability depends on the
installed version, authentication, subscription, operating system, repository,
and host capabilities. AstraFlow does not fabricate unavailable commands.
Cloud/browser/account commands such as `/autofix-pr`, `/background`, `/desktop`,
`/mobile`, `/remote-control`, `/schedule`, `/teleport`, `/ultraplan`, and
`/ultrareview` pass through when Claude advertises them and may still require
Anthropic, GitHub, browser, or subscription setup outside AstraFlow.

The pinned ACP adapter intentionally filters CLI-only commands that require a
terminal-owned UI (`clear`, `cost`, `keybindings-help`, `login`, `logout`,
`output-style:new`, `release-notes`, and `todos`). AstraFlow supplies its own
transcript, authentication controls, usage UI, task plan, and workspace-history
controls where the protocol exposes an equivalent. Interactive terminal login,
Claude-native rewind, structured output, channel transport, and team/workflow
control remain explicit adapter/host boundaries rather than fabricated parity.

Anthropic Computer Use, the `claude agents` TUI, and Anthropic-hosted web,
mobile, remote-control, routines, autofix, ultraplan, and ultrareview surfaces
are outside the headless ACP runtime contract. Organization policy can be read
and enforced by Claude but remains administrator-owned.

## Verification

Run the Claude-specific protocol smoke and the normal repository checks:

```bash
bun run smoke:claude-agent-acp
bun test tests/claude-features.test.ts tests/acp-v1-conformance.test.ts
bun run typecheck
bun run lint
git diff --check
```
