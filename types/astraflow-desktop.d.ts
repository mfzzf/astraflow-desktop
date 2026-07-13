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
  browserClearData: () => Promise<boolean>
  onCloseTabCommand: (callback: () => void) => () => void
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
