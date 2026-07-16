# AstraFlow download landing page

Standalone Vite + React download page based on the authorized Feldar download-page layout.

## Local development

```bash
npm install
npm run dev
```

## Updating a release

Edit `src/release.js` when a new desktop release is published. Update the version, release date,
four installer URLs, file sizes, and the GitHub release link together. The current values mirror
the AstraFlow `v1.4.1` release manifest.

Brand assets are local under `public/brand`. Platform and decorative assets are local under
`public/icons` and `public/decor`; the page does not hotlink Feldar assets.
