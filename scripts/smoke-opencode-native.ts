import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startOpenCodeNativeServer } from "@/lib/agent/adapters/opencode-native-runtime"

const dataRoot = mkdtempSync(join(tmpdir(), "astraflow-opencode-smoke-"))
let server: Awaited<ReturnType<typeof startOpenCodeNativeServer>> | null = null

try {
  server = await startOpenCodeNativeServer({
    commandEnv: {
      NODE_ENV: process.env.NODE_ENV ?? "test",
      XDG_CACHE_HOME: join(dataRoot, "cache"),
      XDG_CONFIG_HOME: join(dataRoot, "config"),
      XDG_DATA_HOME: join(dataRoot, "data"),
    },
    pure: true,
  })
  console.log(`OpenCode native server initialized at ${server.baseUrl}.`)
} finally {
  await server?.dispose()
  rmSync(dataRoot, { recursive: true, force: true })
}
