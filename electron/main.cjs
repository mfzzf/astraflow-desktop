/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  session,
  Tray,
  utilityProcess,
} = require("electron")
const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { spawn, spawnSync } = require("node:child_process")
const { createHmac, randomBytes } = require("node:crypto")
const { get, request: httpRequest } = require("node:http")
const { createServer } = require("node:net")
const {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} = require("node:path")
const pty = require("node-pty")
const { parseDn } = require("builder-util-runtime")
const {
  isPathInsideLocalWorkspace,
  resolveExistingLocalPath,
  resolveLocalWorkspacePath,
} = require("./local-workspace-paths.cjs")
const { createPythonEnvironmentManager } = require("./python-environment.cjs")
const {
  createAgentRuntimeEnvironmentManager,
} = require("./agent-runtime-environment.cjs")
const {
  createDeveloperRuntimeEnvironmentManager,
} = require("./developer-runtime-environment.cjs")
const {
  ensureManagedPythonRuntimeIfNeeded: ensureManagedPythonRuntime,
} = require("./python-runtime-guard.cjs")
const { readAuthenticodeSignature } = require("./windows-authenticode.cjs")

const APP_NAME = "AstraFlow"
const LOOPBACK_HOST = "127.0.0.1"
const NATIVE_TITLEBAR_HEIGHT = 48
const SERVER_START_TIMEOUT_MS = 90_000
const SMOKE_TIMEOUT_MS = 30_000
const CODEBOX_GITHUB_OAUTH_CLIENT_ID = "Ov23li4imZRAMlx9enez"
const SECRET_KEY_FILE = "studio-secret.key"
const STUDIO_ONBOARDING_STATE_FILE = "studio-onboarding-v1.state"
const AUTOMATION_BACKGROUND_SETTINGS_FILE =
  "automation-background-settings.json"
const APPSNAP_SETTINGS_FILE = "appsnap-settings.json"
const APPSNAP_SHORTCUT = "CommandOrControl+Shift+2"
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1_000
const SIDE_PANEL_TEXT_FILE_LIMIT_BYTES = 2 * 1024 * 1024
const SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES = 50 * 1024 * 1024
const SIDE_PANEL_LEGACY_XLS_LIMIT_BYTES = 12 * 1024 * 1024
const LOCAL_WORKSPACE_FILE_SEARCH_CACHE_TTL_MS = 5_000
const LOCAL_WORKSPACE_FILE_SEARCH_CACHE_MAX_ENTRIES = 256
const LOCAL_FULL_ACCESS_GRANT_VERSION = 1
const LOCAL_FULL_ACCESS_POLICY_VERSION = 2
const LOCAL_FULL_ACCESS_GRANT_TTL_MS = 2 * 60 * 1000
const SIDE_PANEL_BROWSER_PARTITION = "persist:astraflow-browser"
const SIDE_PANEL_VISIBLE_DOTFILES = new Set([
  ".editorconfig",
  ".env",
  ".eslintrc",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
])
const SIDE_PANEL_VISIBLE_DOTFILE_PREFIXES = [
  ".env.",
  ".eslintrc.",
  ".prettierrc.",
]
const localWorkspaceFileSearchCache = new Map()
const WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN =
  /certificate chain|trusted root|0x800b010a|cert_e_chaining|证书链|受信任的根/i
const WINDOWS_SIGNATURE_RECOVERABLE_STATUSES = new Set([1, 4])
const WINDOWS_SIGNER_THUMBPRINTS_ENV = "ASTRAFLOW_WINDOWS_SIGNER_THUMBPRINTS"

const isSmokeRun = process.env.ASTRAFLOW_ELECTRON_SMOKE === "1"
const isDevRun = process.env.ASTRAFLOW_ELECTRON_DEV === "1"
const isScreenshotRun =
  isDevRun &&
  process.env.ASTRAFLOW_DEMO_MODE === "1" &&
  process.env.ASTRAFLOW_ELECTRON_SCREENSHOT === "1"
const smokeUserDataPath = process.env.ASTRAFLOW_ELECTRON_SMOKE_USER_DATA?.trim()
const screenshotUserDataPath =
  process.env.ASTRAFLOW_ELECTRON_SCREENSHOT_USER_DATA?.trim()

if (isSmokeRun && smokeUserDataPath) {
  const resolvedSmokeUserDataPath = resolve(smokeUserDataPath)

  mkdirSync(resolvedSmokeUserDataPath, { recursive: true })
  app.setPath("userData", resolvedSmokeUserDataPath)
}

if (isScreenshotRun && screenshotUserDataPath) {
  const resolvedScreenshotUserDataPath = resolve(screenshotUserDataPath)

  mkdirSync(resolvedScreenshotUserDataPath, { recursive: true })
  app.setPath("userData", resolvedScreenshotUserDataPath)
}

let mainWindow = null
let nextProcess = null
let serverUrl = null
let mobileRecoveryToken = null
let lastMobileRecoveryAt = 0
let networkRecoveryTimer = null
let isQuitting = false
let isUpdateQuitRequested = false
let lastServerOutput = ""
let autoUpdater = null
let updateCheckPromise = null
let updateDownloadPromise = null
let updateCheckTimer = null
let updateStatus = {
  phase: "idle",
  version: null,
  percent: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
  message: null,
  checkedAt: null,
}
const updateDownloadWaiters = new Set()
let pythonEnvironmentManager = null
let developerRuntimeEnvironmentManager = null
let automationTray = null
let automationNotificationTimer = null
let automationNotificationDirectory = null
let automationBackgroundSettings = null
let studioTrayTasks = []
let macosNotificationSigningSupported = null
let appSnapEnabled = null
let appSnapError = null
let agentRuntimeEnvironmentManager = null
const terminalSessions = new Map()
const pendingAppSnapCaptures = new Map()
const pendingDesktopNotificationActions = new Map()
const activeDesktopNotifications = new Map()

const gotSingleInstanceLock = isScreenshotRun || app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function rememberServerOutput(chunk) {
  const text = String(chunk)
  lastServerOutput = `${lastServerOutput}${text}`.slice(-6_000)
  return text
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : resolve(__dirname, "..")
}

function getUnpackedAppRoot() {
  const appRoot = getAppRoot()

  return appRoot.endsWith(".asar") ? `${appRoot}.unpacked` : appRoot
}

function getPythonEnvironmentManager() {
  if (!pythonEnvironmentManager) {
    const runtimePaths =
      getDeveloperRuntimeEnvironmentManager().getRuntimePaths()
    pythonEnvironmentManager = createPythonEnvironmentManager({
      appRoot: getUnpackedAppRoot(),
      userDataPath: app.getPath("userData"),
      bootstrapRoot: runtimePaths.python.root,
    })
  }

  return pythonEnvironmentManager
}

