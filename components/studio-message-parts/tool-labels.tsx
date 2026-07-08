import { Shimmer } from "@/components/ai-elements/shimmer"
import type { useI18n } from "@/components/i18n-provider"
import { getMcpToolDisplayName, isMcpToolName } from "@/lib/mcp"
import type { StudioMessageActivity } from "@/lib/studio-types"

import {
  assistantTraceLabelClassName,
  commandToolNames,
  fileToolNames,
  formatCommandActivityLabel,
  formatGenericToolActivityLabel,
  getFileActivityTarget,
  getRunCodePayload,
  getRunCommandPayload,
  getSandboxHostToolPort,
  getSkillToolSlug,
  getWebFetchUrl,
  getWebSearchQuery,
  isZhLocale,
} from "./shared"
import { FileTypeBadge, getFilePathName, getWrittenFileInfo } from "./file-output"

function getActivityLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status === "error") {
    return t.studioToolError
  }

  if (activity.toolName === "web_fetch") {
    const url = getWebFetchUrl(activity.input)

    return activity.status === "running"
      ? t.studioToolFetching(url)
      : t.studioToolFetched(url)
  }

  if (activity.toolName === "run_code") {
    const { language } = getRunCodePayload(activity.input)

    return activity.status === "running"
      ? t.studioToolRunningCode(language)
      : t.studioToolRanCode(language)
  }

  if (commandToolNames.has(activity.toolName)) {
    const { command } = getRunCommandPayload(activity.input)

    return formatCommandActivityLabel({
      command,
      running: activity.status === "running",
      t,
    })
  }

  if (activity.toolName === "sandbox_get_host") {
    const port = getSandboxHostToolPort(activity.input)

    return activity.status === "running"
      ? t.studioToolResolvingHost(port)
      : t.studioToolResolvedHost(port)
  }

  if (fileToolNames.has(activity.toolName)) {
    const target = getFileActivityTarget(activity)

    if (activity.toolName === "upload_file") {
      return activity.status === "running"
        ? t.studioToolUploadingFile(target)
        : t.studioToolUploadedFile(target)
    }

    if (activity.toolName === "list_files") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "ls" || activity.toolName === "glob") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "read_file") {
      return activity.status === "running"
        ? t.studioToolReadingFile(target)
        : t.studioToolReadFile(target)
    }

    if (activity.toolName === "grep") {
      return activity.status === "running"
        ? t.studioToolSearching(target)
        : t.studioToolAnalyzed(target)
    }

    if (
      activity.toolName === "write_file" ||
      activity.toolName === "edit_file"
    ) {
      return activity.status === "running"
        ? t.studioToolWritingFile(target)
        : t.studioToolWroteFile(target)
    }

    return activity.status === "running"
      ? t.studioToolSavingFile(target)
      : t.studioToolSavedFile(target)
  }

  if (activity.toolName === "list_installed_skills") {
    return activity.status === "running"
      ? t.studioToolListingSkills
      : t.studioToolListedSkills
  }

  if (activity.toolName === "list_installed_mcp_servers") {
    return activity.status === "running"
      ? t.studioToolListingMcpServers
      : t.studioToolListedMcpServers
  }

  if (activity.toolName === "load_skill") {
    const slug = getSkillToolSlug(activity.input)

    return activity.status === "running"
      ? t.studioToolLoadingSkill(slug)
      : t.studioToolLoadedSkill(slug)
  }

  if (
    activity.toolName === "studio_list_image_models" ||
    activity.toolName === "studio_list_video_models" ||
    activity.toolName === "studio_list_media_generation_models"
  ) {
    const isZh = isZhLocale(t)
    const label =
      activity.toolName === "studio_list_image_models"
        ? isZh
          ? "图像模型"
          : "image models"
        : activity.toolName === "studio_list_video_models"
          ? isZh
            ? "视频模型"
            : "video models"
          : isZh
            ? "媒体模型"
            : "media models"

    return activity.status === "running"
      ? isZh
        ? `正在查看${label}`
        : `Listing ${label}`
      : isZh
        ? `已查看${label}`
        : `Listed ${label}`
  }

  if (
    activity.toolName === "studio_list_media_generations" ||
    activity.toolName === "studio_get_media_generation"
  ) {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在查看媒体生成"
        : "Reading media generations"
      : isZh
        ? "已查看媒体生成"
        : "Read media generations"
  }

  if (activity.toolName === "studio_generate_image") {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在生成图像"
        : "Generating image"
      : isZh
        ? "已生成图像"
        : "Generated image"
  }

  if (activity.toolName === "studio_generate_video") {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在提交视频生成"
        : "Submitting video generation"
      : isZh
        ? "已提交视频生成"
        : "Submitted video generation"
  }

  if (isMcpToolName(activity.toolName)) {
    const toolName = getMcpToolDisplayName(activity.toolName)

    return activity.status === "running"
      ? t.studioToolCallingMcpTool(toolName)
      : t.studioToolCalledMcpTool(toolName)
  }

  if (activity.toolName === "web_search") {
    const query = getWebSearchQuery(activity.input)

    return activity.status === "running"
      ? t.studioToolSearching(query)
      : t.studioToolAnalyzed(query)
  }

  return formatGenericToolActivityLabel({
    running: activity.status === "running",
    toolName: activity.toolName,
    t,
  })
}

type StructuredActivityLabel = {
  prefix: string
  detail?: string
  filePath?: string
}

// Split completed activity labels into a short verb and the affected command or file.
function getStructuredActivityLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
): StructuredActivityLabel | null {
  if (activity.status !== "complete") {
    return null
  }

  const isZh = t.studioThinking === "正在思考"

  if (commandToolNames.has(activity.toolName)) {
    const { command } = getRunCommandPayload(activity.input)

    if (command) {
      return { prefix: isZh ? "已运行" : "Ran", detail: command }
    }
  }

  if (activity.toolName === "run_code") {
    const { code, language } = getRunCodePayload(activity.input)

    if (code) {
      return {
        prefix: isZh ? `已运行 ${language}` : `Ran ${language}`,
        detail: code.split(/\r?\n/)[0] ?? "",
      }
    }
  }

  if (activity.toolName === "write_file" || activity.toolName === "edit_file") {
    const info = getWrittenFileInfo(activity)

    if (info) {
      return {
        prefix:
          info.kind === "create"
            ? isZh
              ? "已写入"
              : "Wrote"
            : isZh
              ? "已更新"
              : "Updated",
        filePath: info.path,
      }
    }
  }

  return null
}

export function renderActivityInlineLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  const structured = getStructuredActivityLabel(activity, t)

  if (structured) {
    return (
      <span className="flex max-w-full min-w-0 items-center gap-1.5 leading-6">
        <span className="shrink-0 font-medium text-foreground">
          {structured.prefix}
        </span>
        {structured.filePath ? (
          <>
            <FileTypeBadge path={structured.filePath} />
            <span className="min-w-0 truncate font-medium text-foreground">
              {getFilePathName(structured.filePath)}
            </span>
          </>
        ) : null}
        {structured.detail ? (
          <span className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">
            {structured.detail}
          </span>
        ) : null}
      </span>
    )
  }

  const label =
    activity.status === "error"
      ? t.studioToolError
      : getActivityLabel(activity, t)

  return (
    <span className={assistantTraceLabelClassName}>
      {activity.status === "running" ? (
        <Shimmer as="span">{label}</Shimmer>
      ) : (
        label
      )}
    </span>
  )
}
