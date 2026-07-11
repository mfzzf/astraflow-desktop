import "server-only"

import { resolvePermission } from "@/lib/agent/permission-broker"
import {
  createStudioMessage,
  createStudioSession,
  getStudioLocalProject,
  getStudioSession,
  listStudioImageGenerations,
} from "@/lib/studio-db"
import {
  cancelStudioChatRun,
  getStudioChatRun,
  getStudioChatRunLiveSnapshot,
  startStudioChatRun,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import type {
  StudioImageOutput,
  StudioMediaGenerationOutput,
  StudioMessageActivity,
  StudioMessagePart,
} from "@/lib/studio-types"
import { listStudioVideoGenerations } from "@/lib/studio-video-db"
import type { StudioVideoOutput } from "@/lib/studio-video-types"

import { errorMessage } from "./http"
import {
  consumeMobileChannelFileReferences,
  extractMobileChannelFileLinks,
  parseMobileChannelFileReference,
  resolveMobileChannelOutboundFile,
  type MobileChannelFileReference,
} from "./file-transfer"
import { resolveMobileChannelMediaDownloadUrl } from "./media-links"
import {
  formatMobileModelList,
  resolveMobileModelSelection,
} from "./model-command"
import {
  resolveGeneratedMobileChannelImage,
  resolveGeneratedMobileChannelVideo,
} from "./media"
import { refreshMobileChannelOutboxTargets } from "./outbox"
import {
  resolveMobileChannelPreferences,
  syncMobileChannelConnectionToBoundSessions,
  syncMobileChannelConnectionToSession,
} from "./preferences"
import {
  refreshActiveMobileRunTarget,
  registerActiveMobileRunTarget,
} from "./reply-target"
import {
  consumeMobileChannelBindCode,
  getMobileChannelBinding,
  getMobileChannelConnection,
  recordMobileChannelEvent,
  saveMobileChannelBinding,
  updateMobileChannelBindingSession,
  updateMobileChannelConnectionMetadata,
  updateMobileChannelConnectionSettings,
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

type SendFile = (
  target: MobileChannelOutboundTarget,
  file: ReturnType<typeof resolveMobileChannelOutboundFile>
) => Promise<void>

type SetTyping = (
  target: MobileChannelOutboundTarget,
  typing: boolean
) => Promise<void>

const VIDEO_GENERATION_POLL_INTERVAL_MS = 2_500
const VIDEO_GENERATION_WATCH_TIMEOUT_MS = 30 * 60_000
const MOBILE_FILE_DELIVERY_REQUEST_PATTERN =
  /(?:发|发送|传|回传|交付|分享).{0,8}(?:给我|文件|附件)|(?:给我|把).{0,12}(?:发|发送|传|回传)|(?:文件|附件).{0,8}(?:下载|发给我|发送给我)|\b(?:send|attach|deliver|share)\b[\s\S]{0,32}\b(?:me|file|attachment)\b|\bdownload\b/i

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

function durableTarget(target: MobileChannelOutboundTarget) {
  return { ...target, durable: true }
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

async function safeSetTyping(
  setTyping: SetTyping,
  target: MobileChannelOutboundTarget,
  typing: boolean
) {
  try {
    await setTyping(target, typing)
  } catch (error) {
    console.warn("[mobile-channels] typing_status_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      typing,
      error: errorMessage(error),
    })
  }
}

async function safeSendMediaDownloadLink({
  kind,
  output,
  sendText,
  target,
}: {
  kind: "image" | "video"
  output: StudioMediaGenerationOutput
  sendText: SendText
  target: MobileChannelOutboundTarget
}) {
  const downloadUrl = resolveMobileChannelMediaDownloadUrl(output)
  if (!downloadUrl) {
    console.info("[mobile-channels] outbound_media_download_link_unavailable", {
      provider: target.provider,
      connectionId: target.connectionId,
      kind,
      outputId: output.id,
    })
    return
  }

  const sent = await safeSend(
    sendText,
    durableTarget(target),
    `${kind === "image" ? "原图" : "原视频"}下载链接：${downloadUrl}`
  )
  if (sent) {
    console.info("[mobile-channels] outbound_media_download_link_sent", {
      provider: target.provider,
      connectionId: target.connectionId,
      kind,
      outputId: output.id,
    })
  }
}

async function safeSendImage(
  sendText: SendText,
  sendImage: SendImage,
  target: MobileChannelOutboundTarget,
  output: Parameters<typeof resolveGeneratedMobileChannelImage>[0]
) {
  try {
    const image = await resolveGeneratedMobileChannelImage(output)
    console.info("[mobile-channels] outbound_image_sending", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
      mimeType: image.mimeType,
      size: image.buffer.length,
    })
    await sendImage(durableTarget(target), image)
    console.info("[mobile-channels] outbound_image_sent", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
    })
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
      `图片已生成，发送暂时失败，网络恢复后会自动重试：${errorMessage(error)}`
    )
  }
  await safeSendMediaDownloadLink({
    kind: "image",
    output,
    sendText,
    target,
  })
}

