import * as React from "react"

import type { useI18n } from "@/components/i18n-provider"
import { normalizeCommandToolResult } from "@/lib/agent/tool-payload"
import type { StudioMessageActivity } from "@/lib/studio-types"
import type { StudioWorkspaceServiceContext } from "@/lib/studio-workspace-service-result"

import type { MessageRenderEnvironment } from "./types"

export const MessageRenderEnvironmentContext =
  React.createContext<MessageRenderEnvironment>("local")

export function useMessageRenderEnvironment() {
  return React.useContext(MessageRenderEnvironmentContext)
}

export const StudioWorkspaceServiceIdentityContext =
  React.createContext<StudioWorkspaceServiceContext | null>(null)

export function useStudioWorkspaceServiceContext() {
  return React.useContext(StudioWorkspaceServiceIdentityContext)
}

export function canOpenMessageLinksInWorkspace(
  environment: MessageRenderEnvironment
) {
  return environment === "local" || environment === "remote"
}

// When the completed-turn activity summary renders write activities inside
// its collapsible, the open-file cards are lifted out and rendered by the
// message renderer instead.
export const SuppressWrittenFileOpenCardsContext = React.createContext(false)

export const markdownClassName =
  "max-w-none text-foreground [--markdown-font-size:15px] [--markdown-line-height:24px]"

export const reasoningMarkdownClassName =
  "max-w-none text-muted-foreground [--markdown-font-size:13px] [--markdown-line-height:21px] [--markdown-heading-scale:0.9]"

export const assistantTraceContainerClassName =
  "not-prose my-0 text-muted-foreground"

export const assistantTraceTriggerClassName =
  "min-h-7 max-w-full text-sm leading-6 [&>div]:min-w-0 [&>div]:gap-2 [&>div>span:last-child]:min-w-0"

export const assistantTraceLabelClassName =
  "block max-w-full truncate leading-6"

export const fileToolNames = new Set([
  "read",
  "edit",
  "write",
  "find",
  "upload_file",
  "list_files",
  "read_file",
  "write_file",
  "download_file",
  "ls",
  "edit_file",
  "glob",
  "grep",
])

export const commandToolNames = new Set([
  "bash",
  "run_command",
  "execute",
  "shell",
])

export const skillToolNames = new Set([
  "list_installed_skills",
  "list_installed_mcp_servers",
  "load_skill",
  "read_skill_file",
  "prepare_skill_sandbox",
])

export const planToolNames = new Set(["plan", "update_plan", "write_todos"])
export const subagentToolNames = new Set(["spawn_agent", "subagent", "task"])

export const mediaToolNames = new Set([
  "studio_list_image_models",
  "studio_list_video_models",
  "studio_list_media_generation_models",
  "studio_list_media_generations",
  "studio_get_media_generation",
  "studio_generate_image",
  "studio_generate_video",
])

