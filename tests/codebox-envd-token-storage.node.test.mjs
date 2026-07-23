import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-envd-token-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")
process.env.ASTRAFLOW_SECRET_KEY = "a".repeat(64)

const connection = await import("../lib/studio-db/connection.ts")
const agents = await import("../lib/studio-db/agents.ts")

function upsertSandbox(envdAccessToken) {
  return agents.upsertCodeBoxSandboxRecord({
    sandboxId: "sandbox-secure",
    template: "template-secure",
    status: "running",
    codeServerPort: 8080,
    workspacePath: "/workspace",
    ...(envdAccessToken ? { envdAccessToken } : {}),
  })
}

after(() => {
  connection.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("encrypts envd tokens without exposing them on public sandbox records", () => {
  const sandbox = upsertSandbox("envd-token-created")

  assert.equal("envdAccessToken" in sandbox, false)
  assert.equal(
    agents.getCodeBoxSandboxEnvdAccessToken("sandbox-secure"),
    "envd-token-created"
  )

  const stored = connection
    .getStudioDatabase()
    .prepare(
      "SELECT envd_access_token FROM codebox_sandboxes WHERE sandbox_id = ?"
    )
    .get("sandbox-secure")
  assert.match(stored.envd_access_token, /^enc:v1:/)
  assert.equal(stored.envd_access_token.includes("envd-token-created"), false)
})

test("preserves tokens during metadata updates and replaces them after DescribeSandbox", () => {
  upsertSandbox()
  assert.equal(
    agents.getCodeBoxSandboxEnvdAccessToken("sandbox-secure"),
    "envd-token-created"
  )

  assert.equal(
    agents.updateCodeBoxSandboxEnvdAccessTokenRecord(
      "sandbox-secure",
      "envd-token-described"
    ),
    true
  )
  assert.equal(
    agents.getCodeBoxSandboxEnvdAccessToken("sandbox-secure"),
    "envd-token-described"
  )
})
