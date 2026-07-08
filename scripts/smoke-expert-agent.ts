import { createStudioMessage, createStudioSession } from "@/lib/studio-db"
import { upsertStudioSessionExpert } from "@/lib/studio-db/experts"
import {
  getStudioChatRun,
  startStudioChatRun,
} from "@/lib/studio-chat-runner"
import { getExpertRuntime } from "@/lib/experts-api"

const hasEnvironmentModelverseKey = Boolean(
  process.env.MODELVERSE_API_KEY?.trim() ||
    process.env.MODELVERSE_APIKEY?.trim() ||
    process.env.UCLOUD_MODELVERSE_API_KEY?.trim()
)

if (!hasEnvironmentModelverseKey) {
  throw new Error("Missing temporary ModelVerse API key in the environment.")
}

const expertId = process.env.ASTRAFLOW_SMOKE_EXPERT_ID?.trim() || "SoloExpert"
const timeoutMs = Number.parseInt(
  process.env.ASTRAFLOW_SMOKE_TIMEOUT_MS ?? "120000",
  10
)
const session = createStudioSession({
  mode: "chat",
  title: `Smoke Expert ${expertId}`,
  chatModel: "kimi-k2.6",
  chatRuntimeId: "astraflow",
  chatReasoningEffort: "enabled",
})

const runtimeResponse = await getExpertRuntime(expertId)
const runtime = runtimeResponse.runtime

if (!runtime?.expert?.id) {
  throw new Error(`Expert runtime not found for ${expertId}`)
}

const expertRecord = runtime.expert as Record<string, unknown>

upsertStudioSessionExpert({
  sessionId: session.id,
  expertId: runtime.expert.id,
  expertType: typeof runtime.expert.type === "string" ? runtime.expert.type : "agent",
  runtimeHash:
    typeof expertRecord.runtimeHash === "string"
      ? expertRecord.runtimeHash
      : typeof expertRecord.runtime_hash === "string"
        ? expertRecord.runtime_hash
        : "",
  snapshot: runtime,
})

createStudioMessage({
  sessionId: session.id,
  role: "user",
  content:
    "请确认当前专家是否已经被召唤激活。必须包含 EXPERT_SUMMON_OK，并说出专家 display_name。",
})

const run = startStudioChatRun({
  environment: "local",
  model: "kimi-k2.6",
  reasoningEffort: "enabled",
  runtimeId: "astraflow",
  sessionId: session.id,
})

const deadline = Date.now() + timeoutMs
let latest = getStudioChatRun(session.id) ?? run

while (Date.now() < deadline) {
  latest = getStudioChatRun(session.id) ?? latest

  if (latest.status === "complete" || latest.status === "error") {
    break
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
}

latest = getStudioChatRun(session.id) ?? latest

if (latest.status !== "complete") {
  throw new Error(
    `Expert agent smoke did not complete. status=${latest.status} error=${
      latest.error ?? ""
    }`
  )
}

const finalSnapshot = await import("@/lib/studio-db").then(({ getStudioMessage }) =>
  getStudioMessage(latest.assistantMessageId)
)

const content = finalSnapshot?.content ?? ""

if (!content.includes("EXPERT_SUMMON_OK")) {
  throw new Error(`Expert marker missing from final answer: ${content}`)
}

console.log(
  JSON.stringify(
    {
      sessionId: session.id,
      runId: latest.runId,
      expertId,
      model: "kimi-k2.6",
      runtimeId: "astraflow",
      status: latest.status,
      content,
    },
    null,
    2
  )
)

process.exit(0)

export {}
