import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { register } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-model-usage-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("records one updatable usage row for each model run", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Usage test",
    chatModel: "gpt-test",
    chatRuntimeId: "codex-direct",
  })
  const assistant = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "assistant",
    content: "done",
    model: "gpt-test",
  })
  const startedAt = "2026-07-19T08:00:00.000Z"

  studioDb.recordStudioModelUsageRun({
    runId: "run-1",
    sessionId: session.id,
    assistantMessageId: assistant.id,
    model: "gpt-test",
    runtimeId: "codex-direct",
    startedAt,
    usage: {
      inputTokens: 1_000,
      outputTokens: 100,
      totalTokens: 1_100,
      cachedInputTokens: 400,
      cacheWriteInputTokens: 50,
      reasoningOutputTokens: 20,
      modelContextWindow: 128_000,
    },
  })
  studioDb.recordStudioModelUsageRun({
    runId: "run-1",
    sessionId: session.id,
    assistantMessageId: assistant.id,
    model: "gpt-test",
    runtimeId: "codex-direct",
    startedAt,
    usage: {
      inputTokens: 1_200,
      outputTokens: 150,
      totalTokens: 1_350,
      cachedInputTokens: 500,
      cacheWriteInputTokens: 50,
      reasoningOutputTokens: 30,
      modelContextWindow: 128_000,
    },
  })

  const rows = studioDb
    .getStudioDatabase()
    .prepare(
      `
        SELECT
          model,
          runtime_id AS runtimeId,
          input_tokens AS inputTokens,
          output_tokens AS outputTokens,
          total_tokens AS totalTokens,
          cached_input_tokens AS cachedInputTokens,
          cache_write_input_tokens AS cacheWriteInputTokens,
          reasoning_output_tokens AS reasoningOutputTokens,
          model_context_window AS modelContextWindow
        FROM studio_model_usage_runs
      `
    )
    .all()

  assert.deepEqual(rows, [
    {
      model: "gpt-test",
      runtimeId: "codex-direct",
      inputTokens: 1_200,
      outputTokens: 150,
      totalTokens: 1_350,
      cachedInputTokens: 500,
      cacheWriteInputTokens: 50,
      reasoningOutputTokens: 30,
      modelContextWindow: 128_000,
    },
  ])
})

test("splits provider-reported model usage within the same agent run", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Multi-model usage",
  })

  studioDb.recordStudioModelUsageRun({
    runId: "run-2",
    sessionId: session.id,
    model: "fallback-model",
    runtimeId: "claude-native",
    startedAt: "2026-07-19T09:00:00.000Z",
    usage: {
      inputTokens: 2_300,
      outputTokens: 170,
      totalTokens: 2_470,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
      modelContextWindow: null,
      raw: {
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 1_200,
            outputTokens: 120,
            cacheReadInputTokens: 500,
            contextWindow: 200_000,
          },
          "claude-haiku-4-5": {
            inputTokens: 500,
            outputTokens: 50,
            cacheReadInputTokens: 100,
            contextWindow: 200_000,
          },
        },
      },
    },
  })

  const rows = studioDb
    .getStudioDatabase()
    .prepare(
      `
        SELECT model, total_tokens AS totalTokens,
          cached_input_tokens AS cachedInputTokens,
          model_context_window AS modelContextWindow
        FROM studio_model_usage_runs
        WHERE run_id = 'run-2'
        ORDER BY model ASC
      `
    )
    .all()

  assert.deepEqual(rows, [
    {
      model: "claude-haiku-4-5",
      totalTokens: 650,
      cachedInputTokens: 100,
      modelContextWindow: 200_000,
    },
    {
      model: "claude-sonnet-4-6",
      totalTokens: 1_820,
      cachedInputTokens: 500,
      modelContextWindow: 200_000,
    },
  ])
})
