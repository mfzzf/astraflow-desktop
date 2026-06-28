import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"
import type { UCloudCredentials } from "@/lib/ucloud"

export async function getUCloudCredentials(): Promise<UCloudCredentials | null> {
  const tokens = await ensureValidStudioOAuthTokens()

  if (!tokens?.accessToken) {
    return null
  }

  return {
    mode: "oauth",
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType ?? "Bearer",
    projectId: "",
  }
}

export function getDefaultProjectId() {
  return ""
}
