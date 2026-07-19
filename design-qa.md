# Design QA

## Plan Indicator Visibility — 2026-07-19

- Source visual truth:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-WE5whm.png`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-3B3d9M.png`
- Implementation screenshots:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.51.36.jpeg`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.52.01.jpeg`
- Viewport: 1179 x 768, light theme, new local OpenCode chat.
- State: default composer followed by Plan mode enabled from the `+` menu.

### Full-view and focused comparison evidence

The two Synara references and both implementation states were opened together. The default composer no longer renders a Plan control, while enabling Plan adds the compact Plan indicator after the permission control. The change preserves the existing composer geometry in both states.

No separate crop was needed because the complete composer footer and Plan label are readable in the four comparison images.

### Findings and comparison history

- [P2] Codex, Claude Code, and OpenCode rendered their Plan controls whenever the mode was available, even while normal mode was active.
  - Fix: gate each runtime's footer Plan control on its live `plan.active` state; the `+` menu and `Shift+Tab` remain available to enable it.
  - Post-fix evidence: the default screenshot has no Plan label, and the enabled screenshot shows exactly one Plan indicator beside the permission control.
- No actionable P0/P1/P2 differences remain for the requested visibility behavior.

### Required fidelity surfaces

- Fonts and typography: existing compact composer label styling is unchanged.
- Spacing and layout rhythm: inactive mode leaves no Plan placeholder or gap; active mode restores the existing compact control.
- Colors and visual tokens: existing active Plan colors and hover tokens are unchanged.
- Image quality and asset fidelity: no raster assets were added; existing icon-library components remain in use.
- Copy and content: `计划`/`Plan` appears only while Plan mode is active.

### Interaction and console checks

- Opened the running Electron development app after hot reload.
- Confirmed default OpenCode mode has no Plan indicator.
- Enabled Plan from the `+` menu and confirmed the Plan indicator appears.
- Switched Plan off from the footer and confirmed the indicator disappears again.

final result: passed

---

## Composer Extras and Plan Mode — 2026-07-19

- Source visual truth: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-WE5whm.png`
- Product correction: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-PHB5WF.png`
- Implementation screenshots:
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.39.32.jpeg`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.39.51.jpeg`
  - `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.42.56.jpeg`
- Viewport: 1179 x 768, light theme, new local chat with AstraFlow Agent selected.

### Findings and corrections

- [P1] Plan mode was absent from the `+` menu and `Shift+Tab` did nothing for AstraFlow Agent.
  - Fix: add a Synara-style Plan switch, centralize the shortcut across ACP runtimes, preserve draft Plan state before a session exists, and apply it to the newly activated ACP session before the first run.
- [P1] AstraFlow ACP advertised only a default mode, so a Plan toggle would otherwise be cosmetic.
  - Fix: add persisted `default` and `plan` ACP modes and inject a read-only planning system contract into main-agent and subagent prompts.
- [P2] The first replacement removed the existing Expert, Skill, and Connector entry points.
  - Fix: retain all three as compact submenus in the same `+` surface while removing the redundant standalone Plugin wrench button.
- [P2] The slash menu placed commands before Skills.
  - Fix: Skills render first and keyboard indices follow the same visible order; builtin/runtime commands remain below.

### Interaction checks

- The running Electron app shows Add image, Expert, Skill, Connector, and Plan mode in the `+` menu.
- The standalone Plugin wrench button is absent.
- Plan can be switched on before the first message; the switch is visibly active.
- While Plan mode is active, the composer footer shows the Plan indicator beside the permission control.
- With the textarea focused, `Shift+Tab` switches Plan off, confirmed by reopening the menu.

final result: passed

---

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

- Source visual truth: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/codex-clipboard-swKvmU.png`
- Implementation screenshot: `/var/folders/vj/srgnjnqd65sgw__bs2912byw0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-19 at 23.17.32.jpeg`
- Viewport: 1178 x 768
- State: empty chat composer with `/` entered and the complete command list open above it.

## Full-view comparison evidence

The previous oversized translucent menu was replaced by the Synara command-menu structure and styling: an opaque popover surface, 12px outer radius, compact grouped rows, muted section labels, single icon column, inline title and description, right-aligned command token, and a subtle selected-row fill. The menu is anchored above the composer like the source instead of opening below the empty-state input.

## Focused region comparison evidence

The running Electron app was inspected after hot reload. The menu matches the source hierarchy and density while preserving AstraFlow's localized descriptions and runtime-specific command, Skill, and MCP groups. Its 18rem internal scroll cap keeps the composer visible and gives the list the same compact rhythm as Synara.

## Findings and comparison history

- [P1] The menu could open below the composer, unlike Synara's composer-attached surface.
  - Fix: anchor the command menu to `bottom-full` with the same 8px gap and inset wrapper used by Synara.
- [P2] The old menu used 40px rows, 13px copy, large rounded pills, a heavy shadow, blur, and ring chrome.
  - Fix: copy Synara's compact row geometry, 11–11.5px typography, 14px glyphs, 8px row radius, 12px panel radius, opaque border surface, and semantic active/hover tokens.
- [P2] Command titles and icons were generic for several native commands.
  - Fix: adopt Synara's command-title mapping and Lucide concept mapping while retaining AstraFlow-only commands and behavior.
- No actionable P0/P1/P2 visual differences remain for the requested slash-command menu surface.

## Required fidelity surfaces

- Fonts and typography: existing product font tokens remain unchanged; menu titles use 11.5px and descriptions use 11px, matching the Synara source component.
- Spacing and layout rhythm: rows use Synara's compact `px-2.5 py-1` geometry, grouped separators, and an 18rem internal scroll region.
- Colors and visual tokens: Synara's foreground, muted, border, popover, and secondary button tokens are reused across light and dark themes.
- Image quality and asset fidelity: no raster assets are required; affordances now use the same Lucide icon family as the Synara source.
- Copy and content: command descriptions remain runtime-aware and localized; canonical commands remain visible at the right edge.

## Verification

- The already-running Electron development app was inspected after hot reload; `/` opens the menu above the composer and Escape closes it.
- Focused slash-command tests pass: 11/11.
- `bun run typecheck` passes.
- `bun run lint` passes.
- `git diff --check` passes.

final result: passed

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
