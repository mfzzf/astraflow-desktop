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
        reasoningOutputTokens: normalized.reasoningOutputTokens,
        modelContextWindow: normalized.modelContextWindow,
      }

      aggregate = aggregate ? addUsage(aggregate, comparable) : comparable
    }

    if (aggregate && hasTokenData(aggregate)) {
      return aggregate
    }
  }

  const cachedInputTokens =
    getNumber(record, [
      "cachedInputTokens",
      "cached_input_tokens",
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cache_read",
    ]) +
    getNumber(record, [
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
      "cacheWriteInputTokens",
      "cache_write_input_tokens",
      "cache_write",
    ])
  const usage = {
    inputTokens: getNumber(record, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
      "input",
    ]),
    outputTokens: getNumber(record, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
      "output",
    ]),
    totalTokens: getNumber(record, [
      "totalTokens",
      "total_tokens",
      "total",
    ]),
    cachedInputTokens,
    reasoningOutputTokens: getNumber(record, [
      "reasoningOutputTokens",
      "reasoning_output_tokens",
      "reasoning_tokens",
    ]),
    modelContextWindow:
      getNumber(record, ["modelContextWindow", "model_context_window"]) ||
      null,
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
