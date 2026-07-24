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

  test("exposes downloadable Python and Node.js/npm runtimes through narrow IPC calls", () => {
    for (const channel of [
      "astraflow:developer-runtime-status",
      "astraflow:developer-runtime-install",
      "astraflow:developer-runtime-status-changed",
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

  test("uses the transparent CompShare mark for the native tray icon", () => {
    expect(mainSource).toContain('"brand-light-zh.png"')
    expect(mainSource).toContain(
      "image = image.crop({ x: 0, y: 0, width: height, height })"
    )
    expect(mainSource).not.toContain("image.setTemplateImage(true)")
  })

  test("syncs Studio task summaries into the native tray through narrow IPC", () => {
    expect(preloadSource).toContain("updateTrayTasks")
    expect(preloadSource).toContain("astraflow:tray-tasks:update")
    expect(mainSource).toContain("normalizeStudioTrayTasks")
    expect(mainSource).toContain("astraflow:tray-tasks:update")
  })

  test("uses installed repository agent runtimes in development", () => {
    expect(mainSource).toContain("function getDevelopmentAgentRuntimes()")
    expect(mainSource).toContain(
      "developmentRuntimes: getDevelopmentAgentRuntimes()"
    )
    for (const packageName of [
      "@openai/codex",
      "@anthropic-ai/claude-agent-sdk",
      "opencode-ai",
    ]) {
      expect(mainSource).toContain(`packageName: "${packageName}"`)
    }
  })

  test("routes the open-local-workspace shortcut through a narrow IPC event", () => {
    expect(mainSource).toContain('key === "o"')
    expect(mainSource).toContain(
      'window.webContents.send("astraflow:open-local-workspace")'
    )
    expect(preloadSource).toContain("onOpenLocalWorkspaceCommand")
    expect(preloadSource).toContain("astraflow:open-local-workspace")
  })

  test("indexes local workspace files through a narrow IPC call", () => {
    expect(preloadSource).toContain("localWorkspaceFindFile")
    expect(preloadSource).toContain("astraflow:local-workspace-find-file")
    expect(mainSource).toContain("findLocalWorkspaceFileByReference")
    expect(mainSource).toContain("astraflow:local-workspace-find-file")
  })

  test("allows main-frame video fullscreen without widening capture permissions", () => {
    const permissionHandler = mainSource.slice(
      mainSource.indexOf("function configureMainWindowPermissions"),
      mainSource.indexOf("function createMainWindow")
    )

    expect(permissionHandler).toContain('permission === "fullscreen"')
    expect(permissionHandler).toContain("return details.isMainFrame")
    expect(permissionHandler).toContain("callback(details.isMainFrame)")
    expect(permissionHandler).toContain('permission === "media"')
    expect(permissionHandler).toContain('mediaTypes.includes("audio")')
    expect(permissionHandler).toContain('!mediaTypes.includes("video")')
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
    expect(mainSource).toContain("!isUpdateQuitRequested &&")
    expect(mainSource).not.toContain("autoUpdater.autoInstallOnAppQuit = true")
    expect(mainSource).not.toContain("scheduleUpdateInstallWhenIdle")
    expect(mainSource).not.toContain(
      'new URL("/api/app-runtime/idle", serverUrl)'
    )

    const downloadedHandler = mainSource.slice(
      mainSource.indexOf('autoUpdater.on("update-downloaded"'),
      mainSource.indexOf('autoUpdater.on("error"')
    )
    expect(downloadedHandler).toContain('phase: "downloaded"')
    expect(downloadedHandler).not.toContain("quitAndInstall")

    const installHandler = mainSource.slice(
      mainSource.indexOf("async function installUpdateNow()"),
      mainSource.indexOf("function setupAutomaticUpdates()")
    )
    expect(installHandler.indexOf("isUpdateQuitRequested = true")).toBeLessThan(
      installHandler.indexOf("quitAndInstall(false, true)")
    )
    expect(installHandler).toContain("isUpdateQuitRequested = false")
  })
})
