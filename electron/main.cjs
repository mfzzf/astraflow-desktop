/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  safeStorage,
  shell,
  session,
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
const { execFile, spawn } = require("node:child_process")
const { randomBytes } = require("node:crypto")
const { get, request: httpRequest } = require("node:http")
const { createServer } = require("node:net")
const {
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
} = require("node:path")
const pty = require("node-pty")
const { parseDn } = require("builder-util-runtime")
const {
  isPathInsideLocalWorkspace,
  resolveLocalWorkspacePath,
} = require("./local-workspace-paths.cjs")

const APP_NAME = "AstraFlow"
const LOOPBACK_HOST = "127.0.0.1"
const NATIVE_TITLEBAR_HEIGHT = 48
const SERVER_START_TIMEOUT_MS = 90_000
const SMOKE_TIMEOUT_MS = 30_000
const CODEBOX_GITHUB_OAUTH_CLIENT_ID = "Ov23li4imZRAMlx9enez"
const PENDING_UPDATE_INSTALLERS_FILE = "pending-update-installers.json"
const SECRET_KEY_FILE = "studio-secret.key"
const STUDIO_ONBOARDING_STATE_FILE = "studio-onboarding-v1.state"
const SIDE_PANEL_TEXT_FILE_LIMIT_BYTES = 2 * 1024 * 1024
const SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES = 50 * 1024 * 1024
const SIDE_PANEL_LEGACY_XLS_LIMIT_BYTES = 12 * 1024 * 1024
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
const WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN =
  /certificate chain|trusted root|0x800b010a|cert_e_chaining|证书链|受信任的根/i
const WINDOWS_SIGNATURE_RECOVERABLE_STATUSES = new Set([1, 4])
const WINDOWS_SIGNER_THUMBPRINTS_ENV = "ASTRAFLOW_WINDOWS_SIGNER_THUMBPRINTS"

const isSmokeRun = process.env.ASTRAFLOW_ELECTRON_SMOKE === "1"
const isDevRun = process.env.ASTRAFLOW_ELECTRON_DEV === "1"
let mainWindow = null
let nextProcess = null
let serverUrl = null
let mobileRecoveryToken = null
let lastMobileRecoveryAt = 0
let networkRecoveryTimer = null
let isQuitting = false
let lastServerOutput = ""
let autoUpdater = null
let updateInstallPromise = null
const terminalSessions = new Map()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

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

