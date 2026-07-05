# Subagent 02 Code Quality Review

Scope: code quality, maintainability, conventions, duplicated logic, unsafe typing, error handling, and API route patterns.

Verification: static review only. I did not change application code, run a build, or start the dev server.

## Findings

### High: Audio/video generation routes trust client-supplied OpenAPI metadata

Evidence:
- `components/studio-video-workbench.tsx:215` sends `openapi` and `fields` from the browser to `/api/studio/sessions/:id/video-generations`; `components/studio-video-workbench.tsx:600` passes `promptOpenapi` and `components/studio-video-workbench.tsx:601` passes `promptModel.fields`.
- `components/studio-audio-workbench.tsx:213` sends the same kind of payload; `components/studio-audio-workbench.tsx:549` passes `promptOpenapi` and `components/studio-audio-workbench.tsx:550` passes `promptOperation.fields`.
- `app/api/studio/sessions/[sessionId]/video-generations/route.ts:87` accepts `openapi.path`, `statusPath`, `adapter`, and `modelConstant` from the request body, while `app/api/studio/sessions/[sessionId]/video-generations/route.ts:99` uses `z.custom<StudioVideoParameterField>()`, which is a type assertion rather than runtime validation.
- `app/api/studio/sessions/[sessionId]/video-generations/route.ts:822` builds the provider endpoint from `input.openapi`, and `app/api/studio/sessions/[sessionId]/video-generations/route.ts:841` / `app/api/studio/sessions/[sessionId]/video-generations/route.ts:908` call that endpoint.
- `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:71` accepts the same OpenAPI metadata and `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:89` accepts custom-typed fields; `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:798` builds the endpoint directly from the request.
- The image route is safer: `app/api/studio/sessions/[sessionId]/image-generations/route.ts:750` resolves the server-side registry, `app/api/studio/sessions/[sessionId]/image-generations/route.ts:761` selects a supported operation, and `app/api/studio/sessions/[sessionId]/image-generations/route.ts:789` loads fields server-side.

Impact:
Authenticated clients can lie about operation metadata and field shapes. Even though the base URL is fixed to ModelVerse, this bypasses the server-side supported-operation registry and makes correctness depend on an untrusted frontend contract. It also makes route behavior brittle when generated OpenAPI metadata changes, because malformed fields can reach payload builders as trusted objects.

Actionable remediation:
Change audio/video POST bodies to accept only `modelId`, `modelName`, `operationId`, `prompt`, params, and media. Resolve `openapi` and fields server-side from `AUDIO_OPENAPI_MODELS` / `VIDEO_OPENAPI_MODELS`, following the image route pattern. Replace `z.custom<...>()` with concrete schemas only where the server truly accepts external structured input.

### Medium: Model Square refetches the full catalog on every search/filter edit

Evidence:
- `components/model-square-page.tsx:1063` builds requests with `limit: "all"`.
- `components/model-square-page.tsx:1132` fetches `queryUrl` whenever the memoized URL changes, and `components/model-square-page.tsx:1168` depends on that URL.
- `components/model-square-page.tsx:1315` updates `keyword` directly on input change; `components/model-square-page.tsx:1361` wires the search input to `updateKeyword`.
- `app/api/model-square/route.ts:325` defines `fetchAllModels`, `app/api/model-square/route.ts:352` fetches the first page, and `app/api/model-square/route.ts:356` loops through every remaining page.
- `app/api/model-square/route.ts:436` calls `fetchAllModels` before local filtering and `app/api/model-square/route.ts:462` slices only after the full catalog has been fetched, filtered, and sorted.

Impact:
Typing into search can trigger repeated full-catalog UCloud calls. That is expensive, slow on large catalogs, and more likely to hit upstream latency or rate limits. It also duplicates data transfer because the UI asks for all rows even though it renders a paged list with `visibleLimit`.

Actionable remediation:
Cache the catalog by project, locale, and sort key with a short TTL, or fetch once and do search/filtering locally after initial load. Add input debouncing if server search remains necessary. If UCloud supports keyword/modality/vendor filtering, push those filters upstream and keep route pagination server-side.

### Medium: Audio/image/video model-list routes are copy-pasted

Evidence:
- `app/api/studio/audio/models/route.ts:35`, `app/api/studio/image/models/route.ts:35`, and `app/api/studio/video/models/route.ts:35` each define the same `normalizeList` helper.
- `app/api/studio/audio/models/route.ts:47`, `app/api/studio/image/models/route.ts:47`, and `app/api/studio/video/models/route.ts:47` each define the same `normalizeTotal` helper.
- `app/api/studio/audio/models/route.ts:66`, `app/api/studio/image/models/route.ts:66`, and `app/api/studio/video/models/route.ts:66` each implement the same paginated `ListUFSquareModel` fetch with only the modality string changed.
- `app/api/studio/audio/models/route.ts:104`, `app/api/studio/image/models/route.ts:104`, and `app/api/studio/video/models/route.ts:104` each duplicate `toErrorResponse`.

Impact:
Bug fixes and UCloud behavior changes must be applied three times. The current pattern already makes it easy for one modality to drift in pagination, error handling, project resolution, or supported/disabled mapping.

