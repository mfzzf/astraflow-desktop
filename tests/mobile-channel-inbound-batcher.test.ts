import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { WechatInboundBatcher } from "../lib/mobile-channels/inbound-batcher"
import type {
  MobileChannelImageAttachment,
  MobileChannelInboundMessage,
} from "../lib/mobile-channels/types"

const image: MobileChannelImageAttachment = {
  type: "image",
  name: "test.png",
  mimeType: "image/png",
  size: 8,
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
}

function message({
  id,
  text = "",
  attachments,
}: {
  id: string
  text?: string
  attachments?: MobileChannelImageAttachment[]
}): MobileChannelInboundMessage {
  return {
    id,
    connectionId: "wechat-connection",
    provider: "wechat",
    externalUserId: "wechat-user",
    conversationId: "wechat-conversation",
    text,
    attachments,
    senderName: null,
    createdAt: Date.now(),
    replyContext: { provider: "wechat", contextToken: "context-token" },
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function setup() {
  const dispatched: MobileChannelInboundMessage[] = []
  const replies: string[] = []
  const errors: unknown[] = []
  const batcher = new WechatInboundBatcher({
    acknowledgementDelayMs: 10,
    draftExpiryMs: 500,
    maxAttachments: 6,
    mediaQuietMs: 15,
    textAttachmentGraceMs: 40,
    textBatchMaxWaitMs: 100,
  })
  const input = {
    dispatch: async (value: MobileChannelInboundMessage) => {
      dispatched.push(value)
    },
    sendText: async (_target: unknown, text: string) => {
      replies.push(text)
    },
    onError: (error: unknown) => {
      errors.push(error)
    },
  }

  return { batcher, dispatched, errors, input, replies }
}

describe("WeChat inbound draft batching", () => {
  test("holds text briefly so a later image joins the same Agent turn", async () => {
    const state = setup()

    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "text-1", text: "比较这两张图" }),
    })
    await sleep(5)
    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "image-1", attachments: [image] }),
    })
    await sleep(30)

    assert.equal(state.dispatched.length, 1)
    assert.equal(state.dispatched[0].text, "比较这两张图")
    assert.equal(state.dispatched[0].attachments?.length, 1)
    assert.equal(state.replies.length, 0)
    assert.equal(state.errors.length, 0)
  })

  test("collects image-only messages until the user supplies instructions", async () => {
    const state = setup()

    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "image-1", attachments: [image] }),
    })
    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "image-2", attachments: [image] }),
    })
    await sleep(25)

    assert.equal(state.dispatched.length, 0)
    assert.equal(state.replies.length, 1)
    assert.match(state.replies[0], /已接收 2 张图片/)

    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "text-1", text: "找出不同点" }),
    })
    await sleep(30)

    assert.equal(state.dispatched.length, 1)
    assert.equal(state.dispatched[0].text, "找出不同点")
    assert.equal(state.dispatched[0].attachments?.length, 2)
    assert.equal(state.errors.length, 0)
  })

  test("supports explicit send and cancel commands for pending images", async () => {
    const state = setup()

    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "image-1", attachments: [image] }),
    })
    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "send-1", text: "/send" }),
    })

    assert.equal(state.dispatched.length, 1)
    assert.equal(state.dispatched[0].text, "请查看并处理这些图片。")

    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "image-2", attachments: [image] }),
    })
    await state.batcher.enqueue({
      ...state.input,
      message: message({ id: "cancel-1", text: "/cancel" }),
    })
    await sleep(25)

    assert.equal(state.dispatched.length, 1)
    assert.equal(state.replies.at(-1), "已取消本次图片任务。")
    assert.equal(state.errors.length, 0)
  })
})
