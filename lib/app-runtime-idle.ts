type ActiveWorkCounts = {
  agentRuns: number
  automationRuns: number
  imageGenerations: number
  audioGenerations: number
  videoGenerations: number
}

type AppRuntimeDatabase = {
  prepare: (query: string) => {
    get: () => unknown
  }
}

function getAppRuntimeIdleState(database: AppRuntimeDatabase) {
  const counts = database
    .prepare(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM studio_messages
            WHERE status = 'streaming'
          ) AS agentRuns,
          (
            SELECT COUNT(*)
            FROM studio_scheduled_task_runs
            WHERE status IN ('queued', 'running')
          ) AS automationRuns,
          (
            SELECT COUNT(*)
            FROM studio_image_generations
            WHERE status IN ('queued', 'running', 'polling')
          ) AS imageGenerations,
          (
            SELECT COUNT(*)
            FROM studio_audio_generations
            WHERE status = 'running'
          ) AS audioGenerations,
          (
            SELECT COUNT(*)
            FROM studio_video_generations
            WHERE status IN ('queued', 'running', 'polling')
          ) AS videoGenerations
      `
    )
    .get() as ActiveWorkCounts
  const activeCount = Object.values(counts).reduce(
    (total, count) => total + count,
    0
  )

  return {
    idle: activeCount === 0,
    activeCount,
    counts,
  }
}

export { getAppRuntimeIdleState }
export type { ActiveWorkCounts }
