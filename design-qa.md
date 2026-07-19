# Design QA

- Source visual truth:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-b68be6c5-28a1-4f17-86f7-afb523133cdb.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-ae53f094-e8c8-4701-96cf-01f91a9050d3.png`
- Defect evidence:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-50ba95df-ba9c-4fd4-8468-4a7dd5f25351.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-0a731a7e-0499-4477-b021-3152656d3af1.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-a1b916b5-f8f8-4465-ad66-91deeaf76377.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-26734388-7ea2-4b99-85fb-3f63f22c1de3.png`
- Implementation screenshots:
  - `/tmp/astraflow-model-picker-root-fixed.png`
  - `/tmp/astraflow-model-picker-submenu-fixed.png`
  - `/tmp/astraflow-model-picker-gpt-prefix.png`
  - `/tmp/astraflow-model-picker-idle-transparent.png`
- Comparison images:
  - `/tmp/astraflow-model-picker-compare.png`
  - `/tmp/astraflow-model-picker-submenu-compare.png`
  - `/tmp/astraflow-model-picker-idle-compare.png`
- Viewport: 1280 x 720 at device pixel ratio 2
- State: root menu, model submenu, effort submenu, and expanded advanced slider

## Full-view comparison evidence

The fixed picker was captured in the running local app. The root menu is now a compact 224px surface with 32px rows and reduced typography, padding, radii, icons, and slider geometry. It no longer dominates the composer or overlaps the heading at the scale shown in the defect captures.

## Focused region comparison evidence

The source and implementation were combined into the comparison images listed above. The model and effort rows retain the reference hierarchy and side-facing affordances. Both submenu surfaces now render outside the parent menu bounds. The longer product model catalog is capped to a compact scrolling region rather than growing to the full viewport height.

The latest focused comparison isolates the composer controls: the reported idle gray capsule is removed, while the `GPT 5.6 Sol Medium` label remains legible and aligned with the adjacent controls.

## Findings and comparison history

- [P1] Model and effort submenus were clipped by the root menu overflow container.
  - Fix: render submenu content through a Radix portal so positioned panels escape the parent clipping boundary.
  - Post-fix evidence: both `Model 5.5` and `Effort Medium` expose visible, keyboard-addressable radio menus in the browser DOM and screenshots.
- [P2] The root menu was visually oversized relative to the composer and reference density.
  - Fix: reduce the root width from 256px to 224px, rows from 36px to 32px, and tighten typography, padding, radii, icon size, and advanced-slider geometry.
  - Post-fix evidence: `/tmp/astraflow-model-picker-compare.png`.
- [P2] The full model catalog could create a viewport-height submenu.
  - Fix: cap the model submenu at 288px and make only that panel vertically scrollable.
  - Post-fix evidence: `/tmp/astraflow-model-picker-submenu-compare.png`.
- [P2] Model and effort rows lacked a persistent selected-state surface, and GPT names were shortened in this picker.
  - Fix: apply the existing gray interaction token to checked and hovered radio rows, and render the complete `GPT`-prefixed labels in both the trigger and model menu.
  - Post-fix evidence: the selected `GPT 5.6 Sol` row has a non-transparent gray background while an unchecked idle row remains transparent; `/tmp/astraflow-model-picker-gpt-prefix.png`.
- [P2] The composer trigger kept its gray capsule while idle.
  - Fix: switch the trigger from the secondary button treatment to the ghost treatment, keeping the gray surface only for hover and expanded states.
  - Post-fix evidence: the closed, unfocused trigger computes to a transparent background; the expanded trigger computes to the muted gray token. See `/tmp/astraflow-model-picker-idle-compare.png`.

## Required fidelity surfaces

- Fonts and typography: product fonts and antialiasing are unchanged; picker copy now uses the app's compact 12px menu scale.
- Spacing and layout rhythm: root and submenus use 32px rows, tighter padding, smaller radii, and 6px panel offsets.
- Colors and visual tokens: existing dropdown background, border, hover, foreground, muted foreground, and shadow tokens remain intact.
- Image quality and asset fidelity: no raster assets are required by this control; existing product and icon-library assets remain unchanged.
- Copy and content: Model, Effort, Advanced, reasoning names, and selected values remain unchanged; GPT model names retain their explicit `GPT` prefix.