function findDevelopmentCommand(command) {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
      : [""]

  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) {
      continue
    }

    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`)

      if (existsSync(candidate)) {
        return resolve(candidate)
      }
    }
  }

  throw new Error(
    `Development command ${command} is unavailable. Install it before starting Electron.`
  )
}

function getDevelopmentDeveloperRuntimes() {
  if (app.isPackaged) {
    return null
  }

  const runtimeTarget = `${process.platform}-${process.arch}`
  const pythonRoot = join(
    getAppRoot(),
    "runtime",
    "python",
    "distributions",
    runtimeTarget
  )
  const pythonExecutable =
    process.platform === "win32"
      ? join(pythonRoot, "python.exe")
      : join(pythonRoot, "bin", "python3")
  const pipExecutable =
    process.platform === "win32"
      ? join(pythonRoot, "Scripts", "pip.cmd")
      : join(pythonRoot, "bin", "pip3")
  const nodeExecutable = findDevelopmentCommand("node")
  const npmExecutable = findDevelopmentCommand("npm")
  const npxExecutable = findDevelopmentCommand("npx")
  const nodeRoot =
    process.platform === "win32"
      ? dirname(nodeExecutable)
      : resolve(dirname(nodeExecutable), "..")
  const pythonManifest = JSON.parse(
    readFileSync(
      join(getAppRoot(), "runtime", "python", "runtime-manifest.json"),
      "utf8"
    )
  )

  return {
    python: {
      id: "python",
      label: "Python",
      version: pythonManifest.pythonVersion,
      packageManagerVersion: null,
      root: pythonRoot,
      commands: {
        python: relative(pythonRoot, pythonExecutable),
        pip: relative(pythonRoot, pipExecutable),
      },
    },
    node: {
      id: "node",
      label: "Node.js + npm",
      version: process.versions.node,
      packageManagerVersion: null,
      root: nodeRoot,
      commands: {
        node: relative(nodeRoot, nodeExecutable),
        npm: relative(nodeRoot, npmExecutable),
        npx: relative(nodeRoot, npxExecutable),
      },
    },
  }
}

function getDeveloperRuntimeEnvironmentManager() {
  if (!developerRuntimeEnvironmentManager) {
    developerRuntimeEnvironmentManager =
      createDeveloperRuntimeEnvironmentManager({
        appRoot: getUnpackedAppRoot(),
        userDataPath: app.getPath("userData"),
        developmentRuntimes: getDevelopmentDeveloperRuntimes(),
        onStatusChanged: (status) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              "astraflow:developer-runtime-status-changed",
              status
            )
          }
        },
      })
  }

  return developerRuntimeEnvironmentManager
}

async function ensureManagedPythonRuntimeIfNeeded() {
  return ensureManagedPythonRuntime({
    developerRuntimeEnvironment: getDeveloperRuntimeEnvironmentManager(),
    pythonEnvironment: getPythonEnvironmentManager(),
  })
}

function getDevelopmentAgentRuntimes() {
  if (app.isPackaged) {
    return null
  }

  const appRoot = getAppRoot()
  const definitions = [
    { id: "codex", label: "Codex", packageName: "@openai/codex" },
    {
      id: "claude-code",
      label: "Claude Code",
      packageName: "@anthropic-ai/claude-agent-sdk",
    },
    { id: "opencode", label: "OpenCode", packageName: "opencode-ai" },
  ]

  return Object.fromEntries(
    definitions.map(({ id, label, packageName }) => {
      const packageJsonPath = join(
        appRoot,
        "node_modules",
        ...packageName.split("/"),
        "package.json"
      )
      let packageJson

      try {
        packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
      } catch {
        throw new Error(
          `Development agent runtime ${label} is unavailable. Run bun install before starting Electron.`
        )
      }

      if (typeof packageJson.version !== "string" || !packageJson.version) {
        throw new Error(
          `Development agent runtime ${label} has invalid package metadata.`
        )
      }

      return [id, { id, label, version: packageJson.version }]
    })
  )
}

function getAgentRuntimeEnvironmentManager() {
  if (!agentRuntimeEnvironmentManager) {
    agentRuntimeEnvironmentManager = createAgentRuntimeEnvironmentManager({
      appRoot: getUnpackedAppRoot(),
      userDataPath: app.getPath("userData"),
      developmentRuntimes: getDevelopmentAgentRuntimes(),
      onStatusChanged: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            "astraflow:agent-runtime-status-changed",
            status
          )
        }
      },
    })
  }

  return agentRuntimeEnvironmentManager
}

function getStudioOnboardingStatePath() {
  return join(app.getPath("userData"), STUDIO_ONBOARDING_STATE_FILE)
}

function readStudioOnboardingState() {
  try {
    const state = readFileSync(getStudioOnboardingStatePath(), "utf8").trim()

    return state === "seen" || state === "done" ? state : null
  } catch {
    return null
  }
}

function writeStudioOnboardingState(state) {
  if (state !== "seen" && state !== "done") {
    return false
  }

  try {
    writeFileSync(getStudioOnboardingStatePath(), state, {
      encoding: "utf8",
      mode: 0o600,
    })
    return true
  } catch (error) {
    console.error("Failed to persist Studio onboarding state.", error)
    return false
  }
}

const DEFAULT_AUTOMATION_BACKGROUND_SETTINGS = Object.freeze({
  keepRunningInBackground: true,
  openAtLogin: false,
  notificationsEnabled: true,
})

function getAutomationBackgroundSettingsPath() {
  return join(app.getPath("userData"), AUTOMATION_BACKGROUND_SETTINGS_FILE)
}

function normalizeAutomationBackgroundSettings(value) {
  const input = value && typeof value === "object" ? value : {}

  return {
    keepRunningInBackground:
      typeof input.keepRunningInBackground === "boolean"
        ? input.keepRunningInBackground
        : DEFAULT_AUTOMATION_BACKGROUND_SETTINGS.keepRunningInBackground,
    openAtLogin:
      typeof input.openAtLogin === "boolean"
        ? input.openAtLogin
        : DEFAULT_AUTOMATION_BACKGROUND_SETTINGS.openAtLogin,
    notificationsEnabled:
      typeof input.notificationsEnabled === "boolean"
        ? input.notificationsEnabled
        : DEFAULT_AUTOMATION_BACKGROUND_SETTINGS.notificationsEnabled,
  }
}

function readAutomationBackgroundSettings() {
  if (automationBackgroundSettings) {
    return automationBackgroundSettings
  }

  try {
    automationBackgroundSettings = normalizeAutomationBackgroundSettings(
      JSON.parse(readFileSync(getAutomationBackgroundSettingsPath(), "utf8"))
    )
  } catch {
    automationBackgroundSettings = {
      ...DEFAULT_AUTOMATION_BACKGROUND_SETTINGS,
    }
  }

  return automationBackgroundSettings
}

function applyAutomationLoginItemSetting(settings) {
  if (!app.isPackaged) {
    return
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin,
      openAsHidden: settings.openAtLogin,
      args: process.platform === "win32" ? ["--hidden"] : [],
    })
  } catch (error) {
    console.warn("Failed to update automation login setting.", error)
  }
}

function broadcastAutomationBackgroundSettings(settings) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(
        "astraflow:automation-background-settings-changed",
        settings
      )
    }
  }
}

function writeAutomationBackgroundSettings(value) {
  const settings = normalizeAutomationBackgroundSettings(value)

  try {
    writeFileSync(
      getAutomationBackgroundSettingsPath(),
      JSON.stringify(settings, null, 2),
      { encoding: "utf8", mode: 0o600 }
    )
  } catch (error) {
    console.error("Failed to persist automation background settings.", error)
    throw error
  }

  automationBackgroundSettings = settings
  applyAutomationLoginItemSetting(settings)
  updateAutomationTrayMenu()
  broadcastAutomationBackgroundSettings(settings)
  return settings
}

function automationDesktopLabels() {
  const chinese = app.getLocale().toLowerCase().startsWith("zh")

  return chinese
    ? {
        show: "显示 AstraFlow",
        activeTasks: "进行中的任务",
        recentTasks: "最近任务",
        noActiveTasks: "暂无进行中的任务",
        noRecentTasks: "暂无最近任务",
        allTasks: "查看全部任务…",
        newTask: "新建任务",
        scheduledTasks: "定时任务",
        background: "关闭窗口后继续运行",
        login: "开机自动启动",
        notifications: "定时任务完成通知",
        quit: "退出 AstraFlow",
        succeeded: "定时任务执行成功",
        failed: "定时任务执行失败",
      }
    : {
        show: "Show AstraFlow",
        activeTasks: "Active tasks",
        recentTasks: "Recent tasks",
        noActiveTasks: "No active tasks",
        noRecentTasks: "No recent tasks",
        allTasks: "View all tasks…",
        newTask: "New task",
        scheduledTasks: "Scheduled tasks",
        background: "Keep running after closing windows",
        login: "Open at login",
        notifications: "Scheduled task notifications",
        quit: "Quit AstraFlow",
        succeeded: "Scheduled task succeeded",
        failed: "Scheduled task failed",
      }
}

function showMainWindow(pathname = null) {
  if (!serverUrl || isQuitting) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(serverUrl)
  }

  if (pathname) {
    const targetUrl = new URL(pathname, serverUrl).toString()
    if (mainWindow.webContents.getURL() !== targetUrl) {
      void mainWindow.loadURL(targetUrl)
    }
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function normalizeDesktopNotificationInput(value) {
  const input = value && typeof value === "object" ? value : {}
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const body = typeof input.body === "string" ? input.body.trim() : ""
  const id = typeof input.id === "string" ? input.id.trim().slice(0, 200) : ""
  const path =
    typeof input.path === "string" && input.path.startsWith("/")
      ? input.path.slice(0, 2_000)
      : null
  const actions = Array.isArray(input.actions)
    ? input.actions
        .flatMap((action) => {
          if (!action || typeof action !== "object") return []

          const actionId =
            typeof action.id === "string" ? action.id.trim().slice(0, 80) : ""
          const label =
            typeof action.label === "string"
              ? action.label.trim().slice(0, 80)
              : ""

          return actionId && label ? [{ id: actionId, label }] : []
        })
        .slice(0, 2)
    : []

  return {
    id,
    title: title.slice(0, 160),
    body: body.slice(0, 500),
    path,
    silent: input.silent === true,
    actions,
  }
}

function isDesktopNotificationSupported() {
  if (!Notification.isSupported()) return false
  if (process.platform !== "darwin") return true
  if (typeof macosNotificationSigningSupported === "boolean") {
    return macosNotificationSigningSupported
  }

  const result = spawnSync("/usr/bin/codesign", ["-dvvv", process.execPath], {
    encoding: "utf8",
  })
  const signingDetails = `${result.stdout || ""}\n${result.stderr || ""}`
  macosNotificationSigningSupported =
    result.status === 0 &&
    /TeamIdentifier=(?!not set\b)[A-Z0-9]+/.test(signingDetails)

  return macosNotificationSigningSupported
}

async function showDesktopNotification(value) {
  const input = normalizeDesktopNotificationInput(value)

  if (!input.title || !isDesktopNotificationSupported()) return false

  const notification = new Notification({
    ...(input.id ? { id: input.id } : {}),
    groupId: input.id.startsWith("permission:")
      ? "astraflow-attention"
      : "astraflow-tasks",
    title: input.title,
    body: input.body,
    silent: input.silent,
    actions: input.actions.map((action) => ({
      type: "button",
      text: action.label,
    })),
    closeButtonText: app.getLocale().toLowerCase().startsWith("zh")
      ? "关闭"
      : "Close",
  })
  const notificationId = input.id || notification.id

  activeDesktopNotifications.get(notificationId)?.close()
  activeDesktopNotifications.set(notificationId, notification)
  while (activeDesktopNotifications.size > 50) {
    const oldestId = activeDesktopNotifications.keys().next().value
    const oldestNotification = oldestId
      ? activeDesktopNotifications.get(oldestId)
      : null

    if (!oldestId) break
    activeDesktopNotifications.delete(oldestId)
    oldestNotification?.close()
  }

  notification.on("click", () => showMainWindow(input.path))
  notification.on("close", () => {
    if (activeDesktopNotifications.get(notificationId) === notification) {
      activeDesktopNotifications.delete(notificationId)
    }
  })
  notification.on("action", (event, legacyIndex) => {
    const actionIndex = Number.isInteger(event?.actionIndex)
      ? event.actionIndex
      : legacyIndex
    const action = input.actions[actionIndex]

    showMainWindow(input.path)
    if (!action || !mainWindow || mainWindow.isDestroyed()) return

    const notificationAction = {
      notificationId: input.id,
      actionId: action.id,
    }
    pendingDesktopNotificationActions.set(input.id, notificationAction)
    while (pendingDesktopNotificationActions.size > 50) {
      const oldestId = pendingDesktopNotificationActions.keys().next().value
      if (oldestId) pendingDesktopNotificationActions.delete(oldestId)
      else break
    }
    mainWindow.webContents.send(
      "astraflow:notification-action",
      notificationAction
    )
  })

  return new Promise((resolveShown) => {
    let settled = false
    const settle = (shown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveShown(shown)
    }
    const timeout = setTimeout(() => settle(false), 5_000)

    notification.once("show", () => settle(true))
    notification.once("failed", (_event, error) => {
      console.warn(`Desktop notification failed: ${error}`)
      if (activeDesktopNotifications.get(notificationId) === notification) {
        activeDesktopNotifications.delete(notificationId)
      }
      settle(false)
    })

    try {
      notification.show()
    } catch (error) {
      console.warn("Desktop notification failed.", error)
      activeDesktopNotifications.delete(notificationId)
      settle(false)
    }
  })
}

function getAppSnapSettingsPath() {
  return join(app.getPath("userData"), APPSNAP_SETTINGS_FILE)
}

function readAppSnapEnabled() {
  if (typeof appSnapEnabled === "boolean") return appSnapEnabled

  try {
    const value = JSON.parse(readFileSync(getAppSnapSettingsPath(), "utf8"))
    appSnapEnabled = value?.enabled === true
  } catch {
    appSnapEnabled = false
  }

  return appSnapEnabled
}

function writeAppSnapEnabled(enabled) {
  appSnapEnabled = enabled === true
  writeFileSync(
    getAppSnapSettingsPath(),
    JSON.stringify({ enabled: appSnapEnabled }, null, 2),
    { encoding: "utf8", mode: 0o600 }
  )
}

function broadcastAppSnapState() {
  const state = getAppSnapState()

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("astraflow:appsnap-state-changed", state)
    }
  }

  return state
}

function getAppSnapState() {
  const supported = process.platform === "darwin"

  return {
    supported,
    enabled: supported && readAppSnapEnabled(),
    registered: supported && globalShortcut.isRegistered(APPSNAP_SHORTCUT),
    shortcut: "⌘ ⇧ 2",
    error: appSnapError,
  }
}

async function captureAppSnapWindow() {
  if (process.platform !== "darwin" || !readAppSnapEnabled()) return null

  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1_920, height: 1_200 },
      fetchWindowIcons: true,
    })
    const source = sources.find(
      (candidate) =>
        !candidate.thumbnail.isEmpty() &&
        !candidate.name.toLowerCase().includes(APP_NAME.toLowerCase())
    )

    if (!source) {
      throw new Error(
        "No capturable app window was found. Check Screen Recording permission in System Settings."
      )
    }

    const id = randomBytes(12).toString("hex")
    const dataUrl = source.thumbnail.toDataURL()
    const capture = {
      id,
      name: `AppSnap-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      mimeType: "image/png",
      size: Math.max(0, Math.floor((dataUrl.length * 3) / 4)),
      dataUrl,
      sourceName: source.name,
      capturedAt: new Date().toISOString(),
    }

    pendingAppSnapCaptures.set(id, capture)
    while (pendingAppSnapCaptures.size > 6) {
      const oldestId = pendingAppSnapCaptures.keys().next().value
      if (oldestId) pendingAppSnapCaptures.delete(oldestId)
      else break
    }

    appSnapError = null
    showMainWindow("/studio")
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("astraflow:appsnap-captured", capture)
    }
    broadcastAppSnapState()
    return capture
  } catch (error) {
    appSnapError = error instanceof Error ? error.message : String(error)
    broadcastAppSnapState()
    showDesktopNotification({
      id: "appsnap-error",
      title: "AppSnap failed",
      body: appSnapError,
      path: "/settings/appsnap",
    })
    return null
  }
}

