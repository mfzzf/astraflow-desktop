/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron")

const platform = process.platform
let fullScreenState = null

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

ipcRenderer.on("astraflow:fullscreen-changed", (_event, isFullScreen) => {
  fullScreenState = Boolean(isFullScreen)
  markDesktopEnvironment()
})

contextBridge.exposeInMainWorld("astraflowDesktop", {
  platform,
  installUpdate: () => ipcRenderer.invoke("astraflow:install-update"),
  getOnboardingState: () =>
    ipcRenderer.invoke("astraflow:onboarding-state:get"),
  setOnboardingState: (state) =>
    ipcRenderer.invoke("astraflow:onboarding-state:set", state),
  openExternal: (url) => ipcRenderer.invoke("astraflow:open-external", url),
  pickFolder: () => ipcRenderer.invoke("astraflow:pick-folder"),
  sidePanelListDirectory: (directory) =>
    ipcRenderer.invoke("astraflow:side-panel-list-directory", directory),
  sidePanelReadTextFile: (filePath) =>
    ipcRenderer.invoke("astraflow:side-panel-read-text-file", filePath),
  sidePanelReadFileDataUrl: (filePath) =>
    ipcRenderer.invoke("astraflow:side-panel-read-file-data-url", filePath),
  sidePanelShowItem: (path) =>
    ipcRenderer.invoke("astraflow:side-panel-show-item", path),
  sidePanelOpenPath: (path) =>
    ipcRenderer.invoke("astraflow:side-panel-open-path", path),
  browserClearData: () => ipcRenderer.invoke("astraflow:browser-clear-data"),
  terminalCreate: (options) =>
    ipcRenderer.invoke("astraflow:terminal-create", options),
  terminalWrite: (id, data) =>
    ipcRenderer.invoke("astraflow:terminal-write", id, data),
  terminalResize: (id, cols, rows) =>
    ipcRenderer.invoke("astraflow:terminal-resize", id, cols, rows),
  terminalClose: (id) => ipcRenderer.invoke("astraflow:terminal-close", id),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:terminal-data", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:terminal-data", listener)
    }
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:terminal-exit", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:terminal-exit", listener)
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
