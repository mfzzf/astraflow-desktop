import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import type { useI18n } from "@/components/i18n-provider"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"
import type {
  StudioLocalProjectWithGitInfo,
  StudioSession,
} from "@/lib/studio-types"

import { DEFAULT_CHAT_RUNTIME_ID } from "./constants"
import type {
  BuiltinSlashCommandName,
  ComposerFileMention,
  ComposerMention,
  ComposerSessionMention,
  MentionToken,
  SlashCommandToken,
  WorkspaceFileCandidate,
} from "./types"

export function serializeComposerMentions(
  mentions: ComposerMention[]
): PromptMention[] {
  return mentions.map((mention) =>
    mention.kind === "session"
      ? {
          kind: "session",
          sessionId: mention.sessionId,
          title: mention.title,
        }
      : {
          kind: mention.kind,
          path: mention.path,
          name: mention.name,
        }
  )
}

export const BUILTIN_SLASH_COMMAND_NAMES = new Set<BuiltinSlashCommandName>([
  "clear",
  "model",
  "reasoning",
  "approve",
  "always",
  "deny",
  "compact",
  "export",
  "tools",
  "packages",
  "reload",
  "session",
  "undo",
  "redo",
  "checkpoint",
  "tree",
  "rewind",
])

export function isBuiltinSlashCommandName(
  name: string
): name is BuiltinSlashCommandName {
  return BUILTIN_SLASH_COMMAND_NAMES.has(
    name.toLowerCase() as BuiltinSlashCommandName
  )
}

export function getBuiltinSlashCommands(
  t: ReturnType<typeof useI18n>["t"],
  supportsCompact: boolean,
  supportsPiCommands = false
): SlashCommandDescriptor[] {
  const commands: SlashCommandDescriptor[] = [
    {
      name: "clear",
      description: t.studioCommandClearDescription,
      source: "builtin",
    },
    {
      name: "model",
      description: t.studioCommandModelDescription,
      inputHint: t.studioCommandModelInputHint,
      source: "builtin",
    },
    {
      name: "reasoning",
      description: t.studioCommandReasoningDescription,
      inputHint: t.studioCommandReasoningInputHint,
      source: "builtin",
    },
    {
      name: "approve",
      description: t.studioCommandApproveDescription,
      source: "builtin",
    },
    {
      name: "always",
      description: t.studioCommandAlwaysDescription,
      source: "builtin",
    },
    {
      name: "deny",
      description: t.studioCommandDenyDescription,
      source: "builtin",
    },
  ]

  if (supportsCompact) {
    commands.push({
      name: "compact",
      description: t.studioCommandCompactDescription,
      inputHint: t.studioCommandCompactInputHint,
      source: "builtin",
    })
  }

  commands.push({
    name: "session",
    description: t.studioCommandSessionDescription,
    source: "builtin",
  })
  commands.push({
    name: "export",
    description: t.studioCommandExportDescription,
    source: "builtin",
  })

  if (supportsPiCommands) {
    commands.push(
      {
        name: "tools",
        description: t.studioCommandToolsDescription,
        source: "builtin",
      },
      {
        name: "packages",
        description: t.studioCommandPackagesDescription,
        source: "builtin",
      },
      {
        name: "reload",
        description: t.studioCommandReloadDescription,
        source: "builtin",
      },
      {
        name: "undo",
        description: t.studioCommandUndoDescription,
        source: "builtin",
      },
      {
        name: "redo",
        description: t.studioCommandRedoDescription,
        source: "builtin",
      },
      {
        name: "checkpoint",
        description: t.studioCommandCheckpointDescription,
        source: "builtin",
      },
      {
        name: "tree",
        description: t.studioCommandTreeDescription,
        source: "builtin",
      },
      {
        name: "rewind",
        description: t.studioCommandRewindDescription,
        inputHint: t.studioCommandRewindInputHint,
        source: "builtin",
      }
    )
  }

  return commands
}