function syncAppSnapShortcut() {
  globalShortcut.unregister(APPSNAP_SHORTCUT)
  appSnapError = null

  if (process.platform !== "darwin" || !readAppSnapEnabled()) {
    return broadcastAppSnapState()
  }

  const registered = globalShortcut.register(APPSNAP_SHORTCUT, () => {
    void captureAppSnapWindow()
  })

  if (!registered) {
    appSnapError = `Could not register ${APPSNAP_SHORTCUT}. Another app may already use it.`
  }

  return broadcastAppSnapState()
}

function setAppSnapEnabled(enabled) {
  if (process.platform !== "darwin") return getAppSnapState()

  writeAppSnapEnabled(enabled)
  return syncAppSnapShortcut()
}

function normalizeStudioTrayTasks(value) {
  if (!Array.isArray(value)) return []

  return value
    .flatMap((task) => {
      if (!task || typeof task !== "object") return []

      const id = typeof task.id === "string" ? task.id.trim().slice(0, 160) : ""
      const title =
        typeof task.title === "string" ? task.title.trim().slice(0, 120) : ""
      const detail =
        typeof task.detail === "string" ? task.detail.trim().slice(0, 160) : ""
      const status =
        task.status === "running" ||
        task.status === "waiting" ||
        task.status === "recent"
          ? task.status
          : null
      const path =
        typeof task.path === "string" && task.path.startsWith("/studio")
          ? task.path.slice(0, 2_000)
          : null
      const updatedAt =
        typeof task.updatedAt === "string"
          ? task.updatedAt.trim().slice(0, 80)
          : ""

      return id && title && status && path
        ? [{ id, title, detail, status, path, updatedAt }]
        : []
    })
    .slice(0, 5)
}

function updateStudioTrayTasks(value) {
  const tasks = normalizeStudioTrayTasks(value)

  if (JSON.stringify(tasks) === JSON.stringify(studioTrayTasks)) {
    return false
  }

  studioTrayTasks = tasks
  updateAutomationTrayMenu()
  return true
}

function updateAutomationTrayMenu() {
  if (!automationTray || automationTray.isDestroyed()) {
    return
  }

  const settings = readAutomationBackgroundSettings()
  const labels = automationDesktopLabels()
  const activeTasks = studioTrayTasks.filter(
    (task) => task.status === "running" || task.status === "waiting"
  )
  const recentTasks = studioTrayTasks.filter((task) => task.status === "recent")
  const taskMenuItem = (task) => ({
    label:
      process.platform === "darwin" || !task.detail
        ? task.title
        : `${task.title} — ${task.detail}`,
    ...(process.platform === "darwin" && task.detail
      ? { sublabel: task.detail }
      : {}),
    click: () => showMainWindow(task.path),
  })

  automationTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: () => showMainWindow() },
      { type: "separator" },
      { label: labels.activeTasks, enabled: false },
      ...(activeTasks.length > 0
        ? activeTasks.map(taskMenuItem)
        : [{ label: labels.noActiveTasks, enabled: false }]),
      { label: labels.recentTasks, enabled: false },
      ...(recentTasks.length > 0
        ? recentTasks.map(taskMenuItem)
        : [{ label: labels.noRecentTasks, enabled: false }]),
      {
        label: labels.allTasks,
        click: () => showMainWindow("/studio"),
      },
      { type: "separator" },
      {
        label: labels.newTask,
        click: () => showMainWindow("/studio"),
      },
      {
        label: labels.scheduledTasks,
        click: () => showMainWindow("/automations"),
      },
      { type: "separator" },
      {
        type: "checkbox",
        label: labels.background,
        checked: settings.keepRunningInBackground,
        click: (item) =>
          writeAutomationBackgroundSettings({
            ...settings,
            keepRunningInBackground: item.checked,
          }),
      },
      {
        type: "checkbox",
        label: labels.login,
        checked: settings.openAtLogin,
        click: (item) =>
          writeAutomationBackgroundSettings({
            ...settings,
            openAtLogin: item.checked,
          }),
      },
      {
        type: "checkbox",
        label: labels.notifications,
        checked: settings.notificationsEnabled,
        click: (item) =>
          writeAutomationBackgroundSettings({
            ...settings,
            notificationsEnabled: item.checked,
          }),
      },
      { type: "separator" },
      {
        label: labels.quit,
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  )
}

function ensureAutomationTray() {
  if (automationTray && !automationTray.isDestroyed()) {
    updateAutomationTrayMenu()
    return
  }

  const iconPath = join(getAppRoot(), "public", "icon", "icon.png")
  if (!existsSync(iconPath)) {
    console.warn(`Automation tray icon is unavailable at ${iconPath}.`)
    return
  }

  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.warn(`Automation tray icon could not be loaded from ${iconPath}.`)
    return
  }
  if (process.platform === "darwin") {
    image = image.resize({ width: 18, height: 18 })
    image.setTemplateImage(true)
  } else {
    image = image.resize({ width: 20, height: 20 })
  }

  automationTray = new Tray(image)
  automationTray.setToolTip(APP_NAME)
  automationTray.on("click", () => showMainWindow())
  updateAutomationTrayMenu()
}

function showAutomationNotification(payload) {
  const settings = readAutomationBackgroundSettings()
  if (!settings.notificationsEnabled) {
    return
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.taskName !== "string" ||
    (payload.status !== "succeeded" && payload.status !== "failed")
  ) {
    return
  }

  const labels = automationDesktopLabels()
  const failed = payload.status === "failed"
  const error = typeof payload.error === "string" ? payload.error.trim() : ""
  const body =
    failed && error
      ? `${payload.taskName}: ${error}`.slice(0, 240)
      : payload.taskName.slice(0, 240)
  void showDesktopNotification({
    id: `automation:${typeof payload.id === "string" ? payload.id : payload.taskName}`,
    title: failed ? labels.failed : labels.succeeded,
    body,
    path: "/automations",
  })
}

function drainAutomationNotificationQueue() {
  const directory = automationNotificationDirectory
  if (!directory || isQuitting) {
    return
  }

  let filenames
  try {
    filenames = readdirSync(directory)
      .filter((filename) => filename.endsWith(".json"))
      .sort()
      .slice(0, 50)
  } catch (error) {
    console.warn("Failed to read automation notification queue.", error)
    return
  }

  for (const filename of filenames) {
    const notificationPath = join(directory, filename)
    try {
      showAutomationNotification(
        JSON.parse(readFileSync(notificationPath, "utf8"))
      )
    } catch (error) {
      console.warn("Failed to process automation notification.", error)
    } finally {
      try {
        rmSync(notificationPath, { force: true })
      } catch (error) {
        console.warn("Failed to remove automation notification.", error)
      }
    }
  }
}

function setupAutomationDesktopFeatures() {
  const settings = readAutomationBackgroundSettings()
  applyAutomationLoginItemSetting(settings)
  ensureAutomationTray()
  drainAutomationNotificationQueue()
  automationNotificationTimer = setInterval(
    drainAutomationNotificationQueue,
    2_000
  )
  automationNotificationTimer.unref?.()
}

function getFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()

    server.once("error", rejectPort)
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()

      server.close(() => {
        if (address && typeof address === "object") {
          resolvePort(address.port)
          return
        }

        rejectPort(new Error("Unable to allocate a loopback port."))
      })
    })
  })
}

function request(url) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = get(url, (res) => {
      res.resume()
      res.once("end", () => resolveRequest(res.statusCode ?? 0))
    })

    req.setTimeout(5_000, () => {
      req.destroy(new Error("Timed out while waiting for the Next.js server."))
    })
    req.once("error", rejectRequest)
  })
}

function waitForServer(url, child) {
  const startedAt = Date.now()

  return new Promise((resolveServer, rejectServer) => {
    let settled = false
    let timer = null

    function cleanup() {
      settled = true
      child.off("exit", onExit)

      if (timer) {
        clearTimeout(timer)
      }
    }

    function fail(error) {
      if (settled) return
      cleanup()
      rejectServer(error)
    }

    function onExit(code, signal) {
      fail(
        new Error(
          `Next.js server exited before startup (code ${code ?? "null"}, signal ${
            signal ?? "null"
          }).\n${lastServerOutput}`
        )
      )
    }

    async function poll() {
      if (settled) return

      if (Date.now() - startedAt > SERVER_START_TIMEOUT_MS) {
        fail(
          new Error(
            `Next.js server did not start in time.\n${lastServerOutput}`
          )
        )
        return
      }

      try {
        const statusCode = await request(url)

        if (statusCode > 0 && statusCode < 500) {
          cleanup()
          resolveServer()
          return
        }
      } catch {
        // Keep polling until the server accepts requests or the timeout expires.
      }

      timer = setTimeout(poll, 500)
    }

    child.once("exit", onExit)
    void poll()
  })
}

function startServerProcess(script, args, { appRoot, env }) {
  const child = utilityProcess.fork(script, args, {
    cwd: appRoot.endsWith(".asar") ? dirname(appRoot) : appRoot,
    env: sanitizeProcessEnv(env),
    serviceName: `${APP_NAME} Server`,
    stdio: ["ignore", "pipe", "pipe"],
  })

  nextProcess = child

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(rememberServerOutput(chunk))
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(rememberServerOutput(chunk))
  })

  child.once("error", (type, location, report) => {
    lastServerOutput =
      `${lastServerOutput}\n${type}: ${location}\n${report}`.slice(-6_000)
  })

  return child
}

function sanitizeProcessEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined)
  )
}

function getBunCommand() {
  const npmExecPath = process.env.npm_execpath

  if (npmExecPath && /(^|[/\\])bun(?:\.exe)?$/i.test(npmExecPath)) {
    return npmExecPath
  }

  return process.platform === "win32" ? "bun.cmd" : "bun"
}

function startDevServerProcess(port, { appRoot, env }) {
  const child = spawn(
    getBunCommand(),
    ["run", "dev", "--", "--hostname", LOOPBACK_HOST, "--port", String(port)],
    {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  nextProcess = child

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(rememberServerOutput(chunk))
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(rememberServerOutput(chunk))
  })

  child.once("error", (error) => {
    lastServerOutput =
      `${lastServerOutput}\n${error.stack ?? error.message}`.slice(-6_000)
  })

  return child
}

function resolveStudioSecretKey() {
  // Persist a 32-byte key encrypted at rest with the OS keychain (safeStorage)
  // and hand it to the server process as hex so it can encrypt sensitive
  // settings. Returns null when encryption is unavailable so the server falls
  // back to plaintext storage.
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }

  const keyPath = join(app.getPath("userData"), SECRET_KEY_FILE)

  if (existsSync(keyPath)) {
    try {
      const decrypted = safeStorage.decryptString(readFileSync(keyPath))
      const trimmed = decrypted.trim()

      if (/^[0-9a-f]{64}$/i.test(trimmed)) {
        return trimmed
      }
    } catch {
      // Fall through and regenerate the key below.
    }
  }

  const key = randomBytes(32).toString("hex")

  try {
    writeFileSync(keyPath, safeStorage.encryptString(key))
  } catch {
    // If persistence fails, still return the key for this run so credentials
    // are encrypted in memory; they simply won't decrypt on the next launch.
  }

  return key
}

