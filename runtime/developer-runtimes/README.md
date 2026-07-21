# Downloadable developer runtimes

AstraFlow Desktop keeps Python and Node.js/npm out of the Electron installer.
The packaged app contains only `runtime-catalog.json` plus the small installer
helper. After first launch, Electron downloads both target-specific archives
from the managed US3/S3-compatible bucket, verifies their declared sizes and
SHA-256 hashes, extracts them into Electron user data, and adds their command
directories to local Agent and terminal environments.

The `astraflow_environment` MCP server exposes status, installation, and
executable health-check tools to local AstraFlow Agent, Codex, OpenCode, and
Claude Code sessions. Every MCP-triggered installation runs a post-install
health check. It uses the same installer and a cross-process lock, so an Agent
can recover a missing runtime while the first-launch background installation
is still running.

Node.js includes npm and npx. npm packages remain on demand: project packages
are installed into the selected workspace, while global packages and the npm
cache use isolated directories under Electron user data. Local sandbox network
access is restricted to the npm and PyPI registries unless the normal network
permission flow grants another host.

Build upload artifacts for the current target with:

```bash
bun run runtime:python
bun run runtime:developer-installers
```

The `Developer Runtime Packages` workflow builds all supported targets and
uploads archives before their manifests under `developer-runtimes/v1`.
