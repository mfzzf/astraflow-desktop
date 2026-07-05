# Subagent 1 Component Reuse Review

Scope: cases where AstraFlow Desktop reimplements behavior that is usually better delegated to mature Next/React packages, primitives, or existing components. I did not modify application code and did not run a build or dev server.

References checked:
- Local Next docs: `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md` notes that Client Components can use SWR or React Query for client-side data fetching.
- Local Next docs: `node_modules/next/dist/docs/01-app/02-guides/forms.md` recommends schema validation such as Zod for server-side form validation.
- TanStack Query docs: <https://tanstack.com/query/latest/docs/framework/react/overview>
- TanStack Table docs: <https://tanstack.com/table/latest/docs/framework/react/guide/table-state>
- React Hook Form docs: <https://react-hook-form.com/docs/usefieldarray>
- shadcn form docs: <https://ui.shadcn.com/docs/forms>
- AI SDK `useChat` docs: <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>
- Media Chrome React docs: <https://www.media-chrome.org/docs/en/react/get-started>
- Streamdown docs: <https://streamdown.ai/docs/usage>
- React Arborist: <https://github.com/jameskerr/react-arborist>
- React Complex Tree: <https://github.com/lukasbach/react-complex-tree>

## Findings

### 1. High - Client server-state fetching is hand-rolled across core screens

Evidence:
- `components/skills-market-page.tsx:2033` defines a large local server-state surface for marketplace lists, installed lists, detail payloads, pagination cursors, loading flags, and errors.
- `components/skills-market-page.tsx:2181` implements a manual debounce that resets query, page, and cursor state.
- `components/skills-market-page.tsx:2214`, `components/skills-market-page.tsx:2272`, `components/skills-market-page.tsx:2325`, and `components/skills-market-page.tsx:2421` each implement separate `useEffect` fetch flows with `AbortController`, duplicate loading/error handling, and cache invalidation by local dependency changes.
- `components/model-square-page.tsx:1092` defines local filter, refresh, response, price, loading, and status state.
- `components/model-square-page.tsx:1129`, `components/model-square-page.tsx:1186`, and `components/model-square-page.tsx:1230` implement separate fetch/cache effects for the model list, studio experience models, and model pricing.
- `components/model-square-page.tsx:946` implements custom localStorage cache helpers for model pricing.
- `components/studio-api-settings-page.tsx:341` and `components/studio-api-settings-page.tsx:391` manually coordinate loading, saving, deleting, settings, API keys, search, and status refresh state.
- `components/studio-image-workbench.tsx:305`, `components/studio-video-workbench.tsx:355`, and `components/studio-audio-workbench.tsx:360` repeat manual model-fetch effects.

Risk:
- This duplicates the hard parts of client server-state management: request deduping, cancellation, stale data, cache invalidation after mutations, retry behavior, background refresh, error state, garbage collection, and race prevention.
- The same UCloud/project-context state is fetched and invalidated through ad hoc dependency lists, `refreshNonce`, `queueMicrotask`, `cancelled`, and localStorage cache code. That makes regressions likely when project selection, auth, pricing, or marketplace state changes.
- Manual caches can drift from server truth and are harder to invalidate consistently than query-keyed server state.

Replacement options:
- Add a query layer with TanStack Query for mutable client server state, or SWR for simpler read-mostly resources. The local Next docs explicitly call out SWR and React Query for Client Components.
- Define stable query keys such as `["skills", "market", pluginType, category, debouncedQuery, page, cursor]`, `["skills", "installed", pluginType, category]`, `["models", "square", filters]`, and `["studio", "mediaModels", generationType]`.
- Move marketplace install/uninstall, API key create/update/delete, generation create/delete, and pricing refresh into `useMutation` calls that invalidate the affected query families.
- Replace `refreshNonce` and localStorage pricing helpers with `staleTime`, `gcTime`, optional TanStack persistence, and explicit invalidation after project/auth changes.
- For data that can be loaded before hydration, use Next server components plus React `use`/streaming patterns where it fits the route structure.

### 2. High - The video player reimplements accessible media controls already available in the repo stack

