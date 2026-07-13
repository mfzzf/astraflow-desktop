import type {
  CodeBoxDirectoryList,
  CodeBoxGithubStatus,
  CodeBoxLocalDependencyStatus,
  CodeBoxSandbox,
  CodeBoxSshAccess,
  CodeBoxStatus,
} from "@/lib/codebox-types"

export type SandboxFilter = "all" | "running" | "paused"

export type ApiEnvelope<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

export type GithubDeviceFlow = {
  flowId: string
  userCode: string
  verificationUri: string
  expiresAt: string
  interval: number
}

export type GithubPollResult =
  | {
      status: "pending"
      interval?: number
    }
  | {
      status: "expired" | "error"
      message?: string
    }
  | {
      status: "complete"
      github: CodeBoxGithubStatus
    }

export type ModelverseApiKeyOption = {
  id: string
  name: string
}

export type ModelverseApiKeysResponse = {
  projectId: string
  items: ModelverseApiKeyOption[]
  selected: ModelverseApiKeyOption | null
}

export type SaveModelverseApiKeyResponse = {
  projectId: string
  selected: ModelverseApiKeyOption
}

export type CodeBoxTerminalSession = {
  terminalId: string
  sandboxId: string
  pid: number
  cwd: string
  cols: number
  rows: number
  websocketUrl: string
  ticketExpiresAt: string
}

export type ConfirmAction =
  | {
      kind: "sandbox"
      sandbox: CodeBoxSandbox
    }

export type WebsocatInstallOption = {
  key: string
  label: string
  value: string
  note: string
}

export type WebsocatInstallTabKey =
  | "linux"
  | "darwin"
  | "freebsd"
  | "source"
  | "prebuilt"

export type WebsocatInstallGroup = {
  key: WebsocatInstallTabKey
  label: string
  options: WebsocatInstallOption[]
}

export const DEFAULT_CODEBOX_WORKSPACE_PATH = "/workspace"

export type {
  CodeBoxDirectoryList,
  CodeBoxGithubStatus,
  CodeBoxLocalDependencyStatus,
  CodeBoxSandbox,
  CodeBoxSshAccess,
  CodeBoxStatus,
}