export function getSlashCommandTokenAtCursor(
  text: string,
  cursorPosition: number | null
): SlashCommandToken | null {
  if (cursorPosition === null) {
    return null
  }

  const cursor = Math.max(0, Math.min(cursorPosition, text.length))
  let start = cursor

  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1
  }

  const tokenBeforeCursor = text.slice(start, cursor)

  if (!/^\/[$A-Za-z0-9_:.\-]*$/.test(tokenBeforeCursor)) {
    return null
  }

  let end = cursor

  while (end < text.length && !/\s/.test(text[end])) {
    end += 1
  }

  return {
    start,
    end,
    prefix: tokenBeforeCursor.slice(1),
  }
}

export function getMentionTokenAtCursor(
  text: string,
  cursorPosition: number | null
): MentionToken | null {
  if (cursorPosition === null) {
    return null
  }

  const cursor = Math.max(0, Math.min(cursorPosition, text.length))
  let start = cursor

  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1
  }

  const tokenBeforeCursor = text.slice(start, cursor)

  if (!/^@[^\s]*$/.test(tokenBeforeCursor)) {
    return null
  }

  let end = cursor

  while (end < text.length && !/\s/.test(text[end])) {
    end += 1
  }

  return {
    start,
    end,
    prefix: tokenBeforeCursor.slice(1),
  }
}

