type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowOnboardingState = "seen" | "done"

type AstraFlowSandboxRuntimeStatus = {
  platform: string
  supported: boolean
  ready: boolean
  needsInstall: boolean
  cancelled?: boolean
  message?: string
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
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
  getSandboxRuntimeStatus: () => Promise<AstraFlowSandboxRuntimeStatus>
  installSandboxRuntime: () => Promise<AstraFlowSandboxRuntimeStatus>
  getOnboardingState: () => Promise<AstraFlowOnboardingState | null>
  setOnboardingState: (state: AstraFlowOnboardingState) => Promise<boolean>
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
