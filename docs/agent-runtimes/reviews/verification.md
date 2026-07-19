# Verification record

Final verification on 2026-07-19:

- `bun run typecheck`: passed, including Codex generated-contract, bundled
  Skills, AstraFlow ACP, and release-platform checks.
- `bun run lint`: passed with no warnings.
- Focused Bun suites: 101 assertions/tests across ACP conformance, Claude and
  OpenCode features, runtime commands, structured events, session continuation,
  deletion, stop reasons, usage, tool labels, native Skills, and Markdown audit
  export passed.
- `bun run smoke:agent-acp`: Codex, Claude Code, and OpenCode passed; Claude
  Plan/compact and OpenCode session/config/MCP/image/compact checks succeeded.
- `bun run smoke:opencode-native`: passed startup smoke for the hidden
  experimental adapter.
- `bun run smoke:codex-app-server`: pinned 0.144.5 initialized successfully.
- `bun run smoke:workspace-gateway`: 13 passed, 2 PTY tests skipped by the
  environment, 0 failed.
- `node --import tsx --test tests/astraflow-agent-capability-chain.node.test.mjs`:
  2 passed, covering local/Sandbox Skills and expert/plugin chain behavior.
- `git diff --check`: passed.
- Documentation SHA-256 values in Codex and Claude `SOURCE.md` match the stored
  files. OpenCode pinned/current comparison differs only in commit marker,
  `go.mdx`, and `zen.mdx`.

`bun run check:agent-runtime-updates` reported only `@openai/codex` drift:
0.144.5 pinned versus 0.144.6 latest. All other five pinned runtime packages
match npm latest. Codex was explicitly outside the requested implementation
focus, so this pass did not mix a runtime upgrade into the Claude-focused work.

