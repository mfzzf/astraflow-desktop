type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowDesktopBridge = {
  platform: string
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
  openExternal: (url: string) => Promise<boolean>
  pickFolder: () => Promise<string | null>
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