Evidence:
- `components/ui/video-player.tsx:58` stores playback, current time, duration, volume, mute, fullscreen, hover, control visibility, seek, and error state manually.
- `components/ui/video-player.tsx:103` implements custom play, mute, volume, seek, fullscreen, and skip handlers.
- `components/ui/video-player.tsx:170` wires media events manually.
- `components/ui/video-player.tsx:211` implements custom keyboard shortcuts for playback, seeking, mute, volume, and fullscreen.
- `components/ui/video-player.tsx:298` renders a raw `<video>` without native controls, followed by a full custom overlay at `components/ui/video-player.tsx:307`.
- `components/ai-elements/audio-player.tsx:10` already imports Media Chrome React controls, and `components/ai-elements/audio-player.tsx:29` wraps audio in `MediaController`.
- `components/studio-video-workbench.tsx:31` imports the custom `VideoPlayer`, and `components/studio-video-workbench.tsx:1276` uses it for generated video preview.

Risk:
- Media controls are accessibility- and browser-behavior-heavy. Keyboard support, fullscreen, time ranges, volume controls, touch behavior, focus management, captions, PiP, and error states are easy to get subtly wrong.
- The custom implementation creates maintenance drift because audio uses Media Chrome while video uses a separate control system.
- Any future improvements such as captions, playback rate, AirPlay, PiP, or custom control layouts must be rebuilt for video instead of shared with audio.

Replacement options:
- Replace `components/ui/video-player.tsx` with Media Chrome React components, matching the existing audio player pattern: `MediaController`, `MediaControlBar`, `MediaPlayButton`, `MediaTimeRange`, `MediaTimeDisplay`, `MediaVolumeRange`, `MediaMuteButton`, `MediaFullscreenButton`, and optional `MediaPipButton`.
- Keep the current generated-video visual shell if needed, but make the controls package-owned and reuse shared media styling.
- If the product needs a higher-level player abstraction later, evaluate Vidstack. For the current codebase, Media Chrome is the lowest-friction replacement because it is already in use.

### 3. Medium - Complex forms and generated parameter editors are manually controlled instead of using form primitives

Evidence:
- `components/skills-market-page.tsx:1260` comments that `McpHeadersEditor` maintains stable row IDs in local state, then `components/skills-market-page.tsx:1287` implements manual row update/removal.
- `components/skills-market-page.tsx:1320` maps header rows to manually controlled inputs and raw checkbox controls.
- `components/skills-market-page.tsx:1385` starts `McpManualDialog`, a large manual form with controlled fields, select state, checkbox state, and a button-driven submit path instead of a schema-backed form.
- `components/studio-api-settings-page.tsx:494` implements manual submit validation, parsing, payload creation, loading state, and form reset.
- `components/studio-api-settings-page.tsx:1103` renders a large API key form with manually wired inputs, textareas, selects, and checkboxes.
- `components/studio-agent-model-settings-page.tsx:275` implements manual validation for custom models, and `components/studio-agent-model-settings-page.tsx:351` normalizes form state with a custom `updateForm`.
- `components/studio-image-workbench.tsx:873` renders a custom `ParameterControl` for boolean/select/slider/number/text fields. Similar generated parameter state exists in `components/studio-video-workbench.tsx:268` and `components/studio-audio-workbench.tsx:263`.

Risk:
- Validation, dirty tracking, nested array fields, dynamic defaults, reset behavior, disabled states, and submit race handling are spread across component bodies instead of concentrated in a form abstraction.
- The MCP header editor and studio parameter editors are exactly the kind of dynamic field arrays/schema-driven forms that become fragile when maintained by hand.
- Raw checkbox/input wiring makes it easier to miss accessibility labels, error associations, and consistent validation feedback.

Replacement options:
- Use React Hook Form with `@hookform/resolvers/zod` and shadcn Form components for manually designed forms such as API key settings and agent model settings.
- Use `useFieldArray` for MCP headers and dynamic array inputs instead of maintaining `rowIdState` and row mutations by hand.
- Move media parameter metadata into Zod schemas or a small schema-driven renderer that emits React Hook Form fields. If the parameter set grows toward arbitrary backend-provided schemas, evaluate `@rjsf/core` or TanStack Form.
- Keep Sonner for transient submit feedback, but let the form library own field validation, dirty state, touched state, reset, and submit disabling.