function resolveAstraFlowDeviceId(secretKey) {
  return createHmac("sha256", Buffer.from(secretKey, "hex"))
    .update(`astraflow-device:${resolve(app.getPath("userData"))}`)
    .digest("hex")
}

function createLocalFullAccessGrant(secretKey, input) {
  const now = Date.now()
  const payload = {
    version: LOCAL_FULL_ACCESS_GRANT_VERSION,
    policyVersion: LOCAL_FULL_ACCESS_POLICY_VERSION,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    environment: "local",
    deviceId: resolveAstraFlowDeviceId(secretKey),
    nonce: randomBytes(32).toString("hex"),
    issuedAt: now,
    expiresAt: now + LOCAL_FULL_ACCESS_GRANT_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  )
  const signature = createHmac("sha256", Buffer.from(secretKey, "hex"))
    .update(encodedPayload)
    .digest("base64url")

  return `${encodedPayload}.${signature}`
}

async function startNextServer() {
  const appRoot = getAppRoot()
  const standaloneServer = join(appRoot, "server.js")
  const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next")

  if (!isDevRun && !existsSync(standaloneServer) && !existsSync(nextBin)) {
    throw new Error(
      `Next.js runtime was not packaged. Missing ${standaloneServer} and ${nextBin}.`
    )
  }

  const port = await getFreePort()
  const userData = app.getPath("userData")
  const dataDir = join(userData, "data")
  const filesDir = join(userData, "studio-files")
  const skillsDir = join(userData, "studio-skills")
  const managedWorkspacesDir = join(app.getPath("home"), "AstraFlow")
  const acpWorkspacesDir = join(userData, "acp-workspaces")
  const acpAttachmentsDir = join(userData, "acp-attachments")
  const sandboxWorkspacesDir = join(userData, "sandbox-workspaces")
  const automationNotificationsDir = join(userData, "automation-notifications")
  const bundledRuntimeTarget = `${process.platform}-${process.arch}`
  const unpackedAppRoot = getUnpackedAppRoot()
  const developerRuntimeEnvironment = isScreenshotRun
    ? null
    : getDeveloperRuntimeEnvironmentManager()
  const developerProcessEnvironment = developerRuntimeEnvironment
    ? developerRuntimeEnvironment.getProcessEnvironment()
    : {}
  const developerRuntimeStatuses = developerRuntimeEnvironment
    ? developerRuntimeEnvironment.getStatuses()
    : []
  const pythonEnvironment = isScreenshotRun
    ? null
    : getPythonEnvironmentManager()
  const agentRuntimeEnvironment = isScreenshotRun
    ? {}
    : await getAgentRuntimeEnvironmentManager().ensureReady()
  const pythonProcessEnvironment = isScreenshotRun
    ? {}
    : pythonEnvironment.getActiveProcessEnvironment()
  const bundledPythonRoot = pythonEnvironment?.bootstrapRoot
  const bundledPythonExecutable = pythonEnvironment?.bootstrapExecutable
  const bundledSandboxBin = join(
    unpackedAppRoot,
    "runtime",
    "sandbox",
    bundledRuntimeTarget,
    "bin"
  )

  mkdirSync(dataDir, { recursive: true })
  mkdirSync(filesDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(acpWorkspacesDir, { recursive: true })
  mkdirSync(acpAttachmentsDir, { recursive: true })
  mkdirSync(sandboxWorkspacesDir, { recursive: true })
  mkdirSync(automationNotificationsDir, { recursive: true })
  automationNotificationDirectory = automationNotificationsDir

  const secretKey = resolveStudioSecretKey()
  const deviceId = secretKey ? resolveAstraFlowDeviceId(secretKey) : null
  mobileRecoveryToken = randomBytes(32).toString("hex")

  const env = {
    ...process.env,
    ...developerProcessEnvironment,
    ...pythonProcessEnvironment,
    ...agentRuntimeEnvironment,
    PATH: [
      pythonProcessEnvironment.ASTRAFLOW_PYTHON_EXECUTABLE
        ? dirname(pythonProcessEnvironment.ASTRAFLOW_PYTHON_EXECUTABLE)
        : null,
      agentRuntimeEnvironment.ASTRAFLOW_CODEX_EXECUTABLE
        ? dirname(agentRuntimeEnvironment.ASTRAFLOW_CODEX_EXECUTABLE)
        : null,
      agentRuntimeEnvironment.CLAUDE_CODE_EXECUTABLE
        ? dirname(agentRuntimeEnvironment.CLAUDE_CODE_EXECUTABLE)
        : null,
      agentRuntimeEnvironment.ASTRAFLOW_OPENCODE_EXECUTABLE
        ? dirname(agentRuntimeEnvironment.ASTRAFLOW_OPENCODE_EXECUTABLE)
        : null,
      developerProcessEnvironment.PATH,
    ]
      .filter(Boolean)
      .join(delimiter),
    ASTRAFLOW_ELECTRON: "1",
    ASTRAFLOW_ELECTRON_DEV: isDevRun ? "1" : undefined,
    ASTRAFLOW_APP_VERSION: app.getVersion(),
    ASTRAFLOW_SQLITE_PATH: join(dataDir, "astraflow.sqlite"),
    ASTRAFLOW_STUDIO_FILES_PATH: filesDir,
    ASTRAFLOW_STUDIO_SKILLS_PATH: skillsDir,
    // The directory itself is created lazily on the first Agent run. Keeping
    // allocation in the server process avoids leaving an empty ~/AstraFlow
    // folder for users who never run an Agent task.
    ASTRAFLOW_MANAGED_WORKSPACES_PATH: managedWorkspacesDir,
    ASTRAFLOW_ACP_WORKSPACES_PATH: acpWorkspacesDir,
    ASTRAFLOW_ACP_ATTACHMENTS_PATH: acpAttachmentsDir,
    ASTRAFLOW_ASTRAFLOW_ACP_ROOT: join(appRoot, "runtime", "astraflow-acp"),
    ASTRAFLOW_BUNDLED_SKILLS_PATH: join(appRoot, "bundled-skills"),
    ASTRAFLOW_BUNDLED_NODE_MODULES: join(appRoot, "node_modules"),
    ASTRAFLOW_NODE_EXECUTABLE: process.execPath,
    ASTRAFLOW_ENVIRONMENT_INSTALLER_PATH: join(
      unpackedAppRoot,
      "runtime",
      "developer-runtimes",
      "environment-installer.mjs"
    ),
    ASTRAFLOW_ENVIRONMENT_MANAGER_PATH: join(
      appRoot,
      "electron",
      "developer-runtime-environment.cjs"
    ),
    ASTRAFLOW_UNPACKED_APP_ROOT: unpackedAppRoot,
    ASTRAFLOW_USER_DATA_PATH: userData,
    ASTRAFLOW_PYTHON_BOOTSTRAP_EXECUTABLE: bundledPythonExecutable,
    ASTRAFLOW_PYTHON_BOOTSTRAP_VERSION: developerRuntimeStatuses.find(
      (status) => status.runtimeId === "python"
    )?.version,
    ASTRAFLOW_DEVELOPER_NODE_VERSION: developerRuntimeStatuses.find(
      (status) => status.runtimeId === "node"
    )?.version,
    ASTRAFLOW_NPM_VERSION: developerRuntimeStatuses.find(
      (status) => status.runtimeId === "node"
    )?.packageManagerVersion,
    ASTRAFLOW_SANDBOX_RUNNER_PATH: join(
      appRoot,
      "electron",
      "sandbox-command-runner.mjs"
    ),
    ASTRAFLOW_SANDBOX_WORKSPACES_PATH: sandboxWorkspacesDir,
    ASTRAFLOW_AUTOMATION_NOTIFICATIONS_PATH: automationNotificationsDir,
    ASTRAFLOW_BUNDLED_PYTHON_ROOT: bundledPythonRoot,
    ASTRAFLOW_PYTHON_CONFIG_PATH: pythonEnvironment?.configPath,
    ASTRAFLOW_PYTHON_STATE_PATH: pythonEnvironment?.statePath,
    ASTRAFLOW_SANDBOX_BIN_PATH: existsSync(bundledSandboxBin)
      ? bundledSandboxBin
      : undefined,
    ASTRAFLOW_INTERNAL_RECOVERY_TOKEN: mobileRecoveryToken,
    ASTRAFLOW_INTERNAL_ORIGIN: `http://${LOOPBACK_HOST}:${port}`,
    ASTRAFLOW_DEVICE_ID: deviceId ?? undefined,
    GITHUB_OAUTH_CLIENT_ID:
      process.env.GITHUB_OAUTH_CLIENT_ID || CODEBOX_GITHUB_OAUTH_CLIENT_ID,
    HOSTNAME: LOOPBACK_HOST,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: isDevRun ? "development" : "production",
    PORT: String(port),
  }

  if (secretKey) {
    env.ASTRAFLOW_SECRET_KEY = secretKey
  }

  const child = isDevRun
    ? startDevServerProcess(port, { appRoot, env })
    : existsSync(standaloneServer)
      ? startServerProcess(standaloneServer, [], { appRoot, env })
      : startServerProcess(
          nextBin,
          ["start", "--hostname", LOOPBACK_HOST, "--port", String(port)],
          { appRoot, env }
        )

  serverUrl = `http://${LOOPBACK_HOST}:${port}`
  await waitForServer(serverUrl, child)

  return serverUrl
}

function triggerMobileChannelRecovery(reason) {
  if (!serverUrl || !mobileRecoveryToken || isQuitting) {
    return Promise.resolve(false)
  }

  const now = Date.now()
  if (now - lastMobileRecoveryAt < 2_000) {
    return Promise.resolve(false)
  }
  lastMobileRecoveryAt = now

  return new Promise((resolveRecovery) => {
    const body = JSON.stringify({ reason })
    const target = new URL("/api/internal/mobile-channels/recover", serverUrl)
    const req = httpRequest(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-AstraFlow-Recovery-Token": mobileRecoveryToken,
        },
      },
      (res) => {
        res.resume()
        res.once("end", () => {
          const succeeded = (res.statusCode ?? 500) < 400
          if (!succeeded) {
            console.warn(
              `Mobile channel recovery returned ${res.statusCode ?? "unknown"}.`
            )
          }
          resolveRecovery(succeeded)
        })
      }
    )
    req.setTimeout(10_000, () => {
      req.destroy(new Error("Mobile channel recovery request timed out."))
    })
    req.once("error", (error) => {
      console.warn("Failed to trigger mobile channel recovery.", error)
      resolveRecovery(false)
    })
    req.end(body)
  })
}

function setupMobileChannelPowerRecovery() {
  powerMonitor.on("resume", () => {
    void triggerMobileChannelRecovery("system-resume")
  })
  powerMonitor.on("unlock-screen", () => {
    void triggerMobileChannelRecovery("screen-unlock")
  })

  let wasOnline = net.isOnline()
  networkRecoveryTimer = setInterval(() => {
    const isOnline = net.isOnline()
    if (isOnline && !wasOnline) {
      void triggerMobileChannelRecovery("network-online")
    }
    wasOnline = isOnline
  }, 5_000)
  networkRecoveryTimer.unref?.()
}

function shouldOpenExternal(url) {
  if (url === "about:blank") {
    return false
  }

  if (serverUrl && url.startsWith(serverUrl)) {
    return false
  }

  try {
    const parsed = new URL(url)
    return isExternalOpenProtocol(parsed.protocol)
  } catch {
    return false
  }
}

