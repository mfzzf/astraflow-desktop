import type { StudioTokenUsage } from "@/lib/studio-types"

type NormalizedUsage = Omit<StudioTokenUsage, "raw">

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value))
    }
  }

  return 0
}

function getOptionalNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value))
    }
  }

  return null
}

function getCost(value: unknown): StudioTokenUsage["cost"] {
  const record = getRecord(value)

  if (!record) {
    return null
  }

  const amount = record.amount
  const currency = record.currency

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    typeof currency !== "string" ||
    currency.trim().length === 0
  ) {
    return null
  }

  return {
    amount: Math.max(0, amount),
    currency: currency.trim(),
    ...(record._meta === null ||
    (typeof record._meta === "object" && !Array.isArray(record._meta))
      ? { _meta: record._meta as Record<string, unknown> | null }
      : {}),
  }
}

function addUsage(
  left: NormalizedUsage,
  right: NormalizedUsage
): NormalizedUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteInputTokens:
      left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
    modelContextWindow: left.modelContextWindow ?? right.modelContextWindow,
    ...(right.contextTokensUsed != null || left.contextTokensUsed != null
      ? {
          contextTokensUsed:
            right.contextTokensUsed ?? left.contextTokensUsed ?? null,
        }
      : {}),
    ...(right.contextWindowSize != null || left.contextWindowSize != null
      ? {
          contextWindowSize:
            right.contextWindowSize ?? left.contextWindowSize ?? null,
        }
      : {}),
    ...(right.cost != null || left.cost != null
      ? { cost: right.cost ?? left.cost ?? null }
      : {}),
  }
}

function hasUsageData(usage: NormalizedUsage) {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.totalTokens > 0 ||
    usage.cachedInputTokens > 0 ||
    usage.cacheWriteInputTokens > 0 ||
    usage.reasoningOutputTokens > 0 ||
    usage.contextTokensUsed != null ||
    usage.contextWindowSize != null ||
    usage.cost != null
  )
}