### 4. Medium - The API key management table is a bespoke grid with manual filtering and no table-state abstraction

Evidence:
- `components/studio-api-settings-page.tsx:362` implements search/status filtering as custom predicate helpers.
- `components/studio-api-settings-page.tsx:792` renders a hand-written `<table>` with fixed columns and static headers.
- `components/studio-api-settings-page.tsx:847` maps rows directly with custom cell layouts and action buttons.
- `components/studio-api-settings-page.tsx:794` uses `min-w-[1150px]` and a fixed `colgroup`, making layout management manual.

Risk:
- Sorting, filtering, pagination, column sizing, row selection, empty states, keyboard navigation, and virtualization will each need separate bespoke code as the table grows.
- Manual table state is easy to desynchronize from search/status controls and makes URL/shareable state harder to add.
- Fixed column sizing increases responsive maintenance burden for a desktop app that still needs ergonomic resizing and constrained panes.

Replacement options:
- Use TanStack Table with the existing shadcn table primitives for API key management and other management tables.
- Control `globalFilter`, column filters, sorting, pagination, and row selection through TanStack Table state. This keeps the existing centered header/body styling while moving behavior to a proven table engine.
- Add `@tanstack/react-virtual` only if row counts justify virtualization.
- Keep custom cell renderers for key preview, status badges, model counts, and actions; replace only the table-state engine.

### 5. Medium - Chat streaming, session state, and polling duplicate AI SDK chat primitives

Evidence:
- `hooks/use-studio-chat-run.ts:25` defines `useStudioChatRunLiveStream`, a custom live-stream hook.
- `hooks/use-studio-chat-run.ts:54` opens an `EventSource` directly.
- `hooks/use-studio-chat-run.ts:57` batches snapshots with `requestAnimationFrame`.
- `hooks/use-studio-chat-run.ts:95` manually wires open, snapshot, done, error, and close event handling.
- `components/studio-chat-workbench.tsx:1650` defines extensive local chat state for sessions, messages, runtime, active run, attachments, streaming flags, errors, and preferences.
- `components/studio-chat-workbench.tsx:2168` implements a polling fallback while live stream state is not connected.
- `components/studio-chat-workbench.tsx:2218` applies live snapshots to local message state.
- `components/studio-chat-workbench.tsx:2275` and `components/studio-chat-workbench.tsx:2506` manually coordinate assistant-run creation, user-message creation, local append/replace behavior, and title updates.

Risk:
- Chat is one of the highest-churn surfaces in the product. Custom transport, polling fallback, optimistic message insertion, run state, stream coalescing, and persistence create a large behavioral surface that is difficult to test.
- The code already depends on the AI SDK package, but the UI is not using the SDK chat state/streaming primitives that handle message state, status, errors, and streaming updates.
- The current hook is transport-specific and may make it harder to support resumable streams, tool parts, attachments, partial message updates, or model-provider changes.

Replacement options:
- Migrate chat state to AI SDK `useChat` with `DefaultChatTransport` or a custom `ChatTransport` that adapts the existing AstraFlow run API.
- On the server side, expose AI SDK-compatible UI message streams where feasible, or map the existing SSE snapshots into typed `UIMessage` updates in a transport adapter.
- Persist sessions/messages in the existing backend, but hydrate `useChat` only on active session changes, matching the project note about avoiding history/messages feedback loops.
- If a full `useChat` migration is too large, extract the current SSE/polling/session reload behavior behind a reusable query/transport module and use TanStack Query for session/message cache invalidation.

### 6. Medium - The workspace file browser and preview rebuild tree, search, and code-viewer behavior

