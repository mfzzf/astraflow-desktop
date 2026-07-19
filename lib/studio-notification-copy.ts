import type { StudioMessagePart } from "@/lib/studio-types"

type PermissionPart = Extract<StudioMessagePart, { type: "permission" }>

function normalizeNotificationText(value: string, maximum = 160) {
  const normalized = value.replace(/\s+/g, " ").trim()

  if (!normalized || normalized === "{}" || normalized === "[]") return ""
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1).trimEnd()}…`
    : normalized
}

export function buildPermissionNotificationCopy({
  locale,
  part,
  sessionTitle,
}: {
  locale: "en" | "zh"
  part: PermissionPart
  sessionTitle: string
}) {
  const tool = normalizeNotificationText(part.toolName, 64)
  const input = normalizeNotificationText(part.input)
  const title = locale === "zh" ? "工具调用需要批准" : "Tool approval needed"
  const session = normalizeNotificationText(sessionTitle, 80)
  const detail = [session, tool, input].filter(Boolean).join(" · ")

  return {
    title,
    body:
      detail ||
      (locale === "zh"
        ? "AstraFlow 正在等待你的决定。"
        : "AstraFlow is waiting for your decision."),
    allowLabel: locale === "zh" ? "允许一次" : "Allow once",
    denyLabel: locale === "zh" ? "拒绝" : "Deny",
  }
}