function isExternalOpenProtocol(protocol) {
  return (
    protocol === "http:" ||
    protocol === "https:" ||
    protocol === "mailto:" ||
    protocol === "vscode:" ||
    protocol === "vscode-insiders:"
  )
}

function normalizeExternalOpenUrl(targetUrl) {
  if (typeof targetUrl !== "string") {
    return null
  }

  const trimmedUrl = targetUrl.trim()

  if (!trimmedUrl) {
    return null
  }

  try {
    const parsed = new URL(trimmedUrl)
    return isExternalOpenProtocol(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

async function openExternalUrl(targetUrl) {
  const normalizedUrl = normalizeExternalOpenUrl(targetUrl)

  if (!normalizedUrl) {
    return false
  }

  try {
    await shell.openExternal(normalizedUrl)
    return true
  } catch (error) {
    console.error("Failed to open external URL.", error)
    return false
  }
}

function attachNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternal(url)) {
      void openExternalUrl(url)
      return { action: "deny" }
    }

    return { action: "allow" }
  })

  window.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenExternal(url)) {
      return
    }

    event.preventDefault()
    void openExternalUrl(url)
  })

  window.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key ?? "").toLowerCase()

    if (
      (input.meta || input.control) &&
      !input.shift &&
      !input.alt &&
      key === "o"
    ) {
      event.preventDefault()
      window.webContents.send("astraflow:open-local-workspace")
      return
    }

    if ((input.meta || input.control) && key === "w") {
      event.preventDefault()
      window.webContents.send("astraflow:close-active-tab")
    }
  })

  window.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false

      if (
        params.partition !== SIDE_PANEL_BROWSER_PARTITION ||
        !isSidePanelBrowserUrl(params.src)
      ) {
        event.preventDefault()
      }
    }
  )

  window.webContents.on("did-attach-webview", (_event, guest) => {
    const handleGuestNavigation = (event, targetUrl) => {
      if (isSidePanelBrowserUrl(targetUrl)) {
        return
      }

      event.preventDefault()

      if (shouldOpenExternal(targetUrl)) {
        void openExternalUrl(targetUrl)
      }
    }

    guest.on("will-navigate", handleGuestNavigation)
    guest.on("will-redirect", handleGuestNavigation)
    guest.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isSidePanelBrowserUrl(targetUrl)) {
        void guest.loadURL(targetUrl).catch(() => undefined)
      } else if (shouldOpenExternal(targetUrl)) {
        void openExternalUrl(targetUrl)
      }

      return { action: "deny" }
    })
  })
}

function isSidePanelBrowserUrl(value) {
  if (value === "about:blank") {
    return true
  }

  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function configureSidePanelBrowserSession() {
  const browserSession = session.fromPartition(SIDE_PANEL_BROWSER_PARTITION)

  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  )
}

function configureMainWindowPermissions(window) {
  const browserSession = window.webContents.session

  browserSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) => {
      if (webContents !== window.webContents) {
        return false
      }

      if (permission === "fullscreen") {
        return details.isMainFrame
      }

      return permission === "media" && details.mediaType === "audio"
    }
  )
  browserSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (webContents !== window.webContents) {
        callback(false)
        return
      }

      if (permission === "fullscreen") {
        callback(details.isMainFrame)
        return
      }

      const mediaTypes = Array.isArray(details.mediaTypes)
        ? details.mediaTypes
        : []
      callback(
        permission === "media" &&
          mediaTypes.includes("audio") &&
          !mediaTypes.includes("video")
      )
    }
  )
}

function createMainWindow(url, { show = true } = {}) {
  const macWindowOptions =
    process.platform === "darwin"
      ? {
          acceptFirstMouse: true,
          titleBarStyle: "hidden",
          // Let Electron read the current AppKit button size and center the
          // native traffic lights inside the same 48px row used by the web UI.
          titleBarOverlay: {
            height: NATIVE_TITLEBAR_HEIGHT,
          },
        }
      : {}

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#f7f6f2",
    show: false,
    ...macWindowOptions,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      webviewTag: true,
    },
  })

  if (isScreenshotRun) {
    const screenshotWidth = Number.parseInt(
      process.env.ASTRAFLOW_ELECTRON_SCREENSHOT_WIDTH || "1920",
      10
    )
    const screenshotHeight = Number.parseInt(
      process.env.ASTRAFLOW_ELECTRON_SCREENSHOT_HEIGHT || "1080",
      10
    )

    window.setContentSize(screenshotWidth, screenshotHeight + 48)
  }

  configureSidePanelBrowserSession()
  configureMainWindowPermissions(window)
  attachNavigationGuards(window)

  if (process.platform === "darwin") {
    const showWindowButtons = () => {
      if (!window.isDestroyed()) {
        window.setWindowButtonVisibility(true)
      }
    }

    const sendFullScreenState = (isFullScreen) => {
      if (!window.isDestroyed()) {
        showWindowButtons()
        window.webContents.send("astraflow:fullscreen-changed", isFullScreen)
      }
    }

    showWindowButtons()
    window.webContents.once("did-finish-load", () => {
      sendFullScreenState(window.isFullScreen())
    })
    window.on("enter-full-screen", () => sendFullScreenState(true))
    window.on("leave-full-screen", () => sendFullScreenState(false))
  }

  window.once("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.on("close", (event) => {
    if (
      !isQuitting &&
      !isUpdateQuitRequested &&
      readAutomationBackgroundSettings().keepRunningInBackground
    ) {
      event.preventDefault()
      window.hide()
    }
  })

  window.once("ready-to-show", () => {
    if (show) {
      window.show()
    }
  })

  void window.loadURL(url)
  return window
}

function getDefaultShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe"
  }

  return process.env.SHELL || "/bin/zsh"
}

function getDefaultShellArgs() {
  return process.platform === "win32" ? [] : ["-l"]
}