function normalizeUsageRecord(
  record: Record<string, unknown>
): NormalizedUsage | null {
  const totalBreakdown = getRecord(record.total)

  if (totalBreakdown) {
    const normalizedTotal = normalizeUsageRecord(totalBreakdown)

    if (normalizedTotal) {
      return {
        ...normalizedTotal,
        modelContextWindow:
          getNumber(record, ["modelContextWindow", "model_context_window"]) ||
          normalizedTotal.modelContextWindow,
      }
    }
  }

  const nestedUsage = getRecord(record.usage)

  if (nestedUsage) {
    const normalizedNested = normalizeUsageRecord(nestedUsage)

    if (normalizedNested) {
      return normalizedNested
    }
  }

  const tokenRecord = getRecord(record.tokens)

  if (tokenRecord) {
    const normalizedTokens = normalizeUsageRecord(tokenRecord)

    if (normalizedTokens) {
      return normalizedTokens
    }
  }

  const modelUsage = getRecord(record.modelUsage)

  if (modelUsage) {
    let aggregate: NormalizedUsage | null = null

    for (const value of Object.values(modelUsage)) {
      const normalized = normalizeAgentUsage(value)

      if (!normalized) {
        continue
      }

      const comparable = {
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        totalTokens: normalized.totalTokens,
        cachedInputTokens: normalized.cachedInputTokens,
        cacheWriteInputTokens: normalized.cacheWriteInputTokens,
        reasoningOutputTokens: normalized.reasoningOutputTokens,
        modelContextWindow: normalized.modelContextWindow,
        ...(normalized.contextTokensUsed != null
          ? { contextTokensUsed: normalized.contextTokensUsed }
          : {}),
        ...(normalized.contextWindowSize != null
          ? { contextWindowSize: normalized.contextWindowSize }
          : {}),
        ...(normalized.cost != null ? { cost: normalized.cost } : {}),
      }

      aggregate = aggregate ? addUsage(aggregate, comparable) : comparable
    }

    if (aggregate && hasUsageData(aggregate)) {
      return aggregate
    }
  }

  const inputTokenDetails =
    getRecord(record.input_token_details) ??
    getRecord(record.input_tokens_details) ??
    getRecord(record.prompt_tokens_details)
  const outputTokenDetails =
    getRecord(record.output_token_details) ??
    getRecord(record.output_tokens_details) ??
    getRecord(record.completion_tokens_details)
  const topLevelCachedInputTokens = getNumber(record, [
    "cachedInputTokens",
    "cached_input_tokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedReadTokens",
    "cacheRead",
    "cache_read",
  ])
  const topLevelCacheWriteInputTokens = getNumber(record, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteInputTokens",
    "cache_write_input_tokens",
    "cachedWriteTokens",
    "cacheWrite",
    "cache_write",
  ])
  const cachedInputTokens =
    topLevelCachedInputTokens ||
    (inputTokenDetails
      ? getNumber(inputTokenDetails, [
          "cacheReadInputTokens",
          "cache_read_input_tokens",
          "cache_read",
          "cached_tokens",
        ])
      : 0)
  const cacheWriteInputTokens =
    topLevelCacheWriteInputTokens ||
    (inputTokenDetails
      ? getNumber(inputTokenDetails, [
          "cacheCreationInputTokens",
          "cache_creation_input_tokens",
          "cacheWriteInputTokens",
          "cache_write_input_tokens",
          "cache_creation",
          "cache_write",
        ])
      : 0)
  const providerReportsCacheTokensSeparately =
    "cache_read_input_tokens" in record ||
    "cache_creation_input_tokens" in record ||
    "cacheReadInputTokens" in record ||
    "cacheCreationInputTokens" in record ||
    "cacheWriteInputTokens" in record ||
    "cacheRead" in record ||
    "cacheWrite" in record
  const reportedInputTokens = getNumber(record, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "input",
  ])
  const contextTokensUsed = getOptionalNumber(record, ["used"])
  const contextWindowSize = getOptionalNumber(record, ["size"])
  const cost = getCost(record.cost)
  const usage = {
    inputTokens: providerReportsCacheTokensSeparately
      ? reportedInputTokens + cachedInputTokens + cacheWriteInputTokens
      : reportedInputTokens,
    outputTokens: getNumber(record, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
      "output",
    ]),
    totalTokens: getNumber(record, ["totalTokens", "total_tokens", "total"]),
    cachedInputTokens,
    cacheWriteInputTokens,
    reasoningOutputTokens:
      getNumber(record, [
        "reasoningOutputTokens",
        "reasoning_output_tokens",
        "thoughtTokens",
        "reasoning_tokens",
        "reasoning",
      ]) ||
      (outputTokenDetails
        ? getNumber(outputTokenDetails, [
            "reasoningOutputTokens",
            "reasoning_output_tokens",
            "reasoning_tokens",
            "reasoning",
          ])
        : 0),
    modelContextWindow:
      getNumber(record, [
        "modelContextWindow",
        "model_context_window",
        "contextWindow",
        "context_window",
      ]) || null,
    ...(contextTokensUsed != null ? { contextTokensUsed } : {}),
    ...(contextWindowSize != null ? { contextWindowSize } : {}),
    ...(cost != null ? { cost } : {}),
  }

  if (!usage.totalTokens) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens
  }

  return hasUsageData(usage) ? usage : null
}

export function normalizeAgentUsage(value: unknown): StudioTokenUsage | null {
  const record = getRecord(value)

  if (!record) {
    return null
  }

  const normalized = normalizeUsageRecord(record)

  return normalized
    ? {
        ...normalized,
        raw: value,
      }
    : null
}

/**
 * ACP may publish context-window usage during a turn and token counters only
 * in the final prompt response (or in the opposite order). Keep the newest
 * value for each independently optional family instead of dropping one
 * partial update when another arrives.
 */
export function mergeAgentUsageSnapshots(
  previous: StudioTokenUsage | null,
  next: StudioTokenUsage
): StudioTokenUsage {
  if (!previous) {
    return next
  }

  return {
    inputTokens: next.inputTokens || previous.inputTokens,
    outputTokens: next.outputTokens || previous.outputTokens,
    totalTokens: next.totalTokens || previous.totalTokens,
    cachedInputTokens: next.cachedInputTokens || previous.cachedInputTokens,
    cacheWriteInputTokens:
      next.cacheWriteInputTokens || previous.cacheWriteInputTokens,
    reasoningOutputTokens:
      next.reasoningOutputTokens || previous.reasoningOutputTokens,
    modelContextWindow: next.modelContextWindow ?? previous.modelContextWindow,
    contextTokensUsed:
      next.contextTokensUsed ?? previous.contextTokensUsed ?? null,
    contextWindowSize:
      next.contextWindowSize ?? previous.contextWindowSize ?? null,
    cost: next.cost ?? previous.cost ?? null,
    raw: next.raw,
  }
}