function getPendingUpdateInstallersPath() {
  return join(app.getPath("userData"), PENDING_UPDATE_INSTALLERS_FILE)
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

function cleanupPendingUpdateInstallers() {
  const markerPath = getPendingUpdateInstallersPath()

  if (!existsSync(markerPath)) {
    return
  }

  try {
    const installerPaths = JSON.parse(readFileSync(markerPath, "utf8"))

    if (Array.isArray(installerPaths)) {
      for (const installerPath of installerPaths) {
        if (typeof installerPath === "string" && installerPath.trim()) {
          rmSync(installerPath, { force: true })
        }
      }
    }
  } catch (error) {
    console.error("Failed to clean update installer.", error)
  } finally {
    rmSync(markerPath, { force: true })
  }
}

function rememberUpdateInstallers(installerPaths) {
  const normalizedPaths = (Array.isArray(installerPaths) ? installerPaths : [])
    .filter((installerPath) => typeof installerPath === "string")
    .map((installerPath) => installerPath.trim())
    .filter(Boolean)

  if (normalizedPaths.length === 0) {
    return
  }

  try {
    writeFileSync(
      getPendingUpdateInstallersPath(),
      JSON.stringify(normalizedPaths),
      "utf8"
    )
  } catch (error) {
    console.error("Failed to remember update installer.", error)
  }
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
    cwd: appRoot,
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
  const sandboxWorkspacesDir = join(userData, "sandbox-workspaces")
  const bundledRuntimeTarget = `${process.platform}-${process.arch}`
  const packagedPythonRoot = join(
    appRoot,
    "runtime",
    "python",
    bundledRuntimeTarget
  )
  const developmentPythonRoot = join(
    appRoot,
    "runtime",
    "python",
    "distributions",
    bundledRuntimeTarget
  )
  const bundledPythonRoot = existsSync(packagedPythonRoot)
    ? packagedPythonRoot
    : developmentPythonRoot
  const bundledPythonExecutable =
    process.platform === "win32"
      ? join(bundledPythonRoot, "python.exe")
      : join(bundledPythonRoot, "bin", "python3")
  const bundledSandboxBin = join(
    appRoot,
    "runtime",
    "sandbox",
    bundledRuntimeTarget,
    "bin"
  )

  if (!existsSync(bundledPythonExecutable)) {
    throw new Error(
      `Bundled Python is unavailable at ${bundledPythonExecutable}. Run bun run runtime:python before starting AstraFlow.`
    )
  }

  mkdirSync(dataDir, { recursive: true })
  mkdirSync(filesDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(sandboxWorkspacesDir, { recursive: true })

  const secretKey = resolveStudioSecretKey()
  mobileRecoveryToken = randomBytes(32).toString("hex")

  const env = {
    ...process.env,
    ASTRAFLOW_ELECTRON: "1",
    ASTRAFLOW_ELECTRON_DEV: isDevRun ? "1" : undefined,
    ASTRAFLOW_SQLITE_PATH: join(dataDir, "astraflow.sqlite"),
    ASTRAFLOW_STUDIO_FILES_PATH: filesDir,
    ASTRAFLOW_STUDIO_SKILLS_PATH: skillsDir,
    ASTRAFLOW_BUNDLED_SKILLS_PATH: join(appRoot, "bundled-skills"),
    ASTRAFLOW_BUNDLED_NODE_MODULES: join(appRoot, "node_modules"),
    ASTRAFLOW_NODE_EXECUTABLE: process.execPath,
    ASTRAFLOW_SANDBOX_WORKSPACES_PATH: sandboxWorkspacesDir,
    ASTRAFLOW_BUNDLED_PYTHON_ROOT: bundledPythonRoot,
    ASTRAFLOW_SANDBOX_BIN_PATH: existsSync(bundledSandboxBin)
      ? bundledSandboxBin
      : undefined,
    ASTRAFLOW_INTERNAL_RECOVERY_TOKEN: mobileRecoveryToken,
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
    const target = new URL(
      "/api/internal/mobile-channels/recover",
      serverUrl
    )
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

    if ((input.meta || input.control) && key === "w") {
      event.preventDefault()
      window.webContents.send("astraflow:close-active-tab")
    }
  })
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
          transparent: true,
          backgroundColor: "#00000000",
          vibrancy: "sidebar",
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
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  })

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

function listLocalWorkspaceDirectory(workspaceRoot, directory) {
  const { resolvedRoot, resolvedPath: cwd } = resolveLocalWorkspacePath(
    workspaceRoot,
    directory || workspaceRoot,
    { kind: "directory" }
  )
  const parentPath = dirname(cwd)
  const entries = readdirSync(cwd, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith(".") ||
        SIDE_PANEL_VISIBLE_DOTFILES.has(entry.name.toLowerCase()) ||
        SIDE_PANEL_VISIBLE_DOTFILE_PREFIXES.some((prefix) =>
          entry.name.toLowerCase().startsWith(prefix)
        )
    )
    .map((entry) =>
      mapLocalWorkspaceDirectoryEntry(resolvedRoot, cwd, entry)
    )
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
      cwd !== resolvedRoot && isPathInsideLocalWorkspace(resolvedRoot, parentPath)
        ? parentPath
        : null,
    entries,
  }
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

async function clearSidePanelBrowserData() {
  await session.defaultSession.clearStorageData()
  await session.defaultSession.clearCache()
  return true
}

function preparePowerShellExec(command, timeout = 20_000) {
  return [
    'set "PSModulePath=" & chcp 65001 >NUL & powershell.exe',
    [
      "-NoProfile",
      "-NonInteractive",
      "-InputFormat",
      "None",
      "-Command",
      command,
    ],
    { shell: true, timeout, maxBuffer: 1024 * 1024 * 4 },
  ]
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''")
}

