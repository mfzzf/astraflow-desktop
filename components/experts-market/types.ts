import type {
  AstraflowV1ExpertAgent,
  AstraflowV1ExpertCategory,
  AstraflowV1ExpertDetail,
  AstraflowV1ExpertListItem,
  AstraflowV1ExpertRuntime,
  AstraflowV1ExpertSkill,
  AstraflowV1ExpertTeamMember,
} from "@/lib/generated/astraflow-api"

export type ExpertCategory = AstraflowV1ExpertCategory
export type ExpertListItem = AstraflowV1ExpertListItem
export type ExpertDetail = AstraflowV1ExpertDetail
export type ExpertAgent = AstraflowV1ExpertAgent
export type ExpertSkill = AstraflowV1ExpertSkill
export type ExpertTeamMember = AstraflowV1ExpertTeamMember
export type ExpertRuntime = AstraflowV1ExpertRuntime

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
