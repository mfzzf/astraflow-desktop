import { expect, type APIRequestContext, test } from "@playwright/test"

import type {
  StudioChatRunLiveSnapshot,
  StudioMessage,
} from "@/lib/studio-types"
import type { StudioProfilerSample } from "@/components/studio-chat/performance-profiler"

test.skip(
  process.env.ASTRAFLOW_RUN_STREAM_PROFILE !== "1",
  "Set ASTRAFLOW_RUN_STREAM_PROFILE=1 to run the React Profiler workload."
)

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: unknown }

test("profiles a repeatable streaming Markdown workload", async ({
  page,
  request,
}) => {
  const session = await createSession(request)
  const assistant = await createStreamingMessage(request, session.id)
  const source = createProfileMarkdown(
    Number(process.env.ASTRAFLOW_STREAM_PROFILE_CHARS ?? 12_000)
  )

  await page.addInitScript(() => {
    window.__ASTRAFLOW_REACT_PROFILER_ENABLED__ = true
    window.__ASTRAFLOW_REACT_PROFILER_SAMPLES__ = []
    window.__ASTRAFLOW_STREAM_PROFILE_FLUSH_COUNT__ = 0
  })
  await page.goto(`/studio/chat/${encodeURIComponent(session.id)}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(page.getByTestId("studio-chat-workbench")).toBeVisible({
    timeout: 30_000,
  })
  const chatLog = page.getByRole("log")
  await expect(
    page.locator('[data-pip-obstacle="thread-summary-panel"][data-state="open"]')
  ).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await chatLog.boundingBox()
      const viewportWidth = page.viewportSize()?.width ?? 0

      return bounds ? viewportWidth - (bounds.x + bounds.width) : Infinity
    })
    .toBeLessThanOrEqual(1)
  await page.waitForFunction(
    () => typeof window.__ASTRAFLOW_STREAM_PROFILE_PUSH__ === "function"
  )

  await page.evaluate(({ assistant }) => {
    window.__ASTRAFLOW_STREAM_PROFILE_PUSH__?.({
      runId: "profile-working-state",
      sessionId: assistant.sessionId,
      assistantMessageId: assistant.id,
      status: "running",
      error: null,
      usage: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: {
        ...assistant,
        content: "",
        reasoningContent: "Completed reasoning while the turn keeps running.",
        reasoningDurationMs: 3_000,
        parts: [
          {
            id: "profile-reasoning",
            type: "reasoning",
            content: "Completed reasoning while the turn keeps running.",
            durationMs: 3_000,
          },
        ],
        status: "streaming",
      },
    })
  }, { assistant })
  await expect(page.getByText(/^(Working|正在工作)$/)).toBeVisible()

  await page.evaluate(({ assistant }) => {
    window.__ASTRAFLOW_STREAM_PROFILE_PUSH__?.({
      runId: "profile-plan-state",
      sessionId: assistant.sessionId,
      assistantMessageId: assistant.id,
      status: "running",
      error: null,
      usage: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: {
        ...assistant,
        content: "",
        reasoningContent: "",
        reasoningDurationMs: null,
        parts: [
          {
            id: "profile-plan",
            type: "plan",
            content: "Profile plan",
            todos: [
              { text: "Inspect the current renderer", status: "completed" },
              { text: "Render the compact plan", status: "in_progress" },
              { text: "Verify the result", status: "pending" },
            ],
          },
        ],
        status: "streaming",
      },
    })
  }, { assistant })
  const floatingPlan = page.getByTestId("studio-floating-plan")
  await expect(floatingPlan).toBeVisible()
  await expect(
    floatingPlan.getByText(/^(Step 2 of 3|第 2 \/ 3 步)$/)
  ).toBeVisible()
  await expect(floatingPlan.getByText("Inspect the current renderer")).toBeHidden()
  await floatingPlan.getByRole("button").hover()
  await expect(
    floatingPlan.getByText("Inspect the current renderer")
  ).toBeVisible()

  await page.evaluate(() => {
    window.__ASTRAFLOW_REACT_PROFILER_SAMPLES__ = []
  })

  const startedAt = Date.now()
  await page.evaluate(
    async ({ assistant, source, startedAt }) => {
      const push = window.__ASTRAFLOW_STREAM_PROFILE_PUSH__

      if (!push) {
        throw new Error("Streaming profile bridge is unavailable.")
      }

      const chunkSize = 48

      for (let end = chunkSize; end <= source.length; end += chunkSize) {
        const content = source.slice(0, end)
        const message: StudioMessage = {
          ...assistant,
          content,
          parts: [{ id: "profile-text", type: "text", content }],
          status: "streaming",
        }
        const snapshot: StudioChatRunLiveSnapshot = {
          runId: "profile-run",
          sessionId: assistant.sessionId,
          assistantMessageId: assistant.id,
          status: "running",
          error: null,
          usage: null,
          startedAt: new Date(startedAt).toISOString(),
          updatedAt: new Date().toISOString(),
          message,
        }

        push(snapshot)
        await new Promise((resolve) => window.setTimeout(resolve, 16))
      }

      const content = source
      push({
        runId: "profile-run",
        sessionId: assistant.sessionId,
        assistantMessageId: assistant.id,
        status: "complete",
        error: null,
        usage: null,
        startedAt: new Date(startedAt).toISOString(),
        updatedAt: new Date().toISOString(),
        message: {
          ...assistant,
          content,
          parts: [{ id: "profile-text", type: "text", content }],
          status: "complete",
        },
      })
    },
    { assistant, source, startedAt }
  )

  await page.waitForTimeout(250)

  const samples = await page.evaluate(
    () => window.__ASTRAFLOW_REACT_PROFILER_SAMPLES__ ?? []
  )
  const flushCount = await page.evaluate(
    () => window.__ASTRAFLOW_STREAM_PROFILE_FLUSH_COUNT__ ?? 0
  )
  const summary = { flushCount, ...summarizeSamples(samples) }

  console.log(`STREAM_PROFILE ${JSON.stringify(summary)}`)
  expect(summary.workbench.commits).toBeGreaterThan(0)
  expect(summary.messages.commits).toBeGreaterThan(0)

  await expect
    .poll(() =>
      chatLog.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop
      )
    )
    .toBeLessThanOrEqual(2)

  await chatLog.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -1_000 })
    )
    element.scrollTop = 0
    element.dispatchEvent(new Event("scroll"))
  })
  await page.evaluate(
    ({ assistant, source, startedAt }) => {
      const content = `${source}\n\nUser-controlled scroll remains unlocked.`

      window.__ASTRAFLOW_STREAM_PROFILE_PUSH__?.({
        runId: "profile-run",
        sessionId: assistant.sessionId,
        assistantMessageId: assistant.id,
        status: "running",
        error: null,
        usage: null,
        startedAt: new Date(startedAt).toISOString(),
        updatedAt: new Date().toISOString(),
        message: {
          ...assistant,
          content,
          parts: [{ id: "profile-text", type: "text", content }],
          status: "streaming",
        },
      })
    },
    { assistant, source, startedAt }
  )
  await page.waitForTimeout(100)
  expect(await chatLog.evaluate((element) => element.scrollTop)).toBeLessThan(2)
})

function summarizeSamples(samples: StudioProfilerSample[]) {
  return {
    workbench: summarizeProfile(
      samples.filter((sample) => sample.id === "StudioChatWorkbench")
    ),
    messages: summarizeProfile(
      samples.filter((sample) => sample.id === "StudioChatMessages")
    ),
  }
}

function summarizeProfile(samples: StudioProfilerSample[]) {
  const durations = samples
    .map((sample) => sample.actualDuration)
    .sort((a, b) => a - b)
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)

  return {
    commits: samples.length,
    phases: Object.fromEntries(
      ["mount", "update", "nested-update"].map((phase) => [
        phase,
        samples.filter((sample) => sample.phase === phase).length,
      ])
    ),
    totalDuration: Number(totalDuration.toFixed(2)),
    durationByPhase: Object.fromEntries(
      ["mount", "update", "nested-update"].map((phase) => [
        phase,
        Number(
          samples
            .filter((sample) => sample.phase === phase)
            .reduce((sum, sample) => sum + sample.actualDuration, 0)
            .toFixed(2)
        ),
      ])
    ),
    averageDuration: Number((totalDuration / samples.length || 0).toFixed(2)),
    p95Duration: Number(percentile(durations, 0.95).toFixed(2)),
    maxDuration: Number((durations.at(-1) ?? 0).toFixed(2)),
  }
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) {
    return 0
  }

  return values[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ]
}

function createProfileMarkdown(length: number) {
  const section = [
    "## 流式渲染测试",
    "",
    "这是一段包含 **强调文本**、`inline code` 和 [链接](https://example.com) 的说明。",
    "",
    "- 第一项会随着流式响应逐步增长",
    "- 第二项用于观察 Markdown 列表更新",
    "- 第三项用于制造稳定且可重复的渲染负载",
    "",
    "```ts",
    "const render = (value: string) => value.length",
    "```",
    "",
  ].join("\n")

  return section.repeat(Math.ceil(length / section.length)).slice(0, length)
}

async function createSession(request: APIRequestContext) {
  const response = await request.post("/api/studio/sessions", {
    data: { mode: "chat", title: "Streaming Profiler" },
  })
  const payload = (await response.json()) as ApiResponse<{ id: string }>

  expect(response.status()).toBe(201)
  expect(payload.ok).toBe(true)
  if (!payload.ok) throw new Error("Failed to create profile session")
  return payload.data
}

async function createStreamingMessage(
  request: APIRequestContext,
  sessionId: string
) {
  const response = await request.post(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      data: {
        role: "assistant",
        content: "开始",
        parts: [{ id: "profile-text", type: "text", content: "开始" }],
        status: "streaming",
      },
    }
  )
  const payload = (await response.json()) as ApiResponse<StudioMessage>

  expect(response.status()).toBe(201)
  expect(payload.ok).toBe(true)
  if (!payload.ok) throw new Error("Failed to create profile message")
  return payload.data
}
