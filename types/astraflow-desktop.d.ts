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

type AstraFlowTerminalCreateOptions = {
  cwd?: string | null
  cols?: number
  rows?: number
}

type AstraFlowTerminalCreateResult = {
  id: string
  cwd: string
}

type AstraFlowTerminalDataPayload = {
  id: string
  data: string
}

type AstraFlowTerminalExitPayload = {
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
  sidePanelListDirectory: (
    directory?: string | null
  ) => Promise<AstraFlowSidePanelDirectory>
  sidePanelStatPath: (
    path: string
  ) => Promise<AstraFlowSidePanelDirectoryEntry | null>
  sidePanelReadTextFile: (path: string) => Promise<AstraFlowSidePanelTextFile>
  sidePanelReadFileDataUrl: (
    path: string,
    maxBytes?: number
  ) => Promise<AstraFlowSidePanelDataUrlFile>
  sidePanelShowItem: (path: string) => Promise<boolean>
  sidePanelOpenPath: (path: string) => Promise<boolean>
  getSandboxWorkspacePath: (sessionId: string) => Promise<string | null>
  browserClearData: () => Promise<boolean>
  terminalCreate: (
    options?: AstraFlowTerminalCreateOptions
  ) => Promise<AstraFlowTerminalCreateResult>
  terminalWrite: (id: string, data: string) => Promise<boolean>
  terminalResize: (id: string, cols: number, rows: number) => Promise<boolean>
  terminalClose: (id: string) => Promise<boolean>
  onTerminalData: (
    callback: (payload: AstraFlowTerminalDataPayload) => void
  ) => () => void
  onTerminalExit: (
    callback: (payload: AstraFlowTerminalExitPayload) => void
  ) => () => void
  onCloseTabCommand: (callback: () => void) => () => void
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
