import assert from "node:assert/strict"
import test from "node:test"

import {
  discordBotInstallUrl,
  discordSlashCommandDefinitions,
  normalizeDiscordInteraction,
  normalizeDiscordMessage,
  splitDiscordText,
} from "../lib/mobile-channels/providers/discord-protocol"
import {
  normalizeTelegramCommand,
  normalizeTelegramUpdate,
  splitTelegramText,
  telegramBotDeepLink,
} from "../lib/mobile-channels/providers/telegram-protocol"
import { resolveMobileChannelMediaDownloadUrl } from "../lib/mobile-channels/media-links"
import {
  mobileChannelSlashCommands,
  normalizeMobileChannelCommandText,
  parseMobileChannelSlashCommand,
  telegramSlashCommandDefinitions,
} from "../lib/mobile-channels/slash-commands"
import { mergeMobileChannelRuntimeMetadata } from "../lib/mobile-channels/metadata"
import {
  formatMobileModelList,
  resolveMobileModelSelection,
  type MobileModelCommandOption,
} from "../lib/mobile-channels/model-command"
import { getMobileChannelUsageGuide } from "../lib/mobile-channels/usage-guide"
import { resolveMobileChannelPreferences } from "../lib/mobile-channels/preferences"
import { updateMobileChannelConnectionSchema } from "../lib/schemas/mobile-channels"
import { shouldAutoApprovePermission } from "../lib/agent/permission-policy"

test("Telegram updates normalize text and the largest photo", () => {
  const result = normalizeTelegramUpdate({
    update_id: 42,
    message: {
      message_id: 7,
      date: 1_700_000_000,
      from: { id: 123, first_name: "Astra", last_name: "User" },
      chat: { id: -456, type: "supergroup" },
      caption: "分析这张图片",
      photo: [
        { file_id: "small", width: 90, height: 90, file_size: 1_000 },
        { file_id: "large", width: 1_280, height: 720, file_size: 50_000 },
      ],
    },
  })

  assert.equal(result?.updateId, 42)
  assert.equal(result?.externalUserId, "123")
  assert.equal(result?.conversationId, "-456")
  assert.equal(result?.text, "分析这张图片")
  assert.equal(result?.senderName, "Astra User")
  assert.equal(result?.files[0]?.fileId, "large")
  assert.equal(result?.files[0]?.type, "image")
})

test("Telegram protocol supports video references, deep links, and safe chunks", () => {
  const result = normalizeTelegramUpdate({
    update_id: 43,
    message: {
      message_id: 8,
      from: { id: 123 },
      chat: { id: 123, type: "private" },
      video: {
        file_id: "video-file",
        file_name: "result.mp4",
        mime_type: "video/mp4",
        file_size: 1024,
      },
    },
  })

  assert.equal(result?.files[0]?.type, "video")
  assert.equal(
    telegramBotDeepLink("@AstraFlowBot", "BIND_123"),
    "https://t.me/AstraFlowBot?start=BIND_123"
  )
  assert.equal(
    normalizeTelegramCommand("/start@AstraFlowBot BIND_123"),
    "/bind BIND_123"
  )
  const chunks = splitTelegramText("😀".repeat(4_097))
  assert.deepEqual(
    chunks.map((chunk) => Array.from(chunk).length),
    [4_096, 1]
  )
})

test("all channel clients normalize their common slash command shapes", () => {
  assert.equal(
    normalizeMobileChannelCommandText(
      '<at user_id="ou_bot">AstraFlow</at> ／MODEL@AstraBot 2 high'
    ),
    "/model 2 high"
  )
  assert.equal(
    normalizeMobileChannelCommandText("<@123456789012345678> /STATUS"),
    "/status"
  )
  assert.equal(
    normalizeMobileChannelCommandText("@AstraFlowBot /APPROVE"),
    "/approve"
  )
  assert.equal(
    normalizeMobileChannelCommandText("/start@AstraFlowBot BIND_123", {
      startAsBind: true,
    }),
    "/bind BIND_123"
  )
  assert.equal(
    normalizeMobileChannelCommandText("/Summarize this slash-prefixed prompt"),
    "/Summarize this slash-prefixed prompt"
  )
  assert.equal(normalizeMobileChannelCommandText("\u200B/help"), "/help")
  assert.equal(
    normalizeMobileChannelCommandText("请分析 👩‍💻 与 👨‍👩‍👧‍👦"),
    "请分析 👩‍💻 与 👨‍👩‍👧‍👦"
  )
  assert.equal(
    normalizeMobileChannelCommandText("می\u200Cخواهم این متن حفظ شود"),
    "می\u200Cخواهم این متن حفظ شود"
  )
  assert.equal(
    normalizeMobileChannelCommandText("/appro\u200Dve"),
    "/appro\u200Dve"
  )
  assert.deepEqual(parseMobileChannelSlashCommand("／MODEL 2 high"), {
    name: "model",
    argument: "2 high",
  })
  assert.equal(parseMobileChannelSlashCommand("/appro\u200Dve"), null)
  assert.equal(parseMobileChannelSlashCommand("/unknown"), null)
})

