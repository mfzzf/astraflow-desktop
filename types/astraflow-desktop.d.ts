type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowDesktopBridge = {
  platform: string
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
  openExternal: (url: string) => Promise<boolean>
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
