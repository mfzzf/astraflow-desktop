# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Prototype decisions

- This is an authorized high-fidelity recreation of the Feldar download-page layout for AstraFlow.
- Preserve the 52px fixed header, 1180px content frame, three 360px platform cards, responsive single-column layout, footer CTA, mobile drawer, and human/machine view toggle.
- AstraFlow brand files and release URLs must remain local/configured in this project; do not hotlink Feldar assets.
- Update release metadata centrally in `src/release.js`.
