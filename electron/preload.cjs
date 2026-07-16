/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer, webFrame } = require("electron")

const platform = process.platform
const homePath = ipcRenderer.sendSync("astraflow:home-path")
// Keep these native DIP metrics in sync with electron/main.cjs and the macOS
// traffic-light safe-area fallback in app/globals.css.
const NATIVE_TITLEBAR_HEIGHT = 48
const MAC_TRAFFIC_LIGHT_SAFE_LEFT = 68
let fullScreenState = null
let titlebarMetricsAnimationFrame = null
let lastNativeTitlebarHeight = NATIVE_TITLEBAR_HEIGHT
let lastNativeSafeLeft = MAC_TRAFFIC_LIGHT_SAFE_LEFT

function readZoomFactor() {
  try {
    const zoomFactor = webFrame.getZoomFactor()

    return Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  } catch {
    return 1
  }
}

function readWindowControlsOverlayRect() {
  if (platform !== "darwin" || fullScreenState === true) {
    return null
  }

  try {
    const overlay = navigator.windowControlsOverlay
    const rect = overlay?.getTitlebarAreaRect()

    return rect && rect.height > 0 ? rect : null
  } catch {
    return null
  }
}

function toCssPixels(value) {
  return `${Number(value.toFixed(4))}px`
}

function syncTitlebarMetrics(root = document.documentElement) {
  if (!root) {
    return
  }

  const zoomFactor = readZoomFactor()
  const overlayRect = readWindowControlsOverlayRect()

  if (overlayRect) {
    lastNativeTitlebarHeight = overlayRect.height * zoomFactor
    lastNativeSafeLeft = Math.max(
      overlayRect.x * zoomFactor,
      MAC_TRAFFIC_LIGHT_SAFE_LEFT
    )
  }

  const titlebarHeight = lastNativeTitlebarHeight / zoomFactor
  const safeLeft = lastNativeSafeLeft / zoomFactor
  const titlebarHeightValue = toCssPixels(titlebarHeight)
  const safeLeftValue = toCssPixels(safeLeft)

  if (
    root.style.getPropertyValue("--astraflow-titlebar-height") !==
    titlebarHeightValue
  ) {
    root.style.setProperty("--astraflow-titlebar-height", titlebarHeightValue)
  }

  if (
    root.style.getPropertyValue("--astraflow-titlebar-safe-left") !==
    safeLeftValue
  ) {
    root.style.setProperty("--astraflow-titlebar-safe-left", safeLeftValue)
  }
}

function scheduleTitlebarMetricsSync() {
  if (titlebarMetricsAnimationFrame !== null) {
    cancelAnimationFrame(titlebarMetricsAnimationFrame)
  }

  titlebarMetricsAnimationFrame = requestAnimationFrame(() => {
    titlebarMetricsAnimationFrame = null
    syncTitlebarMetrics()
  })
}

function markDesktopEnvironment() {
  const root = document.documentElement

  if (!root) {
    return
  }

  if (root.dataset.astraflowDesktop !== "true") {
    root.dataset.astraflowDesktop = "true"
  }

  if (root.dataset.astraflowPlatform !== platform) {
    root.dataset.astraflowPlatform = platform
  }

  if (fullScreenState !== null) {
    const fullScreenValue = fullScreenState ? "true" : "false"

    if (root.dataset.astraflowFullscreen !== fullScreenValue) {
      root.dataset.astraflowFullscreen = fullScreenValue
    }
  }

  syncTitlebarMetrics(root)
}

// Renderer recovery can reconcile attributes on <html> back to the server
// markup. Keep the native-shell markers authoritative for the whole document
// lifetime so the renderer never falls back to the browser titlebar layout.
let observedRoot = null

function observeDesktopRoot() {
  const root = document.documentElement

  if (!root || root === observedRoot) {
    return
  }

  observedRoot = root
  desktopEnvironmentObserver.observe(root, {
    attributeFilter: [
      "data-astraflow-desktop",
      "data-astraflow-fullscreen",
      "data-astraflow-platform",
      "style",
    ],
    attributes: true,
  })
}

const desktopEnvironmentObserver = new MutationObserver(() => {
  observeDesktopRoot()
  markDesktopEnvironment()
})

// Observe only replacement/creation of the document root, not every React DOM
// mutation inside the application.
desktopEnvironmentObserver.observe(document, {
  childList: true,
})

observeDesktopRoot()
markDesktopEnvironment()
window.addEventListener("DOMContentLoaded", markDesktopEnvironment, {
  once: true,
})
window.addEventListener("resize", scheduleTitlebarMetricsSync)
window.visualViewport?.addEventListener("resize", scheduleTitlebarMetricsSync)
navigator.windowControlsOverlay?.addEventListener(
  "geometrychange",
  scheduleTitlebarMetricsSync
)

