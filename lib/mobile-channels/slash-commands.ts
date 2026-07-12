export const MOBILE_CHANNEL_SLASH_COMMANDS_VERSION = "2026-07-12.1"

export const mobileChannelSlashCommands = [
  {
    name: "help",
    description: "Show the AstraFlow mobile control guide",
    descriptionZh: "查看 AstraFlow 移动控制使用说明",
  },
  {
    name: "new",
    description: "Start a new Agent conversation",
    descriptionZh: "新建一个 Agent 会话",
  },
  {
    name: "status",
    description: "Show the current task and model status",
    descriptionZh: "查看当前任务、模型和思考强度",
  },
  {
    name: "stop",
    description: "Stop the current Agent task",
    descriptionZh: "停止当前 Agent 任务",
  },
  {
    name: "model",
    description: "List or switch the model and reasoning effort",
    descriptionZh: "查看或切换模型及思考强度",
  },
  {
    name: "approve",
    description: "Approve the pending operation once",
    descriptionZh: "仅本次批准待处理操作",
  },
  {
    name: "always",
    description: "Always approve this kind of operation",
    descriptionZh: "始终批准同类操作",
  },
  {
    name: "deny",
    description: "Deny the pending operation",
    descriptionZh: "拒绝待处理操作",
  },
  {
    name: "bind",
    description: "Bind this chat with a code from AstraFlow Desktop",
    descriptionZh: "使用电脑端绑定码连接当前会话",
  },
] as const

export type MobileChannelSlashCommandName =
  (typeof mobileChannelSlashCommands)[number]["name"]

const primaryCommandNames = new Set<string>(
  mobileChannelSlashCommands.map((command) => command.name)
)
const supportedCommandNames = new Set<string>([
  ...primaryCommandNames,
  // These two commands are available only to the WeChat image draft flow,
  // but still need the same full-width slash and mention normalization.
  "send",
  "cancel",
])

const leadingAtTagPattern = /^\s*<at\b[^>]*>[\s\S]*?<\/at>\s*/i
const leadingDiscordMentionPattern = /^\s*<@!?[A-Za-z0-9:_-]+>\s*/
const leadingPlainMentionPattern = /^\s*@[^\s]+\s+(?=[/／])/u

function stripLeadingBotMentions(value: string) {
  let normalized = value
  while (true) {
    const next = normalized
      .replace(leadingAtTagPattern, "")
      .replace(leadingDiscordMentionPattern, "")
      .replace(leadingPlainMentionPattern, "")
    if (next === normalized) {
      return normalized
    }
    normalized = next
  }
}

/**
 * Normalizes the command shapes emitted by all supported chat clients while
 * leaving ordinary prompts (including unknown slash-prefixed prompts) intact.
 */
export function normalizeMobileChannelCommandText(
  text: string,
  { startAsBind = false }: { startAsBind?: boolean } = {}
) {
  const trimmed = text.trim()
  const withoutMention = stripLeadingBotMentions(trimmed)
  const withoutCommandPrefixFormatting = withoutMention.replace(
    /^[\u200B\u2060\uFEFF]+(?=[/／])/,
    ""
  )
  const commandCandidate = withoutCommandPrefixFormatting.startsWith("／")
    ? `/${withoutCommandPrefixFormatting.slice(1)}`
    : withoutCommandPrefixFormatting
  const match = commandCandidate.match(
    /^\/([a-z][a-z0-9_]*)(?:@[A-Za-z0-9_]+)?(?:[\s\u00A0]+([\s\S]*))?$/i
  )
  if (!match) {
    return trimmed
  }

  const incomingName = match[1].toLowerCase()
  const commandName =
    startAsBind && incomingName === "start" ? "bind" : incomingName
  if (!supportedCommandNames.has(commandName)) {
    return trimmed
  }

  const argument = match[2]?.trim()
  return `/${commandName}${argument ? ` ${argument}` : ""}`
}

export function telegramSlashCommandDefinitions(language: "en" | "zh") {
  return mobileChannelSlashCommands.map((command) => ({
    command: command.name,
    description:
      language === "zh" ? command.descriptionZh : command.description,
  }))
}

export function parseMobileChannelSlashCommand(text: string): {
  name: MobileChannelSlashCommandName
  argument: string
} | null {
  const normalized = normalizeMobileChannelCommandText(text)
  const match = normalized.match(/^\/([a-z][a-z0-9_]*)(?:\s+([\s\S]+))?$/)
  if (!match || !primaryCommandNames.has(match[1])) {
    return null
  }

  return {
    name: match[1] as MobileChannelSlashCommandName,
    argument: match[2]?.trim() ?? "",
  }
}
