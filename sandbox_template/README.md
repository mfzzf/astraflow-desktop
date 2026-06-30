# AstraFlow Desktop E2B Template

Builds the `astraflow-desktop` E2B sandbox template from `code-interpreter-v1`
with `tmux` installed.

## Build

```bash
cd sandbox_template
bun install
E2B_API_KEY=... E2B_DOMAIN=cn-wlcb.sandbox.ucloudai.com E2B_VALIDATE_API_KEY=false bun run build
```

Do not include the wildcard prefix in `E2B_DOMAIN`; use
`cn-wlcb.sandbox.ucloudai.com`, not `*.cn-wlcb.sandbox.ucloudai.com`.
UCloud-issued compatibility keys do not use the official `e2b_...` format, so
the build script disables the SDK's client-side key format check by default.

The script uses the E2B SDK template builder:

```ts
Template()
  .fromTemplate("code-interpreter-v1")
  .aptInstall(["tmux"], { noInstallRecommends: true })
```

The resulting template name is `astraflow-desktop` and the build is tagged
`latest`.