function createTerminalSession(event, options = {}) {
  const id = randomBytes(12).toString("hex")
  const cols = Math.max(20, Math.min(400, Number(options.cols) || 80))
  const rows = Math.max(6, Math.min(160, Number(options.rows) || 24))
  const { resolvedPath: cwd } = resolveLocalWorkspacePath(
    options.workspaceRoot,
    options.cwd || options.workspaceRoot,
    { kind: "directory" }
  )
  const webContents = event.sender
  const terminal = pty.spawn(getDefaultShell(), getDefaultShellArgs(), {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: sanitizeProcessEnv({
      ...process.env,
      ...getDeveloperRuntimeEnvironmentManager().getProcessEnvironment(),
      ...getPythonEnvironmentManager().getActiveProcessEnvironment(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ASTRAFLOW_TERMINAL: "1",
    }),
  })
  const handleWebContentsDestroyed = () => closeTerminalSession(id)

  terminalSessions.set(id, {
    terminal,
    webContents,
    handleWebContentsDestroyed,
  })
  webContents.once("destroyed", handleWebContentsDestroyed)

  terminal.onData((data) => {
    if (!webContents.isDestroyed()) {
      webContents.send("astraflow:local-terminal-data", { id, data })
    }
  })

  terminal.onExit(({ exitCode, signal }) => {
    const session = terminalSessions.get(id)

    terminalSessions.delete(id)
    session?.webContents.off("destroyed", session.handleWebContentsDestroyed)

    if (!webContents.isDestroyed()) {
      webContents.send("astraflow:local-terminal-exit", {
        id,
        exitCode,
        signal,
      })
    }
  })

  return { id, cwd }
}

function getOwnedTerminalSession(event, id) {
  const session = terminalSessions.get(id)

  return session?.webContents === event.sender ? session : null
}

function closeTerminalSession(id, webContents = null) {
  const session = terminalSessions.get(id)

  if (!session || (webContents && session.webContents !== webContents)) {
    return false
  }

  terminalSessions.delete(id)
  session.webContents.off("destroyed", session.handleWebContentsDestroyed)
  session.terminal.kill()
  return true
}

function closeAllTerminalSessions() {
  for (const id of terminalSessions.keys()) {
    closeTerminalSession(id)
  }
}

function mapLocalWorkspaceDirectoryEntry(workspaceRoot, parentPath, entry) {
  try {
    const { resolvedPath, stats } = resolveLocalWorkspacePath(
      workspaceRoot,
      join(parentPath, entry.name),
      { allowRoot: false }
    )
    const kind = stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : null

    if (!kind) {
      return null
    }

    return {
      name: entry.name,
      path: resolvedPath,
      kind,
      extension:
        kind === "file"
          ? extname(entry.name).replace(/^\./, "").toLowerCase()
          : "",
      size: kind === "file" ? stats.size : null,
      modifiedAt: stats.mtimeMs,
    }
  } catch {
    // Skip broken links and links that escape the selected workspace root.
    return null
  }
}

function listLocalWorkspaceDirectory(
  workspaceRoot,
  directory,
  { includeHidden = false } = {}
) {
  const { resolvedRoot, resolvedPath: cwd } = resolveLocalWorkspacePath(
    workspaceRoot,
    directory || workspaceRoot,
    { kind: "directory" }
  )
  const parentPath = dirname(cwd)
  const entries = readdirSync(cwd, { withFileTypes: true })
    .filter(
      (entry) =>
        includeHidden ||
        !entry.name.startsWith(".") ||
        SIDE_PANEL_VISIBLE_DOTFILES.has(entry.name.toLowerCase()) ||
        SIDE_PANEL_VISIBLE_DOTFILE_PREFIXES.some((prefix) =>
          entry.name.toLowerCase().startsWith(prefix)
        )
    )
    .map((entry) => mapLocalWorkspaceDirectoryEntry(resolvedRoot, cwd, entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    })

  return {
    cwd,
    name: basename(cwd) || cwd,
    parent:
      cwd !== resolvedRoot &&
      isPathInsideLocalWorkspace(resolvedRoot, parentPath)
        ? parentPath
        : null,
    entries,
  }
}

function localWorkspaceFileReferenceSegments(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
}

function matchingLocalWorkspaceFileSuffixLength(candidatePath, referencePath) {
  const candidate = localWorkspaceFileReferenceSegments(candidatePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  const reference = localWorkspaceFileReferenceSegments(referencePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  let score = 0

  while (
    score < candidate.length &&
    score < reference.length &&
    candidate[candidate.length - score - 1] ===
      reference[reference.length - score - 1]
  ) {
    score += 1
  }

  return score
}

async function findLocalWorkspaceFileByReferenceUncached(
  workspaceRoot,
  referencePath
) {
  const referenceSegments = localWorkspaceFileReferenceSegments(referencePath)
  const targetName = referenceSegments.at(-1) ?? ""
  const comparableTargetName = targetName.toLocaleLowerCase("en-US")

  if (!targetName) {
    throw new Error("File reference is required.")
  }

  const resolvedRoot = resolveLocalWorkspacePath(workspaceRoot, workspaceRoot, {
    kind: "directory",
  }).resolvedRoot
  const directories = [resolvedRoot]
  const visitedDirectories = new Set()
  const matches = []

  for (let index = 0; index < directories.length; index += 1) {
    let listing
    try {
      listing = listLocalWorkspaceDirectory(resolvedRoot, directories[index], {
        includeHidden: true,
      })
    } catch (error) {
      if (index === 0) {
        throw error
      }
      continue
    }

    if (visitedDirectories.has(listing.cwd)) {
      continue
    }
    visitedDirectories.add(listing.cwd)

    for (const entry of listing.entries) {
      if (
        entry.kind === "file" &&
        entry.name.toLocaleLowerCase("en-US") === comparableTargetName
      ) {
        matches.push({
          path: entry.path,
          exactName: entry.name === targetName,
          score: matchingLocalWorkspaceFileSuffixLength(
            entry.path,
            referencePath
          ),
          modifiedAt: entry.modifiedAt,
        })
      } else if (entry.kind === "directory") {
        directories.push(entry.path)
      }
    }

    // Yield between directories so an exhaustive fallback never monopolizes the
    // Electron main loop while a large workspace is being indexed.
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
  }

  matches.sort(
    (left, right) =>
      Number(right.exactName) - Number(left.exactName) ||
      right.score - left.score ||
      right.modifiedAt - left.modifiedAt ||
      left.path.length - right.path.length ||
      left.path.localeCompare(right.path)
  )

  const best = matches[0]
  const equallyStrong = best
    ? matches.filter(
        (match) =>
          match.exactName === best.exactName && match.score === best.score
      )
    : []

  return {
    path: equallyStrong.length === 1 ? equallyStrong[0].path : null,
    candidates: matches.map((match) => match.path),
  }
}

function findLocalWorkspaceFileByReference(workspaceRoot, referencePath) {
  const key = `${workspaceRoot}\0${referencePath}`
  const cached = localWorkspaceFileSearchCache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise
  }

  const promise = findLocalWorkspaceFileByReferenceUncached(
    workspaceRoot,
    referencePath
  )
  localWorkspaceFileSearchCache.set(key, {
    expiresAt: Date.now() + LOCAL_WORKSPACE_FILE_SEARCH_CACHE_TTL_MS,
    promise,
  })
  while (
    localWorkspaceFileSearchCache.size >
    LOCAL_WORKSPACE_FILE_SEARCH_CACHE_MAX_ENTRIES
  ) {
    localWorkspaceFileSearchCache.delete(
      localWorkspaceFileSearchCache.keys().next().value
    )
  }
  void promise.catch(() => {
    if (localWorkspaceFileSearchCache.get(key)?.promise === promise) {
      localWorkspaceFileSearchCache.delete(key)
    }
  })

  return promise
}

function statLocalWorkspacePath(workspaceRoot, filePath) {
  try {
    const { resolvedPath, stats } = resolveLocalWorkspacePath(
      workspaceRoot,
      filePath
    )
    const kind = stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : null

    if (!kind) {
      return null
    }

    return {
      name: basename(resolvedPath),
      path: resolvedPath,
      kind,
      extension:
        kind === "file"
          ? extname(resolvedPath).replace(/^\./, "").toLowerCase()
          : "",
      size: kind === "file" ? stats.size : null,
      modifiedAt: stats.mtimeMs,
    }
  } catch {
    return null
  }
}

function readLocalWorkspaceTextFile(workspaceRoot, filePath) {
  const { resolvedPath, stats } = resolveLocalWorkspacePath(
    workspaceRoot,
    filePath,
    { allowRoot: false, kind: "file" }
  )
  const previewSize = Math.min(stats.size, SIDE_PANEL_TEXT_FILE_LIMIT_BYTES)
  const bytes = Buffer.allocUnsafe(previewSize)
  const descriptor = openSync(resolvedPath, "r")
  let bytesRead = 0

  try {
    while (bytesRead < previewSize) {
      const nextRead = readSync(
        descriptor,
        bytes,
        bytesRead,
        previewSize - bytesRead,
        bytesRead
      )

      if (nextRead === 0) {
        break
      }

      bytesRead += nextRead
    }
  } finally {
    closeSync(descriptor)
  }

  return {
    path: resolvedPath,
    name: basename(resolvedPath),
    directory: dirname(resolvedPath),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    content: bytes.subarray(0, bytesRead).toString("utf8"),
    truncated: stats.size > previewSize,
  }
}

function getSidePanelMimeType(filePath) {
  const extension = extname(filePath).replace(/^\./, "").toLowerCase()
  const mimeTypes = {
    avif: "image/avif",
    bmp: "image/bmp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    svg: "image/svg+xml",
    wasm: "application/wasm",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }

  return mimeTypes[extension] ?? "application/octet-stream"
}

function readLocalWorkspaceDataUrlFile(
  workspaceRoot,
  filePath,
  requestedLimitBytes
) {
  const { resolvedPath, stats } = resolveLocalWorkspacePath(
    workspaceRoot,
    filePath,
    { allowRoot: false, kind: "file" }
  )
  const requestedLimit = Number(requestedLimitBytes)
  const effectiveLimit = Number.isFinite(requestedLimit)
    ? Math.max(
        1,
        Math.min(
          SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES,
          Math.floor(requestedLimit)
        )
      )
    : SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES

  if (stats.size > effectiveLimit) {
    throw new Error("Selected file is too large to preview.")
  }

  if (
    extname(resolvedPath).toLowerCase() === ".xls" &&
    stats.size > SIDE_PANEL_LEGACY_XLS_LIMIT_BYTES
  ) {
    throw new Error("Selected legacy XLS file is too large to preview.")
  }

  const mimeType = getSidePanelMimeType(resolvedPath)
  const data = readFileSync(resolvedPath).toString("base64")

  return {
    path: resolvedPath,
    name: basename(resolvedPath),
    directory: dirname(resolvedPath),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    mimeType,
    dataUrl: `data:${mimeType};base64,${data}`,
  }
}

async function showLocalWorkspacePathInFolder(workspaceRoot, filePath) {
  try {
    const { resolvedPath, stats } = resolveLocalWorkspacePath(
      workspaceRoot,
      filePath
    )

    if (process.platform === "linux") {
      const target = stats.isDirectory() ? resolvedPath : dirname(resolvedPath)
      return (await shell.openPath(target)) === ""
    }

    shell.showItemInFolder(resolvedPath)
    return true
  } catch {
    return false
  }
}

async function openLocalWorkspacePath(workspaceRoot, filePath) {
  try {
    const { resolvedPath } = resolveLocalWorkspacePath(workspaceRoot, filePath)
    return (await shell.openPath(resolvedPath)) === ""
  } catch {
    return false
  }
}

async function openLocalPath(filePath) {
  try {
    const { resolvedPath } = resolveExistingLocalPath(filePath, {
      kind: "file",
    })
    return (await shell.openPath(resolvedPath)) === ""
  } catch {
    return false
  }
}

async function clearSidePanelBrowserData() {
  const browserSession = session.fromPartition(SIDE_PANEL_BROWSER_PARTITION)

  await Promise.all([
    session.defaultSession.clearStorageData(),
    session.defaultSession.clearCache(),
    browserSession.clearStorageData(),
    browserSession.clearCache(),
  ])
  return true
}

function normalizeCertificateThumbprint(value) {
  return String(value ?? "")
    .replace(/[^a-f0-9]/gi, "")
    .toUpperCase()
}

function readSignerCertificate(signature) {
  return signature && typeof signature === "object"
    ? (signature.SignerCertificate ?? null)
    : null
}

function normalizeComparableWindowsPath(value) {
  return normalize(value).toLowerCase()
}

function signaturePathMatches(signature, expectedPath) {
  if (!signature?.Path) {
    return true
  }

  return (
    normalizeComparableWindowsPath(signature.Path) ===
    normalizeComparableWindowsPath(expectedPath)
  )
}

function parseDistinguishedName(value) {
  try {
    return parseDn(String(value ?? ""))
  } catch {
    return new Map()
  }
}

function publisherMatchesSigner(publisherNames, signerCertificate) {
  const subject = parseDistinguishedName(signerCertificate?.Subject)

  if (!subject.size) {
    return false
  }

  return publisherNames.some((publisherName) => {
    const publisherDn = parseDistinguishedName(publisherName)

    if (publisherDn.size) {
      return [...publisherDn.keys()].every(
        (key) => publisherDn.get(key) === subject.get(key)
      )
    }

    return publisherName === subject.get("CN")
  })
}

function signatureHasRecoverableChainError(signature, failureMessage = "") {
  const status = Number(signature?.Status)

  if (!WINDOWS_SIGNATURE_RECOVERABLE_STATUSES.has(status)) {
    return false
  }

  return WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN.test(
    `${signature?.StatusMessage ?? ""}\n${failureMessage}`
  )
}

function collectConfiguredWindowsSignerThumbprints() {
  return new Set(
    String(process.env[WINDOWS_SIGNER_THUMBPRINTS_ENV] ?? "")
      .split(/[\s,;|]+/)
      .map(normalizeCertificateThumbprint)
      .filter(Boolean)
  )
}

async function collectCurrentWindowsSignerThumbprints() {
  const thumbprints = collectConfiguredWindowsSignerThumbprints()

  if (!app.isPackaged || !existsSync(process.execPath)) {
    return thumbprints
  }

  const currentSignature = await readAuthenticodeSignature(process.execPath)
  const currentStatus = Number(currentSignature?.Status)

  if (
    currentStatus !== 0 &&
    !signatureHasRecoverableChainError(currentSignature)
  ) {
    return thumbprints
  }

  const currentThumbprint = normalizeCertificateThumbprint(
    readSignerCertificate(currentSignature)?.Thumbprint
  )

  if (currentThumbprint) {
    thumbprints.add(currentThumbprint)
  }

  return thumbprints
}

async function verifyWindowsUpdateSignatureFallback(
  publisherNames,
  updateFilePath,
  defaultFailure
) {
  if (process.platform !== "win32") {
    return defaultFailure
  }

  const updateSignature = await readAuthenticodeSignature(updateFilePath)

  if (!signaturePathMatches(updateSignature, updateFilePath)) {
    return defaultFailure
  }

  const updateSigner = readSignerCertificate(updateSignature)
  const updateThumbprint = normalizeCertificateThumbprint(
    updateSigner?.Thumbprint
  )

  if (
    !updateThumbprint ||
    !publisherMatchesSigner(publisherNames, updateSigner)
  ) {
    return defaultFailure
  }

  if (Number(updateSignature?.Status) === 0) {
    console.warn(
      "Accepted Windows update signature after the default PowerShell verifier failed.",
      { path: updateFilePath, thumbprint: updateThumbprint }
    )
    return null
  }

  if (!signatureHasRecoverableChainError(updateSignature, defaultFailure)) {
    return defaultFailure
  }

  const trustedThumbprints = await collectCurrentWindowsSignerThumbprints()

  if (!trustedThumbprints.has(updateThumbprint)) {
    return defaultFailure
  }

  console.warn(
    "Accepted Windows update signature with matching signer thumbprint after Windows reported an incomplete certificate chain.",
    { path: updateFilePath, thumbprint: updateThumbprint }
  )

  return null
}

function configureWindowsUpdateSignatureVerification(updater) {
  if (
    process.platform !== "win32" ||
    updater.__astraflowSignatureVerifierConfigured
  ) {
    return
  }

  const defaultVerifier = updater.verifyUpdateCodeSignature

  if (typeof defaultVerifier !== "function") {
    return
  }

  updater.verifyUpdateCodeSignature = async (
    publisherNames,
    updateFilePath
  ) => {
    let defaultFailure

    try {
      defaultFailure = await defaultVerifier(publisherNames, updateFilePath)
    } catch (error) {
      defaultFailure = error instanceof Error ? error.message : String(error)
      console.warn(
        "Default Windows update signature verifier failed; retrying with the direct PowerShell verifier.",
        error
      )
    }

    if (defaultFailure == null) {
      return null
    }

    try {
      return await verifyWindowsUpdateSignatureFallback(
        publisherNames,
        updateFilePath,
        defaultFailure
      )
    } catch (error) {
      console.warn("Windows update signature fallback failed.", error)
      return defaultFailure
    }
  }
  updater.__astraflowSignatureVerifierConfigured = true
}

function normalizeUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error)

  if (WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN.test(message)) {
    return new Error(
      "Windows could not verify the AstraFlow installer certificate chain. Please install the latest Windows root certificates or use the release page installer for this version."
    )
  }

  return error instanceof Error ? error : new Error(message)
}

