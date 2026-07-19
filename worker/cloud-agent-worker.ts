import { hostname } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { AcpRuntime } from "@/lib/agent/acp/acp-runtime"
import type { AgentEvent, AgentUserInputAnswer } from "@/lib/agent/events"
import type { AgentMessage } from "@/lib/agent/messages"
import { resolvePermission } from "@/lib/agent/permission-broker"
import { createSnapshotAccumulator } from "@/lib/agent/run-orchestrator"
import { resolveUserInput } from "@/lib/agent/user-input-broker"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import {
  cloudWorkerServiceAppendRunEvents,
  cloudWorkerServiceClaimRun,
  cloudWorkerServiceClaimWorkspace,
  cloudWorkerServiceCompleteWorkspace,
  cloudWorkerServiceCompleteRunArtifactUpload,
  cloudWorkerServiceCreateRunArtifactUpload,
  cloudWorkerServiceRenewRun,
  type AstraflowV1AgentAction,
  type AstraflowV1AgentRunEvent,
  type AstraflowV1CloudRunLease,
  type AstraflowV1Message,
} from "@/lib/generated/astraflow-api"
import type { StudioPermissionMode } from "@/lib/studio-types"
import { crossDeviceRunUsage } from "@/lib/cross-device/run-usage"

import {
  connectCloudAgent,
  provisionCloudSandbox,
  readCloudOutputFiles,
} from "./cloud-sandbox-runtime"

const WORKER_LEASE_SECONDS = 60
const HEARTBEAT_INTERVAL_MS = 15_000
const IDLE_DELAY_MS = 1_000
const workerId = `${hostname().slice(0, 48)}-${process.pid}-${randomUUID().slice(0, 8)}`
const workerToken = process.env.ASTRAFLOW_CLOUD_WORKER_TOKEN?.trim() || ""
const runOnce = process.argv.includes("--once")
let stopping = false

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    console.error("[cloud-worker] fatal", errorMessage(error))
    process.exitCode = 1
  })
}

export async function main() {
  validateConfiguration()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  console.info("[cloud-worker] started", { workerId })
  do {
    const provisioned = await tryProvisionWorkspace()
    const executed = stopping ? false : await tryExecuteRun()
    if (runOnce) break
    if (!provisioned && !executed && !stopping) await delay(IDLE_DELAY_MS)
  } while (!stopping)
  console.info("[cloud-worker] stopped", { workerId })
}

async function tryProvisionWorkspace() {
  const claim = await claimWorkspace()
  if (!claim) return false
  const workspace = claim.workspace
  if (!workspace?.id || !claim.leaseToken) return false
  try {
    const sandboxId = await provisionCloudSandbox({
      accountId: claim.accountId || "unknown",
      workspaceId: workspace.id,
      workspaceName: workspace.name || "AstraFlow cloud workspace",
      repository: claim.repository,
    })
    unwrapAstraFlowApiResult(
      await cloudWorkerServiceCompleteWorkspace({
        headers: workerHeaders(),
        path: { workspaceId: workspace.id },
        body: {
          workspaceId: workspace.id,
          workerId,
          leaseToken: claim.leaseToken,
          state: "ready",
          sandboxId,
        },
      }),
      "Workspace provisioning result could not be saved."
    )
    console.info("[cloud-worker] workspace ready", {
      workspaceId: workspace.id,
      sandboxId,
    })
  } catch (error) {
    await cloudWorkerServiceCompleteWorkspace({
      headers: workerHeaders(),
      path: { workspaceId: workspace.id },
      body: {
        workspaceId: workspace.id,
        workerId,
        leaseToken: claim.leaseToken,
        state: "unavailable",
        errorMessage: errorMessage(error).slice(0, 2_000),
      },
    }).catch(() => undefined)
    console.error("[cloud-worker] workspace provisioning failed", {
      workspaceId: workspace.id,
      error: errorMessage(error),
    })
  }
  return true
}

