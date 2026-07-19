# OpenCode independent review

Baseline: `opencode-ai` 1.18.3. The pinned and current official documentation
snapshots differ only in hosted Go/Zen material at review time; ACP/server core
documentation has no relevant drift.

The public `opencode` ACP path is the supported product integration. It covers
session list/resume/fork/close, text/reasoning/tools/files/terminal streaming,
Build/Plan, model and Agent config, subagents, permission and form elicitation,
dynamic commands, synthetic compaction lifecycle, rules, Skills, MCP,
references, images, usage/cost, local transport, and Sandbox transport.

Review fixes include bundled-binary-first resolution, real ACP smoke calls for
list/resume/fork/close and media/MCP/config capabilities, mounted Agent session
controls, Studio Skills/MCP injection for local-settings sessions, accurate
public capabilities, and explicit rejection of Mac-local settings in Sandbox.

The hidden `opencode-native` HTTP adapter is explicitly local-only and
experimental; it no longer claims Plan or compaction. It is not counted as a
second public integration until provider permission/question responses and the
broader Server API are deliberately productized.

OpenCode 1.18.3 ACP explicitly lacks native `/undo` and `/redo`. TUI themes,
keybindings, editor/help UI, GitHub/GitLab CI, hosted Zen/Go billing, and
enterprise SSO/central administration are outside Desktop Agent parity.

