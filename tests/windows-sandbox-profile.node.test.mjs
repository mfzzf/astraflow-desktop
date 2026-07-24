import assert from "node:assert/strict"
import test from "node:test"

import {
  createWindowsSandboxProfileCommand,
  WINDOWS_SANDBOX_PROFILE_ID_PATTERN,
} from "../electron/windows-sandbox-profile.mjs"

test("Windows sandbox profile accepts only opaque profile ids", () => {
  assert.match("0123456789abcdef0123456789abcdef", WINDOWS_SANDBOX_PROFILE_ID_PATTERN)
  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "agent.exe",
        "../host-profile",
        "C:\\Program Files\\node.exe"
      ),
    /profile request is invalid/
  )
  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "",
        "0".repeat(32),
        "C:\\Program Files\\node.exe"
      ),
    /profile request is invalid/
  )
  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "agent.exe",
        "0".repeat(32),
        ""
      ),
    /profile request is invalid/
  )
})

test("Windows sandbox profile is created under the dedicated account", () => {
  const profileId = "0123456789abcdef0123456789abcdef"
  const originalCommand = '"C:\\Program Files\\Agent\\agent.exe" acp'
  const command = createWindowsSandboxProfileCommand(
    originalCommand,
    profileId,
    "C:\\Program Files\\node.exe"
  )

  const encodedArguments = command.match(
    / ([A-Za-z0-9_-]+) ([A-Za-z0-9_-]+)$/
  )
  assert.ok(encodedArguments)
  const bootstrap = Buffer.from(
    encodedArguments[1],
    "base64url"
  ).toString("utf8")
  const payload = JSON.parse(
    Buffer.from(encodedArguments[2], "base64url").toString("utf8")
  )

  assert.match(command, /^"C:\\Program Files\\node\.exe" -e /)
  assert.deepEqual(payload, { command: originalCommand, profileId })
  assert.match(bootstrap, /const originalProfile = process\.env\.USERPROFILE/)
  assert.match(bootstrap, /path\.win32\.join\(\s*originalProfile/)
  assert.match(bootstrap, /CLAUDE_CONFIG_DIR:/)
  assert.match(bootstrap, /OPENCODE_CONFIG_DIR:/)
  assert.match(bootstrap, /LOCALAPPDATA:/)
  assert.match(bootstrap, /USERPROFILE: root/)
  assert.match(bootstrap, /spawnSync\(/)
  assert.ok(command.length < 8_191)
  assert.ok(!command.includes(originalCommand))
  assert.ok(!command.includes("runneradmin"))
})
