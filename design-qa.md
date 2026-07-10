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