async function tryExecuteRun() {
  const lease = await claimRun()
  if (!lease) return false
  if (
    !lease.run?.id ||
    !lease.session?.id ||
    !lease.workspace?.sandboxId ||
    !lease.leaseToken
  ) {
    console.error("[cloud-worker] invalid run lease")
    return true
  }
  const controller = new AbortController()
  const heartbeat = new RunHeartbeat(lease, controller)
  heartbeat.start()
  try {
    await executeRun(lease, controller.signal)
  } catch (error) {
    console.error("[cloud-worker] run failed", {
      runId: lease.run.id,
      error: errorMessage(error),
    })
  } finally {
    heartbeat.stop()
  }
  return true
}

async function executeRun(
  lease: AstraflowV1CloudRunLease,
  signal: AbortSignal
) {
  const run = lease.run!
  const session = lease.session!
  const sessionId = session.id!
  const uploader = new WorkerRunEventUploader(lease)
  const runtimeInfo = runtimeInfoFor(run.runtimeId || "astraflow")
  const runtime = new AcpRuntime({
    info: runtimeInfo,
    resolveCommand: async () => {
      const connection = await connectCloudAgent({
        sandboxId: lease.workspace!.sandboxId!,
        runtimeId: runtimeInfo.id,
        artifacts: lease.artifacts,
      })
      return { transport: "websocket", url: connection.websocketUrl }
    },
    resolveSessionKey: () => sessionId,
    resolveSessionMeta: () => ({
      cloudRunId: run.id,
      workspaceId: lease.workspace?.id,
    }),
  })
  const accumulator = createSnapshotAccumulator()
  let runtimeSessionRef = run.runtimeSessionRef || ""
  const messages = agentMessages(lease.messages ?? [], lease.artifacts ?? [])
  let executionError: unknown
  try {
    for await (const event of runtime.startRun({
      sessionId,
      messages,
      model: run.model || "gpt-5.6-sol",
      reasoningEffort: reasoningEffort(run.reasoningEffort),
      permissionMode: permissionMode(run.permissionMode),
      agentWorkspaceRoot: "/workspace",
      projectPath: "/workspace",
      workspaceId: lease.workspace?.id,
      workspaceRoot: "/workspace",
      runtimeSessionRef: run.runtimeSessionRef || null,
      environment: "remote",
      signal,
    })) {
      if (signal.aborted) break
      if (event.type === "run_meta" && event.sessionRef) {
        runtimeSessionRef = event.sessionRef
      }
      await uploader.captureEvent(event, accumulator, runtimeSessionRef)
      if (event.type === "error") throw new Error(event.message)
    }
  } catch (error) {
    executionError = error
  }
  if (!signal.aborted) {
    try {
      await uploadRunOutputs(lease, accumulator)
    } catch (error) {
      if (!executionError) executionError = error
      console.error("[cloud-worker] output artifact upload failed", {
        runId: run.id,
        error: errorMessage(error),
      })
    }
  }
  if (executionError && !signal.aborted) {
    const message = errorMessage(executionError)
    accumulator.finalizeFailed(message)
    await uploader.finish(accumulator, "failed", runtimeSessionRef, message)
    throw executionError
  }
  if (executionError) {
    throw executionError
  }
  if (signal.aborted) {
    if (!terminalStatus(uploader.lastKnownStatus)) {
      await uploader.finish(accumulator, "cancelled", runtimeSessionRef)
    }
    return
  }
  accumulator.completeReasoning()
  await uploader.finish(accumulator, "completed", runtimeSessionRef)
  console.info("[cloud-worker] run completed", { runId: run.id })
}