async function safeSendVideo(
  sendText: SendText,
  sendVideo: SendVideo,
  target: MobileChannelOutboundTarget,
  output: Parameters<typeof resolveGeneratedMobileChannelVideo>[0]
) {
  try {
    const video = await resolveGeneratedMobileChannelVideo(output)
    console.info("[mobile-channels] outbound_video_sending", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
      mimeType: video.mimeType,
      size: video.buffer.length,
    })
    await sendVideo(durableTarget(target), video)
    console.info("[mobile-channels] outbound_video_sent", {
      provider: target.provider,
      connectionId: target.connectionId,
      outputId: output.id,
    })
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
      `视频已生成，发送暂时失败，网络恢复后会自动重试：${errorMessage(error)}`
    )
  }
  await safeSendMediaDownloadLink({
    kind: "video",
    output,
    sendText,
    target,
  })
}

async function safeSendFile(
  sendText: SendText,
  sendFile: SendFile,
  target: MobileChannelOutboundTarget,
  reference: MobileChannelFileReference
) {
  try {
    const file = resolveMobileChannelOutboundFile(reference)
    console.info("[mobile-channels] outbound_file_sending", {
      provider: target.provider,
      connectionId: target.connectionId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
    })
    await sendFile(durableTarget(target), file)
    console.info("[mobile-channels] outbound_file_sent", {
      provider: target.provider,
      connectionId: target.connectionId,
      fileName: file.fileName,
    })
  } catch (error) {
    console.error("[mobile-channels] outbound_file_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      fileName: reference.fileName,
      error: errorMessage(error),
    })
    await safeSend(
      sendText,
      target,
      `文件已找到，发送暂时失败，网络恢复后会自动重试：${errorMessage(error)}`
    )
  }
}

