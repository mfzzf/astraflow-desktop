import "server-only"

import { resolvePermission } from "@/lib/agent/permission-broker"
import { resolveAgentModelForRuntime } from "@/lib/agent-model-settings"
import {
  DEFAULT_CHAT_MODEL,
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import {
  createStudioMessage,
  createStudioSession,
  getStudioSession,
  updateStudioSessionChatPreferences,
  updateStudioSessionProject,
} from "@/lib/studio-db"
import {
  cancelStudioChatRun,
  getStudioChatRun,
  getStudioChatRunLiveSnapshot,
  startStudioChatRun,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import type { StudioMediaGenerationOutput } from "@/lib/studio-types"
import { listStudioVideoGenerations } from "@/lib/studio-video-db"
import type { StudioVideoOutput } from "@/lib/studio-video-types"

import { errorMessage } from "./http"
import {
  resolveGeneratedMobileChannelImage,
  resolveGeneratedMobileChannelVideo,
} from "./media"
import {
  consumeMobileChannelBindCode,
  getMobileChannelBinding,
  getMobileChannelConnection,
  recordMobileChannelEvent,
  saveMobileChannelBinding,
  updateMobileChannelBindingSession,
  updateMobileChannelConnectionMetadata,
} from "./store"
import type {
  MobileChannelBinding,
  MobileChannelInboundMessage,
  MobileChannelOutboundTarget,
} from "./types"
import {
  getMobileChannelUsageGuide,
  MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY,
} from "./usage-guide"

type SendText = (
  target: MobileChannelOutboundTarget,
  text: string
) => Promise<void>

type SendImage = (
  target: MobileChannelOutboundTarget,
  image: Awaited<ReturnType<typeof resolveGeneratedMobileChannelImage>>
) => Promise<void>

type SendVideo = (
  target: MobileChannelOutboundTarget,
  video: Awaited<ReturnType<typeof resolveGeneratedMobileChannelVideo>>
) => Promise<void>

const VIDEO_GENERATION_POLL_INTERVAL_MS = 2_500
const VIDEO_GENERATION_WATCH_TIMEOUT_MS = 30 * 60_000

function outboundTarget(
  message: MobileChannelInboundMessage
): MobileChannelOutboundTarget {
  return {
    connectionId: message.connectionId,
    provider: message.provider,
    externalUserId: message.externalUserId,
    conversationId: message.conversationId,
    replyContext: message.replyContext,
  }
}

async function safeSend(
  sendText: SendText,
  target: MobileChannelOutboundTarget,
  text: string
) {
  try {
    await sendText(target, text)
    return true
  } catch (error) {
    console.error("[mobile-channels] outbound_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      error: errorMessage(error),
    })
    return false
  }
}

async function safeSendImage(
  sendText: SendText,
  sendImage: SendImage,
  target: MobileChannelOutboundTarget,
  output: Parameters<typeof resolveGeneratedMobileChannelImage>[0]
) {
  try {
    await sendImage(target, await resolveGeneratedMobileChannelImage(output))
  } catch (error) {
    console.error("[mobile-channels] outbound_image_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
      error: errorMessage(error),
    })
    await safeSend(
      sendText,
      target,
      `图片已生成，但发送失败：${errorMessage(error)}`
    )
  }
}

async function safeSendVideo(
  sendText: SendText,
  sendVideo: SendVideo,
  target: MobileChannelOutboundTarget,
  output: Parameters<typeof resolveGeneratedMobileChannelVideo>[0]
) {
  try {
    await sendVideo(target, await resolveGeneratedMobileChannelVideo(output))
  } catch (error) {
    console.error("[mobile-channels] outbound_video_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
      error: errorMessage(error),
    })
    await safeSend(
      sendText,
      target,
      `视频已生成，但发送失败：${errorMessage(error)}`
    )
  }
}