async function uploadRunOutputs(
  lease: AstraflowV1CloudRunLease,
  accumulator: ReturnType<typeof createSnapshotAccumulator>
) {
  const runId = lease.run!.id!
  const paths = accumulator
    .getSnapshot()
    .parts.flatMap((part) =>
      part.type === "file" &&
      part.kind !== "delete" &&
      part.status !== "error" &&
      part.path
        ? [part.path]
        : []
    )
  if (!paths.length) return
  const files = await readCloudOutputFiles(lease.workspace!.sandboxId!, paths)
  for (const file of files) {
    const digest = createHash("sha256").update(file.bytes).digest("hex")
    const uploadId = randomUUID()
    const artifactId = randomUUID()
    const upload = unwrapAstraFlowApiResult(
      await cloudWorkerServiceCreateRunArtifactUpload({
        headers: workerHeaders(),
        path: { runId },
        body: {
          runId,
          workerId,
          leaseToken: lease.leaseToken,
          uploadId,
          artifactId,
          kind: outputKind(file.fileName),
          fileName: file.fileName,
          mimeType: outputMimeType(file.fileName),
          size: String(file.bytes.byteLength),
          sha256: digest,
          clientMutationId: `${runId}:output:${digest}:${file.fileName}`.slice(
            0,
            160
          ),
        },
      }),
      "Cloud output artifact upload could not be prepared."
    )
    if (!upload.uploadUrl) {
      throw new Error("Cloud output artifact upload URL is missing.")
    }
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: Buffer.from(file.bytes),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      throw new Error(
        `Cloud output upload failed with HTTP ${response.status}.`
      )
    }
    unwrapAstraFlowApiResult(
      await cloudWorkerServiceCompleteRunArtifactUpload({
        headers: workerHeaders(),
        path: { runId, uploadId: upload.id! },
        body: {
          runId,
          workerId,
          leaseToken: lease.leaseToken,
          uploadId: upload.id,
        },
      }),
      "Cloud output artifact could not be completed."
    )
  }
}

class RunHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly resolvedActions = new Set<string>()
  cancelled = false

  constructor(
    private readonly lease: AstraflowV1CloudRunLease,
    private readonly controller: AbortController
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), HEARTBEAT_INTERVAL_MS)
    ;(this.timer as unknown as { unref?: () => void }).unref?.()
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick() {
    if (this.controller.signal.aborted) return
    try {
      const runId = this.lease.run!.id!
      const state = unwrapAstraFlowApiResult(
        await cloudWorkerServiceRenewRun({
          headers: workerHeaders(),
          path: { runId },
          body: {
            runId,
            workerId,
            leaseToken: this.lease.leaseToken,
            leaseSeconds: WORKER_LEASE_SECONDS,
          },
          signal: AbortSignal.timeout(10_000),
        }),
        "Cloud run lease could not be renewed."
      )
      if (
        ["cancelled", "failed", "completed"].includes(state.run?.status || "")
      ) {
        this.cancelled = state.run?.status === "cancelled"
        this.controller.abort(new Error(`Run ${state.run?.status}.`))
        return
      }
      for (const action of state.actions ?? []) this.resolveAction(action)
    } catch (error) {
      console.warn("[cloud-worker] lease heartbeat failed", {
        runId: this.lease.run?.id,
        error: errorMessage(error),
      })
      if (
        error instanceof AstraFlowApiError &&
        [401, 409].includes(error.status)
      ) {
        this.controller.abort(error)
      }
    }
  }

  private resolveAction(action: AstraflowV1AgentAction) {
    if (
      !action.id ||
      action.status === "pending" ||
      this.resolvedActions.has(action.id)
    )
      return
    const sessionId = this.lease.session!.id!
    const resolution = asRecord(action.resolution)
    let resolved = false
    if (action.type === "permission") {
      const optionId =
        readString(resolution.option_id) || readString(resolution.optionId)
      resolved = Boolean(
        optionId && resolvePermission(sessionId, action.id, optionId)
      )
    } else if (action.type === "user_input") {
      const answers = Array.isArray(resolution.answers)
        ? resolution.answers.filter(isUserInputAnswer)
        : []
      resolved = resolveUserInput(
        sessionId,
        action.id,
        answers,
        resolution.cancelled === true
      )
    }
    if (resolved) this.resolvedActions.add(action.id)
  }
}

class WorkerRunEventUploader {
  private nextSeq: number
  private pending: AstraflowV1AgentRunEvent[] = []
  private seenActions = new Set<string>()
  private lastSnapshotAt = 0
  lastKnownStatus = "running"

  constructor(private readonly lease: AstraflowV1CloudRunLease) {
    this.nextSeq = Number(lease.run?.lastEventSeq ?? 0) + 1
  }

