# Subagent 03 Performance Review

Scope: client/runtime performance with an extreme performance bar. Static review only. I did not change application code, run a build, or start the dev server.

I read `AGENTS.md` first. For Next.js-specific bundle guidance, I also checked the local Next 16 docs: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md:174-184` says a `"use client"` file pulls its imports into the client bundle, and `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:9-20` recommends lazy loading client components and imported libraries to reduce route JavaScript.

## P1 - Studio route statically pulls every Studio mode and the Skills marketplace into one client graph

Severity: High.

Evidence:
- `components/studio-shell.tsx:1` marks the shell as a Client Component.
- `components/studio-shell.tsx:6-9` statically imports chat, image, video, and audio workbenches.
- `components/studio-shell.tsx:85-119` renders exactly one branch, but the other branches are still statically imported by the client module graph.
- `components/studio-chat-workbench.tsx:1` is also a Client Component, and `components/studio-chat-workbench.tsx:90` statically imports `SkillsMarketPage`.
- `components/studio-chat-workbench.tsx:4940-5040` only needs the marketplace inside the plugins dialog, but the import happens at chat route load.
- Size signal from `wc -l`: `components/studio-chat-workbench.tsx` is 6004 lines, `components/skills-market-page.tsx` is 3619 lines, `components/studio-image-workbench.tsx` is 1484 lines, `components/studio-video-workbench.tsx` is 1444 lines, and `components/studio-audio-workbench.tsx` is 1202 lines.

Performance mechanism:
Opening any `/studio` route pays parse/compile/hydration cost for all Studio modes, the embedded Skills/MCP marketplace, markdown/code rendering, media UI, and large icon/UI graphs before the user has asked for most of it. This also widens every subsequent re-render surface in a route that needs to be chat-fast.

Fix:
Split `StudioShell` by mode using top-level `next/dynamic` or route-level server components that import only the active workbench. Lazy-load `SkillsMarketPage` from a small dialog body component after the dialog opens. Keep the composer button and enabled-count fetch in the chat bundle, but load the 3619-line marketplace only on demand. Apply the same pattern to media players, terminal surfaces, and markdown/code-heavy panels.

## P1 - Chat renders and reloads the entire session history with no windowing

Severity: High.

Evidence:
- `app/api/studio/sessions/[sessionId]/messages/route.ts:203-226` returns `listStudioMessages(sessionId)` with no cursor, limit, or "since" parameter.
- `lib/studio-db.ts:3246-3298` selects every active message for the session and maps every row.
- `components/studio-chat-workbench.tsx:2129-2142` reloads the full message array.
- `components/studio-chat-workbench.tsx:2168-2203` falls back to a 1000 ms interval that calls the full reload while a run is active and SSE is not connected.
- `components/studio-chat-workbench.tsx:2728-2736` maps every visible message into the DOM.
- `components/ui/chat-container.tsx:27-35` and `components/ui/chat-container.tsx:45-50` use `StickToBottom`, not virtualization.
- `components/studio-message-parts-renderer.tsx:1762-1824` maps every part in every rendered assistant message.

Performance mechanism:
Long chat sessions grow linearly in network payload, SQLite row mapping, JSON parsing, React reconciliation, DOM nodes, markdown parsing, and scroll anchoring work. The 1 second fallback poll turns that into repeated O(history) work during the most latency-sensitive streaming state.

Fix:
Add cursor/windowed message APIs, for example `?before=...&limit=50` and `?since=...` for live refresh. Render a virtualized or anchored window of the most recent messages, preserving scroll position when older messages are loaded. Replace the fallback poll with a cheap run-status or delta endpoint, and only request full history when the run completes or the user scrolls back. Keep `StickToBottom` only for the rendered window.

## P1 - Image attachments are stored and resent as base64 in every message history response

Severity: High.

Evidence:
- `app/api/studio/sessions/[sessionId]/messages/route.ts:22-34` allows attachment `dataUrl` payloads up to roughly 70 MB for a 50 MB file.
- `app/api/studio/sessions/[sessionId]/messages/route.ts:160-195` writes the image file to storage, but still returns `dataUrl` for image attachments.
- `lib/studio-db.ts:3544-3549` persists `attachments` as JSON on the message row.
- `app/api/studio/sessions/[sessionId]/messages/route.ts:221-226` returns all messages and therefore all stored attachment JSON.
- `components/studio-chat-workbench.tsx:5705-5711` renders images directly from `attachment.dataUrl`.

Performance mechanism:
A single 50 MB image can become around 70 MB of base64 inside SQLite text, then be parsed into JS strings and sent over local HTTP on every full message reload. With the fallback polling above, the app can repeatedly allocate and parse the same large base64 payload while a chat is active. Rendering from data URLs also forces the renderer process to keep huge strings and decoded images alive in chat history.

Fix:
After persisting an attachment, store and return metadata plus a stable content URL, not the data URL. Reuse the existing media-output pattern: `/api/studio/files/:id/content` or another local content endpoint, with thumbnails for chat history. Keep data URLs only for unsaved, pending client previews. Strip `dataUrl` from `mapMessage` or add a lightweight response mapper before `NextResponse.json`.

## P1 - Client-side Shiki uses the full grammar bundle and re-highlights code blocks in effects

Severity: High.

Evidence:
- `components/prompt-kit/code-block.tsx:1-4` is a Client Component and imports `codeToHtml` from `shiki`.
- `node_modules/shiki/dist/index.mjs:2-4` shows the default `shiki` entry imports bundled languages, bundled themes, and `bundle-full`.
- `components/prompt-kit/code-block.tsx:46-75` runs `codeToHtml` in an effect whenever `code`, `language`, or `theme` changes.
- `components/prompt-kit/markdown.tsx:131-147` lexes markdown with `marked.lexer`.
- `components/prompt-kit/markdown.tsx:625-644` rebuilds render blocks and renders all blocks through `ReactMarkdown`.
- `components/studio-message-parts-renderer.tsx:1808-1822` sends streaming text parts through markdown rendering.

Performance mechanism:
The default Shiki import pulls the full language/theme bundle into the client path, then each code block first paints plaintext and later sets highlighted HTML. During streaming, code content can change repeatedly, causing repeated async highlighting and markdown parsing on the main renderer thread. This is especially expensive for agent chats that often contain long shell output, diffs, JSON, and code fences.

Fix:
Use `shiki/core` with a small explicit language/theme set, or lazy-load Shiki only after a code block is visible. Cache highlighted HTML by `(language, theme, codeHash)`. Do not highlight mutable streaming code blocks; render plaintext while streaming and highlight once the block is stable. For very large code blocks, cap highlighting or move it to a worker/server transform.

## P2 - Model Square search refetches all UCloud pages on every query change

Severity: Medium-High.

Evidence:
- `components/model-square-page.tsx:1116-1127` includes `keyword`, filters, vendor, sort, and project in `queryUrl`.
- `components/model-square-page.tsx:1129-1168` performs a `cache: "no-store"` fetch whenever `queryUrl` changes.
- `components/model-square-page.tsx:1361-1364` updates the keyword on every keystroke with no debounce.
- `app/api/model-square/route.ts:338-363` fetches every UCloud model page sequentially.
- `app/api/model-square/route.ts:436-462` filters, sorts, and slices only after all pages are fetched.
- `components/model-square-page.tsx:1294-1303` filters and slices again on the client.

Performance mechanism:
Typing one character can trigger a server request that sequentially fetches all upstream pages, filters the full result set, and returns a page. Browser abort cancels the client fetch, but the route handler still has no request-signal plumbing into `callUCloudAction`, so upstream work may continue. This can create slow search, unnecessary UCloud load, and rate-limit risk.

Fix:
Debounce search input. Cache `fetchAllModels` per project, language, order, and orderBy with a short TTL, then filter cached data locally in the route. If UCloud supports server-side keyword/category filters, pass them upstream. Otherwise separate "refresh catalog" from "filter catalog". Add request cancellation support to `callUCloudAction`, and avoid fetching all pages when the requested page can be served from cache.

## P2 - Persistent sidebar loads all sessions and fans out git commands on every non-login route

Severity: Medium-High.

Evidence:
- `app/layout.tsx:49-55` wraps the whole app in `AppShell`.
- `components/app-shell.tsx:193-196` mounts `AppSidebar` for every non-login route.
- `components/app-sidebar.tsx:597-664` immediately loads sessions, local projects, and account data.
- `app/api/studio/sessions/route.ts:22-30` returns all sessions, and `lib/studio-db.ts:2956-2977` selects all sessions ordered by update time.
- `app/api/studio/local-projects/route.ts:40-47` runs `git rev-parse`, `git branch --show-current`, and `git status --porcelain`.
- `app/api/studio/local-projects/route.ts:67-84` runs that work for every local project and also performs `countStudioPermissionRules` per project.
- `components/app-sidebar.tsx:806-810` filters all sessions per project, `components/app-sidebar.tsx:1052-1187` maps all projects, and `components/app-sidebar.tsx:1206-1277` maps all unbound sessions.

Performance mechanism:
Visiting pages such as Models or Skills still loads chat history metadata and local project git status. With many projects, the local-projects API can spawn up to three git commands per project. With many sessions, sidebar render work is O(projects * sessions) for project grouping plus O(unbound sessions) DOM work.

Fix:
Fetch chat/session sidebar data only on Studio routes, or defer it with idle loading on non-Studio pages. Paginate session history. Build a `Map<projectId, sessions[]>` once instead of filtering sessions per project. Cache git info with a TTL and refresh only visible/expanded projects. Limit git command concurrency and use cheaper status options where acceptable. Aggregate permission counts in one query.

## P2 - Electron packaging ships a large unpacked app and boots a full Next server before showing UI

Severity: Medium-High.

Evidence:
- `scripts/prepare-electron-app.mjs:14-20` force-includes large runtime packages.
- `scripts/prepare-electron-app.mjs:77-108` recursively copies forced dependencies and all of their dependencies, filtering only source paths ending in `.map`.
- `scripts/prepare-electron-app.mjs:122-128` copies the standalone app, static assets, public assets, Electron code, and forced dependencies into `dist/electron-app`.
- `dist/electron/builder-effective-config.yaml:12` has `asar: false`.
- `dist/electron/builder-effective-config.yaml:16-20` packages `**/*` except cache, maps, and tsbuildinfo.
- `scripts/copy-electron-node-modules.cjs:27-56` recursively copies files and only filters `.map`.
- `scripts/copy-electron-node-modules.cjs:410-423` syncs `dist/electron-app/node_modules`, rebuilds native modules, and copies Next aliases after pack.
- Current generated artifact size in this workspace: `dist/electron-app` is 560 MB, `dist/electron-app/node_modules` is 493 MB, packaged `Resources/app` is 497 MB, and packaged `Resources/app/.data` is 38 MB.
- `electron/main.cjs:339-392` starts a Next server process and waits for HTTP readiness, and `electron/main.cjs:1273-1280` creates the main window only after that wait completes.

Performance mechanism:
An unpacked 500 MB file tree increases install, update, antivirus, code-signing, and cold-start filesystem cost. Shipping `.data` also bloats the app resources. At runtime, the desktop app starts two JavaScript environments, Electron main and a Next server utility process, before the user sees a window.

Fix:
Enable `asar` for JS/static assets and only unpack native binaries that require it. Add an explicit files allowlist that excludes `.data`, tests, docs, source directories, non-current-platform prebuilds, and unused package assets. Prune `node-pty`, agent runtimes, and CLI packages to the actual runtime files, or ship optional agent runtimes as separately downloaded resources. Show a lightweight local shell window immediately while the server boots, then swap to the app URL after readiness.

## P3 - Marketplace and installed-plugin grids are not virtualized

Severity: Medium.

Evidence:
- `components/skills-market-page.tsx:2106-2160` derives installed and visible collections in memory.
- `components/skills-market-page.tsx:3453-3468` maps all visible MCP marketplace servers.
- `components/skills-market-page.tsx:3480-3495` maps all visible skills.
- `components/skills-market-page.tsx:3497-3505` maps all visible installed skills.

Performance mechanism:
The market/installed views render card grids directly. If the marketplace or installed set grows beyond a page-sized response, the route pays full card render, image/icon decode, popover state, and layout cost. This is amplified by the current static import into chat noted in P1.

Fix:
Keep remote market pages bounded and virtualize installed/local grids. Use a virtual grid or windowed list with fixed card measurements, and move expensive per-card derived text into memoized selectors. Ensure the chat plugin dialog imports the marketplace lazily before optimizing its grid internals.
