import type { StudioTokenUsage } from "@/lib/studio-types"

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

function addUsage(
  left: Omit<StudioTokenUsage, "raw">,
  right: Omit<StudioTokenUsage, "raw">
) {
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
  }
}

function hasTokenData(usage: Omit<StudioTokenUsage, "raw">) {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.totalTokens > 0 ||
    usage.cachedInputTokens > 0 ||
    usage.cacheWriteInputTokens > 0 ||
    usage.reasoningOutputTokens > 0
  )
}

function normalizeUsageRecord(
  record: Record<string, unknown>
): Omit<StudioTokenUsage, "raw"> | null {
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
    let aggregate: Omit<StudioTokenUsage, "raw"> | null = null

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
      }

      aggregate = aggregate ? addUsage(aggregate, comparable) : comparable
    }

    if (aggregate && hasTokenData(aggregate)) {
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
    "cache_read",
  ])
  const topLevelCacheWriteInputTokens = getNumber(record, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteInputTokens",
    "cache_write_input_tokens",
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
    "cache_creation_input_tokens" in record
  const reportedInputTokens = getNumber(record, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "input",
  ])
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
        "reasoning_tokens",
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
      getNumber(record, ["modelContextWindow", "model_context_window"]) || null,
  }

  if (!usage.totalTokens) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens
  }

  return hasTokenData(usage) ? usage : null
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
