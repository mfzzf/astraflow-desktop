import assert from "node:assert/strict"
import test from "node:test"
import { gunzipSync } from "node:zlib"

import {
  createWindowsSandboxProfileCommand,
  WINDOWS_SANDBOX_PROFILE_ID_PATTERN,
} from "../electron/windows-sandbox-profile.mjs"
import {
  acquireWindowsSandboxAncestorMetadataAccess,
  collectWindowsSandboxAncestorMetadataPaths,
} from "../electron/windows-sandbox-ancestor-access.mjs"

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
  const bootstrap = gunzipSync(
    Buffer.from(encodedArguments[1], "base64url")
  ).toString("utf8")
  const payload = JSON.parse(
    Buffer.from(encodedArguments[2], "base64url").toString("utf8")
  )

  assert.doesNotThrow(() => new Function(bootstrap))
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

test("Windows sandbox profile bridges long-lived ACP through the sandbox proxy", () => {
  const profileId = "0123456789abcdef0123456789abcdef"
  const acpTransport = {
    host: "127.0.0.1",
    port: 61_234,
    token: "ab".repeat(32),
  }
  const command = createWindowsSandboxProfileCommand(
    "agent.exe acp",
    profileId,
    "C:\\Program Files\\node.exe",
    acpTransport,
    {
      executable: "C:\\Program Files\\Agent\\agent.exe",
      args: ["acp"],
    }
  )
  const encodedArguments = command.match(
    / ([A-Za-z0-9_-]+) ([A-Za-z0-9_-]+)$/
  )

  assert.ok(encodedArguments)
  const bootstrap = gunzipSync(
    Buffer.from(encodedArguments[1], "base64url")
  ).toString("utf8")
  const payload = JSON.parse(
    Buffer.from(encodedArguments[2], "base64url").toString("utf8")
  )

  assert.deepEqual(payload.acpTransport, acpTransport)
  assert.deepEqual(payload.directCommand, {
    executable: "C:\\Program Files\\Agent\\agent.exe",
    args: ["acp"],
  })
  assert.match(bootstrap, /"CONNECT " \+ authority \+ " HTTP\/1\.1/)
  assert.match(bootstrap, /ASTRAFLOW_ACP\/1/)
  assert.match(
    bootstrap,
    /request\.directCommand\.executable,\s*request\.directCommand\.args/
  )
  assert.match(bootstrap, /socket\.pipe\(child\.stdin\)/)
  assert.match(bootstrap, /child\.stdout\.pipe\(socket\)/)
  assert.ok(command.length < 8_191)
})

test("Windows sandbox profile rejects unsafe direct ACP commands", () => {
  const profileId = "0123456789abcdef0123456789abcdef"
  const acpTransport = {
    host: "127.0.0.1",
    port: 61_234,
    token: "ab".repeat(32),
  }

  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "agent.exe acp",
        profileId,
        "C:\\Program Files\\node.exe",
        acpTransport
      ),
    /profile request is invalid/
  )
  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "agent.exe acp",
        profileId,
        "C:\\Program Files\\node.exe",
        acpTransport,
        { executable: "agent.exe", args: ["acp"] }
      ),
    /profile request is invalid/
  )
  assert.throws(
    () =>
      createWindowsSandboxProfileCommand(
        "agent.exe acp",
        profileId,
        "C:\\Program Files\\node.exe",
        acpTransport,
        {
          executable: "C:\\Program Files\\Agent\\agent.exe",
          args: ["acp\0"],
        }
      ),
    /profile request is invalid/
  )
})

test("Windows sandbox ancestor metadata grants stop at the user profile", () => {
  assert.deepEqual(
    collectWindowsSandboxAncestorMetadataPaths(
      [
        "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\workspace",
        "c:\\users\\RUNNERADMIN\\AppData\\Local\\Temp\\workspace\\nested",
        "D:\\repository",
      ],
      "C:\\Users\\runneradmin"
    ),
    [
      "C:\\Users\\runneradmin\\AppData",
      "C:\\Users\\runneradmin\\AppData\\Local",
      "C:\\Users\\runneradmin\\AppData\\Local\\Temp",
    ]
  )
})

test("Windows sandbox ancestor metadata grants exclude the workspace leaf", () => {
  assert.deepEqual(
    collectWindowsSandboxAncestorMetadataPaths(
      ["C:\\Users\\alice\\workspace"],
      "C:\\Users\\alice"
    ),
    []
  )
  assert.deepEqual(
    collectWindowsSandboxAncestorMetadataPaths(
      ["D:\\workspace"],
      "C:\\Users\\alice"
    ),
    []
  )
})

test("Windows sandbox ancestor metadata grants RA+S and retries timeouts", () => {
  const calls = []
  const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })
  const results = [
    { error: timeout, status: null },
    { status: 0, stdout: "", stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]
  const access = acquireWindowsSandboxAncestorMetadataAccess({
    paths: ["C:\\Users\\alice\\AppData\\Local\\workspace"],
    platform: "win32",
    sandboxUserSid: "S-1-5-21-1-2-3-1001",
    spawnSyncImpl(executable, args, options) {
      calls.push({ executable, args, options })
      return results.shift()
    },
    systemRoot: "C:\\Windows",
    userProfile: "C:\\Users\\alice",
  })

  assert.deepEqual(access?.paths, [
    "C:\\Users\\alice\\AppData",
    "C:\\Users\\alice\\AppData\\Local",
  ])
  assert.equal(calls.length, 3)
  assert.equal(calls[0].executable, "C:\\Windows\\System32\\icacls.exe")
  assert.deepEqual(calls[0].args, [
    "C:\\Users\\alice\\AppData",
    "/grant",
    "*S-1-5-21-1-2-3-1001:(RA,S)",
    "/q",
  ])
  assert.equal(calls[0].options.timeout, 5_000)
  assert.deepEqual(calls[1].args, calls[0].args)
  assert.equal(calls[2].args[0], "C:\\Users\\alice\\AppData\\Local")
})
