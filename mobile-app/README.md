# AstraFlow Mobile

Android-first Expo Development Build for cross-device AstraFlow sessions and Agent runs.

```bash
cp .env.example .env.local
bun install
bun run typecheck
bun run lint
bunx expo run:android
```

The app uses Expo SDK 57, Expo Router, SecureStore for OAuth tokens, SQLite for durable local projections/drafts, and the generated client under `src/generated/astraflow-api`. Regenerate that client from the repository root after backend contract changes:

```bash
bun run codegen:astraflow-mobile-api
```

Production OAuth requires these server-side AstraFlow API variables; never put the secret in this app:

```text
ASTRAFLOW_UCLOUD_OAUTH_CLIENT_ID
ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET
```