function broadcastUpdateStatus() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("astraflow:update-status-changed", updateStatus)
    }
  }
}

function setUpdateStatus(patch) {
  updateStatus = {
    ...updateStatus,
    ...patch,
  }
  broadcastUpdateStatus()
}

function settleUpdateDownloadWaiters(error, version = null) {
  for (const waiter of updateDownloadWaiters) {
    if (error) {
      waiter.reject(error)
    } else {
      waiter.resolve({ version })
    }
  }
  updateDownloadWaiters.clear()
}

function waitForUpdateDownload() {
  if (
    updateStatus.phase === "downloaded" ||
    updateStatus.phase === "installing"
  ) {
    return Promise.resolve({ version: updateStatus.version })
  }

  if (updateStatus.phase === "up-to-date") {
    return Promise.reject(new Error("AstraFlow is already up to date."))
  }

  if (updateStatus.phase === "error") {
    return Promise.reject(
      new Error(updateStatus.message || "Unable to download update.")
    )
  }

  return new Promise((resolveDownload, rejectDownload) => {
    updateDownloadWaiters.add({
      resolve: resolveDownload,
      reject: rejectDownload,
    })
  })
}

function beginUpdateDownload(updater, info) {
  if (updateDownloadPromise) {
    return
  }

  setUpdateStatus({
    phase: "downloading",
    version: info?.version ?? updateStatus.version,
    percent: 0,
    transferred: 0,
    total: null,
    bytesPerSecond: null,
    message: null,
  })
  updateDownloadPromise = updater
    .downloadUpdate()
    .catch((error) => {
      const normalizedError = normalizeUpdateError(error)
      setUpdateStatus({
        phase: "error",
        message: normalizedError.message,
      })
      settleUpdateDownloadWaiters(normalizedError)
    })
    .finally(() => {
      updateDownloadPromise = null
    })
}

function getAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater
  }

  try {
    autoUpdater = require("electron-updater").autoUpdater
  } catch (error) {
    console.error("Failed to load electron-updater.", error)
    throw new Error("Updater is unavailable.")
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  configureWindowsUpdateSignatureVerification(autoUpdater)

  autoUpdater.on("checking-for-update", () => {
    if (
      updateStatus.phase !== "downloading" &&
      updateStatus.phase !== "downloaded"
    ) {
      setUpdateStatus({
        phase: "checking",
        message: null,
        checkedAt: new Date().toISOString(),
      })
    }
  })
  autoUpdater.on("update-available", (info) => {
    setUpdateStatus({
      phase: "available",
      version: info?.version ?? null,
      message: null,
      checkedAt: new Date().toISOString(),
    })
    beginUpdateDownload(autoUpdater, info)
  })
  autoUpdater.on("update-not-available", (info) => {
    if (
      updateStatus.phase === "downloading" ||
      updateStatus.phase === "downloaded"
    ) {
      return
    }

    setUpdateStatus({
      phase: "up-to-date",
      version: info?.version ?? null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      message: null,
      checkedAt: new Date().toISOString(),
    })
    settleUpdateDownloadWaiters(new Error("AstraFlow is already up to date."))
  })
  autoUpdater.on("download-progress", (progress) => {
    setUpdateStatus({
      phase: "downloading",
      percent: Math.max(0, Math.min(100, progress?.percent ?? 0)),
      transferred: progress?.transferred ?? null,
      total: progress?.total ?? null,
      bytesPerSecond: progress?.bytesPerSecond ?? null,
      message: null,
    })
  })
  autoUpdater.on("update-downloaded", (info) => {
    const version = info?.version ?? updateStatus.version

    setUpdateStatus({
      phase: "downloaded",
      version,
      percent: 100,
      transferred: updateStatus.total,
      message: null,
    })
    settleUpdateDownloadWaiters(null, version)
  })
  autoUpdater.on("error", (error) => {
    const normalizedError = normalizeUpdateError(error)

    console.error("Auto update failed.", normalizedError)
    isUpdateQuitRequested = false
    setUpdateStatus({
      phase: "error",
      message: normalizedError.message,
    })
    settleUpdateDownloadWaiters(normalizedError)
  })

  return autoUpdater
}

async function checkForAppUpdates() {
  if (!app.isPackaged && process.env.ASTRAFLOW_FORCE_UPDATE !== "1") {
    throw new Error("Updates are only available in packaged apps.")
  }

  if (updateCheckPromise) {
    return updateCheckPromise
  }

  const updater = getAutoUpdater()
  updateCheckPromise = updater
    .checkForUpdates()
    .catch((error) => {
      const normalizedError = normalizeUpdateError(error)

      setUpdateStatus({
        phase: "error",
        message: normalizedError.message,
      })
      throw normalizedError
    })
    .finally(() => {
      updateCheckPromise = null
    })

  return updateCheckPromise
}

async function installUpdateNow() {
  if (
    updateStatus.phase !== "downloading" &&
    updateStatus.phase !== "downloaded" &&
    updateStatus.phase !== "installing"
  ) {
    await checkForAppUpdates()
  }

  const result = await waitForUpdateDownload()

  if (updateStatus.phase === "installing") {
    return result
  }

  try {
    // Electron's macOS updater closes windows before app emits `before-quit`.
    // Allow that close through even when background operation is enabled.
    isUpdateQuitRequested = true
    setUpdateStatus({ phase: "installing", percent: 100, message: null })
    getAutoUpdater().quitAndInstall(false, true)
  } catch (error) {
    const normalizedError = normalizeUpdateError(error)

    isUpdateQuitRequested = false
    setUpdateStatus({
      phase: "error",
      message: normalizedError.message,
    })
    throw normalizedError
  }

  return result
}

function setupAutomaticUpdates() {
  if (!app.isPackaged && process.env.ASTRAFLOW_FORCE_UPDATE !== "1") {
    return
  }

  try {
    getAutoUpdater()
  } catch (error) {
    console.error("Automatic updates are unavailable.", error)
    return
  }

  void checkForAppUpdates().catch((error) => {
    console.warn("Initial automatic update check failed.", error)
  })
  updateCheckTimer = setInterval(() => {
    if (
      updateStatus.phase === "downloading" ||
      updateStatus.phase === "downloaded" ||
      updateStatus.phase === "installing"
    ) {
      return
    }

    void checkForAppUpdates().catch((error) => {
      console.warn("Scheduled automatic update check failed.", error)
    })
  }, UPDATE_CHECK_INTERVAL_MS)
  updateCheckTimer.unref?.()
}