Evidence:
- `components/studio-chat-workbench.tsx:3754` defines local state for directory, listing, preview, query, loading, errors, preview request guards, and selected files.
- `components/studio-chat-workbench.tsx:3787` implements manual file preview loading and request race prevention.
- `components/studio-chat-workbench.tsx:3856` implements manual directory loading.
- `components/studio-chat-workbench.tsx:3918` handles directory navigation and file selection manually.
- `components/studio-chat-workbench.tsx:3935` filters entries with raw lowercase substring matching.
- `components/studio-chat-workbench.tsx:3982` renders a custom list of directories/files as buttons rather than a tree widget with established keyboard and ARIA behavior.
- `components/studio-chat-workbench.tsx:4102` renders code preview through `CodeBlockCode`, and `components/studio-chat-workbench.tsx:4135` implements custom markdown frontmatter parsing.

Risk:
- File-tree interactions quickly accumulate edge cases: keyboard navigation, focus roving, expansion state, lazy loading, virtualized long directories, search highlighting, drag/drop, rename, multi-select, and accessibility semantics.
- Manual preview request guards and substring search are a sign that this panel is becoming a mini file explorer. More workspace features will make this component harder to evolve safely.
- Static Shiki rendering is fine for small read-only previews, but it is not a code editor if the product later needs find-in-file, selection preservation, syntax-aware navigation, or large-file performance.

Replacement options:
- Use React Arborist or React Complex Tree for the file tree/list behavior. Both provide established tree interaction patterns; React Complex Tree also emphasizes WAI-ARIA-style keyboard control.
- Keep the existing backend file APIs, but expose them through lazy tree loaders and a preview query keyed by workspace/root/path.
- Use Fuse.js or `match-sorter` if search should be fuzzy and ranked rather than substring-only.
- Keep Shiki for read-only previews if requirements stay simple. If preview becomes interactive, use CodeMirror 6 via `@uiw/react-codemirror` or Monaco for editor-grade text behavior.

### 7. Medium - Streaming markdown and code rendering reimplement package-level parser/rendering concerns

Evidence:
- `components/prompt-kit/markdown.tsx:63` implements custom hashing.
- `components/prompt-kit/markdown.tsx:77` implements custom detection for markdown tables, code fences, unclosed tags, and incomplete HTML blocks.
- `components/prompt-kit/markdown.tsx:131` tokenizes content with `marked.lexer` and manually composes stream-safe blocks.
- `components/prompt-kit/markdown.tsx:256` creates object URLs for custom HTML preview handling.
- `components/prompt-kit/markdown.tsx:372` implements a bespoke code block with copy, code/preview tabs, and an iframe preview sandbox.
- `components/prompt-kit/markdown.tsx:573` memoizes block rendering manually.
- `components/prompt-kit/code-block.tsx:42` runs Shiki `codeToHtml` client-side in an effect, then `components/prompt-kit/code-block.tsx:82` injects the highlighted HTML with `dangerouslySetInnerHTML`.

Risk:
- Incremental markdown parsing, incomplete fences/tables/HTML, syntax highlighting, copy affordances, memoization, and security boundaries are difficult to maintain in a streaming chat context.
- Client-side highlighting effects can add CPU work to long chats and can rerun on render churn.
- The custom iframe preview path increases the review burden for sandbox policy and user-generated HTML behavior.

Replacement options:
- Replace the custom streaming markdown block splitter with Streamdown, which is designed as a streaming-safe replacement for `react-markdown` and includes AI-oriented handling for incomplete markdown, GFM, syntax highlighting, math, diagrams, and memoization.
- Alternatively, use the AI Elements response/message primitives if the project standardizes on Vercel AI SDK UI.
- Keep product-specific overrides for links, file references, copy buttons, and HTML preview, but make the markdown stream parser and code renderer package-owned.

## Suggested Migration Order

1. Introduce TanStack Query around one bounded surface first, preferably marketplace or model square, then extract shared query keys and mutation invalidation helpers.
2. Replace the custom video player with Media Chrome React controls because the package is already used for audio and the change can be scoped to one component.
3. Move the API key form and MCP headers editor to React Hook Form plus Zod, then reuse the same pattern for generated media parameter forms.
4. Migrate the API key table to TanStack Table before adding more management-table behavior.
5. Treat chat, file tree, and streaming markdown as larger follow-up migrations because they touch core workflow behavior and persistence.
