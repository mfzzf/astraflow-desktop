import type { StructuredToolInterface } from "@langchain/core/tools"

import { getStudioModelverseApiKey } from "@/lib/studio-db"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import { createListInstalledMcpServersTool } from "@/lib/ai/tools/mcp"
import {
  createGetStudioMediaModelSchemaTool,
  createGetStudioMediaGenerationTool,
  createListStudioMediaGenerationModelsTool,
  createListStudioMediaGenerationsTool,
  createStudioGenerateImageTool,
  createStudioGenerateVideoTool,
} from "@/lib/ai/tools/media-generation"
import {
  createCodeInterpreterTool,
  createDownloadFileTool,
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
  createSandboxGetHostTool,
  createSandboxStartServiceTool,
  createSessionSandboxGetter,
  createUploadFileTool,
  createWriteFileTool,
} from "@/lib/ai/tools/astraflow-sandbox"

type StudioAgentToolsOptions = {
  sessionId?: string
  workspaceId?: string
  workspaceRoot?: string
  modelverseApiKey?: string | null
}

export function createStudioAgentTools(options: StudioAgentToolsOptions = {}) {
  const exaApiKey = getStoredExaApiKey()
  const modelverseApiKey =
    options.modelverseApiKey ?? getStudioModelverseApiKey()?.key
  const tools: StructuredToolInterface[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
  ]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (
    modelverseApiKey &&
    options.sessionId &&
    options.workspaceId &&
    options.workspaceRoot
  ) {
    const workspaceRoot = options.workspaceRoot
    const getSandboxContext = createSessionSandboxGetter({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
      workspaceId: options.workspaceId,
      workspaceRoot,
    })

    tools.push(
      createListStudioMediaGenerationModelsTool(),
      createGetStudioMediaModelSchemaTool(),
      createListStudioMediaGenerationsTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createGetStudioMediaGenerationTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateImageTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateVideoTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createUploadFileTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
        workspaceId: options.workspaceId,
        workspaceRoot,
      }),
      createCodeInterpreterTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createRunCommandTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createSandboxGetHostTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createSandboxStartServiceTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createListFilesTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createReadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createWriteFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      }),
      createDownloadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
        workspaceRoot,
      })
    )
  }

  return tools
}