  async captureEvent(
    event: AgentEvent,
    accumulator: ReturnType<typeof createSnapshotAccumulator>,
    runtimeSessionRef: string
  ) {
    const changed = accumulator.handleEvent(event)
    let queuedAction = false
    if (event.type === "permission_request" && event.status !== "resolved") {
      if (!this.seenActions.has(event.requestId)) {
        this.enqueue("agent.permission.requested", {
          action_id: event.requestId,
          request: safeJSON(event),
        })
        this.seenActions.add(event.requestId)
        queuedAction = true
      }
    } else if (
      event.type === "user_input_request" &&
      event.status !== "resolved"
    ) {
      if (!this.seenActions.has(event.requestId)) {
        this.enqueue("agent.user_input.requested", {
          action_id: event.requestId,
          request: safeJSON(event),
        })
        this.seenActions.add(event.requestId)
        queuedAction = true
      }
    } else if (
      event.type !== "reasoning_delta" &&
      event.type !== "text_delta"
    ) {
      this.enqueue(`agent.${event.type.replaceAll("_", ".")}`, {
        event: safeJSON(event),
        ...(event.type === "run_meta"
          ? { usage: crossDeviceRunUsage(event.usage) }
          : {}),
      })
    }
    const now = Date.now()
    if (
      changed &&
      (now - this.lastSnapshotAt >= 350 || this.pending.length >= 80)
    ) {
      this.enqueueSnapshot(accumulator, "running")
      this.lastSnapshotAt = now
    }
    if (this.pending.length >= 80 || queuedAction) {
      await this.flush("running", runtimeSessionRef)
    }
  }

  async finish(
    accumulator: ReturnType<typeof createSnapshotAccumulator>,
    status: "completed" | "failed" | "cancelled",
    runtimeSessionRef: string,
    error?: string
  ) {
    this.enqueueSnapshot(accumulator, status, error)
    await this.flush(status, runtimeSessionRef, error)
  }

  private enqueueSnapshot(
    accumulator: ReturnType<typeof createSnapshotAccumulator>,
    status: string,
    error?: string
  ) {
    this.enqueue("agent.run.snapshot", {
      run_id: this.lease.run?.id,
      session_id: this.lease.session?.id,
      status,
      error: error || null,
      message: {
        id: `assistant-${this.lease.run?.id}`,
        content: accumulator.getSnapshot().content,
        status: terminalStatus(status) ? "completed" : "streaming",
        parts: safeJSON(accumulator.getSnapshot().parts),
      },
      updated_at: new Date().toISOString(),
    })
  }

  private enqueue(type: string, payload: Record<string, unknown>) {
    this.pending.push({
      eventId: randomUUID(),
      seq: String(this.nextSeq++),
      type,
      payload,
      producerType: "worker",
      producerId: workerId,
      occurredAt: new Date().toISOString(),
    })
  }

  private async flush(
    status: string,
    runtimeSessionRef: string,
    error?: string
  ) {
    while (this.pending.length) {
      const batch = this.pending.slice(0, 100)
      const runId = this.lease.run!.id!
      unwrapAstraFlowApiResult(
        await cloudWorkerServiceAppendRunEvents({
          headers: workerHeaders(),
          path: { runId },
          body: {
            runId,
            workerId,
            leaseToken: this.lease.leaseToken,
            events: batch,
            runStatus: status,
            runtimeSessionRef,
            errorCode: status === "failed" ? "CLOUD_RUN_FAILED" : undefined,
            errorMessage:
              status === "failed" ? error?.slice(0, 2_000) : undefined,
          },
          signal: AbortSignal.timeout(15_000),
        }),
        "Cloud Agent events could not be uploaded."
      )
      this.pending.splice(0, batch.length)
      this.lastKnownStatus = status
    }
  }
}

async function claimWorkspace() {
  const result = await cloudWorkerServiceClaimWorkspace({
    headers: workerHeaders(),
    body: { workerId, leaseSeconds: WORKER_LEASE_SECONDS },
    signal: AbortSignal.timeout(10_000),
  })
  if (result.data) return result.data
  if (result.response?.status === 404) return null
  return unwrapAstraFlowApiResult(
    result,
    "Cloud workspace queue is unavailable."
  )
}

async function claimRun() {
  const result = await cloudWorkerServiceClaimRun({
    headers: workerHeaders(),
    body: { workerId, leaseSeconds: WORKER_LEASE_SECONDS },
    signal: AbortSignal.timeout(10_000),
  })
  if (result.data) return result.data
  if (result.response?.status === 404) return null
  return unwrapAstraFlowApiResult(result, "Cloud run queue is unavailable.")
}

