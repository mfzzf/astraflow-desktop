import { normalizeAgentUsage } from "@/lib/agent/usage"

export function crossDeviceRunUsage(value: unknown) {
  const usage = normalizeAgentUsage(value)
  if (!usage) return null
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    modelContextWindow: usage.modelContextWindow,
    contextTokensUsed: usage.contextTokensUsed ?? null,
    contextWindowSize: usage.contextWindowSize ?? null,
    cost: usage.cost
      ? { amount: usage.cost.amount, currency: usage.cost.currency }
      : null,
  }
}