function setupAppIpc() {
  ipcMain.on("astraflow:home-path", (event) => {
    event.returnValue = app.getPath("home")
  })
  ipcMain.handle("astraflow:update-status", () => updateStatus)
  ipcMain.handle(
    "astraflow:local-full-access-grant",
    async (event, input) => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        !input ||
        typeof input !== "object" ||
        typeof input.sessionId !== "string" ||
        !input.sessionId.trim() ||
        input.sessionId.length > 256 ||
        !(
          input.workspaceId === null ||
          (typeof input.workspaceId === "string" &&
            input.workspaceId.length > 0 &&
            input.workspaceId.length <= 256)
        ) ||
        input.environment !== "local" ||
        input.policyVersion !== LOCAL_FULL_ACCESS_POLICY_VERSION
      ) {
        return { granted: false, token: null }
      }

      const secretKey = resolveStudioSecretKey()

      if (!secretKey) {
        return { granted: false, token: null }
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Cancel", "Enable Full Access"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: "Enable Full Access?",
        message:
          "Full Access lets this agent read, change, and run files anywhere your account can access.",
        detail:
          "Only enable it for a task you trust. The current run must be idle before the permission can change.",
      })

      if (result.response !== 1) {
        return { granted: false, token: null }
      }

      return {
        granted: true,
        token: createLocalFullAccessGrant(secretKey, {
          sessionId: input.sessionId.trim(),
          workspaceId: input.workspaceId,
        }),
      }
    }
  )
  ipcMain.handle("astraflow:check-for-updates", async () => {
    if (!app.isPackaged && process.env.ASTRAFLOW_FORCE_UPDATE !== "1") {
      return updateStatus
    }

    await checkForAppUpdates()
    return updateStatus
  })
  ipcMain.handle("astraflow:install-update", async () => installUpdateNow())
  ipcMain.handle("astraflow:agent-runtime-status", () =>
    getAgentRuntimeEnvironmentManager().getStatuses()
  )
  ipcMain.handle("astraflow:agent-runtime-install", async (_event, runtimeId) =>
    getAgentRuntimeEnvironmentManager().install(runtimeId)
  )
  ipcMain.handle("astraflow:developer-runtime-status", () =>
    getDeveloperRuntimeEnvironmentManager().getStatuses()
  )
  ipcMain.handle(
    "astraflow:developer-runtime-install",
    async (_event, runtimeId) =>
      getDeveloperRuntimeEnvironmentManager().install(runtimeId)
  )
  ipcMain.handle("astraflow:python-environment-status", async () =>
    getPythonEnvironmentManager().getStatus()
  )
  ipcMain.handle(
    "astraflow:python-environment-configure",
    async (_event, config) => {
      if (config?.mode === "managed") {
        await getDeveloperRuntimeEnvironmentManager().install("python")
      }

      return getPythonEnvironmentManager().configure(config)
    }
  )
  ipcMain.handle(
    "astraflow:python-environment-install",
    async (_event, options) => {
      const pythonEnvironment = await ensureManagedPythonRuntimeIfNeeded()
      return pythonEnvironment.install(
        options && typeof options === "object" ? options : {}
      )
    }
  )
  ipcMain.handle("astraflow:python-package-search", async (_event, query) => {
    const pythonEnvironment = await ensureManagedPythonRuntimeIfNeeded()
    return pythonEnvironment.searchPackage({ query })
  })
  ipcMain.handle(
    "astraflow:python-package-install",
    async (_event, request) => {
      const pythonEnvironment = await ensureManagedPythonRuntimeIfNeeded()
      return pythonEnvironment.installPackage(
        request && typeof request === "object" ? request : {}
      )
    }
  )
  ipcMain.handle("astraflow:python-environment-pick", async () => {
    const options = {
      properties: ["openFile"],
      title: "Choose a Python interpreter",
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle("astraflow:sandbox-runtime-status", async () => {
    if (process.platform !== "win32") {
      return {
        platform: process.platform,
        supported: true,
        ready: true,
        needsInstall: false,
      }
    }

    try {
      const sandboxRuntime = await import("@anthropic-ai/sandbox-runtime")
      const user = sandboxRuntime.getWindowsSandboxUserStatus()

      if (!user.provisioned || !user.credPresent) {
        return {
          platform: process.platform,
          supported: true,
          ready: false,
          needsInstall: true,
          message:
            "The dedicated Windows sandbox account and network fence have not been provisioned.",
        }
      }

      await sandboxRuntime.verifyWindowsWfpEgress()

      return {
        platform: process.platform,
        supported: true,
        ready: true,
        needsInstall: false,
      }
    } catch (error) {
      return {
        platform: process.platform,
        supported: true,
        ready: false,
        needsInstall: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.handle("astraflow:sandbox-runtime-install", async () => {
    if (process.platform !== "win32") {
      return {
        platform: process.platform,
        supported: true,
        ready: true,
        needsInstall: false,
      }
    }

    try {
      const sandboxRuntime = await import("@anthropic-ai/sandbox-runtime")
      const result = sandboxRuntime.installWindowsSandbox()

      if (result.cancelled) {
        return {
          platform: process.platform,
          supported: true,
          ready: false,
          needsInstall: true,
          cancelled: true,
          message: "Windows sandbox setup was cancelled.",
        }
      }

      await sandboxRuntime.verifyWindowsWfpEgress()

      return {
        platform: process.platform,
        supported: true,
        ready: true,
        needsInstall: false,
      }
    } catch (error) {
      return {
        platform: process.platform,
        supported: true,
        ready: false,
        needsInstall: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.handle("astraflow:onboarding-state:get", () =>
    readStudioOnboardingState()
  )
  ipcMain.handle("astraflow:onboarding-state:set", (_event, state) =>
    writeStudioOnboardingState(state)
  )
  ipcMain.handle("astraflow:automation-background-settings:get", () =>
    readAutomationBackgroundSettings()
  )
  ipcMain.handle(
    "astraflow:automation-background-settings:set",
    (_event, settings) => writeAutomationBackgroundSettings(settings)
  )
  ipcMain.handle("astraflow:notification-supported", () =>
    isDesktopNotificationSupported()
  )
  ipcMain.handle("astraflow:notification-show", (_event, input) =>
    showDesktopNotification(input)
  )
  ipcMain.handle("astraflow:notification-actions-pending", () =>
    Array.from(pendingDesktopNotificationActions.values())
  )
  ipcMain.handle(
    "astraflow:notification-action-acknowledge",
    (_event, notificationId) => {
      if (typeof notificationId !== "string") return false
      return pendingDesktopNotificationActions.delete(notificationId)
    }
  )
  ipcMain.handle("astraflow:tray-tasks:update", (_event, tasks) =>
    updateStudioTrayTasks(tasks)
  )
  ipcMain.handle("astraflow:appsnap-state", () => getAppSnapState())
  ipcMain.handle("astraflow:appsnap-set-enabled", (_event, enabled) =>
    setAppSnapEnabled(enabled)
  )
  ipcMain.handle("astraflow:appsnap-capture", () => captureAppSnapWindow())
  ipcMain.handle("astraflow:appsnap-pending", () =>
    Array.from(pendingAppSnapCaptures.values())
  )
  ipcMain.handle("astraflow:appsnap-acknowledge", (_event, captureId) => {
    if (typeof captureId !== "string") return false
    return pendingAppSnapCaptures.delete(captureId)
  })
  ipcMain.handle("astraflow:open-external", async (_event, url) =>
    openExternalUrl(url)
  )
  ipcMain.handle("astraflow:pick-folder", async () => {
    const options = { properties: ["openDirectory"] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled) {
      return null
    }

    return result.filePaths[0] ?? null
  })
  ipcMain.handle(
    "astraflow:local-workspace-list-directory",
    (_event, workspaceRoot, directory, options) =>
      listLocalWorkspaceDirectory(workspaceRoot, directory, {
        includeHidden: options?.includeHidden === true,
      })
  )
  ipcMain.handle(
    "astraflow:local-workspace-stat-path",
    (_event, workspaceRoot, filePath) =>
      statLocalWorkspacePath(workspaceRoot, filePath)
  )
  ipcMain.handle(
    "astraflow:local-workspace-find-file",
    (_event, workspaceRoot, referencePath) =>
      findLocalWorkspaceFileByReference(workspaceRoot, referencePath)
  )
  ipcMain.handle(
    "astraflow:local-workspace-read-text-file",
    (_event, workspaceRoot, filePath) =>
      readLocalWorkspaceTextFile(workspaceRoot, filePath)
  )
  ipcMain.handle(
    "astraflow:local-workspace-read-file-data-url",
    (_event, workspaceRoot, filePath, maxBytes) =>
      readLocalWorkspaceDataUrlFile(workspaceRoot, filePath, maxBytes)
  )
  ipcMain.handle(
    "astraflow:local-workspace-show-item",
    (_event, workspaceRoot, filePath) =>
      showLocalWorkspacePathInFolder(workspaceRoot, filePath)
  )
  ipcMain.handle(
    "astraflow:local-workspace-open-path",
    (_event, workspaceRoot, filePath) =>
      openLocalWorkspacePath(workspaceRoot, filePath)
  )
  ipcMain.handle("astraflow:local-open-path", (_event, filePath) =>
    openLocalPath(filePath)
  )
  ipcMain.handle("astraflow:browser-clear-data", async () =>
    clearSidePanelBrowserData()
  )
  ipcMain.handle("astraflow:local-terminal-create", (event, options) =>
    createTerminalSession(event, options)
  )
  ipcMain.handle("astraflow:local-terminal-write", (event, id, data) => {
    const terminalSession = getOwnedTerminalSession(event, id)

    if (!terminalSession || typeof data !== "string") {
      return false
    }

    terminalSession.terminal.write(data)
    return true
  })
  ipcMain.handle("astraflow:local-terminal-resize", (event, id, cols, rows) => {
    const terminalSession = getOwnedTerminalSession(event, id)
    const nextCols = Number(cols)
    const nextRows = Number(rows)

    if (
      !terminalSession ||
      !Number.isFinite(nextCols) ||
      !Number.isFinite(nextRows)
    ) {
      return false
    }

    terminalSession.terminal.resize(
      Math.max(20, Math.min(400, Math.round(nextCols))),
      Math.max(6, Math.min(160, Math.round(nextRows)))
    )
    return true
  })
  ipcMain.handle("astraflow:local-terminal-close", (event, id) =>
    closeTerminalSession(id, event.sender)
  )
}

function stopNextServer() {
  const child = nextProcess

  if (!child || !child.pid) {
    return
  }

  child.kill()

  setTimeout(() => {
    if (child.pid) {
      child.kill()
    }
  }, 5_000).unref()
}

function loadForSmoke(window, url) {
  return new Promise((resolveLoad, rejectLoad) => {
    const timeout = setTimeout(() => {
      rejectLoad(new Error("Smoke window did not finish loading in time."))
    }, SMOKE_TIMEOUT_MS)

    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout)
      resolveLoad()
    })

    window.webContents.once("did-fail-load", (_event, code, description) => {
      clearTimeout(timeout)
      rejectLoad(
        new Error(`Smoke window failed to load: ${code} ${description}`)
      )
    })

    void window.loadURL(url)
  })
}

async function verifyDesktopEnvironment(window) {
  let verificationTimeout
  const verification = window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const deadline = Date.now() + 2_000

      document.documentElement.removeAttribute("data-astraflow-desktop")
      document.documentElement.removeAttribute("data-astraflow-platform")

      function readMarkers() {
        const root = document.documentElement
        const markers = {
          desktop: root.dataset.astraflowDesktop,
          platform: root.dataset.astraflowPlatform,
          titlebarHeight: root.style.getPropertyValue(
            "--astraflow-titlebar-height"
          ),
          titlebarSafeLeft: root.style.getPropertyValue(
            "--astraflow-titlebar-safe-left"
          ),
        }

        if (
          (markers.desktop === "true" &&
            markers.platform &&
            Number.parseFloat(markers.titlebarHeight) > 0 &&
            Number.parseFloat(markers.titlebarSafeLeft) > 0) ||
          Date.now() >= deadline
        ) {
          resolve(markers)
          return
        }

        setTimeout(readMarkers, 16)
      }

      setTimeout(readMarkers, 0)
    })
  `)
  const timeout = new Promise((_, reject) => {
    verificationTimeout = setTimeout(() => {
      reject(new Error("Electron renderer marker verification timed out."))
    }, 5_000)
  })
  let markers

  try {
    markers = await Promise.race([verification, timeout])
  } finally {
    clearTimeout(verificationTimeout)
  }

  if (
    markers.desktop !== "true" ||
    markers.platform !== process.platform ||
    !(Number.parseFloat(markers.titlebarHeight) > 0) ||
    !(Number.parseFloat(markers.titlebarSafeLeft) > 0)
  ) {
    throw new Error(
      `Electron renderer markers were not restored: ${JSON.stringify(markers)}`
    )
  }
}

async function runSmoke(url) {
  const smokeUrl = new URL("/login", url).toString()
  const window = createMainWindow(smokeUrl, { show: false })
  await loadForSmoke(window, smokeUrl)
  await verifyDesktopEnvironment(window)
  app.exit(0)
}

async function bootstrap() {
  app.setAppUserModelId("cn.ucloud.astraflow.desktop")
  setupAppIpc()

  if (isScreenshotRun) {
    mainWindow = createMainWindow("about:blank", { show: false })
  }

  const url = await startNextServer()
  setupMobileChannelPowerRecovery()

  if (isSmokeRun) {
    await runSmoke(url)
    return
  }

  if (isScreenshotRun) {
    await mainWindow.loadURL(`about:blank#${encodeURIComponent(url)}`)
    return
  }

  setupAutomationDesktopFeatures()
  syncAppSnapShortcut()
  const startHidden =
    readAutomationBackgroundSettings().keepRunningInBackground &&
    (process.argv.includes("--hidden") ||
      app.getLoginItemSettings().wasOpenedAtLogin)
  mainWindow = createMainWindow(url, { show: !startHidden })
  setupAutomaticUpdates()
  void triggerMobileChannelRecovery("app-startup")
  const developerRuntimes = getDeveloperRuntimeEnvironmentManager()
  void developerRuntimes
    .ensureInstalled()
    .catch((error) => {
      console.warn("Automatic developer runtime installation failed.", error)
    })
    .then(() => {
      const pythonReady = developerRuntimes
        .getStatuses()
        .some((status) => status.runtimeId === "python" && status.ready)

      return pythonReady
        ? getPythonEnvironmentManager().ensureManagedEnvironment()
        : undefined
    })
    .catch((error) => {
      console.warn("Automatic Python environment setup failed.", error)
    })
}

function showFatalError(error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)

  if (!isSmokeRun && !isScreenshotRun && app.isReady()) {
    dialog.showErrorBox(APP_NAME, message)
  }

  app.exit(1)
}

app.on("second-instance", () => {
  showMainWindow()
})

app.on("before-quit", () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
  if (networkRecoveryTimer) {
    clearInterval(networkRecoveryTimer)
    networkRecoveryTimer = null
  }
  if (automationNotificationTimer) {
    clearInterval(automationNotificationTimer)
    automationNotificationTimer = null
  }
  if (automationTray && !automationTray.isDestroyed()) {
    automationTray.destroy()
    automationTray = null
  }
  pythonEnvironmentManager?.dispose()
  closeAllTerminalSessions()
  stopNextServer()
})

app.on("window-all-closed", () => {
  if (!readAutomationBackgroundSettings().keepRunningInBackground) {
    app.quit()
  }
})

app.on("activate", () => {
  if (!serverUrl || isQuitting) {
    return
  }

  showMainWindow()
})

if (gotSingleInstanceLock) {
  app.whenReady().then(bootstrap).catch(showFatalError)
}
