// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const codeBoxRuntimeSource = readFileSync(
  join(process.cwd(), "lib", "codebox-runtime.ts"),
  "utf8"
)

test("CodeBox never persists reusable provider or GitHub credentials", () => {
  for (const forbidden of [
    "envs.MODELVERSE_API_KEY",
    "envs.OPENAI_API_KEY",
    "envs.ANTHROPIC_AUTH_TOKEN",
    "envs.GH_TOKEN",
    "envs.GITHUB_TOKEN",
    "oauth_token:",
    "stringifyProfileExports",
  ]) {
    expect(codeBoxRuntimeSource).not.toContain(forbidden)
  }

  for (const legacyPath of [
    "/etc/git-credentials",
    "/etc/profile.d/astraflow-codebox.sh",
    "/root/.claude/settings.json",
    "/root/.codex/auth.json",
    "/root/.config/gh/hosts.yml",
    "/root/.config/opencode/opencode.json",
  ]) {
    expect(codeBoxRuntimeSource).toContain(legacyPath)
  }
})

test("connected GitHub auth is scoped to a one-time github.com clone", () => {
  expect(codeBoxRuntimeSource).toContain(
    'url.hostname.toLocaleLowerCase("en-US") !== "github.com"'
  )
  expect(codeBoxRuntimeSource).toContain("ASTRAFLOW_GITHUB_TOKEN")
  expect(codeBoxRuntimeSource).toContain("GIT_ASKPASS")
  expect(codeBoxRuntimeSource).toContain(
    "rm -f /tmp/astraflow-git-askpass.sh"
  )
  expect(codeBoxRuntimeSource).not.toContain(
    "credential.helper " + '"store --file=/etc/git-credentials"'
  )
})