ipcRenderer.on("astraflow:fullscreen-changed", (_event, isFullScreen) => {
  fullScreenState = Boolean(isFullScreen)
  markDesktopEnvironment()
})

contextBridge.exposeInMainWorld("astraflowDesktop", {
  platform,
  homePath: typeof homePath === "string" ? homePath : "",
  getUpdateStatus: () => ipcRenderer.invoke("astraflow:update-status"),
  checkForUpdates: () => ipcRenderer.invoke("astraflow:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("astraflow:install-update"),
  onUpdateStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status)

    ipcRenderer.on("astraflow:update-status-changed", listener)
    return () => {
      ipcRenderer.removeListener("astraflow:update-status-changed", listener)
    }
  },
  getPythonEnvironmentStatus: () =>
    ipcRenderer.invoke("astraflow:python-environment-status"),
  configurePythonEnvironment: (config) =>
    ipcRenderer.invoke("astraflow:python-environment-configure", config),
  installPythonEnvironment: (options) =>
    ipcRenderer.invoke("astraflow:python-environment-install", options),
  searchPythonPackage: (query) =>
    ipcRenderer.invoke("astraflow:python-package-search", query),
  installPythonPackage: (request) =>
    ipcRenderer.invoke("astraflow:python-package-install", request),
  pickPythonInterpreter: () =>
    ipcRenderer.invoke("astraflow:python-environment-pick"),
  getSandboxRuntimeStatus: () =>
    ipcRenderer.invoke("astraflow:sandbox-runtime-status"),
  installSandboxRuntime: () =>
    ipcRenderer.invoke("astraflow:sandbox-runtime-install"),
  getOnboardingState: () =>
    ipcRenderer.invoke("astraflow:onboarding-state:get"),
  setOnboardingState: (state) =>
    ipcRenderer.invoke("astraflow:onboarding-state:set", state),
  getAutomationBackgroundSettings: () =>
    ipcRenderer.invoke("astraflow:automation-background-settings:get"),
  setAutomationBackgroundSettings: (settings) =>
    ipcRenderer.invoke(
      "astraflow:automation-background-settings:set",
      settings
    ),
  onAutomationBackgroundSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings)

    ipcRenderer.on("astraflow:automation-background-settings-changed", listener)

    return () => {
      ipcRenderer.removeListener(
        "astraflow:automation-background-settings-changed",
        listener
      )
    }
  },
  openExternal: (url) => ipcRenderer.invoke("astraflow:open-external", url),
  pickFolder: () => ipcRenderer.invoke("astraflow:pick-folder"),
  localWorkspaceListDirectory: (workspaceRoot, directory) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-list-directory",
      workspaceRoot,
      directory
    ),
  localWorkspaceStatPath: (workspaceRoot, filePath) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-stat-path",
      workspaceRoot,
      filePath
    ),
  localWorkspaceReadTextFile: (workspaceRoot, filePath) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-read-text-file",
      workspaceRoot,
      filePath
    ),
  localWorkspaceReadFileDataUrl: (workspaceRoot, filePath, maxBytes) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-read-file-data-url",
      workspaceRoot,
      filePath,
      maxBytes
    ),
  localWorkspaceShowItem: (workspaceRoot, filePath) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-show-item",
      workspaceRoot,
      filePath
    ),
  localWorkspaceOpenPath: (workspaceRoot, filePath) =>
    ipcRenderer.invoke(
      "astraflow:local-workspace-open-path",
      workspaceRoot,
      filePath
    ),
  localOpenPath: (filePath) =>
    ipcRenderer.invoke("astraflow:local-open-path", filePath),
  browserClearData: () => ipcRenderer.invoke("astraflow:browser-clear-data"),
  localTerminalCreate: (options) =>
    ipcRenderer.invoke("astraflow:local-terminal-create", options),
  localTerminalWrite: (id, data) =>
    ipcRenderer.invoke("astraflow:local-terminal-write", id, data),
  localTerminalResize: (id, cols, rows) =>
    ipcRenderer.invoke("astraflow:local-terminal-resize", id, cols, rows),
  localTerminalClose: (id) =>
    ipcRenderer.invoke("astraflow:local-terminal-close", id),
  onLocalTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:local-terminal-data", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:local-terminal-data", listener)
    }
  },
  onLocalTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:local-terminal-exit", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:local-terminal-exit", listener)
    }
  },
  onCloseTabCommand: (callback) => {
    const listener = () => callback()

    ipcRenderer.on("astraflow:close-active-tab", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:close-active-tab", listener)
    }
  },
})
