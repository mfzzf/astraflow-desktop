# Independent runtime reviews

Four read-only reviewers audited the downloaded official documentation, pinned
packages, protocol adapters, product UI, local/Sandbox transports, and focused
tests. Their raw findings were reconciled against the implementation after the
review pass; these files preserve the actionable conclusions without treating
vendor-hosted products as local runtime features.

| Review | Reviewer | Scope |
| --- | --- | --- |
| [Codex](./codex.md) | `019f7a5d-a1f3-7492-9115-e90f4b693d72` | Pinned Codex/app-server/ACP capability parity |
| [Claude Code](./claude-code.md) | `019f7a5d-a0b9-7383-9a58-998efd8ee3a1` | Pinned Claude ACP and Agent SDK parity |
| [OpenCode](./opencode.md) | `019f7a5d-a280-7de0-b200-e861985621e7` | Pinned OpenCode ACP/server/native parity |
| [Cross-runtime](./cross-runtime.md) | `019f7a5d-a31f-7c70-a979-f83d16a4955c` | Permission, UI, transport, export, and capability consistency |

The final command evidence is recorded in [verification.md](./verification.md).

The product paths are `codex`, `claude-code`, and `opencode`, all over ACP.
`codex-direct`, `claude-native`, and `opencode-native` are hidden experimental
adapter or mapper surfaces and are not counted as a second public integration.

## Status vocabulary

- **Implemented**: available through the public ACP path and represented in UI
  or runtime behavior.
- **Dynamic**: rendered only when the running Agent advertises it.
- **Adapter boundary**: available in a vendor SDK/server but absent from the
  pinned public ACP contract used by AstraFlow.
- **Isolation boundary**: cannot safely cross Desktop/Sandbox isolation without
  a new authenticated proxy or synchronization protocol.
- **Platform-only**: owned by a vendor cloud, subscription, admin console, TUI,
  IDE, browser, or mobile product rather than the local coding-agent runtime.
