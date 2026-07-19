import { randomUUID } from "node:crypto"

import { unwrapAstraFlowApiResult } from "@/lib/astraflow-api"
import {
  crossDeviceServiceAppendAgentRunEvents,
  crossDeviceServiceCreateAgentRun,
  crossDeviceServiceResolveAgentAction,
} from "@/lib/generated/astraflow-api"
import {
  getStudioChatRunLiveSnapshot,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import type { StudioSession } from "@/lib/studio-types"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

import { getOrCreateDesktopDeviceIdentity } from "./device-identity"
import {
  DesktopRunEventUploader,
  registerDesktopRunSession,
} from "./device-relay-runtime"
import { uploadDesktopRunArtifacts } from "./desktop-return-artifacts"
import { runSyncCycle } from "./sync-coordinator"

export async function createDesktopOriginRun({
  session,
  runtimeId,
  model,
  reasoningEffort,
  permissionMode,
  returnArtifacts,
}: {
  session: StudioSession
  runtimeId: string
  model: string
  reasoningEffort?: string
  permissionMode: string
  returnArtifacts: boolean
}) {
  const tokens = await ensureValidStudioOAuthTokens()
  if (!tokens?.accessToken) throw new Error("UCloud OAuth login is required.")
  const authorization = `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`
  const identity = getOrCreateDesktopDeviceIdentity()
  await runSyncCycle()
  const runId = randomUUID()
  const run = unwrapAstraFlowApiResult(
    await crossDeviceServiceCreateAgentRun({
      headers: authHeaders(authorization),
      body: {
        runId,
        sessionId: session.id,
        executionTarget: "desktop",
        targetDeviceId: identity.deviceId,
        workspaceId: session.workspaceId ?? undefined,
        runtimeId,
        model,
        reasoningEffort,
        permissionMode,
        returnArtifacts,
        dispatchMode: "local_origin",
        sourceDeviceId: identity.deviceId,
        clientMutationId: `desktop-origin-run:${runId}`,
      },
      signal: AbortSignal.timeout(15_000),
    }),
    "Could not create the shared channel Agent run."
  )
  if (!run.id) throw new Error("Shared channel Agent run ID is missing.")
  return {
    authorization,
    deviceId: identity.deviceId,
    runId: run.id,
    lastEventSeq: Number(run.lastEventSeq ?? 0),
    returnArtifacts,
  }
}

export function mirrorDesktopOriginRun({
  session,
  run,
}: {
  session: StudioSession
  run: Awaited<ReturnType<typeof createDesktopOriginRun>>
}) {
  const uploader = new DesktopRunEventUploader(
    run.authorization,
    run.deviceId,
    run.runId,
    run.lastEventSeq
  )
  let finished = false
  let unsubscribe = () => {}
  const unregisterRun = registerDesktopRunSession(run.runId, session.id)
  const capture = async (
    snapshot: NonNullable<ReturnType<typeof getStudioChatRunLiveSnapshot>>
  ) => {
    if (finished) return
    if (!isTerminal(snapshot.status)) {
      uploader.capture(snapshot)
      return
    }
    finished = true
    unsubscribe()
    unregisterRun()
    if (snapshot.status === "complete" && run.returnArtifacts) {
      try {
        uploader.recordArtifactResult(
          await uploadDesktopRunArtifacts({
            authorization: run.authorization,
            deviceId: run.deviceId,
            runId: run.runId,
            session,
            parts: snapshot.message?.parts ?? [],
          })
        )
      } catch (error) {
        uploader.recordArtifactError(errorMessage(error))
      }
    }
    uploader.capture(snapshot)
    await uploader.finish(snapshot)
  }
  unsubscribe = subscribeStudioChatRun(session.id, (snapshot) => {
    void capture(snapshot).catch((error) =>
      console.warn(
        "[cross-device] channel run mirror failed:",
        errorMessage(error)
      )
    )
  })
  const current = getStudioChatRunLiveSnapshot(session.id)
  if (current) void capture(current)
  return unsubscribe
}

export async function failDesktopOriginRun(
  run: Awaited<ReturnType<typeof createDesktopOriginRun>>,
  error: unknown
) {
  unwrapAstraFlowApiResult(
    await crossDeviceServiceAppendAgentRunEvents({
      headers: authHeaders(run.authorization),
      path: { runId: run.runId },
      body: {
        runId: run.runId,
        runStatus: "failed",
        errorCode: "DESKTOP_RUN_START_FAILED",
        errorMessage: errorMessage(error),
        events: [
          {
            eventId: randomUUID(),
            seq: String(run.lastEventSeq + 1),
            type: "agent.run.start_failed",
            payload: { error_code: "DESKTOP_RUN_START_FAILED" },
            producerType: "desktop",
            producerId: run.deviceId,
            occurredAt: new Date().toISOString(),
          },
        ],
      },
      signal: AbortSignal.timeout(10_000),
    }),
    "Could not mark the shared channel Agent run as failed."
  )
}

export async function resolveDesktopOriginPermission({
  runId,
  actionId,
  resolution,
  optionId,
}: {
  runId: string
  actionId: string
  resolution: "approved" | "denied"
  optionId: string
}) {
  const tokens = await ensureValidStudioOAuthTokens()
  if (!tokens?.accessToken) throw new Error("UCloud OAuth login is required.")
  const authorization = `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`
  const identity = getOrCreateDesktopDeviceIdentity()
  return unwrapAstraFlowApiResult(
    await crossDeviceServiceResolveAgentAction({
      headers: authHeaders(authorization),
      path: { runId, actionId },
      body: {
        runId,
        actionId,
        expectedVersion: "1",
        resolution,
        payload: { option_id: optionId },
        sourceDeviceId: identity.deviceId,
        clientMutationId: `desktop-channel-action:${randomUUID()}`,
      },
      signal: AbortSignal.timeout(10_000),
    }),
    "The shared Agent action could not be resolved."
  )
}

function isTerminal(status: string) {
  return status === "complete" || status === "error" || status === "cancelled"
}

function authHeaders(authorization: string) {
  return { Accept: "application/json", Authorization: authorization }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