test("Telegram exposes every supported command in English and Chinese menus", () => {
  const expected = mobileChannelSlashCommands.map((command) => command.name)
  const english = telegramSlashCommandDefinitions("en")
  const chinese = telegramSlashCommandDefinitions("zh")

  assert.deepEqual(
    english.map((command) => command.command),
    expected
  )
  assert.deepEqual(
    chinese.map((command) => command.command),
    expected
  )
  for (const command of [...english, ...chinese]) {
    assert.match(command.command, /^[a-z0-9_]{1,32}$/)
    assert.ok(command.description.length >= 1)
    assert.ok(command.description.length <= 256)
  }
})

test("Discord messages normalize supported image and video attachments", () => {
  const result = normalizeDiscordMessage({
    id: "123456789012345678",
    channel_id: "223456789012345678",
    guild_id: "323456789012345678",
    content: "处理这些附件",
    timestamp: "2026-07-11T08:00:00.000Z",
    author: {
      id: "423456789012345678",
      username: "astra-user",
      global_name: "Astra User",
    },
    attachments: [
      {
        id: "1",
        filename: "input.png",
        url: "https://cdn.discordapp.com/input.png",
        content_type: "image/png",
      },
      {
        id: "2",
        filename: "result.mp4",
        url: "https://cdn.discordapp.com/result.mp4",
        content_type: "video/mp4",
      },
    ],
  })

  assert.equal(result?.senderName, "Astra User")
  assert.equal(result?.imageAttachments.length, 1)
  assert.equal(result?.videoAttachments.length, 1)
})

test("Discord install links request only the bot scopes and required permissions", () => {
  const url = new URL(
    discordBotInstallUrl({ applicationId: "123456789012345678" })
  )
  assert.equal(url.origin, "https://discord.com")
  assert.equal(url.searchParams.get("client_id"), "123456789012345678")
  assert.equal(url.searchParams.get("permissions"), "117760")
  assert.equal(url.searchParams.get("scope"), "bot applications.commands")

  const chunks = splitDiscordText("x".repeat(2_001))
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [2_000, 1]
  )
})

test("Discord registers global slash commands and normalizes interactions", () => {
  const definitions = discordSlashCommandDefinitions()
  assert.deepEqual(
    definitions.map((command) => command.name),
    mobileChannelSlashCommands.map((command) => command.name)
  )
  assert.ok(
    definitions
      .find((command) => command.name === "bind")
      ?.options?.some(
        (option) => option.name === "code" && option.required === true
      )
  )
  assert.ok(
    definitions
      .find((command) => command.name === "model")
      ?.options?.some((option) => option.name === "reasoning")
  )
  const reasoningOption = definitions
    .find((command) => command.name === "model")
    ?.options?.find((option) => option.name === "reasoning")
  assert.ok(
    Array.isArray(reasoningOption?.choices) &&
      reasoningOption.choices.some(
        (choice) =>
          typeof choice === "object" &&
          choice !== null &&
          "value" in choice &&
          choice.value === "enabled"
      )
  )

  assert.deepEqual(
    normalizeDiscordInteraction({
      id: "123456789012345678",
      application_id: "223456789012345678",
      type: 2,
      token: "interaction-token",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: {
        nick: "Astra User",
        user: { id: "523456789012345678", username: "astra-user" },
      },
      data: {
        name: "model",
        type: 1,
        options: [
          { name: "selection", type: 3, value: "GPT 5.6 Sol" },
          { name: "reasoning", type: 3, value: "high" },
        ],
      },
    }),
    {
      id: "123456789012345678",
      externalUserId: "523456789012345678",
      conversationId: "423456789012345678",
      text: "/model GPT 5.6 Sol high",
      senderName: "Astra User",
      guildId: "323456789012345678",
    }
  )
})

test("mobile channel welcome guide explains setup, commands, and WeChat batching", () => {
  const wechatGuide = getMobileChannelUsageGuide({
    provider: "wechat",
    connectionJustCompleted: true,
  })
  const telegramGuide = getMobileChannelUsageGuide({ provider: "telegram" })

  assert.match(wechatGuide, /连接成功/)
  assert.match(wechatGuide, /默认工作区、Agent、模型、思考强度和机器人权限/)
  assert.match(wechatGuide, /\/approve/)
  assert.match(wechatGuide, /\/model/)
  assert.match(wechatGuide, /自动批准模式/)
  assert.match(wechatGuide, /发给我/)
  assert.doesNotMatch(wechatGuide, /请求ID/)
  assert.match(wechatGuide, /\/send/)
  assert.doesNotMatch(telegramGuide, /\/send/)
})