## Interaction and console checks

- Root trigger opens and closes.
- Closed and unfocused trigger is transparent; hover and expanded states retain the gray interaction surface.
- Model submenu opens and exposes the full scrollable model catalog.
- Selected model and effort rows use the gray list-hover token; unchecked idle rows remain transparent, and hovered rows use the same token.
- Effort submenu opens and exposes the supported reasoning options.
- Advanced expands and shows the effort slider.
- No new console errors were observed. The only warning was the existing Jotai `atomFamily` deprecation warning from a framework chunk.

final result: passed

---

# Synara Composer Parity QA — 2026-07-19

- Defect evidence: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-Wakxv8.png`
- Source visual truth:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-FIc2Vs.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-dsFbGR.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-22Lz6R.png`
- Implementation screenshot: pending. No development server is running, and the repository contract prohibits starting one unless the user explicitly requests it.

## Source-level comparison

- Slash commands now use a dedicated bordered, rounded, shadowed popup with section headings, per-command icons, inline descriptions, canonical `/command` names, a muted selected row, and an internal scroll region.
- Selected Skills now render as the reference's blue stack icon plus name without a pill background or visible slash slug; removal remains available on hover or keyboard focus.
- Active Codex Plan mode now renders after the permission control as a neutral checklist icon plus `Plan` label; inactive Plan mode is entered through `/plan` or `Shift+Tab` and does not leave a persistent active-state pill.
- `/export` downloads the visible conversation as a `.md` transcript and excludes hidden reasoning.

## Required fidelity surfaces

- Fonts and typography: existing product font tokens remain unchanged; menu hierarchy uses compact 12–13px labels and descriptions matching the reference density.
- Spacing and layout rhythm: menu rows use a consistent 40px minimum height, 12px horizontal inset, grouped section spacing, and a 58vh maximum scroll region.
- Colors and visual tokens: existing foreground, muted, border, popover, and accent-blue tokens are reused across light and dark themes.
- Image quality and asset fidelity: no raster assets are required; all affordances use the existing Remix icon package.
- Copy and content: command descriptions remain runtime-aware and localized; canonical commands remain visible at the right edge.

## Verification

- Focused command, ACP conformance, tool-label, and Markdown-export tests pass: 51/51.
- `bun run typecheck` passes.
- `bun run lint` passes without errors or warnings.
- `git diff --check` passes.

final result: implementation checks passed; live visual comparison pending explicit dev-server authorization

---

# Chat Activity Ordering QA — 2026-07-16

- Source visual truth: `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/codex-clipboard-fa64ff55-01fc-4803-b270-42357e3f5793.png`
- Defect evidence:
  - `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/codex-clipboard-137d4dd0-ba04-4c44-9633-968873ac8238.png`
  - `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/codex-clipboard-0db70cdb-ee7e-40f8-9196-6f66c7aad334.png`
- Implementation screenshots:
  - `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-16 at 2.27.55 PM.jpeg`
  - `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-16 at 2.31.37 PM.jpeg`
- Viewport: 1179 x 768
- State: completed simple greeting with the activity summary expanded. The ChatGPT source shows a longer running task, so the comparison target is its information hierarchy rather than identical content or run state.

## Full-view comparison evidence

The source and implementation screenshots were opened together in the same visual comparison inputs. The fixed implementation now follows the reference hierarchy: user request, work/activity trace, assistant response, then response actions. The final response no longer precedes its own reasoning trace. A completed plan is now the last element of the expanded trace, immediately before the final response.

## Focused region comparison evidence

No separate crop was needed because the complete message regions are readable in the supplied and captured screenshots. The running Electron accessibility tree independently confirms the simple-turn order as `hi` → `工作了 1 秒` → `思考了 1 秒` → final AstraFlow response → actions, and the plan session order as final reasoning/tool activity → plan card → final PPT response → actions.

## Findings and comparison history

