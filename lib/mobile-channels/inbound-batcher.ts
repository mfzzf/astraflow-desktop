import type {
  MobileChannelImageAttachment,
  MobileChannelInboundMessage,
  MobileChannelOutboundTarget,
} from "./types"

export type WechatInboundBatcherPolicy = {
  acknowledgementDelayMs: number
  draftExpiryMs: number
  maxAttachments: number
  mediaQuietMs: number
  textAttachmentGraceMs: number
  textBatchMaxWaitMs: number
}

type WechatInboundBatcherInput = {
  message: MobileChannelInboundMessage
  dispatch: (message: MobileChannelInboundMessage) => Promise<void>
  sendText: (target: MobileChannelOutboundTarget, text: string) => Promise<void>
  onError: (error: unknown) => void
}

type WechatInboundDraft = {
  key: string
  connectionId: string
  firstMessage: MobileChannelInboundMessage
  latestMessage: MobileChannelInboundMessage
  messageIds: string[]
  textParts: string[]
  attachments: MobileChannelImageAttachment[]
  acknowledgementSent: boolean
  overflowWarningSent: boolean
  acknowledgementTimer: ReturnType<typeof setTimeout> | null
  expiryTimer: ReturnType<typeof setTimeout> | null
  hardSubmitTimer: ReturnType<typeof setTimeout> | null
  submitTimer: ReturnType<typeof setTimeout> | null
  dispatch: WechatInboundBatcherInput["dispatch"]
  sendText: WechatInboundBatcherInput["sendText"]
  onError: WechatInboundBatcherInput["onError"]
}

const defaultPolicy: WechatInboundBatcherPolicy = {
  acknowledgementDelayMs: 600,
  draftExpiryMs: 5 * 60 * 1_000,
  maxAttachments: 6,
  mediaQuietMs: 1_200,
  textAttachmentGraceMs: 2_000,
  textBatchMaxWaitMs: 6_000,
}

const immediateCommands = new Set([
  "always",
  "approve",
  "bind",
  "deny",
  "help",
  "model",
  "new",
  "status",
  "stop",
])

const draftClearingCommands = new Set(["new", "stop"])

function draftKey(message: MobileChannelInboundMessage) {
  return [
    message.connectionId,
    message.conversationId,
    message.externalUserId,
  ].join(":")
}

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

function commandName(text: string) {
  return (
    text
      .trim()
      .match(/^\/([a-z]+)(?:\s|$)/i)?.[1]
      ?.toLowerCase() ?? null
  )
}

function setUnrefTimeout(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs)
  timer.unref?.()
  return timer
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) {
    clearTimeout(timer)
  }
}

function clearDraftTimers(draft: WechatInboundDraft) {
  clearTimer(draft.acknowledgementTimer)
  clearTimer(draft.expiryTimer)
  clearTimer(draft.hardSubmitTimer)
  clearTimer(draft.submitTimer)
  draft.acknowledgementTimer = null
  draft.expiryTimer = null
  draft.hardSubmitTimer = null
  draft.submitTimer = null
}

function hasText(draft: WechatInboundDraft) {
  return draft.textParts.some((part) => part.trim().length > 0)
}

function combinedText(draft: WechatInboundDraft) {
  const text = draft.textParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")

  return text || "请查看并处理这些图片。"
}

function aggregateDraft(draft: WechatInboundDraft) {
  const lastMessageId = draft.messageIds.at(-1) ?? draft.firstMessage.id

  return {
    ...draft.latestMessage,
    id: `wechat-batch:${draft.firstMessage.id}:${lastMessageId}`,
    text: combinedText(draft),
    attachments: draft.attachments,
    senderName: draft.latestMessage.senderName ?? draft.firstMessage.senderName,
    createdAt: draft.firstMessage.createdAt,
  } satisfies MobileChannelInboundMessage
}

export class WechatInboundBatcher {
  private readonly drafts = new Map<string, WechatInboundDraft>()
  private readonly policy: WechatInboundBatcherPolicy

  constructor(policy: Partial<WechatInboundBatcherPolicy> = {}) {
    this.policy = { ...defaultPolicy, ...policy }
  }