test("mobile model commands select by index or id with supported reasoning", () => {
  const models: MobileModelCommandOption[] = [
    {
      id: "gpt-test",
      label: "GPT Test",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "low",
    },
    {
      id: "claude-test",
      label: "Claude Test",
      reasoningEfforts: ["none", "high"],
      defaultReasoningEffort: "none",
    },
  ]

  assert.deepEqual(resolveMobileModelSelection("2 high", models), {
    model: models[1],
    reasoningEffort: "high",
    reasoningEffortExplicit: true,
  })
  assert.deepEqual(resolveMobileModelSelection("GPT Test", models), {
    model: models[0],
    reasoningEffort: "low",
    reasoningEffortExplicit: false,
  })
  assert.equal(resolveMobileModelSelection("1 max", models), null)
  assert.match(
    formatMobileModelList({
      currentModel: "gpt-test",
      currentReasoningEffort: "low",
      models,
    }),
    /1\. GPT Test.*当前/
  )
})

test("runtime metadata updates cannot roll back mobile model settings", () => {
  const current = {
    agentRuntimeId: "astraflow",
    chatModel: "gpt-5.6-sol",
    reasoningEffort: "low",
    permissionMode: "default",
    replyGranularity: "standard",
    updatesBuffer: "fresh-cursor",
  }
  const staleProviderSnapshot = {
    agentRuntimeId: "astraflow",
    chatModel: "gpt-5.5",
    reasoningEffort: "medium",
    permissionMode: "full_access",
    replyGranularity: "full",
    updatesBuffer: "next-cursor",
  }

  assert.deepEqual(
    mergeMobileChannelRuntimeMetadata(current, staleProviderSnapshot),
    {
      ...current,
      updatesBuffer: "next-cursor",
    }
  )
})

test("default permission mode approves safe file inspection without an id", () => {
  const inputPreview = JSON.stringify({
    command:
      'ls -la "/Users/example/Downloads/invoice.pdf" && file "/Users/example/Downloads/invoice.pdf"',
  })

  assert.equal(
    shouldAutoApprovePermission({
      inputPreview,
      mode: "default",
      toolName: "execute",
    }),
    true
  )
  assert.equal(
    shouldAutoApprovePermission({
      inputPreview,
      mode: "legacy_readonly",
      toolName: "execute",
    }),
    false
  )
})

test("mobile media download links prefer public source URLs", () => {
  assert.equal(
    resolveMobileChannelMediaDownloadUrl({
      url: "https://media.example.com/result.mp4?token=signed",
      contentUrl: "/api/studio/video-outputs/output-1/content",
    }),
    "https://media.example.com/result.mp4?token=signed"
  )
  assert.equal(
    resolveMobileChannelMediaDownloadUrl({
      url: null,
      contentUrl: "https://cdn.example.com/result.png",
    }),
    "https://cdn.example.com/result.png"
  )
  assert.equal(
    resolveMobileChannelMediaDownloadUrl({
      url: null,
      contentUrl: "/api/studio/image-outputs/output-1/content",
    }),
    null
  )
})

test("mobile bot settings cannot grant Full Access", () => {
  assert.equal(
    updateMobileChannelConnectionSchema.safeParse({ permissionMode: "default" })
      .success,
    true
  )
  assert.equal(
    updateMobileChannelConnectionSchema.safeParse({
      permissionMode: "full_access",
    }).success,
    false
  )
  assert.equal(
    updateMobileChannelConnectionSchema.safeParse({ permissionMode: "auto" })
      .success,
    false
  )
  assert.equal(
    updateMobileChannelConnectionSchema.safeParse({
      permissionMode: "unrestricted",
    }).success,
    false
  )
})

test("mobile runtime metadata cannot select hidden native runtimes", () => {
  const forgedNativeSelection = resolveMobileChannelPreferences({
    agentRuntimeId: "opencode-native",
    chatModel: "gpt-5.6-sol",
    reasoningEffort: "medium",
    permissionMode: "default",
    defaultProjectId: null,
  })
  const publicOpenCodeSelection = resolveMobileChannelPreferences({
    agentRuntimeId: "opencode",
    chatModel: "gpt-5.6-sol",
    reasoningEffort: "medium",
    permissionMode: "default",
    defaultProjectId: null,
  })

  assert.equal(forgedNativeSelection.runtimeId, "astraflow")
  assert.equal(publicOpenCodeSelection.runtimeId, "opencode")
})