- [P1] The assistant response rendered above the work and reasoning trace.
  - Evidence: the defect screenshot shows the greeting first and `工作了 1 秒` below it, reversing the causal hierarchy in the ChatGPT reference.
  - Fix: associate each activity group with the next model output and render the activity group before that output; provider-delivered trailing reasoning falls back above the final output.
  - Post-fix evidence: the implementation screenshot and accessibility order listed above.
- [P2] A completed plan could remain in the middle of the expanded activity trace.
  - Fix: anchor plan state to the final activity group and order it after reasoning/tools, immediately before the final assistant output.
  - Post-fix evidence: the second implementation screenshot, the expanded plan-session accessibility order, and deterministic coverage in `tests/studio-message-render-order.test.ts`.
- No actionable P0/P1/P2 differences remain for the requested ordering behavior.

## Required fidelity surfaces

- Fonts and typography: existing AstraFlow message, trace, and muted-label styles are unchanged.
- Spacing and layout rhythm: existing message spacing is unchanged; only semantic render order changed.
- Colors and visual tokens: existing foreground, muted foreground, border, and interaction tokens are unchanged.
- Image quality and asset fidelity: no image assets are required or changed.
- Copy and content: provider output and localized activity labels are unchanged.

## Interaction and console checks

- Inspected the already-running Electron development app after hot reload.
- Confirmed the expanded work summary appears before the final response.
- Confirmed response actions remain below the final response.
- Unit coverage verifies leading activity, provider-trailing reasoning, plan-last ordering, and no-output activity states.

final result: passed

---

# Workspace Create Directory QA — 2026-07-14

- Source visual truth: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-e0ccefdd-80e0-44a4-8061-2d4fb930ced2.png`
- Implementation screenshot: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-14 at 14.23.22.jpeg`
- Combined comparison: `/Users/zzf/.codex/visualizations/2026/07/14/019f5efc-6b6c-7a10-8fd0-192bea1d254d/workspace-create-design-qa-comparison.png`
- Viewport: 1179 x 768; the 1230 x 1230 reference was normalized to the dialog crop for comparison.
- State: Sandbox workspace selected, `/workspace` loaded, no child directories. The reference uses light theme and the running app uses the user's active dark theme; structural fidelity was compared using the product's equivalent semantic tokens.

## Full-view comparison evidence

The implementation preserves the reference dialog hierarchy, two-column workspace type selector, Sandbox list, directory browser, workspace-name control, and footer actions. The requested absolute-path field is inserted inside the directory card without changing the surrounding product language.

## Focused region comparison evidence

The combined comparison focuses on the dialog. The new `工作目录` input and `转到` action sit between the directory heading and child-folder list, making manual entry and list navigation available in the same surface. No raster assets are used; icons come from the product's existing icon libraries.

## Findings and comparison history

- [P2] First implementation pushed the persistent Cancel/Open actions below the visible 768px app frame when several Sandboxes existed.
  - Fix: keep the form footer outside the internally scrolling content pane and cap the Sandbox list height.
  - Post-fix evidence: the final screenshot and combined comparison show both footer actions visible while the variable-length content remains scrollable.
- No actionable P0/P1/P2 differences remain. The extra directory field and additional Sandbox rows are intentional functional/content differences from the supplied reference.

## Required fidelity surfaces

- Fonts and typography: existing AstraFlow heading, label, helper, monospaced-path, and button styles are reused.
- Spacing and layout rhythm: the new field follows the card's existing 12px padding and compact vertical rhythm; the footer remains persistently reachable.
- Colors and visual tokens: existing border, background, muted, focus, selected, and status tokens are unchanged across light/dark themes.
- Image quality and asset fidelity: no raster assets are required; no placeholder, custom SVG, or CSS-drawn asset was introduced.
- Copy and content: Chinese and English copy explain absolute-path entry and list selection; existing workspace creation copy is unchanged.

## Interaction and console checks

- Selected a running Code Sandbox and loaded `/workspace`.
- Entered `/workspace/./`, activated `转到`, and verified normalization back to `/workspace`.
- Confirmed directory list selection and parent/refresh controls remain available.
- Confirmed Cancel/Open actions remain visible at 1179 x 768.
- Retried a remote Codex `pwd` run; it completed with `/workspace`, and no Next.js Console Error issue overlay was created.

final result: passed