function readAuthenticodeSignature(filePath) {
  const escapedPath = escapePowerShellSingleQuoted(filePath)
  const command = `Get-AuthenticodeSignature -LiteralPath '${escapedPath}' | ConvertTo-Json -Depth 6 -Compress`

  return new Promise((resolveSignature, rejectSignature) => {
    execFile(...preparePowerShellExec(command), (error, stdout, stderr) => {
      if (error) {
        rejectSignature(error)
        return
      }

      if (stderr) {
        rejectSignature(
          new Error(`Cannot inspect Authenticode signature: ${stderr}`)
        )
        return
      }

      try {
        const trimmed = stdout.trim()

        if (!trimmed) {
          throw new Error("Empty Authenticode signature output.")
        }

        resolveSignature(JSON.parse(trimmed))
      } catch (parseError) {
        rejectSignature(parseError)
      }
    })
  })
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

  if (
    !signatureHasRecoverableChainError(updateSignature, defaultFailure) ||
    !signaturePathMatches(updateSignature, updateFilePath)
  ) {
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
    const defaultFailure = await defaultVerifier(publisherNames, updateFilePath)

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

  autoUpdater.on("error", (error) => {
    console.error("Auto update failed.", error)
  })

  return autoUpdater
}

function installUpdateNow() {
  if (!app.isPackaged && process.env.ASTRAFLOW_FORCE_UPDATE !== "1") {
    throw new Error("Update installation is only available in packaged apps.")
  }

  if (updateInstallPromise) {
    return updateInstallPromise
  }

  updateInstallPromise = new Promise((resolveInstall, rejectInstall) => {
    const updater = getAutoUpdater()
    let settled = false

    function cleanup() {
      updater.off("update-available", onUpdateAvailable)
      updater.off("update-not-available", onUpdateNotAvailable)
      updater.off("update-downloaded", onUpdateDownloaded)
      updater.off("error", onError)
    }

    function settle(error, value) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      updateInstallPromise = null

      if (error) {
        rejectInstall(error)
      } else {
        resolveInstall(value)
      }
    }

    function onError(error) {
      settle(normalizeUpdateError(error))
    }

    function onUpdateNotAvailable() {
      settle(new Error("AstraFlow is already up to date."))
    }

    function onUpdateAvailable() {
      updater.downloadUpdate().then(rememberUpdateInstallers).catch(onError)
    }

    function onUpdateDownloaded(info) {
      const version = info?.version ?? null

      settle(null, { version })
      setTimeout(() => {
        updater.quitAndInstall(false, true)
      }, 250)
    }

    updater.once("update-available", onUpdateAvailable)
    updater.once("update-not-available", onUpdateNotAvailable)
    updater.once("update-downloaded", onUpdateDownloaded)
    updater.once("error", onError)

    updater.checkForUpdates().catch(onError)
  })

  return updateInstallPromise
}

function setupAppIpc() {
  ipcMain.on("astraflow:home-path", (event) => {
    event.returnValue = app.getPath("home")
  })
  ipcMain.handle("astraflow:install-update", async () => installUpdateNow())
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
    (_event, workspaceRoot, directory) =>
      listLocalWorkspaceDirectory(workspaceRoot, directory)
  )
  ipcMain.handle(
    "astraflow:local-workspace-stat-path",
    (_event, workspaceRoot, filePath) =>
      statLocalWorkspacePath(workspaceRoot, filePath)
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
  ipcMain.handle(
    "astraflow:local-terminal-resize",
    (event, id, cols, rows) => {
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
    }
  )
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
  const window = createMainWindow(url, { show: false })
  await loadForSmoke(window, url)
  await verifyDesktopEnvironment(window)
  app.exit(0)
}

async function bootstrap() {
  app.setAppUserModelId("cn.ucloud.astraflow.desktop")
  cleanupPendingUpdateInstallers()
  setupAppIpc()

  const url = await startNextServer()
  setupMobileChannelPowerRecovery()

  if (isSmokeRun) {
    await runSmoke(url)
    return
  }

  mainWindow = createMainWindow(url)
  void triggerMobileChannelRecovery("app-startup")
}

function showFatalError(error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)

  if (!isSmokeRun && app.isReady()) {
    dialog.showErrorBox(APP_NAME, message)
  }

  app.exit(1)
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
})

app.on("before-quit", () => {
  isQuitting = true
  if (networkRecoveryTimer) {
    clearInterval(networkRecoveryTimer)
    networkRecoveryTimer = null
  }
  closeAllTerminalSessions()
  stopNextServer()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (mainWindow || !serverUrl || isQuitting) {
    return
  }

  mainWindow = createMainWindow(serverUrl)
})

if (gotSingleInstanceLock) {
  app.whenReady().then(bootstrap).catch(showFatalError)
}