Actionable remediation:
Extract a shared server helper such as `listSquareModelsByOutputModality({ credentials, projectId, modality })` plus a common `ucloudRouteErrorResponse(error, fallbackMessage)`. Keep the modality-specific route files thin, with only the `buildAudioModelOption` / `buildImageModelOption` / `buildVideoModelOption` mapping remaining locally.

### Medium: Media generation routes use inconsistent request lifecycles

Evidence:
- Audio polling constants allow up to 180 polls at 2 seconds each in `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:52`; the POST handler awaits polling in request flow at `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:848` and returns `201` only after outputs are stored at `app/api/studio/sessions/[sessionId]/audio-generations/route.ts:936`.
- Image async-task polling allows up to 45 polls at 2 seconds each in `app/api/studio/sessions/[sessionId]/image-generations/route.ts:82`; it also awaits polling inside POST at `app/api/studio/sessions/[sessionId]/image-generations/route.ts:859`.
- Video uses a different lifecycle: `app/api/studio/sessions/[sessionId]/video-generations/route.ts:47` sets `maxDuration`, `app/api/studio/sessions/[sessionId]/video-generations/route.ts:1197` schedules work with `after`, and `app/api/studio/sessions/[sessionId]/video-generations/route.ts:1337` returns `202`.

Impact:
The same product surface has three backend execution models. Audio can hold a route request for roughly six minutes, image can hold one for roughly ninety seconds, and video returns immediately. This increases timeout risk and forces client code and tests to understand modality-specific behavior that should be a shared generation job contract.

Actionable remediation:
Introduce a shared generation job runner and make async providers consistently return `202` with persisted generation state and a polling/read endpoint. Keep synchronous handling only for providers known to return immediately, behind a clear route-level policy.

### Medium: Core UI and storage modules are too large for reliable maintenance

Evidence:
- `components/studio-chat-workbench.tsx:1643` starts `StudioChatWorkbench`, and the file exports at `components/studio-chat-workbench.tsx:6004`.
- `components/skills-market-page.tsx:2027` starts `SkillsMarketPage`, and the file exports at `components/skills-market-page.tsx:3619`.
- `components/codebox-page.tsx:364` starts `CodeBoxPage`, and the file exports at `components/codebox-page.tsx:2952`.
- `lib/studio-db.ts:973` starts schema initialization for many domains; the same file also owns sessions at `lib/studio-db.ts:2956`, messages at `lib/studio-db.ts:3246`, files at `lib/studio-db.ts:4115`, settings at `lib/studio-db.ts:4404`, and image generations through the end of the 4,884-line file.

Impact:
These files mix data fetching, state orchestration, UI rendering, persistence, and domain mapping in single modules. That makes reviews slow, raises merge-conflict risk, and discourages targeted tests because useful seams are buried inside large components or one database module.

Actionable remediation:
Split large components by workflow and ownership boundary: data hooks, command handlers, filter/sidebar panels, item renderers, and modal/detail surfaces. Split `studio-db` by bounded context behind a small shared DB connection/migration layer, for example sessions/messages, local projects/files, installed skills/MCP, settings, and media generations.

### Low: API error envelopes and helper patterns are inconsistent

Evidence:
- UCloud-style routes return `{ ok: false, message, retCode }` through local helpers, for example `app/api/skills/route.ts:38` and `app/api/model-square/route.ts:368`.
- Studio routes often return `{ ok: false, error }`, for example validation in `app/api/studio/chat/route.ts:43` and session errors in `app/api/studio/chat/route.ts:50`.
- Some routes mix both fields in one response, such as `app/api/studio/projects/route.ts:103`.
- Client code compensates with local assumptions: `components/studio-chat-workbench.tsx:1252` has a generic `readJson`, while `components/skills-market-page.tsx:574` through `components/skills-market-page.tsx:910` repeats endpoint-specific casts and message extraction.

Impact:
Client code must branch between `message`, `error`, flattened Zod errors, and `retCode`. New routes are likely to copy whichever pattern is nearby, which keeps the inconsistency growing.

Actionable remediation:
Add a shared route response helper and typed response union, for example `{ ok: false, error: { message, code?, details?, retCode? } }`. Update fetch helpers to consume that shape, and migrate routes opportunistically as touched.

### Low: Runtime JSON parsing often uses assertions instead of validation

Evidence:
- `lib/studio-db.ts:1458` defines `parseJsonValue<T>`, and `lib/studio-db.ts:1464` returns `JSON.parse(raw) as T` with no shape validation.
- `lib/studio-db.ts:4471` parses stored agent model settings as `unknown` and returns them to callers.
- `components/skills-market-page.tsx:574`, `components/skills-market-page.tsx:604`, `components/skills-market-page.tsx:620`, and many adjacent helpers cast `response.json()` directly to API response types.

Impact:
Corrupted persisted values or changed API responses can silently become typed data until a later component assumes required fields exist. The failure then appears far away from the parsing boundary.

Actionable remediation:
Use small Zod schemas or narrow type guards at persistence and network boundaries for critical records. Keep generic JSON helpers only for truly opaque metadata, and name them accordingly so callers know they are not validated.
