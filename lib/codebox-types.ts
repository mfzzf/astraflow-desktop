export type CodeBoxVolume = {
  volumeId: string
  name: string
  createdAt: string | null
  lastSeenAt: string | null
}

export type CodeBoxSandboxStatus = "running" | "paused" | "unknown"

export type CodeBoxSandbox = {
  sandboxId: string
  template: string
  status: CodeBoxSandboxStatus
  volumeId: string | null
  volumeName: string | null
  codeServerUrl: string | null
  codeServerHost: string | null
  codeServerPort: number
  password: string | null
  workspacePath: string
  repoUrl: string | null
  startedAt: string | null
  endAt: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export type CodeBoxGithubStatus = {
  configured: boolean
  login: string | null
  name: string | null
  email: string | null
  updatedAt: string | null
}

export type CodeBoxStatus = {
  template: string
  codeServerPort: number
  workspacePath: string
  modelverseApiKey: {
    configured: boolean
    name: string | null
    projectId: string | null
    updatedAt: string | null
  }
  github: CodeBoxGithubStatus
  installedCli: string[]
  installedExtensions: string[]
}
