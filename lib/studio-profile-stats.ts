export type StudioProfileModelUsage = {
  model: string
  runtimes: string[]
  runs: number
  sessions: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  contextWindow: number | null
  lastUsedAt: string
  percent: number
}

export type StudioProfileStats = {
  lifetimeTokens: number
  peakDayTokens: number
  totalPrompts: number
  totalThreads: number
  currentStreakDays: number
  longestStreakDays: number
  activity: { day: string; count: number }[]
  topProvider: { name: string; percent: number } | null
  mostActiveHour: number | null
  mostWorkedProject: { title: string; count: number } | null
  modelUsage: { model: string; percent: number }[]
  modelUsageDetails: StudioProfileModelUsage[]
}
