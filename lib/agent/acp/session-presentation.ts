import type { SessionInfoUpdate } from "@agentclientprotocol/sdk"

export type AcpSessionInfoSnapshot = SessionInfoUpdate & {
  sessionUpdate: "session_info_update"
}

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function protocolLabel(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().replaceAll("_", " ")
    : null
}

export function getAcpSessionInfoPresentation(
  info: AcpSessionInfoSnapshot | null
) {
  const meta = recordValue(info?._meta)
  const codex = recordValue(meta?.codex)
  const threadStatusRecord = recordValue(codex?.threadStatus)
  const goal = recordValue(codex?.goal)
  const tokenBudget = goal?.tokenBudget

  return {
    title: info?.title ?? null,
    updatedAt: info?.updatedAt ?? null,
    threadStatus:
      protocolLabel(codex?.threadStatus) ??
      protocolLabel(threadStatusRecord?.type) ??
      protocolLabel(threadStatusRecord?.status),
    archived: codex?.archived === true,
    closed: codex?.closed === true,
    goal:
      typeof goal?.objective === "string" && goal.objective.trim()
        ? {
            objective: goal.objective.trim(),
            status: protocolLabel(goal.status),
            tokenBudget:
              typeof tokenBudget === "number" && Number.isFinite(tokenBudget)
                ? tokenBudget
                : null,
          }
        : null,
  }
}

export function getClaudeRateLimitPresentation(
  info: Record<string, unknown> | null
) {
  if (!info) {
    return null
  }

  const status = protocolLabel(info.status)
  const utilization = info.utilization
  const resetsAt = info.resetsAt
  const utilizationPercent =
    typeof utilization === "number" && Number.isFinite(utilization)
      ? Math.round(
          Math.max(
            0,
            Math.min(100, utilization <= 1 ? utilization * 100 : utilization)
          )
        )
      : null

  return {
    status,
    rateLimitType: protocolLabel(info.rateLimitType),
    utilizationPercent,
    resetsAt:
      typeof resetsAt === "number" && Number.isFinite(resetsAt)
        ? new Date(
            resetsAt < 1_000_000_000_000 ? resetsAt * 1000 : resetsAt
          )
        : null,
    overageStatus: protocolLabel(info.overageStatus),
  }
}
