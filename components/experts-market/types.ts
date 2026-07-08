import type { components } from "@/lib/generated/openapi/astraflow-api"

export type ExpertCategory =
  components["schemas"]["astraflow.v1.ExpertCategory"]
export type ExpertListItem =
  components["schemas"]["astraflow.v1.ExpertListItem"]
export type ExpertDetail =
  components["schemas"]["astraflow.v1.ExpertDetail"]
export type ExpertAgent = components["schemas"]["astraflow.v1.ExpertAgent"]
export type ExpertSkill = components["schemas"]["astraflow.v1.ExpertSkill"]
export type ExpertTeamMember =
  components["schemas"]["astraflow.v1.ExpertTeamMember"]
export type ExpertRuntime =
  components["schemas"]["astraflow.v1.ExpertRuntime"]

export type ExpertTypeFilter = "all" | "agent" | "team"
export type ExpertOrderBy = "recent" | "name"

export type ExpertsCatalogData = {
  experts: ExpertListItem[]
  categories: ExpertCategory[]
  totalSize: number
  nextPageToken: string
  catalogVersion: string
  catalogHash: string
  updatedAt: string
  cached?: boolean
}

export type ExpertDetailData = {
  expert: ExpertDetail
  cached?: boolean
}

export type ExpertSummonData = {
  sessionId: string
  sessionPath: string
  runtimeHash: string
  draftPrompt: string
}

export function isExpertRuntimeAvailable(
  expert: Pick<
    ExpertListItem,
    "promptCount" | "runtimeAvailable" | "runtimeHash" | "status"
  >
) {
  return (
    expert.status !== "metadata_only" &&
    expert.runtimeAvailable !== false &&
    typeof expert.runtimeHash === "string" &&
    expert.runtimeHash.trim() !== "" &&
    (expert.promptCount ?? 0) > 0
  )
}