export function normalizeMentionQuery(rawPrefix: string) {
  return rawPrefix.trim().replace(/^"/, "")
}

export function formatQuotedMentionValue(value: string) {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`
}

export function formatFileMentionReference(relativePath: string) {
  if (!/\s/.test(relativePath)) {
    return relativePath
  }

  return formatQuotedMentionValue(relativePath)
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function formatSessionMentionReference(title: string) {
  return `session:${formatQuotedMentionValue(title)}`
}

export function getFileMentionTokenPattern(relativePath: string) {
  const unquoted = escapeRegExp(relativePath)
  const quoted = escapeRegExp(formatFileMentionReference(relativePath))

  return `@(?:${quoted}|${unquoted})`
}

export function getSessionMentionTokenPattern(title: string) {
  return `@${escapeRegExp(formatSessionMentionReference(title))}`
}

export function getComposerMentionTokenPattern(mention: ComposerMention) {
  return mention.kind === "session"
    ? getSessionMentionTokenPattern(mention.title)
    : getFileMentionTokenPattern(mention.relativePath)
}

export function textHasComposerMentionToken(
  text: string,
  mention: ComposerMention
) {
  return new RegExp(
    `(^|\\s)${getComposerMentionTokenPattern(mention)}(?=$|\\s)`
  ).test(text)
}

export function removeComposerMentionTokenFromText(
  text: string,
  mention: ComposerMention
) {
  return text.replace(
    new RegExp(`(^|\\s)${getComposerMentionTokenPattern(mention)}(\\s|$)`, "g"),
    (_match, leading: string) => leading
  )
}

export function fileCandidateMatchesFilter(
  file: WorkspaceFileCandidate,
  rawFilter: string
) {
  const filter = normalizeMentionQuery(rawFilter).toLowerCase()

  if (!filter) {
    return true
  }

  return [file.name, file.relativePath]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(filter))
}

export function mergeComposerMention(
  mentions: ComposerMention[],
  file: WorkspaceFileCandidate
) {
  const nextMention: ComposerFileMention = {
    kind: file.kind,
    path: file.path,
    relativePath: file.relativePath,
    name: file.name,
  }
  const existingIndex = mentions.findIndex(
    (mention) => mention.kind === file.kind && mention.path === file.path
  )

  if (existingIndex === -1) {
    return [...mentions, nextMention]
  }

  return mentions.map((mention, index) =>
    index === existingIndex ? nextMention : mention
  )
}

export function mergeComposerSessionMention(
  mentions: ComposerMention[],
  session: StudioSession
) {
  const nextMention: ComposerSessionMention = {
    kind: "session",
    sessionId: session.id,
    title: session.title,
  }
  const existingIndex = mentions.findIndex(
    (mention) => mention.kind === "session" && mention.sessionId === session.id
  )

  if (existingIndex === -1) {
    return [...mentions, nextMention]
  }

  return mentions.map((mention, index) =>
    index === existingIndex ? nextMention : mention
  )
}

export function sessionCandidateMatchesFilter(
  session: StudioSession,
  rawFilter: string
) {
  const filter = normalizeMentionQuery(rawFilter).toLowerCase()

  if (!filter) {
    return true
  }

  return session.title.toLowerCase().includes(filter)
}

export function formatComposerSessionUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt)

  if (Number.isNaN(date.getTime())) {
    return updatedAt
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function commandMatchesFilter(
  command: SlashCommandDescriptor,
  rawFilter: string
) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [command.name, command.description, command.inputHint]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

export function getComposerSkillLabel(skill: InstalledSkill) {
  return skill.skill.Name || skill.slug
}

export function getComposerSkillDescription(
  skill: InstalledSkill,
  locale: string
) {
  return locale === "zh"
    ? skill.skill.DescZh || skill.skill.Desc
    : skill.skill.Desc
}

export function skillMatchesSlashFilter(
  skill: InstalledSkill,
  rawFilter: string
) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [skill.slug, skill.skill.Name, skill.skill.Desc, skill.skill.DescZh]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

export function getComposerMcpLabel(server: InstalledMcpServer) {
  return server.title || server.name
}

export function mcpMatchesSlashFilter(
  server: InstalledMcpServer,
  rawFilter: string
) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [server.id, server.name, server.title, server.description]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

export function formatSlashSkillPrompt(skillSlugs: string[], prompt: string) {
  const commands = skillSlugs
    .map((slug) => slug.trim())
    .filter(Boolean)
    .map((slug) => `/${slug}`)
  const task = prompt.trim()

  if (commands.length === 0) {
    return task
  }

  return [...commands, task].filter(Boolean).join(" ")
}

export function mergeSlashCommands(
  builtinCommands: SlashCommandDescriptor[],
  runtimeCommands: SlashCommandDescriptor[]
) {
  const seen = new Set<string>()
  const merged: SlashCommandDescriptor[] = []

  for (const command of [...builtinCommands, ...runtimeCommands]) {
    const key = command.name.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(command)
  }

  return merged
}

export function formatProjectGitMeta(
  project: StudioLocalProjectWithGitInfo,
  t: ReturnType<typeof useI18n>["t"]
) {
  const meta = [t.studioLocalProjectLocal]
  const isZh = t.studioThinking === "正在思考"

  if (project.git.branch) {
    meta.push(project.git.branch)
  }

  if (project.git.isDirty) {
    meta.push(t.studioLocalProjectDirty)
  }

  if (
    typeof project.git.changedFiles === "number" &&
    project.git.changedFiles > 0
  ) {
    meta.push(
      isZh
        ? `${project.git.changedFiles} 个文件`
        : `${project.git.changedFiles} files`
    )
  }

  if (
    typeof project.git.additions === "number" &&
    typeof project.git.deletions === "number" &&
    (project.git.additions > 0 || project.git.deletions > 0)
  ) {
    meta.push(`+${project.git.additions} -${project.git.deletions}`)
  }

  return meta.join(" · ")
}

export function getRuntimeGuideDescription(
  runtimeId: string,
  fallback: string,
  t: ReturnType<typeof useI18n>["t"]
) {
  switch (runtimeId) {
    case DEFAULT_CHAT_RUNTIME_ID:
      return t.studioAgentRuntimeAstraflowDescription
    case "codex":
    case "codex-direct":
      return t.studioAgentRuntimeCodexDescription
    case "claude-code":
    case "claude-native":
      return t.studioAgentRuntimeClaudeCodeDescription
    case "opencode":
    case "opencode-native":
      return t.studioAgentRuntimeOpenCodeDescription
    default:
      return fallback || t.studioAgentRuntimeDescription
  }
}

export function getReasoningEffortDescription(
  effort: ChatReasoningEffort,
  t: ReturnType<typeof useI18n>["t"]
) {
  switch (effort) {
    case "none":
      return t.studioReasoningNoneDescription
    case "enabled":
      return t.studioReasoningEnabledDescription
    case "minimal":
      return t.studioReasoningMinimalDescription
    case "low":
      return t.studioReasoningLowDescription
    case "medium":
      return t.studioReasoningMediumDescription
    case "high":
      return t.studioReasoningHighDescription
    case "xhigh":
      return t.studioReasoningXHighDescription
    case "max":
      return t.studioReasoningMaxDescription
  }
}
