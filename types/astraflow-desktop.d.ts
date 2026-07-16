type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowDesktopUpdateStatus = {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "waiting-for-idle"
    | "installing"
    | "up-to-date"
    | "error"
  version: string | null
  percent: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
  message: string | null
  checkedAt: string | null
}

type AstraFlowOnboardingState = "seen" | "done"

type AstraFlowAutomationBackgroundSettings = {
  keepRunningInBackground: boolean
  openAtLogin: boolean
  notificationsEnabled: boolean
}

type AstraFlowSandboxRuntimeStatus = {
  platform: string
  supported: boolean
  ready: boolean
  needsInstall: boolean
  cancelled?: boolean
  message?: string
}

type AstraFlowPythonEnvironmentMode = "managed" | "custom"

type AstraFlowPythonPackage = {
  name: string
  version: string
  required: boolean
  userInstalled: boolean
}

type AstraFlowPythonPackageSearchResult = {
  name: string
  versions: string[]
  latest: string
  installedVersion: string | null
  managedByAstraFlow: boolean
}

type AstraFlowPythonEnvironmentStatus = {
  mode: AstraFlowPythonEnvironmentMode
  customExecutable: string | null
  bootstrapExecutable: string
  executable: string | null
  pythonVersion: string | null
  pipVersion: string | null
  pipAvailable: boolean
  packages: AstraFlowPythonPackage[]
  ready: boolean
  needsInstall: boolean
  installing: boolean
  stage: string
  message: string | null
  error: string | null
}

type AstraFlowLocalTerminalCreateOptions = {
  workspaceRoot: string
  cwd?: string | null
  cols?: number
  rows?: number
}

type AstraFlowLocalTerminalCreateResult = {
  id: string
  cwd: string
}

type AstraFlowLocalTerminalDataPayload = {
  id: string
  data: string
}

type AstraFlowLocalTerminalExitPayload = {
  id: string
  exitCode: number
  signal?: number
}

type AstraFlowSidePanelDirectoryEntry = {
  name: string
  path: string
  kind: "directory" | "file"
  extension: string
  size: number | null
  modifiedAt: number
}

type AstraFlowSidePanelDirectory = {
  cwd: string
  name: string
  parent: string | null
  entries: AstraFlowSidePanelDirectoryEntry[]
}

type AstraFlowSidePanelTextFile = {
  path: string
  name: string
  directory: string
  size: number
  modifiedAt: number
  content: string
  truncated: boolean
}

type AstraFlowSidePanelDataUrlFile = {
  path: string
  name: string
  directory: string
  size: number
  modifiedAt: number
  mimeType: string
  dataUrl: string
}

type AstraFlowDesktopBridge = {
  platform: string
  homePath: string
  getUpdateStatus: () => Promise<AstraFlowDesktopUpdateStatus>
  checkForUpdates: () => Promise<AstraFlowDesktopUpdateStatus>
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
  onUpdateStatusChanged: (
    callback: (status: AstraFlowDesktopUpdateStatus) => void
  ) => () => void
  getPythonEnvironmentStatus: () => Promise<AstraFlowPythonEnvironmentStatus>
  configurePythonEnvironment: (config: {
    mode: AstraFlowPythonEnvironmentMode
    customExecutable?: string | null
  }) => Promise<AstraFlowPythonEnvironmentStatus>
  installPythonEnvironment: (options?: {
    force?: boolean
  }) => Promise<AstraFlowPythonEnvironmentStatus>
  searchPythonPackage: (
    query: string
  ) => Promise<AstraFlowPythonPackageSearchResult>
  installPythonPackage: (request: {
    name: string
    version?: string | null
  }) => Promise<AstraFlowPythonEnvironmentStatus>
  pickPythonInterpreter: () => Promise<string | null>
  getSandboxRuntimeStatus: () => Promise<AstraFlowSandboxRuntimeStatus>
  installSandboxRuntime: () => Promise<AstraFlowSandboxRuntimeStatus>
  getOnboardingState: () => Promise<AstraFlowOnboardingState | null>
  setOnboardingState: (state: AstraFlowOnboardingState) => Promise<boolean>
  getAutomationBackgroundSettings: () => Promise<AstraFlowAutomationBackgroundSettings>
  setAutomationBackgroundSettings: (
    settings: AstraFlowAutomationBackgroundSettings
  ) => Promise<AstraFlowAutomationBackgroundSettings>
  onAutomationBackgroundSettingsChanged: (
    callback: (settings: AstraFlowAutomationBackgroundSettings) => void
  ) => () => void
  openExternal: (url: string) => Promise<boolean>
  pickFolder: () => Promise<string | null>
  localWorkspaceListDirectory: (
    workspaceRoot: string,
    directory?: string | null
  ) => Promise<AstraFlowSidePanelDirectory>
  localWorkspaceStatPath: (
    workspaceRoot: string,
    path: string
  ) => Promise<AstraFlowSidePanelDirectoryEntry | null>
  localWorkspaceReadTextFile: (
    workspaceRoot: string,
    path: string
  ) => Promise<AstraFlowSidePanelTextFile>
  localWorkspaceReadFileDataUrl: (
    workspaceRoot: string,
    path: string,
    maxBytes?: number
  ) => Promise<AstraFlowSidePanelDataUrlFile>
  localWorkspaceShowItem: (
    workspaceRoot: string,
    path: string
  ) => Promise<boolean>
  localWorkspaceOpenPath: (
    workspaceRoot: string,
    path: string
  ) => Promise<boolean>
  localOpenPath: (path: string) => Promise<boolean>
  browserClearData: () => Promise<boolean>
  localTerminalCreate: (
    options: AstraFlowLocalTerminalCreateOptions
  ) => Promise<AstraFlowLocalTerminalCreateResult>
  localTerminalWrite: (id: string, data: string) => Promise<boolean>
  localTerminalResize: (
    id: string,
    cols: number,
    rows: number
  ) => Promise<boolean>
  localTerminalClose: (id: string) => Promise<boolean>
  onLocalTerminalData: (
    callback: (payload: AstraFlowLocalTerminalDataPayload) => void
  ) => () => void
  onLocalTerminalExit: (
    callback: (payload: AstraFlowLocalTerminalExitPayload) => void
  ) => () => void
  onCloseTabCommand: (callback: () => void) => () => void
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
