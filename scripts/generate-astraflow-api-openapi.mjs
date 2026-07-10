#!/usr/bin/env node

import { join } from "node:path"
import { spawnSync } from "node:child_process"

const openapiTs = join("node_modules", ".bin", "openapi-ts")
const config = "openapi-ts.astraflow.config.ts"

const result = spawnSync(openapiTs, ["--file", config], { stdio: "inherit" })

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
