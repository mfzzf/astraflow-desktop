import { normalizeAgentUsage } from "@/lib/agent/usage"
import type { StudioTokenUsage } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"

type RecordStudioModelUsageRunInput = {
  runId: string
  sessionId: string
  assistantMessageId?: string | null
  model: string
  runtimeId: string
  usage: StudioTokenUsage
  startedAt: string
}

function tokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0
}

function optionalTokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getReportedModelUsage(usage: StudioTokenUsage) {
  const raw = getRecord(usage.raw)
  const candidates = [raw, getRecord(raw?.usage), getRecord(raw?.total)]

  for (const candidate of candidates) {
    const reported = getRecord(candidate?.modelUsage)

    if (!reported) continue

    const entries = Object.entries(reported)
      .map(([model, value]) => ({
        model: model.trim(),
        usage: normalizeAgentUsage(value),
      }))
      .filter(
        (
          entry
        ): entry is {
          model: string
          usage: StudioTokenUsage
        } =>
          Boolean(entry.model) &&
          !/^call[_-]?\d+$/i.test(entry.model) &&
          entry.usage !== null
      )

    if (entries.length === Object.keys(reported).length && entries.length > 0) {
      return entries
    }
  }

  return null
}

export function recordStudioModelUsageRun({
  runId,
  sessionId,
  assistantMessageId = null,
  model,
  runtimeId,
  usage,
  startedAt,
}: RecordStudioModelUsageRunInput) {
  const updatedAt = nowIso()
  const fallbackModel = model.trim() || "unknown"
  const modelUsages = getReportedModelUsage(usage) ?? [
    { model: fallbackModel, usage },
  ]
  const database = getDb()
  const removePreviousRows = database.prepare(
    "DELETE FROM studio_model_usage_runs WHERE run_id = ?"
  )
  const insert = database.prepare(
    `
        INSERT INTO studio_model_usage_runs (
          id,
          run_id,
          session_id,
          assistant_message_id,
          model,
          runtime_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          reasoning_output_tokens,
          model_context_window,
          context_tokens_used,
          context_window_size,
          cost_amount,
          cost_currency,
          started_at,
          updated_at
        ) VALUES (
          @id,
          @runId,
          @sessionId,
          @assistantMessageId,
          @model,
          @runtimeId,
          @inputTokens,
          @outputTokens,
          @totalTokens,
          @cachedInputTokens,
          @cacheWriteInputTokens,
          @reasoningOutputTokens,
          @modelContextWindow,
          @contextTokensUsed,
          @contextWindowSize,
          @costAmount,
          @costCurrency,
          @startedAt,
          @updatedAt
        )
      `
  )

  database.transaction(() => {
    removePreviousRows.run(runId)

    for (const entry of modelUsages) {
      const entryCost = entry.usage.cost
      const costAmount =
        typeof entryCost?.amount === "number" &&
        Number.isFinite(entryCost.amount)
          ? Math.max(0, entryCost.amount)
          : null

      insert.run({
        id: `${runId}:${encodeURIComponent(entry.model)}`,
        runId,
        sessionId,
        assistantMessageId,
        model: entry.model,
        runtimeId: runtimeId.trim() || "unknown",
        inputTokens: tokenCount(entry.usage.inputTokens),
        outputTokens: tokenCount(entry.usage.outputTokens),
        totalTokens: tokenCount(entry.usage.totalTokens),
        cachedInputTokens: tokenCount(entry.usage.cachedInputTokens),
        cacheWriteInputTokens: tokenCount(entry.usage.cacheWriteInputTokens),
        reasoningOutputTokens: tokenCount(entry.usage.reasoningOutputTokens),
        modelContextWindow: optionalTokenCount(entry.usage.modelContextWindow),
        contextTokensUsed: optionalTokenCount(entry.usage.contextTokensUsed),
        contextWindowSize: optionalTokenCount(entry.usage.contextWindowSize),
        costAmount,
        costCurrency: entryCost?.currency.trim() || null,
        startedAt,
        updatedAt,
      })
    }
  })()
}

export type { RecordStudioModelUsageRunInput }
