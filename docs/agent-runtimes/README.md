# Agent runtime documentation snapshots

This directory is the audit source of truth for AstraFlow Desktop parity with
the three public coding-agent runtimes. The snapshots were refreshed on
2026-07-19 and are intentionally stored beside the implementation reviews so a
future runtime upgrade can be reviewed without relying on mutable web pages.

## Contents

| Runtime | Pinned integration | Complete official snapshot | Pinned-package evidence |
| --- | --- | --- | --- |
| Codex | `@openai/codex` 0.144.5 + `@agentclientprotocol/codex-acp` 1.1.4 | `codex/official/llms-full.txt`, `codex/official/codex-manual.md` | `codex/pinned-packages/` |
| Claude Code | `@agentclientprotocol/claude-agent-acp` 0.59.0 + `@anthropic-ai/claude-agent-sdk` 0.3.215 | `claude-code/official/llms-full.txt` | `claude-code/pinned-packages/` |
| OpenCode | `opencode-ai` 1.18.3 | all English MDX pages in `opencode/official-v1.18.3/`; a current-HEAD drift snapshot is in `opencode/official-current/` | `opencode/pinned-package/` |

Independent reviewer reports and reconciled resolutions are in
[`reviews/`](./reviews/README.md). The public product integrations are the three
ACP runtimes; hidden direct/native adapters are experimental mapper surfaces and
are not used to inflate the parity claim.

The compact `llms.txt` files are page indexes. The `llms-full.txt` files are the
complete machine-readable documentation exports supplied by OpenAI and
Anthropic. OpenCode does not publish an `llms.txt` endpoint, so its complete
English documentation source is preserved directly from the official GitHub
repository at both the installed tag and the current upstream commit.

## Parity boundary

The parity reviews classify a feature as implementable when the pinned runtime
exposes it through ACP, app-server, the Claude Agent SDK, the OpenCode server,
or a stable local configuration/file contract that AstraFlow can host without
pretending to be the vendor's cloud service. Vendor-hosted billing, organization
administration, proprietary cloud execution, subscription entitlements, and
account-only web/mobile surfaces are recorded as platform-only rather than
fabricated locally.

Runtime-published capabilities remain authoritative. Dynamic commands, modes,
models, and configuration options must be rendered when advertised and must not
be invented when the installed runtime withholds them.

The implementation pass also enforces two cross-runtime safety boundaries:

- Provider-scoped options neither match nor create broad Studio project rules.
  Only AstraFlow-owned choices may opt into Studio rule lookup and persistence.
- A Sandbox cannot consume this Mac's CLI login/config files. Local-settings
  mode is rejected before remote Agent startup; Modelverse or a local workspace
  is required.

## Updating

Refresh the two text exports from their official endpoints, then replace the
OpenCode directories from the official repository:

```bash
curl -fsSL https://developers.openai.com/codex/llms.txt \
  -o docs/agent-runtimes/codex/official/llms.txt
curl -fsSL https://developers.openai.com/codex/llms-full.txt \
  -o docs/agent-runtimes/codex/official/llms-full.txt
curl -fsSL https://developers.openai.com/codex/codex-manual.md \
  -o docs/agent-runtimes/codex/official/codex-manual.md
curl -fsSL https://code.claude.com/docs/llms.txt \
  -o docs/agent-runtimes/claude-code/official/llms.txt
curl -fsSL https://code.claude.com/docs/llms-full.txt \
  -o docs/agent-runtimes/claude-code/official/llms-full.txt
```

For OpenCode, copy the root English MDX files from
`packages/web/src/content/docs/` at the installed tag and at upstream `dev`, and
record each Git commit in the adjacent `GIT_COMMIT.txt`.

## Attribution

The downloaded files remain copyright their respective upstream owners and are
stored as review snapshots. AstraFlow-authored matrices and review reports are
separate files outside the `official/` and `official-*` directories.