export function getWebSearchQuery(input: string) {
  try {
    const parsed = JSON.parse(input) as { query?: unknown }

    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

export function getWebFetchUrl(input: string) {
  try {
    const parsed = JSON.parse(input) as { url?: unknown }

    if (typeof parsed.url === "string" && parsed.url.trim()) {
      return parsed.url.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

export function getRunCodePayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      code?: unknown
      language?: unknown
      auto_pause?: unknown
      sandbox_id?: unknown
    }

    return {
      code: typeof parsed.code === "string" ? parsed.code : input,
      language:
        typeof parsed.language === "string" && parsed.language.trim()
          ? parsed.language.trim()
          : "python",
      autoPause:
        typeof parsed.auto_pause === "boolean" ? parsed.auto_pause : null,
      sandboxId:
        typeof parsed.sandbox_id === "string" && parsed.sandbox_id.trim()
          ? parsed.sandbox_id.trim()
          : null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    code: input,
    language: "plaintext",
    autoPause: null,
    sandboxId: null,
  }
}

export function getRunCommandPayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      command?: unknown
      cwd?: unknown
      rawInput?: unknown
      title?: unknown
      workdir?: unknown
    }
    const rawInput =
      typeof parsed.rawInput === "object" && parsed.rawInput !== null
        ? (parsed.rawInput as Record<string, unknown>)
        : null
    const command =
      typeof parsed.command === "string"
        ? parsed.command
        : typeof rawInput?.command === "string"
          ? rawInput.command
          : typeof parsed.title === "string"
            ? parsed.title
            : input
    const cwd =
      typeof parsed.cwd === "string"
        ? parsed.cwd
        : typeof parsed.workdir === "string"
          ? parsed.workdir
          : typeof rawInput?.cwd === "string"
            ? rawInput.cwd
            : typeof rawInput?.workdir === "string"
              ? rawInput.workdir
              : null

    return {
      command,
      cwd: cwd?.trim() || null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    command: input,
    cwd: null,
  }
}

export function getRunCommandResult(output: string) {
  return normalizeCommandToolResult(output)
}

export function getRunCommandActivityResult(activity: StudioMessageActivity) {
  const output = activity.output.trim()
  const error = activity.error?.trim() ?? ""
  const outputResult = getRunCommandResult(output)
  const errorResult = getRunCommandResult(error)
  const rawOutput = outputResult.isProcessResult
    ? output
    : errorResult.isProcessResult
      ? error
      : activity.status === "error"
        ? error || output
        : output
  const result = getRunCommandResult(rawOutput)
  const outputWithError =
    activity.status === "error" &&
    outputResult.isProcessResult &&
    error &&
    !errorResult.isProcessResult &&
    !result.output.includes(error)
      ? [result.output.trimEnd(), error].filter(Boolean).join("\n")
      : result.output

  return {
    ...result,
    output: outputWithError,
    failed: activity.status === "error" || result.failed,
    rawOutput,
  }
}

export function isCommandProcessResult(activity: StudioMessageActivity) {
  const { isProcessResult } = getRunCommandActivityResult(activity)

  return (
    activity.status !== "running" &&
    commandToolNames.has(activity.toolName) &&
    isProcessResult
  )
}

export function formatCommandActivityLabel({
  command,
  running,
  t,
}: {
  command: string
  running: boolean
  t: ReturnType<typeof useI18n>["t"]
}) {
  const isZh = t.studioThinking === "正在思考"
  const fallback = running
    ? isZh
      ? command
        ? `正在执行命令 ${command}`
        : "正在执行命令"
      : command
        ? `Running command ${command}`
        : "Running command"
    : isZh
      ? command
        ? `已执行命令 ${command}`
        : "已执行命令"
      : command
        ? `Ran command ${command}`
        : "Ran command"
  const formatter = running
    ? (t as Partial<typeof t>).studioToolRunningCommand
    : (t as Partial<typeof t>).studioToolRanCommand

  return typeof formatter === "function" ? formatter(command) : fallback
}

export function formatGenericToolActivityLabel({
  running,
  toolName,
  t,
}: {
  running: boolean
  toolName: string
  t: ReturnType<typeof useI18n>["t"]
}) {
  const displayName = t.studioToolDisplayName(toolName)

  return running
    ? t.studioToolCallingGeneric(displayName)
    : t.studioToolCalledGeneric(displayName)
}

export function isZhLocale(t: ReturnType<typeof useI18n>["t"]) {
  return t.studioThinking === "正在思考"
}

export function parseToolInputObject(input: string) {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>

    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export function getFileToolTarget(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const path = typeof parsed.path === "string" ? parsed.path.trim() : ""
  const filePath =
    typeof parsed.file_path === "string" ? parsed.file_path.trim() : ""
  const camelFilePath =
    typeof parsed.filePath === "string" ? parsed.filePath.trim() : ""
  const absolutePath =
    typeof parsed.absolute_path === "string" ? parsed.absolute_path.trim() : ""
  const camelAbsolutePath =
    typeof parsed.absolutePath === "string" ? parsed.absolutePath.trim() : ""
  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  const fileId = typeof parsed.file_id === "string" ? parsed.file_id.trim() : ""
  const pattern =
    typeof parsed.pattern === "string" ? parsed.pattern.trim() : ""
  const query = typeof parsed.query === "string" ? parsed.query.trim() : ""

  return (
    camelAbsolutePath ||
    absolutePath ||
    camelFilePath ||
    filePath ||
    path ||
    name ||
    fileId ||
    pattern ||
    query ||
    ""
  )
}

export function getSandboxHostToolPort(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const port = parsed.port

  return typeof port === "number" || typeof port === "string"
    ? String(port).trim()
    : ""
}

export function getFileToolOutputTarget(output: string) {
  const parsed = parseToolInputObject(output)
  const parsedTarget = parsed ? getFileToolTarget(output) : ""

  if (parsedTarget) {
    return parsedTarget
  }

  const match = output.match(
    /^(?:Uploaded file|Saved sandbox file for download|Read file|Wrote file|Files in):\s*(.+)$/m
  )

  return match?.[1]?.trim() ?? ""
}

export function getFileActivityTarget(activity: StudioMessageActivity) {
  const inputTarget = getFileToolTarget(activity.input)
  const outputTarget = getFileToolOutputTarget(activity.output)

  return activity.status === "complete"
    ? outputTarget || inputTarget
    : inputTarget || outputTarget
}

export function getSkillToolSlug(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { slug?: unknown }).slug === "string"
    ) {
      return (parsed as { slug: string }).slug.trim()
    }
  } catch {
    // Tool input can be a plain string in streamed events.
  }

  return input.trim()
}

export function getSkillToolTarget(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const slug = typeof parsed.slug === "string" ? parsed.slug.trim() : ""
  const path = typeof parsed.path === "string" ? parsed.path.trim() : ""

  return [slug, path].filter(Boolean).join("/")
}
