#!/usr/bin/env node

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

const input = join("backend", "astraflow-api", "openapi.yaml")
const output = join("lib", "generated", "openapi", "astraflow-api.d.ts")
const openapiTypescript = join("node_modules", ".bin", "openapi-typescript")

await mkdir(dirname(output), { recursive: true })

const result = spawnSync(openapiTypescript, [input, "-o", output], {
  stdio: "inherit",
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
