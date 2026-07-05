# Subagent 04 UI/UX Review - 2026-07-05

Scope: static UI/UX audit of the desktop AstraFlow frontend, focused on app shell, Models/SKILLS, Studio/chat and media workbenches, settings, loading/empty/error states, fixed-height behavior, list/table ergonomics, shadcn usage, and AGENTS.md frontend pitfalls.

I did not change application code, run a build, or start the dev server.

## Findings

### High - Models page can clip results on sub-lg widths

Evidence:
- `components/model-square-page.tsx:1348` renders the page as `h-full min-h-0 overflow-hidden`.
- `components/model-square-page.tsx:1400` switches the filter/results area to a single-column grid below `lg`.
- `components/model-square-page.tsx:1401` keeps the filter `<aside>` at `h-full`.
- `components/model-square-page.tsx:1493` makes only the results `<section>` scrollable.

User impact: on narrow desktop windows or tablet/mobile widths, the one-column grid places a full-height filter row before the results row inside an `overflow-hidden` frame. The results area can be pushed below the fixed shell with no outer page scroll, making model cards and "Show more" inaccessible. This is exactly the fixed-height/grid-scroll failure AGENTS.md warns about.

Design remediation: below `lg`, stop using the two-pane grid. Make filters a compact, shrink-0 toolbar/popover/accordion above a `min-h-0 flex-1 overflow-y-auto` results pane, or only apply `h-full` and the two-column grid at `lg+`. Keep one intended scroll container for the page body.

### Medium - SKILLS action failures use a persistent page Alert for transient feedback

Evidence:
- `components/skills-market-page.tsx:2728` and `components/skills-market-page.tsx:2758` set global `error` for install/toggle failures.
- `components/skills-market-page.tsx:2787`, `components/skills-market-page.tsx:2953`, `components/skills-market-page.tsx:2981`, `components/skills-market-page.tsx:3005`, and `components/skills-market-page.tsx:3035` do the same for remove/install/test MCP actions.
- `components/skills-market-page.tsx:3313` renders that global error as a destructive inline `Alert`.

User impact: routine per-item request failures become a page-level banner that shifts the list, can stay stale after the user continues working, and does not clearly attach to the card or action that failed. AGENTS.md asks for Sonner toasts for transient request-error feedback and reserves inline Alerts for persistent or blocking page state.

Design remediation: use `toast.error(...)` for install, enable/disable, remove, test, scan/import partial failures, and form validation. Keep the page Alert only for load failures that prevent the marketplace or installed list from being usable. For detail dialogs, keep local dialog errors only when the dialog cannot proceed.

### Medium - Studio media workbenches do not adapt when the app window narrows

Evidence:
- Image: `components/studio-image-workbench.tsx:643` uses a horizontal `overflow-hidden` shell and `components/studio-image-workbench.tsx:644` fixes the form pane to `w-[340px]` / `lg:w-[380px]`.
- Video: `components/studio-video-workbench.tsx:650` and `components/studio-video-workbench.tsx:651` use the same fixed horizontal split.
- Audio: `components/studio-audio-workbench.tsx:628` and `components/studio-audio-workbench.tsx:629` use the same fixed horizontal split.

User impact: a resizable desktop window can get too narrow for the fixed form pane plus output pane. The output area is squeezed or clipped while the shell prevents body scrolling. This hurts the desktop-focused ergonomics because users commonly run side-by-side apps or resize Electron windows.

Design remediation: add a responsive mode, such as `flex-col lg:flex-row`, `w-full lg:w-[360px]`, and an output pane that owns vertical scrolling. For desktop density, consider a collapsible inspector/form rail below a practical minimum width.

### Medium - Image Studio output history is squeezed into one fixed canvas instead of a usable list

Evidence:
- `components/studio-image-workbench.tsx:1164` through `components/studio-image-workbench.tsx:1195` turns every generation/output into a tile.
- `components/studio-image-workbench.tsx:1230` through `components/studio-image-workbench.tsx:1238` centers all tiles in a single `max-h-full` grid with no `overflow-y-auto`.

User impact: after several generations, all images must fit into one fixed-height canvas, so thumbnails shrink instead of forming a browsable history. Older results become difficult to inspect and actions become harder to hit.

Design remediation: make image outputs a natural-height, scrollable gallery like the video/audio panes: newest first, stable tile sizes, `overflow-y-auto` on the output pane, and `shrink-0` cards/tiles. Keep a focused preview mode if needed, but do not force the full history into one viewport.

### Low - Media save failures are silent

Evidence:
- `components/studio-image-workbench.tsx:623` through `components/studio-image-workbench.tsx:625` catches save failures and ignores them.
- `components/studio-audio-workbench.tsx:607` through `components/studio-audio-workbench.tsx:610` catches save failures without user feedback.

User impact: clicking Save can fail with no visible result, so users cannot tell whether the asset was saved, still saving, or needs a retry. This violates the AGENTS.md expectation that transient request-error feedback use Sonner toasts.

Design remediation: show `toast.success` on save and `toast.error` on failure, while keeping the per-tile spinner/disabled state. If the output remains retryable, leave the action enabled after the failure toast.

### Low - Profile settings use CSS zoom for density

Evidence:
- `components/settings-profile-page.tsx:330` applies `[zoom:0.9]` to the whole profile page content.

User impact: `zoom` is a non-standard layout scaler that can blur text, shrink hit targets, and interact poorly with OS/browser zoom or future screenshot-based QA. It also makes density inconsistent with the account settings dialog and other management pages.

Design remediation: remove page-level `zoom` and tune spacing, font sizes, and card density directly with Tailwind classes. Keep controls at normal hit-target sizes and use max-width/container constraints for layout density.

## Positive Notes

- The app shell locks `html, body` scrolling and uses an explicit `h-svh` shell (`app/globals.css:316` through `app/globals.css:320`, `components/app-shell.tsx:176` through `components/app-shell.tsx:208`), which is the right foundation for a desktop app.
- Chat avoids the empty-state `StickToBottom` pitfall: populated conversations use `ChatContainerRoot` (`components/studio-chat-workbench.tsx:2727` through `components/studio-chat-workbench.tsx:2768`), while the empty composer is rendered separately (`components/studio-chat-workbench.tsx:2769` through `components/studio-chat-workbench.tsx:2802`).
- Management table alignment in API key settings is centered for headers and body content (`components/studio-api-settings-page.tsx:806` through `components/studio-api-settings-page.tsx:982`).
