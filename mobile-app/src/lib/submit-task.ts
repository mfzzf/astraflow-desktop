import {
  crossDeviceServiceCreateAgentRun,
  crossDeviceServiceCreateMessage,
  crossDeviceServiceCreateSession,
  crossDeviceServiceCreateWorkspace,
  type AstraflowV1AgentRun,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import {
  cleanupTaskAttachments,
  type LocalAttachment,
  uploadTaskAttachments,
} from "@/lib/attachments"
import { createId } from "@/lib/ids"
import {
  completeOutbox,
  enqueueOutbox,
  failOutbox,
  type MobileOutboxItem,
} from "@/lib/mobile-db"

export type NewTaskPayload = {
  taskId: string
  sessionId: string
  messageId: string
  runId: string
  prompt: string
  title: string
  executionTarget: "desktop" | "cloud"
  targetDeviceId?: string
  workspaceId?: string
  createWorkspace?: { id: string; name: string }
  runtimeId: string
  model: string
  permissionMode: string
  returnArtifacts: boolean
  sourceDeviceId: string
  attachments: LocalAttachment[]
  createdAt: string
}

export function createTaskPayload(
  input: Omit<
    NewTaskPayload,
    "taskId" | "sessionId" | "messageId" | "runId" | "createdAt"
  >
): NewTaskPayload {
  return {
    ...input,
    attachments: input.attachments ?? [],
    taskId: createId("task"),
    sessionId: createId("session"),
    messageId: createId("message"),
    runId: createId("run"),
    createdAt: new Date().toISOString(),
  }
}

export async function executeNewTask(
  authorization: string,
  payload: NewTaskPayload
) {
  const headers = authorizationHeaders(authorization)
  if (payload.createWorkspace) {
    await crossDeviceServiceCreateWorkspace({
      headers,
      body: {
        workspaceId: payload.createWorkspace.id,
        type: "sandbox",
        name: payload.createWorkspace.name,
        gatewayProtocolVersion: 1,
        sourceDeviceId: payload.sourceDeviceId,
        clientMutationId: `${payload.taskId}:workspace`,
      },
    }).then((result) => requireApiData(result, "创建云端 Workspace 失败。"))
  }
  await crossDeviceServiceCreateSession({
    headers,
    body: {
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      mode: "chat",
      title: payload.title,
      runtimeId: payload.runtimeId,
      model: payload.model,
      permissionMode: payload.permissionMode,
      sourceDeviceId: payload.sourceDeviceId,
      clientMutationId: `${payload.taskId}:session`,
    },
  }).then((result) => requireApiData(result, "创建任务会话失败。"))

  const artifacts = await uploadTaskAttachments(authorization, {
    taskId: payload.taskId,
    sessionId: payload.sessionId,
    runId: "",
    sourceDeviceId: payload.sourceDeviceId,
    attachments: payload.attachments ?? [],
  })

  await crossDeviceServiceCreateMessage({
    headers,
    path: { sessionId: payload.sessionId },
    body: {
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      role: "user",
      status: "completed",
      content: {
        text: payload.prompt,
        artifacts: artifacts.map(artifactMessageReference),
      },
      parts: [
        { type: "text", text: payload.prompt },
        ...artifacts.map((artifact) => ({
          type: "file",
          ...artifactMessageReference(artifact),
        })),
      ],
      sourceDeviceId: payload.sourceDeviceId,
      clientMutationId: `${payload.taskId}:message`,
    },
  }).then((result) => requireApiData(result, "保存任务消息失败。"))

  const run = requireApiData<AstraflowV1AgentRun>(
    await crossDeviceServiceCreateAgentRun({
      headers,
      body: {
        runId: payload.runId,
        sessionId: payload.sessionId,
        executionTarget: payload.executionTarget,
        targetDeviceId: payload.targetDeviceId,
        workspaceId: payload.workspaceId,
        runtimeId: payload.runtimeId,
        model: payload.model,
        permissionMode: payload.permissionMode,
        returnArtifacts: payload.returnArtifacts,
        sourceDeviceId: payload.sourceDeviceId,
        clientMutationId: `${payload.taskId}:run`,
      },
    }),
    "启动 Agent Run 失败。"
  )
  await cleanupTaskAttachments(payload.attachments ?? [])
  return run
}

export async function queueNewTask(payload: NewTaskPayload) {
  await enqueueOutbox(payload.taskId, "new_task", payload)
}

function artifactMessageReference(artifact: {
  id?: string
  fileName?: string
  mimeType?: string
  size?: string
  sha256?: string
}) {
  return {
    artifactId: artifact.id,
    name: artifact.fileName,
    mimeType: artifact.mimeType,
    size: artifact.size,
    sha256: artifact.sha256,
  }
}

export async function processTaskOutboxItem(
  authorization: string,
  item: MobileOutboxItem
) {
  if (item.operation !== "new_task") return
  try {
    await executeNewTask(authorization, item.payload as NewTaskPayload)
    await completeOutbox(item.id)
  } catch (error) {
    await failOutbox(item, error)
    throw error
  }
}
