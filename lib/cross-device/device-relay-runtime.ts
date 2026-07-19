import { createPrivateKey, randomUUID, sign } from "node:crypto"

import { WebSocket } from "ws"

import { resolvePermission } from "@/lib/agent/permission-broker"
import { resolveUserInput } from "@/lib/agent/user-input-broker"
import {
  AstraFlowApiError,
  getAstraFlowApiBaseUrl,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import {
  DEFAULT_CHAT_MODEL,
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import {
  crossDeviceServiceAppendAgentRunEvents,
  crossDeviceServiceCreateDeviceConnectionToken,
  crossDeviceServiceGetAgentRun,
  type AstraflowV1AgentRunEvent,
} from "@/lib/generated/astraflow-api"
import {
  cancelStudioChatRun,
  getStudioChatRunLiveSnapshot,
  startStudioChatRun,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import {
  getDeviceCommandResult,
  getStudioDatabase,
  getStudioSession,
  hasProcessedDeviceCommand,
  acknowledgeStudioSyncOutbox,
  enqueueStudioSyncMutation,
  recordDeviceCommandResult,
  sanitizeForCrossDeviceSync,
} from "@/lib/studio-db"
import type {
  StudioChatRunLiveSnapshot,
  StudioMessagePart,
} from "@/lib/studio-types"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

import { getOrCreateDesktopDeviceIdentity } from "./device-identity"
import { materializeRemoteSessionArtifacts } from "./desktop-artifacts"
import { uploadDesktopRunArtifacts } from "./desktop-return-artifacts"
import { crossDeviceRunUsage } from "./run-usage"
import { runSyncCycle } from "./sync-coordinator"

type RelayCommand = {
  id: string
  runId: string
  type: string
  payload: Record<string, unknown>
  attempt: number
}

type RelayServerMessage = {
  type?: string
  protocolVersion?: number
  deviceId?: string
  challenge?: string
  heartbeatIntervalMs?: number
  command?: RelayCommand
}

declare global {
  var astraflowDeviceRelayRuntime: DeviceRelayRuntime | undefined
}

const desktopRunSessions = new Map<string, string>()
const relayRunIds = new Set<string>()

export function registerDesktopRunSession(runId: string, sessionId: string) {
  desktopRunSessions.set(runId, sessionId)
  return () => {
    if (desktopRunSessions.get(runId) === sessionId) {
      desktopRunSessions.delete(runId)
    }
  }
}

export async function ensureDeviceRelayStarted() {
  if (process.env.ASTRAFLOW_ELECTRON !== "1") return
  if (!globalThis.astraflowDeviceRelayRuntime) {
    globalThis.astraflowDeviceRelayRuntime = new DeviceRelayRuntime()
  }
  globalThis.astraflowDeviceRelayRuntime.start()
}

class DeviceRelayRuntime {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectAttempt = 0
  private started = false

  start() {
    if (this.started) return
    this.started = true
    void this.connect()
  }

  private async connect() {
    try {
      const authorization = await currentAuthorization()
      if (!authorization) {
        this.scheduleReconnect()
        return
      }
      const identity = getOrCreateDesktopDeviceIdentity()
      const token = unwrapAstraFlowApiResult(
        await crossDeviceServiceCreateDeviceConnectionToken({
          headers: authHeaders(authorization),
          path: { deviceId: identity.deviceId },
          body: { deviceId: identity.deviceId },
          signal: AbortSignal.timeout(10_000),
        }),
        "Device connection token could not be created."
      )
      if (!token.token || !token.websocketPath) {
        throw new Error("Device connection token response is incomplete.")
      }
      const relayUrl = new URL(
        `${getAstraFlowApiBaseUrl()}${token.websocketPath}`
      )
      relayUrl.protocol = relayUrl.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(relayUrl, {
        headers: { Authorization: `Device ${token.token}` },
        handshakeTimeout: 10_000,
        maxPayload: 256 * 1024,
      })
      this.socket = socket
      socket.on("message", (data) => void this.onMessage(socket, data))
      socket.once("close", (code, reason) =>
        this.onClose(socket, code, reason.toString())
      )
      // `ws` emits `close` after transport errors. Let that event own cleanup
      // so a preceding `error` cannot hide a policy close and its revoke reason.
      socket.once("error", () => undefined)
    } catch (error) {
      if (error instanceof AstraFlowApiError && error.status === 404) {
        this.stopForRevocation()
        return
      }
      console.warn(
        "[device-relay] connection failed:",
        error instanceof Error ? error.message : String(error)
      )
      this.scheduleReconnect()
    }
  }

  private async onMessage(socket: WebSocket, raw: WebSocket.RawData) {
    let message: RelayServerMessage
    try {
      message = JSON.parse(raw.toString()) as RelayServerMessage
    } catch {
      socket.close(1003, "invalid JSON")
      return
    }
    if (message.type === "server.challenge") {
      const identity = getOrCreateDesktopDeviceIdentity()
      if (
        message.protocolVersion !== 1 ||
        message.deviceId !== identity.deviceId ||
        !message.challenge
      ) {
        socket.close(1008, "incompatible challenge")
        return
      }
      const signed = Buffer.from(
        `astraflow-device-relay-v1:${identity.deviceId}:${message.challenge}`
      )
      const signature = sign(
        null,
        signed,
        createPrivateKey(identity.privateKey)
      ).toString("base64")
      socket.send(JSON.stringify({ type: "client.authenticate", signature }))
      return
    }
    if (message.type === "server.ready") {
      this.reconnectAttempt = 0
      this.startHeartbeat(socket, message.heartbeatIntervalMs)
      return
    }
    if (message.type === "server.heartbeat") {
      this.send(socket, { type: "client.heartbeat" })
      return
    }
    if (message.type === "server.command" && message.command) {
      void this.handleCommand(socket, message.command)
    }
  }

  private async handleCommand(socket: WebSocket, command: RelayCommand) {
    if (!command.id || !command.type) return
    if (hasProcessedDeviceCommand(command.id)) {
      const previous = getDeviceCommandResult(command.id)
      if (
        (previous?.status === "received" || previous?.status === "running") &&
        command.runId &&
        !desktopRunSessions.has(command.runId)
      ) {
        const result = {
          error_code: "DESKTOP_RUN_INTERRUPTED",
          error: "Desktop restarted before the command completed.",
        }
        recordDeviceCommandResult(command.id, "failed", result)
        this.sendCommandStatus(socket, command.id, "failed", result)
        return
      }
      this.sendCommandStatus(
        socket,
        command.id,
        previous?.status === "failed"
          ? "failed"
          : previous?.status === "completed"
            ? "completed"
            : "acknowledged",
        previous?.result ?? {}
      )
      return
    }
    recordDeviceCommandResult(command.id, "received")
    this.sendCommandStatus(socket, command.id, "acknowledged")
    recordDeviceCommandResult(command.id, "running")
    try {
      if (command.type === "start_run") {
        await this.startRemoteRun(socket, command)
        return
      }
      if (command.type === "cancel_run") {
        const sessionId = desktopRunSessions.get(command.runId)
        if (sessionId) cancelStudioChatRun(sessionId)
      } else if (command.type === "resolve_action") {
        this.resolveRemoteAction(command)
      } else {
        throw new Error(`Unsupported device command: ${command.type}`)
      }
      recordDeviceCommandResult(command.id, "completed", { ok: true })
      this.sendCommandStatus(socket, command.id, "completed", { ok: true })
    } catch (error) {
      console.warn("[device-relay] command failed:", errorMessage(error))
      const result = {
        error_code: "DESKTOP_COMMAND_FAILED",
        error: "Desktop could not complete the requested command.",
      }
      recordDeviceCommandResult(command.id, "failed", result)
      this.sendCommandStatus(socket, command.id, "failed", result)
    }
  }

  private async startRemoteRun(socket: WebSocket, command: RelayCommand) {
    await runSyncCycle()
    const sessionId = readString(command.payload.session_id)
    const session = getStudioSession(sessionId)
    if (!session) throw new Error("Synced session is not available on Desktop.")
    const authorization = await currentAuthorization()
    if (!authorization) throw new Error("UCloud OAuth login is required.")
    const targetWorkspaceId = readString(command.payload.workspace_id)
    if (!targetWorkspaceId || session.workspaceId !== targetWorkspaceId) {
      throw new Error(
        "The requested Mac workspace is unavailable or no longer matches this session."
      )
    }
    await materializeRemoteSessionArtifacts({ authorization, sessionId })
    const identity = getOrCreateDesktopDeviceIdentity()
    const uploader = new DesktopRunEventUploader(
      authorization,
      identity.deviceId,
      command.runId,
      readNumber(command.payload.last_event_seq)
    )
    const unregisterRun = registerDesktopRunSession(command.runId, sessionId)
    relayRunIds.add(command.runId)
    let run
    try {
      run = await startStudioChatRun({
        sessionId,
        runId: command.runId,
        model:
          readString(command.payload.model) ||
          session.chatModel ||
          DEFAULT_CHAT_MODEL,
        runtimeId:
          readString(command.payload.runtime_id) ||
          session.chatRuntimeId ||
          "astraflow",
        reasoningEffort: reasoningEffort(
          readString(command.payload.reasoning_effort) ||
            session.chatReasoningEffort
        ),
        environment: "local",
      })
    } catch (error) {
      relayRunIds.delete(command.runId)
      unregisterRun()
      throw error
    }
    if (run.runId !== command.runId) {
      relayRunIds.delete(command.runId)
      unregisterRun()
      throw new Error("Another Agent run is already active in this session.")
    }
    let unsubscribe = () => {}
    const finish = async (snapshot: StudioChatRunLiveSnapshot) => {
      if (!terminalSnapshot(snapshot)) {
        uploader.capture(snapshot)
        return
      }
      unsubscribe()
      if (
        snapshot.status === "complete" &&
        readBoolean(command.payload.return_artifacts)
      ) {
        try {
          const result = await uploadDesktopRunArtifacts({
            authorization,
            deviceId: identity.deviceId,
            runId: command.runId,
            session,
            parts: snapshot.message?.parts ?? [],
          })
          uploader.recordArtifactResult(result)
        } catch (error) {
          uploader.recordArtifactError(errorMessage(error))
        }
      }
      uploader.capture(snapshot)
      await uploader.finish(snapshot)
      const failed = snapshot.status === "error"
      const result = {
        runId: command.runId,
        status: snapshot.status,
        error: snapshot.error,
      }
      recordDeviceCommandResult(
        command.id,
        failed ? "failed" : "completed",
        result
      )
      this.sendCommandStatus(
        socket,
        command.id,
        failed ? "failed" : "completed",
        result
      )
      unregisterRun()
      relayRunIds.delete(command.runId)
    }
    const failFinishedRun = (error: unknown) => {
      console.warn(
        "[device-relay] terminal event upload failed:",
        errorMessage(error)
      )
      const result = {
        error_code: "DESKTOP_EVENT_UPLOAD_FAILED",
        error: "Desktop could not synchronize the terminal Agent events.",
      }
      recordDeviceCommandResult(command.id, "failed", result)
      this.sendCommandStatus(socket, command.id, "failed", result)
      unregisterRun()
      relayRunIds.delete(command.runId)
    }
    unsubscribe = subscribeStudioChatRun(sessionId, (snapshot) => {
      void finish(snapshot).catch(failFinishedRun)
    })
    const current = getStudioChatRunLiveSnapshot(sessionId)
    if (current) void finish(current).catch(failFinishedRun)
  }

  private resolveRemoteAction(command: RelayCommand) {
    const sessionId = desktopRunSessions.get(command.runId)
    if (!sessionId) throw new Error("Remote run is not active on Desktop.")
    const snapshot = getStudioChatRunLiveSnapshot(sessionId)
    const actionId = readString(command.payload.id)
    const part = snapshot?.message?.parts.find(
      (candidate) => candidate.id === actionId
    )
    if (!part) throw new Error("Pending Agent action was not found.")
    const resolution = isRecord(command.payload.resolution)
      ? command.payload.resolution
      : {}
    const status = readString(command.payload.status)
    if (part.type === "permission") {
      const requestedOption = readString(resolution.option_id)
      const option =
        part.options.find(
          (candidate) => candidate.optionId === requestedOption
        ) ??
        part.options.find((candidate) =>
          status === "denied"
            ? candidate.kind.startsWith("reject")
            : candidate.kind === "allow_once" ||
              candidate.kind.startsWith("allow")
        )
      if (!option || !resolvePermission(sessionId, part.id, option.optionId)) {
        throw new Error("Permission action could not be resolved.")
      }
      return
    }
    if (part.type === "user_input") {
      const answers = Array.isArray(resolution.answers)
        ? resolution.answers.filter(isUserInputAnswer)
        : []
      if (
        !resolveUserInput(
          sessionId,
          part.id,
          answers,
          resolution.cancelled === true
        )
      ) {
        throw new Error("User input action could not be resolved.")
      }
      return
    }
    throw new Error("Agent action type is not remotely resolvable.")
  }

  private startHeartbeat(socket: WebSocket, interval?: number) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(
      () => this.send(socket, { type: "client.heartbeat" }),
      Math.max(5_000, interval || 20_000)
    )
    unrefTimer(this.heartbeatTimer)
  }

  private sendCommandStatus(
    socket: WebSocket,
    commandId: string,
    status: "acknowledged" | "completed" | "failed",
    result: Record<string, unknown> = {}
  ) {
    this.send(socket, {
      type: "client.command_status",
      commandId,
      status,
      result,
    })
  }

  private send(socket: WebSocket, payload: Record<string, unknown>) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  private onClose(socket: WebSocket, code?: number, reason?: string) {
    if (this.socket !== socket) return
    this.socket = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    if (code === 1008 && reason === "device access revoked") {
      this.stopForRevocation()
      return
    }
    this.scheduleReconnect()
  }

  private stopForRevocation() {
    for (const runId of relayRunIds) {
      const sessionId = desktopRunSessions.get(runId)
      if (sessionId) cancelStudioChatRun(sessionId)
    }
    // Revocation requires an explicit device re-registration. Do not keep
    // retrying with an identity that the account has deliberately disabled.
    this.started = false
  }

  private scheduleReconnect() {
    if (!this.started || this.reconnectTimer) return
    const delay = Math.min(60_000, 1_000 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
    unrefTimer(this.reconnectTimer)
  }
}

export class DesktopRunEventUploader {
  private nextSeq: number
  private readonly pending: AstraflowV1AgentRunEvent[] = []
  private readonly seenActions = new Set<string>()
  private latest: StudioChatRunLiveSnapshot | null = null
  private captureTimer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null

  constructor(
    private readonly authorization: string,
    private readonly deviceId: string,
    private readonly runId: string,
    lastEventSeq: number
  ) {
    this.nextSeq = lastEventSeq + 1
  }

  capture(snapshot: StudioChatRunLiveSnapshot) {
    this.latest = snapshot
    this.captureActions(snapshot.message?.parts ?? [])
    if (terminalSnapshot(snapshot)) {
      this.enqueueSnapshot(snapshot)
      void this.flush()
      return
    }
    if (this.captureTimer) return
    this.captureTimer = setTimeout(() => {
      this.captureTimer = null
      if (this.latest) this.enqueueSnapshot(this.latest)
      void this.flush()
    }, 350)
    unrefTimer(this.captureTimer)
  }

  async finish(snapshot: StudioChatRunLiveSnapshot) {
    if (this.captureTimer) clearTimeout(this.captureTimer)
    this.captureTimer = null
    this.latest = snapshot
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.flush()
      if (this.pending.length === 0) return
      await delay(500 * 2 ** attempt)
    }
    throw new Error("Desktop Agent events remained unsynchronized.")
  }

  recordArtifactResult(result: {
    uploaded: number
    skipped: number
    totalBytes: number
  }) {
    this.enqueue("agent.artifacts.completed", result)
  }

  recordArtifactError(message: string) {
    this.enqueue("agent.artifacts.failed", {
      error_code: "DESKTOP_ARTIFACT_UPLOAD_FAILED",
      error_message: message,
    })
  }

  private captureActions(parts: StudioMessagePart[]) {
    for (const part of parts) {
      if (
        (part.type !== "permission" && part.type !== "user_input") ||
        part.status !== "pending" ||
        this.seenActions.has(part.id)
      ) {
        continue
      }
      this.seenActions.add(part.id)
      this.enqueue(
        part.type === "permission"
          ? "agent.permission.requested"
          : "agent.user_input.requested",
        {
          action_id: part.id,
          request: sanitizeForCrossDeviceSync(part),
        }
      )
    }
  }

  private enqueueSnapshot(snapshot: StudioChatRunLiveSnapshot) {
    this.enqueue("agent.run.snapshot", {
      run_id: snapshot.runId,
      session_id: snapshot.sessionId,
      assistant_message_id: snapshot.assistantMessageId,
      status: snapshot.status,
      error: snapshot.error,
      usage: crossDeviceRunUsage(snapshot.usage),
      message: snapshot.message
        ? {
            id: snapshot.message.id,
            content: snapshot.message.content,
            status: snapshot.message.status,
            parts: sanitizeForCrossDeviceSync(snapshot.message.parts),
          }
        : null,
      updated_at: snapshot.updatedAt,
    })
  }

  private enqueue(type: string, payload: Record<string, unknown>) {
    const eventId = randomUUID()
    const event: AstraflowV1AgentRunEvent = {
      eventId,
      seq: String(this.nextSeq),
      type,
      payload,
      producerType: "desktop",
      producerId: this.deviceId,
      occurredAt: new Date().toISOString(),
    }
    this.pending.push(event)
    enqueueStudioSyncMutation(getStudioDatabase(), {
      id: eventId,
      entityType: "agent_run_event",
      entityId: this.runId,
      operation: "append",
      payload: {
        runId: this.runId,
        event,
        runStatus: this.latest
          ? backendRunStatus(this.latest.status)
          : "running",
        errorCode:
          this.latest?.status === "error" ? "DESKTOP_RUN_FAILED" : undefined,
        errorMessage: this.latest?.error ?? undefined,
      },
    })
    this.nextSeq += 1
  }

  private async flush() {
    if (this.flushing) return this.flushing
    if (this.pending.length === 0) return
    this.flushing = (async () => {
      const batch = this.pending.slice(0, 100)
      const latest = this.latest
      try {
        unwrapAstraFlowApiResult(
          await crossDeviceServiceAppendAgentRunEvents({
            headers: authHeaders(this.authorization),
            path: { runId: this.runId },
            body: {
              runId: this.runId,
              events: batch,
              runStatus: latest ? backendRunStatus(latest.status) : undefined,
              errorCode:
                latest?.status === "error" ? "DESKTOP_RUN_FAILED" : undefined,
              errorMessage: latest?.error ?? undefined,
            },
            signal: AbortSignal.timeout(10_000),
          }),
          "Desktop Agent events could not be uploaded."
        )
        this.pending.splice(0, batch.length)
        for (const event of batch) {
          if (event.eventId) {
            acknowledgeStudioSyncOutbox(
              event.eventId,
              "agent_run_event",
              this.runId
            )
          }
        }
      } catch (error) {
        if (latest?.status === "cancelled") {
          try {
            const run = unwrapAstraFlowApiResult(
              await crossDeviceServiceGetAgentRun({
                headers: authHeaders(this.authorization),
                path: { runId: this.runId },
                signal: AbortSignal.timeout(10_000),
              }),
              "Cancelled Desktop run state could not be checked."
            )
            if (run.status === "cancelled") {
              this.pending.splice(0, batch.length)
              return
            }
          } catch {
            // Retain the batch and use the normal retry path below.
          }
        }
        console.warn(
          "[device-relay] event upload failed:",
          error instanceof Error ? error.message : String(error)
        )
      }
    })().finally(() => {
      this.flushing = null
      if (
        this.pending.length > 0 &&
        this.latest &&
        !terminalSnapshot(this.latest)
      ) {
        this.capture(this.latest)
      }
    })
    return this.flushing
  }
}

function terminalSnapshot(snapshot: StudioChatRunLiveSnapshot) {
  return (
    snapshot.status === "complete" ||
    snapshot.status === "error" ||
    snapshot.status === "cancelled"
  )
}

function backendRunStatus(status: StudioChatRunLiveSnapshot["status"]) {
  if (status === "complete") return "completed"
  if (status === "error") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "queued") return "waiting_device"
  return "running"
}

function reasoningEffort(
  value: string | null
): ChatReasoningEffort | undefined {
  return SUPPORTED_CHAT_REASONING_EFFORTS.includes(value as ChatReasoningEffort)
    ? (value as ChatReasoningEffort)
    : undefined
}

async function currentAuthorization() {
  const tokens = await ensureValidStudioOAuthTokens()
  return tokens?.accessToken
    ? `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`
    : null
}

function authHeaders(authorization: string) {
  return { Accept: "application/json", Authorization: authorization }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUserInputAnswer(value: unknown): value is {
  questionId: string
  optionId: string | null
  label: string | null
  text: string
} {
  return isRecord(value) && typeof value.questionId === "string"
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readBoolean(value: unknown) {
  return value === true
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function unrefTimer(timer: ReturnType<typeof setTimeout>) {
  ;(timer as unknown as { unref?: () => void }).unref?.()
}
