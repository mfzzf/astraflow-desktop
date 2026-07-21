import { getStudioToolDisplayName } from "@/lib/i18n"
import type {
  StudioMessage,
  StudioMessagePart,
  StudioSession,
} from "@/lib/studio-types"

const MAX_TRAY_TASKS = 5

type PendingPermissionPart = Extract<StudioMessagePart, { type: "permission" }>

export type StudioDesktopTask = {
  id: string
  title: string
  detail: string
  status: "running" | "waiting" | "recent"
  path: string
  updatedAt: string
}

export type StudioDesktopTaskSummary = {
  task: StudioDesktopTask
  pendingPermission: PendingPermissionPart | null
}

function getSessionHref(session: StudioSession) {
  return `/studio/${session.mode}/${encodeURIComponent(session.id)}`
}

function getLatestMatchingPart<T extends StudioMessagePart["type"]>(
  messages: readonly StudioMessage[],
  type: T,
  predicate: (part: Extract<StudioMessagePart, { type: T }>) => boolean
) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const parts = messages[messageIndex]?.parts ?? []

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]

      if (
        part?.type === type &&
        predicate(part as Extract<StudioMessagePart, { type: T }>)
      ) {
        return part as Extract<StudioMessagePart, { type: T }>
      }
    }
  }

  return null
}

function getRunningTool(messages: readonly StudioMessage[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const activities = messages[messageIndex]?.activities ?? []

    for (
      let activityIndex = activities.length - 1;
      activityIndex >= 0;
      activityIndex--
    ) {
      const activity = activities[activityIndex]

      if (activity?.status === "running") {
        return activity
      }
    }
  }

  return null
}

export function summarizeStudioDesktopTask(
  session: StudioSession,
  messages: readonly StudioMessage[],
  locale: "en" | "zh"
): StudioDesktopTaskSummary {
  const pendingPermission = getLatestMatchingPart(
    messages,
    "permission",
    (part) => part.status === "pending"
  )
  const pendingUserInput = getLatestMatchingPart(
    messages,
    "user_input",
    (part) => part.status === "pending"
  )
  const runningSubagent = getLatestMatchingPart(
    messages,
    "subagent",
    (part) => part.status === "running"
  )
  const runningMedia = getLatestMatchingPart(
    messages,
    "media_generation",
    (part) =>
      part.status === "queued" ||
      part.status === "running" ||
      part.status === "polling"
  )
  const runningTool = getRunningTool(messages)

  let status: StudioDesktopTask["status"] = session.isRunning
    ? "running"
    : "recent"
  let detail =
    session.workspace?.name?.trim() ||
    (locale === "zh" ? "最近任务" : "Recent task")

  if (pendingPermission) {
    status = "waiting"
    detail = `${locale === "zh" ? "等待批准" : "Approval needed"} · ${getStudioToolDisplayName(pendingPermission.toolName, locale)}`
  } else if (pendingUserInput) {
    status = "waiting"
    detail = locale === "zh" ? "等待你的输入" : "Waiting for your input"
  } else if (runningSubagent) {
    detail = `${locale === "zh" ? "子任务" : "Subtask"} · ${runningSubagent.nickname || runningSubagent.name}`
  } else if (runningMedia) {
    const mediaLabel =
      runningMedia.kind === "image"
        ? locale === "zh"
          ? "生成图像"
          : "Generating image"
        : locale === "zh"
          ? "生成视频"
          : "Generating video"
    detail = `${mediaLabel} · ${runningMedia.modelName}`
  } else if (runningTool) {
    detail = `${locale === "zh" ? "正在调用" : "Using"} · ${runningTool.title?.trim() || getStudioToolDisplayName(runningTool.toolName, locale)}`
  } else if (session.isRunning) {
    detail = locale === "zh" ? "正在处理" : "Working"
  }

  return {
    task: {
      id: session.id,
      title:
        session.title.trim() ||
        (locale === "zh" ? "未命名任务" : "Untitled task"),
      detail,
      status,
      path: getSessionHref(session),
      updatedAt: session.updatedAt,
    },
    pendingPermission,
  }
}

export function selectStudioDesktopTasks(
  sessions: readonly StudioSession[],
  messagesBySession: ReadonlyMap<string, readonly StudioMessage[]>,
  locale: "en" | "zh",
  limit = MAX_TRAY_TASKS
) {
  return sessions
    .filter((session) => !session.archivedAt)
    .toSorted((left, right) => {
      if (left.isRunning !== right.isRunning) {
        return left.isRunning ? -1 : 1
      }

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
    .slice(0, Math.max(0, limit))
    .map((session) =>
      summarizeStudioDesktopTask(
        session,
        messagesBySession.get(session.id) ?? [],
        locale
      )
    )
}
