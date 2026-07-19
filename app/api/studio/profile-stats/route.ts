import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getChatModelConfig, isBuiltInChatModel } from "@/lib/chat-models"
import { getStudioDatabase } from "@/lib/studio-db"
import type { StudioProfileModelUsage } from "@/lib/studio-profile-stats"

export const runtime = "nodejs"

type CountRow = { count: number }
type DayCountRow = { day: string; count: number }
type RuntimeCountRow = { runtime: string; count: number }
type ProjectCountRow = { title: string; count: number }
type ModelUsageAggregateRow = Omit<
  StudioProfileModelUsage,
  "runtimes" | "percent"
> & { runtimes: string }

function getStreaks(days: string[]) {
  const timestamps = [...new Set(days)]
    .map((day) => Date.parse(`${day}T00:00:00.000Z`))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  let longest = 0
  let run = 0
  let previous = Number.NaN

  for (const timestamp of timestamps) {
    run = timestamp - previous === 86_400_000 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = timestamp
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const last = timestamps.at(-1)
  const active =
    last !== undefined && today.getTime() - last <= 86_400_000 ? run : 0

  return { current: active, longest }
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) return authError

  const database = getStudioDatabase()
  const totalPrompts = (
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM studio_messages WHERE role = 'user' AND visible = 1"
      )
      .get() as CountRow
  ).count
  const totalThreads = (
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM studio_sessions WHERE mode = 'chat'"
      )
      .get() as CountRow
  ).count
  const dayCounts = database
    .prepare(
      `
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
        FROM studio_messages
        WHERE role = 'user' AND visible = 1
        GROUP BY day
        ORDER BY day ASC
      `
    )
    .all() as DayCountRow[]
  const tokenDayRows = database
    .prepare(
      `
        SELECT substr(started_at, 1, 10) AS day, SUM(total_tokens) AS count
        FROM studio_model_usage_runs
        GROUP BY day
        ORDER BY day ASC
      `
    )
    .all() as DayCountRow[]
  const modelUsageRows = database
    .prepare(
      `
        SELECT
          model,
          GROUP_CONCAT(DISTINCT runtime_id) AS runtimes,
          COUNT(DISTINCT run_id) AS runs,
          COUNT(DISTINCT session_id) AS sessions,
          SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens,
          SUM(cached_input_tokens) AS cachedInputTokens,
          SUM(cache_write_input_tokens) AS cacheWriteInputTokens,
          SUM(reasoning_output_tokens) AS reasoningOutputTokens,
          SUM(total_tokens) AS totalTokens,
          NULLIF(MAX(COALESCE(model_context_window, context_window_size, 0)), 0)
            AS contextWindow,
          MAX(updated_at) AS lastUsedAt
        FROM studio_model_usage_runs
        GROUP BY model
        ORDER BY totalTokens DESC, runs DESC, model ASC
      `
    )
    .all() as ModelUsageAggregateRow[]
  const runtimeRows = database
    .prepare(
      `
        SELECT runtime_id AS runtime, COUNT(DISTINCT run_id) AS count
        FROM studio_model_usage_runs
        GROUP BY runtime
        ORDER BY count DESC
      `
    )
    .all() as RuntimeCountRow[]
  const activeHour = database
    .prepare(
      `
        SELECT CAST(substr(created_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS count
        FROM studio_messages
        WHERE role = 'user' AND visible = 1
        GROUP BY hour
        ORDER BY count DESC, hour ASC
        LIMIT 1
      `
    )
    .get() as { hour: number; count: number } | undefined
  const project = database
    .prepare(
      `
        SELECT COALESCE(workspace.name, session.title) AS title, COUNT(message.id) AS count
        FROM studio_sessions AS session
        LEFT JOIN studio_workspaces AS workspace ON workspace.id = session.workspace_id
        LEFT JOIN studio_messages AS message
          ON message.session_id = session.id AND message.role = 'user' AND message.visible = 1
        GROUP BY session.id
        ORDER BY count DESC, session.updated_at DESC
        LIMIT 1
      `
    )
    .get() as ProjectCountRow | undefined

  const lifetimeTokens = modelUsageRows.reduce(
    (sum, row) => sum + row.totalTokens,
    0
  )
  const peakDayTokens = Math.max(0, ...tokenDayRows.map((entry) => entry.count))
  const streaks = getStreaks(dayCounts.map((entry) => entry.day))
  const totalModelRuns = modelUsageRows.reduce(
    (sum, entry) => sum + entry.runs,
    0
  )
  const totalRuntimeRuns = runtimeRows.reduce(
    (sum, entry) => sum + entry.count,
    0
  )
  const modelUsageDetails = modelUsageRows.map((entry) => {
    const configuredContextWindow = isBuiltInChatModel(entry.model)
      ? getChatModelConfig(entry.model).contextWindow
      : 0

    return {
      ...entry,
      contextWindow:
        Math.max(entry.contextWindow ?? 0, configuredContextWindow) || null,
      runtimes: entry.runtimes
        .split(",")
        .map((runtime) => runtime.trim())
        .filter(Boolean),
      percent: Math.round(
        (lifetimeTokens > 0
          ? entry.totalTokens / lifetimeTokens
          : totalModelRuns > 0
            ? entry.runs / totalModelRuns
            : 0) * 100
      ),
    }
  }) satisfies StudioProfileModelUsage[]

  return NextResponse.json({
    ok: true,
    data: {
      lifetimeTokens,
      peakDayTokens,
      totalPrompts,
      totalThreads,
      currentStreakDays: streaks.current,
      longestStreakDays: streaks.longest,
      activity: dayCounts,
      topProvider: runtimeRows[0]
        ? {
            name: runtimeRows[0].runtime,
            percent: Math.round(
              (runtimeRows[0].count / totalRuntimeRuns) * 100
            ),
          }
        : null,
      mostActiveHour: activeHour?.hour ?? null,
      mostWorkedProject: project ?? null,
      modelUsage: modelUsageDetails.map((entry) => ({
        model: entry.model,
        percent: entry.percent,
      })),
      modelUsageDetails,
    },
  })
}