function agentMessages(
  messages: AstraflowV1Message[],
  artifacts: AstraflowV1CloudRunLease["artifacts"]
): AgentMessage[] {
  const result = messages.flatMap((message): AgentMessage[] => {
    if (
      !message.role ||
      !["user", "assistant", "system", "tool"].includes(message.role)
    )
      return []
    const content = messageContent(message)
    if (!content) return []
    return [
      {
        id: message.id,
        role: message.role as AgentMessage["role"],
        content,
      },
    ]
  })
  if (artifacts?.length) {
    result.push({
      role: "system",
      content: [
        "User-provided task attachments were explicitly uploaded and verified.",
        ...artifacts.map(
          (artifact) =>
            `- /workspace/.astraflow/attachments/${safeFileName(artifact.fileName || artifact.id || "attachment")} (${artifact.mimeType || "application/octet-stream"}, sha256 ${artifact.sha256 || "unknown"})`
        ),
      ].join("\n"),
    })
  }
  return result
}

function messageContent(message: AstraflowV1Message) {
  const content = asRecord(message.content)
  const direct = readString(content.text) || readString(content.content)
  if (direct) return direct
  return (message.parts ?? [])
    .map(
      (part) =>
        readString(asRecord(part).text) || readString(asRecord(part).content)
    )
    .filter(Boolean)
    .join("\n")
}

function runtimeInfoFor(runtimeId: string): AgentRuntimeInfo {
  const id = runtimeId === "claude" ? "claude-code" : runtimeId
  const supported = ["astraflow", "codex", "claude-code", "opencode"]
  const normalized = supported.includes(id) ? id : "astraflow"
  return {
    id: normalized as AgentRuntimeInfo["id"],
    label: `Cloud ${normalized}`,
    description: "AstraFlow cloud Workspace Gateway runtime",
    capabilities: {
      hitl: true,
      resume: true,
      subagents: true,
      plan: true,
      sandbox: true,
      mcp: true,
      skills: true,
      compact: true,
    },
  }
}

function permissionMode(value?: string): StudioPermissionMode {
  if (value === "plan" || value === "readonly") return "readonly"
  if (value === "full" || value === "full_access") return "full_access"
  if (value === "auto") return "auto"
  return "ask"
}

function reasoningEffort(value?: string): ChatReasoningEffort | undefined {
  return [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "enabled",
  ].includes(value || "")
    ? (value as ChatReasoningEffort)
    : undefined
}

function terminalStatus(value: string) {
  return ["completed", "failed", "cancelled"].includes(value)
}

function workerHeaders() {
  return { Authorization: `Bearer ${workerToken}`, Accept: "application/json" }
}

function validateConfiguration() {
  const missing = [
    ["ASTRAFLOW_CLOUD_WORKER_TOKEN", workerToken],
    [
      "ASTRAFLOW_CLOUD_SANDBOX_API_KEY",
      process.env.ASTRAFLOW_CLOUD_SANDBOX_API_KEY || process.env.E2B_API_KEY,
    ],
    [
      "ASTRAFLOW_CLOUD_MODELVERSE_API_KEY",
      process.env.ASTRAFLOW_CLOUD_MODELVERSE_API_KEY,
    ],
  ].filter(([, value]) => !value?.trim())
  if (missing.length) {
    throw new Error(
      `Missing cloud worker configuration: ${missing.map(([name]) => name).join(", ")}`
    )
  }
}

function isUserInputAnswer(value: unknown): value is AgentUserInputAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { questionId?: unknown }).questionId === "string"
  )
}

function safeJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function safeFileName(value: string) {
  return value.replace(/[\\/\u0000\r\n]/g, "-").slice(0, 180)
}

function outputKind(fileName: string) {
  const mime = outputMimeType(fileName)
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  return "file"
}

function outputMimeType(fileName: string) {
  const extension = fileName.toLowerCase().split(".").pop() || ""
  const types: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    py: "text/x-python",
    go: "text/x-go",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
  }
  return types[extension] || "application/octet-stream"
}

function stop() {
  stopping = true
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
