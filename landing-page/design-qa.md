# Design QA

## Result

`passed`

## Visual source of truth

- Authorized live reference: `https://feldar.com/download`
- Desktop source captures: `qa/source/source-desktop-top.png`, `qa/source/source-desktop-full.png`
- Mobile source captures: `qa/source/source-mobile-top.png`, `qa/source/source-mobile-full.png`
- State captures: `qa/source/source-mobile-menu-open.png`, `qa/source/source-mobile-machine.png`

## Implementation evidence

- Desktop: `qa/implementation-desktop-top-final.png`, `qa/implementation-desktop-full-final.png`
- Mobile: `qa/implementation-mobile-top-final.png`, `qa/implementation-mobile-full-final.png`
- States: `qa/implementation-mobile-menu-open.png`, `qa/implementation-mobile-machine.png`
- Side-by-side comparisons: `qa/comparisons/`

## Viewports and states checked

- Desktop: 1280 × 720, top and full-page views
- Mobile: 390 × 844 and 375 × 812, top and full-page views
- Fixed-header border after scrolling
- Mobile navigation open, link activation, click-to-close, and Escape-to-close
- Mobile menu focus loop, background inert state, and automatic close when resizing to desktop
- Human-to-machine and machine-to-human view switching
- macOS, Windows, and Linux download rows and preferred-platform primary CTA
- Keyboard focus visibility and reduced-motion behavior

## Comparison history

### Pass 1

- The desktop and mobile footer link regions were shorter than the reference.
- The footer gradient direction was vertically reversed.
- Installer sizes caused mobile download labels to wrap differently from the reference.

### Corrections

- Matched footer minimum heights to the reference at desktop and mobile widths.
- Tuned the CTA gradient independently for landscape and portrait proportions while retaining a lightweight CSS animation.
- Kept release sizes on wider screens and hid them at the narrow mobile breakpoint.
- Added hidden-menu focus isolation, a keyboard focus loop, dynamic accessibility labels, and desktop-resize recovery.

### Pass 2

- Desktop implementation document height: 1764 px; source: 1764 px.
- Mobile implementation document height: 2519 px; source: 2519 px.
- Header, hero, CTA, cards, responsive stacking, footer, menu, and machine view align with the reference structure and spacing.
- Browser console was checked at desktop and mobile sizes with no errors or warnings.
- Final full-page evidence was recaptured as native PNG at 1280 × 1764 and 390 × 2519 without scaling or horizontal clipping.

## Findings

- P0: none
- P1: none
- P2: none
- P3: the source uses a WebGL footer effect; this implementation uses a visually matched local SVG and animated CSS gradient for lower runtime cost. AstraFlow branding, product copy, and real installer availability intentionally differ from Feldar. Terms and Privacy links remain pending because no official URLs exist in the repository.

## Functional verification

- All four configured installer URLs returned HTTP 200.
- GitHub repository and v1.4.1 release URLs returned HTTP 200.
- `npm run build` completed successfully.
- Repository `bun run typecheck` and `bun run lint` completed successfully.
- `git diff --check -- landing-page` completed successfully.
