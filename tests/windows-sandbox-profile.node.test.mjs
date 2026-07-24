import assert from "node:assert/strict"
import test from "node:test"

import {
  createWindowsSandboxProfileCommand,
  WINDOWS_SANDBOX_PROFILE_ID_PATTERN,
} from "../electron/windows-sandbox-profile.mjs"

test("Windows sandbox profile accepts only opaque profile ids", () => {
  assert.match("0123456789abcdef0123456789abcdef", WINDOWS_SANDBOX_PROFILE_ID_PATTERN)
  assert.throws(
    () => createWindowsSandboxProfileCommand("agent.exe", "../host-profile"),
    /profile request is invalid/
  )
  assert.throws(
    () => createWindowsSandboxProfileCommand("", "0".repeat(32)),
    /profile request is invalid/
  )
})

test("Windows sandbox profile is created under the dedicated account", () => {
  const profileId = "0123456789abcdef0123456789abcdef"
  const originalCommand = '"C:\\Program Files\\Agent\\agent.exe" acp'
  const command = createWindowsSandboxProfileCommand(
    originalCommand,
    profileId
  )
  const profileRoot = `%USERPROFILE%\\.astraflow\\sandbox-profiles\\${profileId}`

  assert.ok(
    command.includes(
      `if not exist "${profileRoot}\\AppData\\Local" mkdir "${profileRoot}\\AppData\\Local"`
    )
  )
  assert.ok(
    command.includes(
      "[AstraFlow sandbox] Failed to create the isolated Windows Agent profile."
    )
  )
  assert.ok(command.includes(`set "APPDATA=${profileRoot}\\AppData\\Roaming"`))
  assert.ok(command.includes(`set "CLAUDE_CONFIG_DIR=${profileRoot}\\.claude"`))
  assert.ok(
    command.includes(
      `set "OPENCODE_CONFIG_DIR=${profileRoot}\\.config\\opencode"`
    )
  )
  assert.ok(command.includes(`set "LOCALAPPDATA=${profileRoot}\\AppData\\Local"`))
  assert.ok(command.includes(`set "USERPROFILE=${profileRoot}"`))
  assert.ok(command.endsWith(originalCommand))
  assert.ok(!command.includes("runneradmin"))
})
