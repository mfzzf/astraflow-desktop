import { NextResponse } from "next/server"

import {
  ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
  CODEBOX_CODE_SERVER_EXTENSIONS,
  CODEBOX_CODE_SERVER_PORT,
  CODEBOX_INSTALLED_CLI,
  CODEBOX_WORKSPACE_GATEWAY_PORT,
  CODEBOX_WORKSPACE_GATEWAY_PROTOCOL_VERSION,
  CODEBOX_WORKSPACE_PATH,
} from "@/lib/codebox-runtime"
import {
  getCodeBoxGithubStatus,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET() {
  const apiKey = getStudioModelverseApiKey()

  return NextResponse.json({
    ok: true,
    data: {
      template: ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
      codeServerPort: CODEBOX_CODE_SERVER_PORT,
      workspaceGatewayPort: CODEBOX_WORKSPACE_GATEWAY_PORT,
      workspaceGatewayProtocolVersion:
        CODEBOX_WORKSPACE_GATEWAY_PROTOCOL_VERSION,
      workspacePath: CODEBOX_WORKSPACE_PATH,
      modelverseApiKey: {
        configured: Boolean(apiKey?.key),
        id: apiKey?.id ?? null,
        name: apiKey?.name ?? null,
        projectId: apiKey?.projectId ?? null,
        updatedAt: apiKey?.updatedAt ?? null,
      },
      github: getCodeBoxGithubStatus(),
      installedCli: [...CODEBOX_INSTALLED_CLI],
      installedExtensions: [...CODEBOX_CODE_SERVER_EXTENSIONS],
    },
  })
}
