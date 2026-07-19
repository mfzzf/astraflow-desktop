import * as React from "react"
import { RiArrowRightLine, RiPencilLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import type { StudioPermissionOption } from "@/lib/studio-types"

import {
  commandToolNames,
  fileToolNames,
  getFileToolTarget,
  getRunCommandPayload,
  getSkillToolTarget,
  skillToolNames,
} from "./shared"
import type { StudioPermissionPart, StudioPermissionStatus } from "./types"

const NETWORK_PERMISSION_TOOL_NAME = "network_access"

function isClaudeExitPlanMode(toolName: string) {
  return toolName.trim().toLowerCase().replace(/[^a-z]/g, "") === "exitplanmode"
}

function getPermissionDecisionStatus(option: StudioPermissionOption) {
  return option.kind.startsWith("allow")
    ? ("approved" as const)
    : ("denied" as const)
}

function getPermissionCommand(part: StudioPermissionPart) {
  if (!commandToolNames.has(part.toolName)) {
    return ""
  }

  return getRunCommandPayload(part.input).command.trim()
}

function getNetworkPermissionTarget(part: StudioPermissionPart) {
  if (part.toolName !== NETWORK_PERMISSION_TOOL_NAME) {
    return ""
  }

  try {
    const input = JSON.parse(part.input) as {
      host?: unknown
      port?: unknown
    }
    const host = typeof input.host === "string" ? input.host.trim() : ""
    const port =
      typeof input.port === "number" && Number.isInteger(input.port)
        ? input.port
        : null

    if (!host) {
      return part.input.trim()
    }

    if (port === null) {
      return host
    }

    return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`
  } catch {
    return part.input.trim()
  }
}

function getPermissionPreview(part: StudioPermissionPart) {
  const command = getPermissionCommand(part)
  const networkTarget = getNetworkPermissionTarget(part)
  // Prefer a human-readable target over raw JSON input: a skill slug or a
  // file path explains the call at a glance; raw JSON is the last resort.
  const skillTarget = skillToolNames.has(part.toolName)
    ? getSkillToolTarget(part.input)
    : ""
  const fileTarget = fileToolNames.has(part.toolName)
    ? getFileToolTarget(part.input)
    : ""
  const rawInput = part.input.trim()
  // An empty JSON container carries no information — treat it as no input so
  // the panel does not render a meaningless "{}" block.
  const meaningfulInput =
    rawInput === "{}" || rawInput === "[]" ? "" : rawInput

  return {
    input:
      networkTarget ||
      command ||
      skillTarget ||
      fileTarget ||
      meaningfulInput,
    isCommand: Boolean(command),
    isNetwork: Boolean(networkTarget),
  }
}

export function getPermissionOptionDisplayName({
  option,
  part,
  t,
}: {
  option: StudioPermissionOption
  part: StudioPermissionPart
  t: ReturnType<typeof useI18n>["t"]
}) {
  const fallback = option.name || option.optionId
  const isZh = t.studioThinking === "正在思考"

  if (part.toolName === NETWORK_PERMISSION_TOOL_NAME) {
    if (option.kind === "allow_always" || option.kind === "reject_always") {
      return fallback
    }

    return option.kind.startsWith("allow")
      ? t.studioPermissionNetworkAllow
      : t.studioPermissionNetworkDeny
  }

  if (isClaudeExitPlanMode(part.toolName)) {
    switch (option.optionId) {
      case "auto":
        return t.studioClaudePlanApproveAuto
      case "acceptEdits":
        return t.studioClaudePlanApproveEdits
      case "default":
        return t.studioClaudePlanApproveManual
      case "bypassPermissions":
        return t.studioClaudePlanApproveBypass
      case "plan":
        return t.studioClaudePlanKeepPlanning
    }
  }

  if (!isZh) {
    return fallback
  }

  if (option.kind === "allow_always") {
    return fallback
  }

  if (option.kind.startsWith("allow")) {
    return "允许一次"
  }

  if (option.kind.startsWith("reject")) {
    return option.kind === "reject_once" ? "拒绝" : fallback
  }

  return fallback
}

export function getPermissionDecisionOptions(
  options: StudioPermissionOption[]
) {
  const feedbackRejectOption =
    options.find((option) => option.kind === "reject_once") ?? null

  return {
    feedbackRejectOption,
    immediateOptions: feedbackRejectOption
      ? options.filter(
          (option) => option.optionId !== feedbackRejectOption.optionId
        )
      : options,
  }
}

// Frosted-glass approval card that replaces the composer while the agent
// waits. Provider options keep their original order and scoped labels. The
// ordinary one-shot reject accepts optional feedback and submits with Enter.
export function PendingPermissionApprovalPanel({
  part,
  onDecision,
}: {
  part: StudioPermissionPart
  onDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: StudioPermissionStatus,
    feedback?: string
  ) => void
}) {
  const { t } = useI18n()
  const { feedbackRejectOption, immediateOptions } =
    getPermissionDecisionOptions(part.options)
  const [feedback, setFeedback] = React.useState("")
  const preview = getPermissionPreview(part)
  const isPlanExit = isClaudeExitPlanMode(part.toolName)
  const rejectLabel = feedbackRejectOption
    ? getPermissionOptionDisplayName({ option: feedbackRejectOption, part, t })
    : ""

  function submitOption(option: StudioPermissionOption | null) {
    if (!option) {
      return
    }

    const normalizedFeedback = feedback.trim()
    const feedbackForDecision = option.kind.startsWith("reject")
      ? normalizedFeedback || undefined
      : undefined

    onDecision(
      part.id,
      option,
      getPermissionDecisionStatus(option),
      feedbackForDecision
    )
  }

  return (
    <div className="animate-in rounded-3xl border border-border/60 bg-background/75 p-3.5 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl backdrop-saturate-150 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] leading-6 font-semibold text-foreground">
            {preview.isNetwork
              ? t.studioPermissionNetworkTitle
              : preview.isCommand
                ? t.studioPermissionApprovalCommandTitle
                : t.studioPermissionApprovalTitle}
          </h2>
          {preview.input ? (
            <pre className="mt-1.5 max-h-16 min-w-0 overflow-auto rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
              {preview.input}
            </pre>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          {preview.isNetwork
            ? t.studioPermissionNetworkBadge
            : t.studioToolDisplayName(part.toolName)}
        </Badge>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {immediateOptions.map((option, index) => {
          const label = getPermissionOptionDisplayName({ option, part, t })

          return (
            <button
              key={option.optionId}
              type="button"
              title={label}
              className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-muted/60"
              onClick={() => submitOption(option)}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-1 ring-border/70">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {label}
              </span>
            </button>
          )
        })}

        {feedbackRejectOption ? (
          <div className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-muted/60">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/70">
              <RiPencilLine aria-hidden className="size-3.5" />
            </span>
            <input
              value={feedback}
              placeholder={
                isPlanExit
                  ? rejectLabel
                  : t.studioPermissionFeedbackPlaceholder
              }
              aria-label={t.studioPermissionFeedbackPlaceholder}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submitOption(feedbackRejectOption)
                }
              }}
            />
            {feedback.trim() || isPlanExit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={
                  isPlanExit
                    ? rejectLabel
                    : t.studioPermissionFeedbackPlaceholder
                }
                className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => submitOption(feedbackRejectOption)}
              >
                <RiArrowRightLine aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {feedbackRejectOption ? (
        <div className="mt-1.5 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs text-muted-foreground"
            onClick={() => submitOption(feedbackRejectOption)}
          >
            {preview.isNetwork
              ? t.studioPermissionNetworkDeny
              : getPermissionOptionDisplayName({
                  option: feedbackRejectOption,
                  part,
                  t,
                })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
