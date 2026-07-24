# File diff full-header toggle and animation QA

## Evidence

- Source visual truth: `/var/folders/y4/b2g75pd16zv7hk08fr1qn77r0000gn/T/codex-clipboard-9iiRKM.png`
- Browser-rendered implementation:
  - Full view: `/tmp/astraflow-design-qa-full.png`
  - Focused diff panel: `/tmp/astraflow-design-qa-focus.png`
  - Normalized side-by-side comparison: `/tmp/astraflow-design-qa-comparison.png`
- Browser viewport: 1512 × 862 CSS px
- Source pixels: 1208 × 944
- Implementation pixels: full view 1512 × 862; focused panel 672 × 606 at 1× capture density
- Density normalization: the source panel was cropped to 1096 × 930 and scaled to a 672 × 570 comparison region. The implementation was compared as a native-density 672 × 570 crop.
- State: light theme, completed `index.html` creation, diff expanded at its first line after an animated collapse/expand cycle.

## Full-view comparison

The entire file header—including the empty area to the right of `+63 -0`—is one full-width toggle. The file change remains a single bordered diff surface with line numbers, addition backgrounds, syntax highlighting, and an internal vertical scroll area.

## Focused comparison

The normalized side-by-side image confirms that the header spans the same full panel width as the annotated reference. Header density, line-number gutter, addition colors, code typography, indentation, and syntax colors remain aligned.

## Required fidelity surfaces

- Fonts and typography: monospaced code size, line height, weights, and syntax hierarchy match after density normalization.
- Spacing and layout rhythm: compact full-width header, gutter widths, row height, and code indentation match; the implementation uses the app’s existing radius and border tokens.
- Colors and visual tokens: addition background, active change edge, gutter, filename, and change statistics use the existing diff semantic tokens and match the reference.
- Image quality and assets: no raster or decorative product assets are involved; the existing file-type icon remains sharp.
- Copy and content: filename and `+63 -0` match. The implementation intentionally keeps “已创建” as product context.

## Interaction and runtime checks

- Full-width hit target: the trigger measured 670 px wide; its center point was in the empty region 119 px beyond the last visible header item.
- Collapse animation: clicking that empty center region changed `aria-expanded` to `false` and ran `collapsible-up` for 0.2s.
- Expand animation: clicking the same full-width header changed `aria-expanded` to `true` and ran `collapsible-down` for 0.2s.
- Chevron animation: the arrow rotates over 0.2s and respects reduced-motion preferences.
- Direct diff scrolling: internal `scrollTop` changed from 0 to 320 while the surrounding chat stayed in place.
- Raw metadata check: no visible `diff --git`, `new file mode`, or `/dev/null`.
- Expansion footer check: no visible “展开剩余…” or “Show … more” control.
- Console: no errors. One unrelated Jotai `atomFamily` deprecation warning remains.

## Findings

No actionable P0, P1, or P2 differences remain.

## Comparison history

- Pass 1: no P0/P1/P2 findings after changing the header to a single full-width trigger and adding the 0.2s height/chevron transitions. The empty annotated area toggled successfully in browser interaction testing.

## Residual test gaps

- Browser QA used the persisted completed tool call. Partial JSON streaming is covered by the renderer test rather than a live provider run.

final result: passed