function toMobileVideoGenerationOutput(
  output: StudioVideoOutput
): StudioMediaGenerationOutput {
  return {
    id: output.id,
    index: output.index,
    contentUrl: `/api/studio/video-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
    durationSeconds: output.durationSeconds,
  }
}

function waitForVideoGenerationPoll() {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, VIDEO_GENERATION_POLL_INTERVAL_MS)
    timeout.unref()
  })
}

async function watchPendingVideoGenerations({
  sessionId,
  generationIds,
  sentVideos,
  target,
  sendText,
  sendVideo,
}: {
  sessionId: string
  generationIds: string[]
  sentVideos: Set<string>
  target: MobileChannelOutboundTarget
  sendText: SendText
  sendVideo: SendVideo
}) {
  const pendingGenerationIds = new Set(generationIds)
  const deadline = Date.now() + VIDEO_GENERATION_WATCH_TIMEOUT_MS

  await safeSend(sendText, target, "视频正在后台生成，完成后会自动发送。")

  while (pendingGenerationIds.size > 0 && Date.now() < deadline) {
    const generations = new Map(
      listStudioVideoGenerations(sessionId).map((generation) => [
        generation.id,
        generation,
      ])
    )

    for (const generationId of pendingGenerationIds) {
      const generation = generations.get(generationId)
      if (!generation) {
        continue
      }

      if (generation.status === "complete" || generation.status === "partial") {
        for (const storedOutput of generation.outputs) {
          if (sentVideos.has(storedOutput.id)) {
            continue
          }
          sentVideos.add(storedOutput.id)
          await safeSendVideo(
            sendText,
            sendVideo,
            target,
            toMobileVideoGenerationOutput(storedOutput)
          )
        }
        pendingGenerationIds.delete(generationId)
        continue
      }

      if (generation.status === "error" || generation.status === "cancelled") {
        pendingGenerationIds.delete(generationId)
        await safeSend(
          sendText,
          target,
          generation.status === "cancelled"
            ? "视频生成已取消。"
            : `视频生成失败：${generation.errorMessage || "服务返回未知错误。"}`
        )
      }
    }

    if (pendingGenerationIds.size > 0) {
      await waitForVideoGenerationPoll()
    }
  }

  if (pendingGenerationIds.size > 0) {
    await safeSend(
      sendText,
      target,
      "视频生成等待超时，请在桌面端打开当前会话查看结果。"
    )
  }
}

function activeBindingForMessage(message: MobileChannelInboundMessage) {
  return getMobileChannelBinding({
    connectionId: message.connectionId,
    externalUserId: message.externalUserId,
    conversationId: message.conversationId,
  })
}

async function authorizeMessage(
  message: MobileChannelInboundMessage,
  sendText: SendText
): Promise<MobileChannelBinding | null> {
  const target = outboundTarget(message)
  const connection = getMobileChannelConnection(message.connectionId)

  if (!connection?.enabled || !connection.credentials) {
    return null
  }

  const bindMatch = message.text.match(/^\/bind\s+([A-Z2-9]{6,12})$/i)
  if (bindMatch) {
    const pairing = consumeMobileChannelBindCode({
      connectionId: connection.id,
      code: bindMatch[1].toUpperCase(),
    })

    if (!pairing) {
      await safeSend(
        sendText,
        target,
        "绑定码无效或已过期，请在 AstraFlow 的「移动版」页面重新生成。"
      )
      return null
    }

    const binding = saveMobileChannelBinding({
      connectionId: connection.id,
      externalUserId: message.externalUserId,
      conversationId: message.conversationId,
    })
    await safeSend(
      sendText,
      target,
      getMobileChannelUsageGuide({
        provider: message.provider,
        connectionJustCompleted: true,
      })
    )
    return binding
  }

  const existing = activeBindingForMessage(message)
  if (existing) {
    return existing
  }

  if (
    connection.ownerExternalUserId &&
    connection.ownerExternalUserId === message.externalUserId
  ) {
    const binding = saveMobileChannelBinding({
      connectionId: connection.id,
      externalUserId: message.externalUserId,
      conversationId: message.conversationId,
    })
    if (
      !connection.metadata[MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY] &&
      !/^\/help\s*$/i.test(message.text)
    ) {
      const guideSent = await safeSend(
        sendText,
        target,
        getMobileChannelUsageGuide({
          provider: message.provider,
          connectionJustCompleted: true,
        })
      )
      if (guideSent) {
        updateMobileChannelConnectionMetadata(connection.id, {
          ...connection.metadata,
          [MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY]:
            new Date().toISOString(),
        })
      }
    }
    return binding
  }

  await safeSend(
    sendText,
    target,
    "此账号尚未绑定这台电脑。请在 AstraFlow 左侧打开「移动版」，完成扫码后发送页面中的绑定命令。"
  )
  return null
}

function ensureBindingSession(
  binding: MobileChannelBinding,
  message: MobileChannelInboundMessage
) {
  const connection = getMobileChannelConnection(binding.connectionId)
  const existingSession = binding.sessionId
    ? getStudioSession(binding.sessionId)
    : null

  if (existingSession) {
    if (
      connection?.defaultProjectId &&
      existingSession.projectId !== connection.defaultProjectId
    ) {
      return (
        updateStudioSessionProject(
          existingSession.id,
          connection.defaultProjectId
        ) ?? existingSession
      )
    }

    return existingSession
  }

  const senderLabel = message.senderName?.trim() || "移动端"
  const session = createStudioSession({
    mode: "chat",
    title: `${senderLabel} · ${new Date().toLocaleDateString("zh-CN")}`,
  })

  if (connection?.defaultProjectId) {
    updateStudioSessionProject(session.id, connection.defaultProjectId)
  }
  updateMobileChannelBindingSession(binding.id, session.id)

  return getStudioSession(session.id) ?? session
}

function resolvePermissionCommand({
  sessionId,
  command,
  requestId,
}: {
  sessionId: string
  command: "approve" | "always" | "deny"
  requestId: string
}) {
  const snapshot = getStudioChatRunLiveSnapshot(sessionId)
  const part = snapshot?.message?.parts.find(
    (candidate) =>
      candidate.type === "permission" &&
      candidate.id === requestId &&
      candidate.status === "pending"
  )

  if (!part || part.type !== "permission") {
    return false
  }

  const wantedKind =
    command === "approve"
      ? "allow_once"
      : command === "always"
        ? "allow_always"
        : "reject_once"
  const option =
    part.options.find((candidate) => candidate.kind === wantedKind) ??
    part.options.find((candidate) =>
      command === "deny"
        ? candidate.kind.startsWith("reject")
        : candidate.kind.startsWith("allow")
    )

  return option
    ? resolvePermission(sessionId, requestId, option.optionId)
    : false
}

function summarizeFinalMessage(
  content: string,
  status: string,
  error: string | null
) {
  if (status === "cancelled") {
    return "任务已停止。"
  }
  if (status === "error") {
    return `任务失败：${error || "运行时发生未知错误。"}`
  }

  const trimmed = content.trim()
  if (!trimmed) {
    return "任务已完成。"
  }

  return trimmed.length > 8_000
    ? `${trimmed.slice(0, 8_000)}\n\n…内容已截断`
    : trimmed
}

function watchRun({
  sessionId,
  target,
  sendText,
  sendImage,
  sendVideo,
}: {
  sessionId: string
  target: MobileChannelOutboundTarget
  sendText: SendText
  sendImage: SendImage
  sendVideo: SendVideo
}) {
  const sentPermissions = new Set<string>()
  const sentActivities = new Set<string>()
  const sentImages = new Set<string>()
  const sentVideos = new Set<string>()
  const pendingVideoGenerations = new Set<string>()
  let lastProgressAt = 0
  let progressCount = 0
  let finished = false
  let outboundMediaQueue = Promise.resolve()
  let unsubscribe = () => {}
  const handleSnapshot: Parameters<typeof subscribeStudioChatRun>[1] = (
    snapshot
  ) => {
    if (finished) {
      return
    }

    for (const activity of snapshot.message?.activities ?? []) {
      if (activity.status !== "running" || sentActivities.has(activity.id)) {
        continue
      }
      sentActivities.add(activity.id)
      if (progressCount >= 8 || Date.now() - lastProgressAt < 4_000) {
        continue
      }
      progressCount += 1
      lastProgressAt = Date.now()
      void safeSend(
        sendText,
        target,
        `正在执行：**${activity.toolName || "工具调用"}**`
      )
    }

    for (const part of snapshot.message?.parts ?? []) {
      if (
        part.type === "media_generation" &&
        part.kind === "image" &&
        ["complete", "partial"].includes(part.status)
      ) {
        for (const output of part.outputs) {
          if (sentImages.has(output.id)) {
            continue
          }
          sentImages.add(output.id)
          outboundMediaQueue = outboundMediaQueue.then(() =>
            safeSendImage(sendText, sendImage, target, output)
          )
        }
      }

      if (part.type === "media_generation" && part.kind === "video") {
        if (
          ["complete", "partial", "error", "cancelled"].includes(part.status)
        ) {
          pendingVideoGenerations.delete(part.generationId)
        } else {
          pendingVideoGenerations.add(part.generationId)
        }

        if (["complete", "partial"].includes(part.status)) {
          for (const output of part.outputs) {
            if (sentVideos.has(output.id)) {
              continue
            }
            sentVideos.add(output.id)
            outboundMediaQueue = outboundMediaQueue.then(() =>
              safeSendVideo(sendText, sendVideo, target, output)
            )
          }
        }
      }

      if (
        part.type !== "permission" ||
        part.status !== "pending" ||
        sentPermissions.has(part.id)
      ) {
        continue
      }
      sentPermissions.add(part.id)
      const preview = part.input.trim().slice(0, 1_500) || "无参数预览"
      void safeSend(
        sendText,
        target,
        [
          "**需要你的授权**",
          `工具：${part.toolName || "未知工具"}`,
          "```",
          preview,
          "```",
          `允许一次：\`/approve ${part.id}\``,
          `始终允许：\`/always ${part.id}\``,
          `拒绝：\`/deny ${part.id}\``,
        ].join("\n")
      )
    }

    if (["complete", "error", "cancelled"].includes(snapshot.status)) {
      finished = true
      unsubscribe()
      const finalMessage = outboundMediaQueue.then(() =>
        safeSend(
          sendText,
          target,
          summarizeFinalMessage(
            snapshot.message?.content ?? "",
            snapshot.status,
            snapshot.error
          )
        )
      )
      if (pendingVideoGenerations.size > 0) {
        const generationIds = Array.from(pendingVideoGenerations)
        void finalMessage
          .then(() =>
            watchPendingVideoGenerations({
              sessionId,
              generationIds,
              sentVideos,
              target,
              sendText,
              sendVideo,
            })
          )
          .catch(async (error) => {
            console.error("[mobile-channels] video_watch_failed", {
              sessionId,
              error: errorMessage(error),
            })
            await safeSend(
              sendText,
              target,
              `视频结果同步失败：${errorMessage(error)}`
            )
          })
      }
    }
  }

  unsubscribe = subscribeStudioChatRun(sessionId, handleSnapshot)
  const current = getStudioChatRunLiveSnapshot(sessionId)
  if (current) {
    handleSnapshot(current)
  }
}