function toMobileImageGenerationOutput(
  output: StudioImageOutput
): StudioMediaGenerationOutput {
  return {
    id: output.id,
    index: output.index,
    contentUrl: `/api/studio/image-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
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
    return connection
      ? (syncMobileChannelConnectionToSession(
          connection,
          existingSession.id
        ) ?? existingSession)
      : existingSession
  }

  const senderLabel = message.senderName?.trim() || "移动端"
  const session = createStudioSession({
    mode: "chat",
    title: `${senderLabel} · ${new Date().toLocaleDateString("zh-CN")}`,
  })

  updateMobileChannelBindingSession(binding.id, session.id)

  return connection
    ? (syncMobileChannelConnectionToSession(connection, session.id) ?? session)
    : session
}

function resolvePermissionCommand({
  sessionId,
  command,
}: {
  sessionId: string
  command: "approve" | "always" | "deny"
}) {
  const snapshot = getStudioChatRunLiveSnapshot(sessionId)
  const part = snapshot?.message?.parts.find(
    (candidate) =>
      candidate.type === "permission" &&
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
    ? resolvePermission(sessionId, part.id, option.optionId)
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
  runId,
  target,
  allowLinkedFiles,
  sendText,
  sendImage,
  sendVideo,
  sendFile,
  setTyping,
}: {
  sessionId: string
  runId: string
  target: MobileChannelOutboundTarget
  allowLinkedFiles: boolean
  sendText: SendText
  sendImage: SendImage
  sendVideo: SendVideo
  sendFile: SendFile
  setTyping: SetTyping
}) {
  const activeTarget = registerActiveMobileRunTarget(sessionId, target, runId)
  const currentTarget = activeTarget.current
  const releaseTarget = activeTarget.release
  const sentPermissions = new Set<string>()
  const sentActivities = new Set<string>()
  const sentImages = new Set<string>()
  const sentVideos = new Set<string>()
  const sentFiles = new Set<string>()
  const pendingVideoGenerations = new Set<string>()
  let lastProgressAt = 0
  let progressCount = 0
  let finished = false
  let typingStopped = false
  let outboundMediaQueue = Promise.resolve()
  let unsubscribe = () => {}

  const stopTyping = async () => {
    if (typingStopped) {
      return
    }
    typingStopped = true
    await safeSetTyping(setTyping, currentTarget(), false)
  }

  const enqueueText = (text: string) => {
    outboundMediaQueue = outboundMediaQueue.then(async () => {
      await safeSend(sendText, currentTarget(), text)
    })
  }

  const enqueueImage = (output: StudioMediaGenerationOutput) => {
    if (sentImages.has(output.id)) {
      return
    }
    sentImages.add(output.id)
    const logTarget = currentTarget()
    console.info("[mobile-channels] outbound_image_queued", {
      provider: logTarget.provider,
      connectionId: logTarget.connectionId,
      sessionId,
      outputId: output.id,
    })
    outboundMediaQueue = outboundMediaQueue.then(() =>
      safeSendImage(sendText, sendImage, currentTarget(), output)
    )
  }

  const enqueueVideo = (output: StudioMediaGenerationOutput) => {
    if (sentVideos.has(output.id)) {
      return
    }
    sentVideos.add(output.id)
    const logTarget = currentTarget()
    console.info("[mobile-channels] outbound_video_queued", {
      provider: logTarget.provider,
      connectionId: logTarget.connectionId,
      sessionId,
      outputId: output.id,
    })
    outboundMediaQueue = outboundMediaQueue.then(() =>
      safeSendVideo(sendText, sendVideo, currentTarget(), output)
    )
  }

  const enqueueFile = (reference: MobileChannelFileReference) => {
    if (sentFiles.has(reference.path)) {
      return
    }
    sentFiles.add(reference.path)
    const logTarget = currentTarget()
    console.info("[mobile-channels] outbound_file_queued", {
      provider: logTarget.provider,
      connectionId: logTarget.connectionId,
      sessionId,
      fileName: reference.fileName,
      size: reference.size,
    })
    outboundMediaQueue = outboundMediaQueue.then(() =>
      safeSendFile(sendText, sendFile, currentTarget(), reference)
    )
  }

  const inspectFileActivity = (activity: StudioMessageActivity) => {
    if (
      activity.status !== "complete" ||
      activity.toolName !== "studio_send_file"
    ) {
      return
    }

    const reference = parseMobileChannelFileReference(activity.output)
    if (reference) {
      enqueueFile(reference)
    }
  }

  const inspectMediaPart = (part: StudioMessagePart) => {
    if (part.type !== "media_generation") {
      return
    }

    if (
      part.kind === "image" &&
      ["complete", "partial"].includes(part.status)
    ) {
      for (const output of part.outputs) {
        enqueueImage(output)
      }
      return
    }

    if (part.kind !== "video") {
      return
    }

    if (["complete", "partial", "error", "cancelled"].includes(part.status)) {
      pendingVideoGenerations.delete(part.generationId)
    } else {
      pendingVideoGenerations.add(part.generationId)
    }

    if (["complete", "partial"].includes(part.status)) {
      for (const output of part.outputs) {
        enqueueVideo(output)
      }
    }
  }

  const reconcileRunMedia = (runStartedAt: string) => {
    const startedAt = Date.parse(runStartedAt)
    if (!Number.isFinite(startedAt)) {
      throw new Error(`Invalid Agent run start time: ${runStartedAt}`)
    }
    const belongsToRun = (createdAt: string) => {
      const parsedCreatedAt = Date.parse(createdAt)

      return Number.isFinite(parsedCreatedAt) && parsedCreatedAt >= startedAt
    }

    const imageGenerations = listStudioImageGenerations(sessionId).filter(
      (generation) => belongsToRun(generation.createdAt)
    )
    const videoGenerations = listStudioVideoGenerations(sessionId).filter(
      (generation) => belongsToRun(generation.createdAt)
    )

    if (imageGenerations.length > 0 || videoGenerations.length > 0) {
      const logTarget = currentTarget()
      console.info("[mobile-channels] outbound_media_reconciled", {
        provider: logTarget.provider,
        connectionId: logTarget.connectionId,
        sessionId,
        imageGenerations: imageGenerations.length,
        videoGenerations: videoGenerations.length,
      })
    }

    for (const generation of imageGenerations) {
      if (generation.status !== "complete" && generation.status !== "partial") {
        continue
      }
      for (const output of generation.outputs) {
        enqueueImage(toMobileImageGenerationOutput(output))
      }
    }

    for (const generation of videoGenerations) {
      if (generation.status === "complete" || generation.status === "partial") {
        pendingVideoGenerations.delete(generation.id)
        for (const output of generation.outputs) {
          enqueueVideo(toMobileVideoGenerationOutput(output))
        }
      } else if (
        generation.status !== "error" &&
        generation.status !== "cancelled"
      ) {
        pendingVideoGenerations.add(generation.id)
      }
    }
  }

  const handleSnapshot: Parameters<typeof subscribeStudioChatRun>[1] = (
    snapshot
  ) => {
    if (finished) {
      return
    }

    for (const reference of consumeMobileChannelFileReferences(sessionId)) {
      enqueueFile(reference)
    }

    for (const activity of snapshot.message?.activities ?? []) {
      inspectFileActivity(activity)

      if (activity.status !== "running" || sentActivities.has(activity.id)) {
        continue
      }
      sentActivities.add(activity.id)
      if (progressCount >= 8 || Date.now() - lastProgressAt < 4_000) {
        continue
      }
      progressCount += 1
      lastProgressAt = Date.now()
      enqueueText(`正在执行：**${activity.toolName || "工具调用"}**`)
    }

    for (const part of snapshot.message?.parts ?? []) {
      inspectMediaPart(part)

      if (part.type === "subagent") {
        for (const activity of part.activities) {
          inspectFileActivity(activity)
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
      enqueueText(
        [
          "**需要你的授权**",
          `工具：${part.toolName || "未知工具"}`,
          "```",
          preview,
          "```",
          "允许一次：`/approve`",
          "始终允许：`/always`",
          "拒绝：`/deny`",
        ].join("\n")
      )
    }

    if (["complete", "error", "cancelled"].includes(snapshot.status)) {
      const session = getStudioSession(sessionId)
      const project = session?.projectId
        ? getStudioLocalProject(session.projectId)
        : null
      if (allowLinkedFiles) {
        for (const reference of extractMobileChannelFileLinks({
          content: snapshot.message?.content ?? "",
          rootDir: project?.path ?? null,
        })) {
          enqueueFile(reference)
        }
      }

      try {
        reconcileRunMedia(snapshot.startedAt)
      } catch (error) {
        const logTarget = currentTarget()
        console.error("[mobile-channels] outbound_media_reconcile_failed", {
          provider: logTarget.provider,
          connectionId: logTarget.connectionId,
          sessionId,
          error: errorMessage(error),
        })
      }
      finished = true
      unsubscribe()
      const finalText = summarizeFinalMessage(
        snapshot.message?.content ?? "",
        snapshot.status,
        snapshot.error
      )
      console.info("[mobile-channels] outbound_final_queued", {
        provider: currentTarget().provider,
        connectionId: currentTarget().connectionId,
        sessionId,
        textLength: finalText.length,
      })
      const finalMessage = outboundMediaQueue.then(async () => {
        const finalTarget = currentTarget()
        const sent = await safeSend(
          sendText,
          durableTarget(finalTarget),
          finalText
        )

        console.info(
          sent
            ? "[mobile-channels] outbound_final_sent"
            : "[mobile-channels] outbound_final_not_delivered",
          {
            provider: finalTarget.provider,
            connectionId: finalTarget.connectionId,
            sessionId,
          }
        )
        return sent
      })
      const generationIds = Array.from(pendingVideoGenerations)
      void finalMessage
        .then(async () => {
          await stopTyping()
          if (generationIds.length > 0) {
            await watchPendingVideoGenerations({
              sessionId,
              generationIds,
              sentVideos,
              target: currentTarget(),
              sendText,
              sendVideo,
            })
          }
        })
        .catch(async (error) => {
          console.error("[mobile-channels] final_delivery_chain_failed", {
            sessionId,
            error: errorMessage(error),
          })
          await safeSend(
            sendText,
            currentTarget(),
            `结果同步失败：${errorMessage(error)}`
          )
        })
        .finally(async () => {
          await stopTyping()
          releaseTarget()
        })
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
    /^\/(help|new|status|stop|model|approve|always|deny)(?:\s+(.+))?$/i
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

  const connection = getMobileChannelConnection(binding.connectionId)
  if (!connection) {
    await safeSend(sendText, target, "移动渠道连接已失效，请在电脑端重新绑定。")
    return true
  }

  const preferences = resolveMobileChannelPreferences(connection)

  if (command === "model") {
    if (!argument) {
      await safeSend(
        sendText,
        target,
        formatMobileModelList({
          currentModel: preferences.model,
          currentReasoningEffort: preferences.reasoningEffort,
          models: preferences.availableModels,
        })
      )
      return true
    }

    const run = binding.sessionId ? getStudioChatRun(binding.sessionId) : null
    if (run?.status === "queued" || run?.status === "running") {
      await safeSend(
        sendText,
        target,
        "当前任务正在运行，模型不会在中途切换。请等待完成或发送 `/stop` 后再切换。"
      )
      return true
    }

    const selection = resolveMobileModelSelection(
      argument,
      preferences.availableModels
    )
    if (!selection) {
      await safeSend(
        sendText,
        target,
        `模型或思考强度无效。\n\n${formatMobileModelList({
          currentModel: preferences.model,
          currentReasoningEffort: preferences.reasoningEffort,
          models: preferences.availableModels,
        })}`
      )
      return true
    }

    const reasoningEffort =
      !selection.reasoningEffortExplicit &&
      connection.reasoningEffort &&
      selection.model.reasoningEfforts.includes(connection.reasoningEffort)
        ? connection.reasoningEffort
        : selection.reasoningEffort
    const updated = updateMobileChannelConnectionSettings(connection.id, {
      chatModel: selection.model.id,
      reasoningEffort,
    })
    if (!updated) {
      await safeSend(sendText, target, "模型设置保存失败，请在电脑端重试。")
      return true
    }

    syncMobileChannelConnectionToBoundSessions(connection.id, updated)
    await safeSend(
      sendText,
      target,
      `已切换到 **${selection.model.label}**（${selection.model.id}），思考强度 **${reasoningEffort}**。电脑端设置和当前会话会自动同步。`
    )
    return true
  }

  if (command === "status") {
    const run = binding.sessionId ? getStudioChatRun(binding.sessionId) : null
    const status = run?.status ?? "idle"
    await safeSend(
      sendText,
      target,
      [
        `当前状态：**${status}**`,
        `当前模型：**${preferences.modelLabel}**（${preferences.model}）`,
        preferences.reasoningEffort
          ? `思考强度：**${preferences.reasoningEffort}**`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
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
    const resolved = resolvePermissionCommand({
      sessionId: binding.sessionId,
      command,
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
  sendFile: SendFile,
  setTyping: SetTyping,
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

  const target = outboundTarget(message)
  try {
    const refreshed = refreshMobileChannelOutboxTargets(target)
    if (refreshed > 0) {
      console.info("[mobile-channels] outbox_reply_context_refreshed", {
        provider: target.provider,
        connectionId: target.connectionId,
        count: refreshed,
      })
    }
  } catch (error) {
    console.warn("[mobile-channels] outbox_reply_context_refresh_failed", {
      provider: target.provider,
      connectionId: target.connectionId,
      error: errorMessage(error),
    })
  }
  if (
    binding.sessionId &&
    refreshActiveMobileRunTarget(binding.sessionId, target)
  ) {
    console.info("[mobile-channels] active_reply_context_refreshed", {
      provider: target.provider,
      connectionId: target.connectionId,
      sessionId: binding.sessionId,
    })
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

  const preferences = resolveMobileChannelPreferences(connection)
  createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: message.text,
    attachments: message.attachments ?? [],
  })

  await safeSend(
    sendText,
    target,
    [
      message.attachments?.length
        ? `已接收 ${message.attachments.length} 张图片和你的要求，正在连接本机 Agent…`
        : "任务已接收，正在连接本机 Agent…",
      `模型：${preferences.modelLabel}（${preferences.model}）${
        preferences.reasoningEffort
          ? ` · 思考强度：${preferences.reasoningEffort}`
          : ""
      }`,
    ].join("\n")
  )
  await safeSetTyping(setTyping, target, true)

  try {
    syncMobileChannelConnectionToSession(connection, session.id)
    consumeMobileChannelFileReferences(session.id)
    const run = startStudioChatRun({
      sessionId: session.id,
      model: preferences.model,
      runtimeId: preferences.runtimeId,
      reasoningEffort: preferences.reasoningEffort,
      environment: "local",
    })
    watchRun({
      sessionId: session.id,
      runId: run.runId,
      target,
      allowLinkedFiles: MOBILE_FILE_DELIVERY_REQUEST_PATTERN.test(message.text),
      sendText,
      sendImage,
      sendVideo,
      sendFile,
      setTyping,
    })
  } catch (error) {
    await safeSetTyping(setTyping, target, false)
    await safeSend(sendText, target, `任务启动失败：${errorMessage(error)}`)
  }
}
