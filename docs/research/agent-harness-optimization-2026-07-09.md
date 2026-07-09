# AstraFlow DeepAgent Harness Optimization — Round 2

Date: 2026-07-09
Follow-up to: `agent-harness-optimization-2026-07-06.md`

Inputs: web research sweep (Anthropic building-effective-agents / writing-tools-for-agents / effective-context-engineering / harness-design-long-running-apps, LangChain deepagents JS docs, Manus context-engineering, Cognition don't-build-multi-agents, Codex/Amp/Cursor prompt analyses) plus a full code audit of the deepagents runtime path.

## Changes Landed

### Prompt architecture
- `lib/agent/prompt-hygiene.ts`: the harness-profile `baseSystemPrompt` previously replaced deepagents' built-in `BASE_AGENT_PROMPT` (understand→act→verify loop, failure handling, progress updates) with three sentences. Rewritten as a full working-loop section: task flow, stop conditions (never retry the same failing call more than twice, stop when editing the same files without progress), permission-denial behavior, todo/subagent delegation discipline (self-contained prompts), and communication rules (final message is the deliverable, never mention tool names, `path:line` references). Duplicate "You are AstraFlow Agent" identity removed — identity lives only in the runtime prompt.
- `lib/modelverse-openai.ts` `DEFAULT_SYSTEM_PROMPT`: markdown sections, deduplicated against the base prompt, added root-cause/DRY and reversibility/blast-radius framing.
- `lib/agent/adapters/astraflow-runtime.ts` `createDeepAgentsSystemPrompt`: flat sentence pile → `## Environment` + `## Tool Guidance` sections.
- Subagent prompt now states it cannot ask the user questions and must return evidence-backed reports.
- Tool description overrides re-enriched with load-bearing operational facts that the compaction had dropped: read_file pagination/cat -n/batch/read-before-edit, grep literal-not-regex semantics, edit_file old_string uniqueness, task self-containment.

### Tool-call design
- `lib/agent/permission-gateway.ts`: denial strings now steer the model ("do not retry the same call; continue another way or ask") instead of bare "Permission denied by user".
- `lib/ai/tools/media-generation.ts`: generate image/video wrapped in try/catch returning actionable JSON errors (check schema → adjust → retry once → report); all outputs compact JSON (was pretty-printed, ~30% token waste); `studio_get_media_generation` miss now points to `studio_list_media_generations`.
- `lib/ai/tools/web.ts`: `web_search` network failures no longer throw raw; HTTP error bodies truncated to 500 chars with next-step guidance.
- `lib/ai/tools/astraflow-sandbox.ts`: `list_files` capped at 500 entries with a narrowing hint.
- `lib/ai/tools/user-input.ts`: every question field now has `.describe()`.

### Harness robustness / security
- `astraflow-runtime.ts`: per-session `MemorySaver` map removed — every run uses a random thread_id and resume is not wired, so retained checkpoints were pure leak (two-dimensional: per session × per run). Checkpointer is now per-run; `InMemoryStore` map is LRU-capped at 16 sessions.
- `lib/agent/deepagents-local-backend.ts`: `read`/`readRaw`/`downloadFiles`/`grep` now pass through the permission gateway. Ordinary reads auto-approve silently; paths matching the sensitive-secret policy (.env, key files, credentials) now require user approval — previously all local reads bypassed the gateway entirely, making `isSensitiveSecretPermissionRequest` dead code for reads.
- `lib/studio-skills.ts` / `lib/studio-session-skills.ts`: skill catalog name/description/category sanitized (single line, 240-char cap) before system-prompt injection — marketplace/frontmatter text could previously smuggle multi-line instruction-like content into the prompt.
- `load_skill` now uses a stat-only file walk (`listInstalledSkillFileStats`) instead of reading every bundled file into memory to print names and sizes.

Verified with `bun run lint` + `bun run typecheck` (both clean).

## Prioritized Next Steps (not landed — need product decisions or larger work)

1. **Summarization trigger for small-context models** — deepagents always installs `createSummarizationMiddleware`; unknown ModelVerse model names likely fall back to a fixed 170k-token trigger, so models with 64k/128k windows hit hard context overflow before compaction ever fires. Fix: attach a model profile (maxInputTokens) to the LangChain client in `createModelverseChatModel`, or patch the middleware trigger per model. (`node_modules/deepagents/dist/langsmith-*.js:3699`)
2. **bash-security AST stub** — `bash-security.ts:25` stubs the tree-sitter parse to `null`; the "primary gate" comment references an `ast.ts` that does not exist. Approval is regex-blacklist only and never hard-blocks. Either restore the AST path or re-document the actual guarantee.
3. **`/compact` advertised but no-op** — runtime info claims `compact: true` and the composer renders `/compact`, but the handler returns false for non-codex runtimes. Wire manual compaction (invoke the summarization middleware, or trim + summarize studio history) or stop advertising it.
4. **`allow_always` granularity** — one approval on `execute` permanently allows all future shell commands in that project (rules keyed by tool name only). Consider command-prefix rules for execute and path-prefix rules for writes.
5. **Local backend jail** — reads/writes can still traverse anywhere the user can (rootDir defaults to home, `virtualMode` off). Full jail conflicts with session-file attachments living in the app data dir; if desired, use `virtualMode: true` plus an explicit attachment allowlist.
6. **Token budget / request-side accounting** — usage is only recorded after responses; nothing constrains the next request. Full message history is re-sent every turn with no cap (`studio-chat-runner.ts:390`).
7. **KV-cache-friendly prompt assembly** — ModelVerse (OpenAI-compatible) gets no prompt-caching middleware; keep the assembled system prompt byte-stable within a session (it currently is, per-session) and consider ordering guarantees when session files/skills change mid-session.
8. **Evals** — replay fixtures exist (`tests/fixtures/agent/*`); add cases for the new behaviors: permission-denial non-retry, secret-read prompting, media error recovery, subagent report discipline.
