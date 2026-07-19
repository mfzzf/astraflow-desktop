# Claude Code independent review

Baseline: `@agentclientprotocol/claude-agent-acp` 0.59.0,
`@anthropic-ai/claude-agent-sdk` 0.3.215, ACP SDK 1.2.1.

## Product ACP path

Implemented and verified:

- persistent multi-turn ACP sessions; list/load/resume/fork/close/delete;
- text, thinking, tools, terminal, files, diffs, cancellation, images and
  embedded context;
- live Plan and permission modes, model/effort/Fast/custom-agent config, plus
  dynamic slash commands;
- structured compaction progress, task plans, subagents, background tasks,
  hooks, goals, prompt suggestions, plugin status, tool summaries, auth status,
  usage and rate-limit metadata;
- form elicitation and `AskUserQuestion` through the shared input panel;
- local/Sandbox ACP transport with raw Claude SDK metadata preserved;
- Studio MCP and Skills injection for Modelverse and local-settings sessions;
- scoped permission decisions, fail-closed posture changes, and non-polluting
  notification metadata.

## Adapter and isolation boundaries

| Capability | Classification | Reason |
| --- | --- | --- |
| Claude-native `Query.rewindFiles()` and conversation rewind | Adapter boundary | The pinned ACP adapter captures checkpoint data but exposes no rewind session method. AstraFlow offers only clearly labeled workspace restore. |
| JSON-schema structured output | Adapter boundary | Present in Agent SDK `outputFormat`, absent from the pinned ACP prompt/session contract. Prompt simulation would not provide schema guarantees. |
| Interactive Claude login | Host/experimental ACP boundary | The adapter exposes only unstable terminal-auth methods for local login. AstraFlow has no secure PTY-auth handoff and therefore supports preconfigured local auth, Modelverse, status, and logout only. |
| URL elicitation | Adapter boundary | The pinned adapter/client contract advertises form elicitation only. |
| Desktop stdio/host tools inside Sandbox | Isolation boundary | The pinned Claude adapter advertises HTTP/SSE MCP, not ACP MCP bridging; local absolute paths cannot safely cross the boundary. |
| Channels, team messaging/control, workflow phase control, human-origin metadata | Adapter boundary | The pinned ACP adapter does not publish these native controls. Runtime tasks/subagents/commands still render dynamically. |

## Platform-only

Anthropic Computer Use in its interactive macOS client, `claude agents` Agent
view, hosted web/mobile/remote-control/routines/autofix/ultraplan/ultrareview,
subscription features, and organization policy administration are not headless
ACP runtime capabilities. Runtime-advertised commands may still pass through
when the user's environment and account support them.

The hidden `claude-native` adapter is explicitly local-only and experimental;
it is retained for SDK mapping coverage and is not presented as public parity.

