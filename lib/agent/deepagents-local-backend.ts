import {
  LocalShellBackend,
  type EditResult,
  type ExecuteResponse,
  type FileUploadResponse,
  type WriteResult,
} from "deepagents"

import { ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS } from "@/lib/astraflow-sandbox-runtime"
import {
  requestToolPermission,
  type PermissionGatewayContext,
} from "@/lib/agent/permission-gateway"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type DeepAgentsLocalBackendOptions = {
  rootDir: string
  sessionId: string
  permissionContext: PermissionGatewayContext
}

// Runs Deep Agent filesystem/shell tools directly on the user's machine,
// rooted at the bound local project. Mutating operations and shell commands
// go through the same permission gateway as the remote sandbox backend.
export class DeepAgentsLocalBackend extends LocalShellBackend {
  private readonly permissionContext: PermissionGatewayContext
  private readonly sessionId: string
  private initializePromise: Promise<void> | null = null

  constructor({
    permissionContext,
    rootDir,
    sessionId,
  }: DeepAgentsLocalBackendOptions) {
    super({
      rootDir,
      inheritEnv: true,
      timeout: ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    })
    this.permissionContext = permissionContext
    this.sessionId = sessionId
  }

  private ensureReady() {
    if (this.isInitialized) {
      return Promise.resolve()
    }

    this.initializePromise ??= this.initialize().catch((error) => {
      this.initializePromise = null
      throw error
    })

    return this.initializePromise
  }

  private async getPermissionDenial(toolName: string, input: unknown) {
    const permission = await requestToolPermission({
      context: this.permissionContext,
      input,
      toolName,
    })

    return permission.allowed ? null : permission.message
  }

  override async execute(command: string): Promise<ExecuteResponse> {
    const denial = await this.getPermissionDenial("execute", { command })

    if (denial) {
      return {
        output: denial,
        exitCode: 1,
        truncated: false,
      }
    }

    return withStudioSessionLock(this.sessionId, async () => {
      await this.ensureReady()

      return super.execute(command)
    })
  }

  override async write(
    filePath: string,
    content: string
  ): Promise<WriteResult> {
    const denial = await this.getPermissionDenial("write_file", {
      path: filePath,
      content,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.write(filePath, content)
    )
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    const denial = await this.getPermissionDenial("edit_file", {
      path: filePath,
      oldString,
      newString,
      replaceAll,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.edit(filePath, oldString, newString, replaceAll)
    )
  }

  override async uploadFiles(
    files: Array<[string, Uint8Array]>
  ): Promise<FileUploadResponse[]> {
    const denial = await this.getPermissionDenial(
      "upload_file",
      files.map(([path, content]) => ({
        path,
        bytes: content.byteLength,
      }))
    )

    if (denial) {
      return files.map(([path]) => ({ path, error: "permission_denied" }))
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.uploadFiles(files)
    )
  }
}