async function handleCommand({
  binding,
  message,
  sendText,
}: {
  binding: MobileChannelBinding
  message: MobileChannelInboundMessage
  sendText: SendText
}) {
  const target = outboundTarget(message)
  const commandMatch = message.text.match(
    /^\/(help|new|status|stop|approve|always|deny)(?:\s+(.+))?$/i
  )

  if (!commandMatch) {
    return false
  }

  const command = commandMatch[1].toLowerCase()
  const argument = commandMatch[2]?.trim() ?? ""

  if (command === "help") {
    await safeSend(
      sendText,
      target,
      getMobileChannelUsageGuide({ provider: message.provider })
    )
    return true
  }

  if (command === "new") {
    if (binding.sessionId) {
      cancelStudioChatRun(binding.sessionId)
    }
    updateMobileChannelBindingSession(binding.id, null)
    await safeSend(sendText, target, "已新建移动会话，下一条消息会开始新任务。")
    return true
  }

  if (!binding.sessionId) {
    await safeSend(
      sendText,
      target,
      "当前还没有任务，直接发送一条消息即可开始。"
    )
    return true
  }

  if (command === "status") {
    const run = getStudioChatRun(binding.sessionId)
    const status = run?.status ?? "idle"
    await safeSend(sendText, target, `当前状态：**${status}**`)
    return true
  }

  if (command === "stop") {
    const cancelled = cancelStudioChatRun(binding.sessionId)
    await safeSend(
      sendText,
      target,
      cancelled ? "正在停止当前任务…" : "当前没有正在运行的任务。"
    )
    return true
  }

  if (command === "approve" || command === "always" || command === "deny") {
    if (!argument) {
      await safeSend(
        sendText,
        target,
        `请附上请求 ID：\`/${command} <请求ID>\``
      )
      return true
    }

    const resolved = resolvePermissionCommand({
      sessionId: binding.sessionId,
      command,
      requestId: argument.split(/\s+/)[0],
    })
    await safeSend(
      sendText,
      target,
      resolved ? "授权决定已提交。" : "未找到待处理的授权请求，它可能已过期。"
    )
    return true
  }

  return false
}

