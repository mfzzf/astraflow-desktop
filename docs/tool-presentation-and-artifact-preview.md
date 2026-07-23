# Tool presentation and artifact preview contract

## Stable event identity

Provider identity, canonical identity, and visual kind are separate fields.
For example, Pi `write` remains provider tool `write`, maps to the canonical
file-write renderer, and may still use ACP kind `edit`. A kind must never
overwrite the tool name.

One `toolCallId` owns one visible activity container across input streaming,
running, completion, and error. Result events update that container instead of
adding a second generic card.

## File mutations

The tool execution boundary emits authoritative metadata:

- path and create/edit/delete kind;
- old/new text when bounded;
- additions/deletions;
- monotonic order and content revision;
- provider/canonical tool names.

React does not reconstruct a diff from display text. Running writes show a
bounded, wrapped preview; complete writes and edits show filename, mutation
kind, stats, and inline diff, with the full session diff available in Review.
Streaming snapshots are size- and frequency-bounded so a large write does not
create quadratic ACP traffic.

## HTML and service previews

A completed `.html` or `.htm` file mutation emits an automatic preview request.
The right panel reuses the same file tab by workspace + path, refreshes it by
revision, does not steal focus from Terminal/Review, and remembers a manual
close for the session.

Local file preview is intentionally static-safe: scripts, event handlers,
frames, refresh redirects, forms, and network-capable attributes/CSS are
removed and a deny-by-default CSP is injected. This keeps generated markup
previewable without giving it Electron or host privileges.

Interactive JavaScript, modules, network access, or backend behavior in a
remote Full Access task uses `sandbox_start_service`. Default keeps the
scripts-off static preview and does not expose the service tool until a
dedicated service-process sandbox exists. A healthy, structured `service.v1`
URL opens in the right-panel Electron webview guest process. The service path
supplies lifecycle, logs, owner isolation, and a trusted remote origin; the
file renderer does not turn on scripts in the main React document.

## Renderer routing

Specialized renderers are matched before generic fallback:

- file read/write/edit and file mutation results;
- commands;
- Sandbox service lifecycle;
- plan/task/subagent and product media tools;
- generic structured/text fallback.

Unknown provider tools remain visible through the fallback, but known tools
must not regress to raw JSON merely because a provider changes its display
title.

## Verification

```bash
bun test tests/studio-tool-rendering.test.ts \
  tests/studio-html-preview.test.tsx \
  tests/studio-workspace-tabs.test.ts \
  tests/studio-workspace-service.test.ts
bun run typecheck
bun run lint
```
