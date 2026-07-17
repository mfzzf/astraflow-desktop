// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const preloadSource = readFileSync(
  join(process.cwd(), "electron", "preload.cjs"),
  "utf8"
)
const mainSource = readFileSync(
  join(process.cwd(), "electron", "main.cjs"),
  "utf8"
)

describe("Electron sandbox preload", () => {
  test("does not import Node built-ins", () => {
    expect(preloadSource).not.toMatch(/require\(["']node:/)
  })

  test("gets the home directory through a main-process IPC bridge", () => {
    expect(preloadSource).toContain(
      'ipcRenderer.sendSync("astraflow:home-path")'
    )
    expect(mainSource).toContain('ipcMain.on("astraflow:home-path"')
    expect(mainSource).toContain('event.returnValue = app.getPath("home")')
  })

  test("exposes Python environment management through narrow IPC calls", () => {
    for (const channel of [
      "astraflow:python-environment-status",
      "astraflow:python-environment-configure",
      "astraflow:python-environment-install",
      "astraflow:python-environment-pick",
      "astraflow:python-package-search",
      "astraflow:python-package-install",
    ]) {
      expect(preloadSource).toContain(channel)
      expect(mainSource).toContain(channel)
    }
  })

  test("exposes automation background preferences through narrow IPC calls", () => {
    for (const channel of [
      "astraflow:automation-background-settings:get",
      "astraflow:automation-background-settings:set",
      "astraflow:automation-background-settings-changed",
    ]) {
      expect(preloadSource).toContain(channel)
      expect(mainSource).toContain(channel)
    }
    expect(mainSource).toContain("new Tray(image)")
    expect(mainSource).toContain("new Notification({")
  })

  test("automatically downloads updates and installs only on request", () => {
    for (const channel of [
      "astraflow:update-status",
      "astraflow:check-for-updates",
      "astraflow:install-update",
      "astraflow:update-status-changed",
    ]) {
      expect(preloadSource).toContain(channel)
      expect(mainSource).toContain(channel)
    }
    expect(mainSource).toContain(
      "const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1_000"
    )
    expect(mainSource).toContain("autoUpdater.autoInstallOnAppQuit = false")
    expect(mainSource).toContain('autoUpdater.on("download-progress"')
    expect(mainSource).toContain(".downloadUpdate()")
    expect(mainSource).toContain(
      'ipcMain.handle("astraflow:install-update", async () => installUpdateNow())'
    )
    expect(mainSource).toContain("getAutoUpdater().quitAndInstall(false, true)")
    expect(mainSource).not.toContain("autoUpdater.autoInstallOnAppQuit = true")
    expect(mainSource).not.toContain("scheduleUpdateInstallWhenIdle")
    expect(mainSource).not.toContain('new URL("/api/app-runtime/idle", serverUrl)')

    const downloadedHandler = mainSource.slice(
      mainSource.indexOf('autoUpdater.on("update-downloaded"'),
      mainSource.indexOf('autoUpdater.on("error"')
    )
    expect(downloadedHandler).toContain('phase: "downloaded"')
    expect(downloadedHandler).not.toContain("quitAndInstall")
  })
})