  async enqueue(input: WechatInboundBatcherInput) {
    const { message } = input
    const key = draftKey(message)
    const command = commandName(message.text)

    if (command === "send") {
      const draft = this.drafts.get(key)
      if (!draft) {
        await this.safeSend(
          input.sendText,
          outboundTarget(message),
          "当前没有待提交的图片。"
        )
        return
      }
      draft.latestMessage = message
      draft.sendText = input.sendText
      draft.dispatch = input.dispatch
      draft.onError = input.onError
      await this.flush(key)
      return
    }

    if (command === "cancel") {
      const cancelled = this.discard(key)
      await this.safeSend(
        input.sendText,
        outboundTarget(message),
        cancelled ? "已取消本次图片任务。" : "当前没有待提交的图片。"
      )
      return
    }

    if (command && immediateCommands.has(command)) {
      if (draftClearingCommands.has(command)) {
        this.discard(key)
      }
      await input.dispatch(message)
      return
    }

    let draft = this.drafts.get(key)
    if (!draft) {
      draft = {
        key,
        connectionId: message.connectionId,
        firstMessage: message,
        latestMessage: message,
        messageIds: [],
        textParts: [],
        attachments: [],
        acknowledgementSent: false,
        overflowWarningSent: false,
        acknowledgementTimer: null,
        expiryTimer: null,
        hardSubmitTimer: null,
        submitTimer: null,
        dispatch: input.dispatch,
        sendText: input.sendText,
        onError: input.onError,
      }
      this.drafts.set(key, draft)
    }

    draft.latestMessage = message
    draft.dispatch = input.dispatch
    draft.sendText = input.sendText
    draft.onError = input.onError
    draft.messageIds.push(message.id)

    if (message.text.trim()) {
      draft.textParts.push(message.text)
    }

    const availableSlots = Math.max(
      0,
      this.policy.maxAttachments - draft.attachments.length
    )
    const incomingAttachments = message.attachments ?? []
    draft.attachments.push(...incomingAttachments.slice(0, availableSlots))

    if (
      incomingAttachments.length > availableSlots &&
      !draft.overflowWarningSent
    ) {
      draft.overflowWarningSent = true
      void this.safeSend(
        draft.sendText,
        outboundTarget(message),
        `一次最多处理 ${this.policy.maxAttachments} 张图片，超出的图片未加入本次任务。`
      )
    }

    this.scheduleExpiry(draft)

    if (hasText(draft)) {
      clearTimer(draft.acknowledgementTimer)
      draft.acknowledgementTimer = null
      this.scheduleSubmit(
        draft,
        draft.attachments.length > 0
          ? this.policy.mediaQuietMs
          : this.policy.textAttachmentGraceMs
      )
      this.scheduleHardSubmit(draft)
      return
    }

    clearTimer(draft.submitTimer)
    draft.submitTimer = null
    clearTimer(draft.hardSubmitTimer)
    draft.hardSubmitTimer = null
    this.scheduleAcknowledgement(draft)
  }

  discardConnection(connectionId: string) {
    for (const [key, draft] of this.drafts) {
      if (draft.connectionId === connectionId) {
        this.discard(key)
      }
    }
  }

  private discard(key: string) {
    const draft = this.drafts.get(key)
    if (!draft) {
      return false
    }

    clearDraftTimers(draft)
    this.drafts.delete(key)
    return true
  }

  private scheduleAcknowledgement(draft: WechatInboundDraft) {
    if (draft.acknowledgementSent) {
      return
    }

    clearTimer(draft.acknowledgementTimer)
    draft.acknowledgementTimer = setUnrefTimeout(() => {
      draft.acknowledgementTimer = null
      if (!this.drafts.has(draft.key) || hasText(draft)) {
        return
      }

      draft.acknowledgementSent = true
      void this.safeSend(
        draft.sendText,
        outboundTarget(draft.latestMessage),
        [
          `已接收 ${draft.attachments.length} 张图片，请输入你的要求，图片会和文字一起处理。`,
          "发送 `/send` 可直接处理，发送 `/cancel` 可取消。",
        ].join("\n")
      )
    }, this.policy.acknowledgementDelayMs)
  }

  private scheduleExpiry(draft: WechatInboundDraft) {
    clearTimer(draft.expiryTimer)
    draft.expiryTimer = setUnrefTimeout(() => {
      if (!this.discard(draft.key)) {
        return
      }
      void this.safeSend(
        draft.sendText,
        outboundTarget(draft.latestMessage),
        "图片草稿已超过 5 分钟，现已清除；如需继续，请重新发送图片。"
      )
    }, this.policy.draftExpiryMs)
  }

  private scheduleSubmit(draft: WechatInboundDraft, delayMs: number) {
    clearTimer(draft.submitTimer)
    draft.submitTimer = setUnrefTimeout(() => {
      draft.submitTimer = null
      void this.flush(draft.key).catch(draft.onError)
    }, delayMs)
  }

  private scheduleHardSubmit(draft: WechatInboundDraft) {
    if (draft.hardSubmitTimer) {
      return
    }

    draft.hardSubmitTimer = setUnrefTimeout(() => {
      draft.hardSubmitTimer = null
      void this.flush(draft.key).catch(draft.onError)
    }, this.policy.textBatchMaxWaitMs)
  }

  private async flush(key: string) {
    const draft = this.drafts.get(key)
    if (!draft) {
      return
    }

    clearDraftTimers(draft)
    this.drafts.delete(key)
    await draft.dispatch(aggregateDraft(draft))
  }

  private async safeSend(
    sendText: WechatInboundBatcherInput["sendText"],
    target: MobileChannelOutboundTarget,
    text: string
  ) {
    try {
      await sendText(target, text)
    } catch (error) {
      console.error("[mobile-channels] wechat_draft_reply_failed", error)
    }
  }
}

declare global {
  var astraflowWechatInboundBatcher: WechatInboundBatcher | undefined
}

export function getWechatInboundBatcher() {
  if (!globalThis.astraflowWechatInboundBatcher) {
    globalThis.astraflowWechatInboundBatcher = new WechatInboundBatcher()
  }

  return globalThis.astraflowWechatInboundBatcher
}
