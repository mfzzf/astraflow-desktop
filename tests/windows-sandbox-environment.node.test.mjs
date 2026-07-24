import assert from "node:assert/strict"
import { test } from "node:test"

import windowsSandboxEnvironment from "../electron/windows-sandbox-environment.cjs"

const { createWindowsSandboxEnvironmentManager } = windowsSandboxEnvironment

test("non-Windows platforms require no sandbox provisioning", async () => {
  const manager = createWindowsSandboxEnvironmentManager({
    platform: "darwin",
    getSrtWinPath() {
      throw new Error("must not resolve srt-win")
    },
    loadSandboxRuntime() {
      throw new Error("must not load Sandbox Runtime")
    },
  })

  assert.deepEqual(await manager.ensureReady(), {
    platform: "darwin",
    supported: true,
    ready: true,
    needsInstall: false,
  })
})

test("Windows first launch provisions and verifies the sandbox once", async () => {
  let provisioned = false
  let installs = 0
  let verifications = 0
  const sandboxRuntime = {
    resolveSrtWin({ path }) {
      assert.equal(path, "C:\\AstraFlow\\srt-win.exe")
      return { exe: path }
    },
    getWindowsSandboxUserStatus() {
      return {
        provisioned,
        credPresent: provisioned,
      }
    },
    installWindowsSandbox() {
      installs += 1
      provisioned = true
      return { cancelled: false }
    },
    async verifyWindowsWfpEgress() {
      verifications += 1
    },
  }
  const manager = createWindowsSandboxEnvironmentManager({
    platform: "win32",
    getSrtWinPath: () => "C:\\AstraFlow\\srt-win.exe",
    loadSandboxRuntime: async () => sandboxRuntime,
  })
  const [first, second] = await Promise.all([
    manager.ensureReady(),
    manager.ensureReady(),
  ])

  assert.equal(first.ready, true)
  assert.equal(second.ready, true)
  assert.equal(installs, 1)
  assert.equal(verifications, 1)
  assert.equal((await manager.getStatus()).ready, true)
  assert.equal(verifications, 2)
})

test("Windows UAC cancellation stays recoverable", async () => {
  const manager = createWindowsSandboxEnvironmentManager({
    platform: "win32",
    getSrtWinPath: () => "C:\\AstraFlow\\srt-win.exe",
    loadSandboxRuntime: async () => ({
      resolveSrtWin: ({ path }) => ({ exe: path }),
      getWindowsSandboxUserStatus: () => ({
        provisioned: false,
        credPresent: false,
      }),
      installWindowsSandbox: () => ({ cancelled: true }),
      verifyWindowsWfpEgress: async () => {
        throw new Error("must not verify after cancellation")
      },
    }),
  })
  const status = await manager.ensureReady()

  assert.equal(status.ready, false)
  assert.equal(status.needsInstall, true)
  assert.equal(status.cancelled, true)
})