export async function handleMobileChannelMessage(
  message: MobileChannelInboundMessage,
  sendText: SendText,
  sendImage: SendImage,
  sendVideo: SendVideo,
  options: { eventAlreadyRecorded?: boolean } = {}
) {
  if (
    !options.eventAlreadyRecorded &&
    !recordMobileChannelEvent({
      connectionId: message.connectionId,
      externalEventId: message.id,
    })
  ) {
    return
  }

  const binding = await authorizeMessage(message, sendText)
  if (!binding) {
    return
  }

  if (/^\/bind\s+/i.test(message.text)) {
    return
  }

  if (await handleCommand({ binding, message, sendText })) {
    return
  }

  const connection = getMobileChannelConnection(message.connectionId)
  if (!connection?.defaultProjectId) {
    await safeSend(
      sendText,
      outboundTarget(message),
      "尚未设置默认工作区。请在电脑端打开 AstraFlow「移动版」，为此渠道选择一个本地项目后再发送任务。"
    )
    return
  }

  const session = ensureBindingSession(binding, message)
  const running = getStudioChatRun(session.id)
  if (running?.status === "queued" || running?.status === "running") {
    await safeSend(
      sendText,
      outboundTarget(message),
      "当前任务仍在运行。发送 `/status` 查看状态，或发送 `/stop` 后再开始新任务。"
    )
    return
  }

  createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: message.text,
    attachments: message.attachments ?? [],
  })

  const target = outboundTarget(message)
  await safeSend(
    sendText,
    target,
    message.attachments?.length
      ? `已接收 ${message.attachments.length} 张图片和你的要求，正在连接本机 Agent…`
      : "任务已接收，正在连接本机 Agent…"
  )

  try {
    const runtimeId = connection.agentRuntimeId || "astraflow"
    const resolvedModel = resolveAgentModelForRuntime({
      modelId: connection.chatModel,
      runtimeId,
    })
    const model =
      resolvedModel?.id || connection.chatModel || DEFAULT_CHAT_MODEL
    const configuredEffort = SUPPORTED_CHAT_REASONING_EFFORTS.includes(
      connection.reasoningEffort as ChatReasoningEffort
    )
      ? (connection.reasoningEffort as ChatReasoningEffort)
      : null
    const reasoningEffort =
      configuredEffort &&
      resolvedModel?.reasoningEfforts.includes(configuredEffort)
        ? configuredEffort
        : resolvedModel?.defaultReasoningEffort
    updateStudioSessionChatPreferences(session.id, {
      chatModel: model,
      chatRuntimeId: runtimeId,
      chatReasoningEffort: reasoningEffort ?? null,
    })
    startStudioChatRun({
      sessionId: session.id,
      model,
      runtimeId,
      reasoningEffort,
      environment: "local",
    })
    watchRun({
      sessionId: session.id,
      target,
      sendText,
      sendImage,
      sendVideo,
    })
  } catch (error) {
    await safeSend(sendText, target, `任务启动失败：${errorMessage(error)}`)
  }
}
