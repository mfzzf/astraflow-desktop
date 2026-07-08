import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import type { StudioPermissionOption } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { commandToolNames, getRunCommandPayload } from "./shared"
import type { StudioPermissionPart, StudioPermissionStatus } from "./types"

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

function getPermissionPreview(part: StudioPermissionPart) {
  const command = getPermissionCommand(part)

  return {
    input: command || part.input.trim(),
    isCommand: Boolean(command),
  }
}

function getDefaultPermissionOption(options: StudioPermissionOption[]) {
  return (
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind.startsWith("allow")) ??
    options[0] ??
    null
  )
}

function getRejectPermissionOption(options: StudioPermissionOption[]) {
  return options.find((option) => option.kind.startsWith("reject")) ?? null
}

function getPermissionOptionDisplayName({
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

  if (!isZh) {
    return fallback
  }

  if (option.kind === "allow_always") {
    return getPermissionCommand(part)
      ? "是，并记住这类命令"
      : "是，并记住这类操作"
  }

  if (option.kind.startsWith("allow")) {
    return "是"
  }

  if (option.kind.startsWith("reject")) {
    return "否，请告诉 AstraFlow 如何调整"
  }

  return fallback
}

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
  const defaultOption = getDefaultPermissionOption(part.options)
  const rejectOption = getRejectPermissionOption(part.options)
  const [selection, setSelection] = React.useState(() => ({
    optionId: defaultOption?.optionId ?? "",
    requestId: part.id,
  }))
  const [feedback, setFeedback] = React.useState("")
  const selectedOptionId =
    selection.requestId === part.id
      ? selection.optionId
      : (defaultOption?.optionId ?? "")
  const selectedOption =
    part.options.find((option) => option.optionId === selectedOptionId) ??
    defaultOption
  const preview = getPermissionPreview(part)

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
    <div className="animate-in rounded-3xl border bg-background/98 p-3 shadow-xl ring-1 shadow-foreground/10 ring-foreground/5 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-5 font-semibold text-foreground">
            {preview.isCommand
              ? t.studioPermissionApprovalCommandTitle
              : t.studioPermissionApprovalTitle}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.studioPermissionApprovalDescription}
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          {part.toolName}
        </Badge>
      </div>

      <pre className="mt-3 max-h-20 min-w-0 overflow-auto rounded-2xl bg-muted/55 px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap text-foreground">
        {preview.input || t.studioPermissionNoInput}
      </pre>

      <div className="mt-3 flex flex-col gap-1 rounded-2xl bg-muted/45 p-1">
        {part.options.map((option, index) => {
          const selected = option.optionId === selectedOption?.optionId
          const label = getPermissionOptionDisplayName({ option, part, t })
          const isRejectOption = option.kind.startsWith("reject")
          const selectOption = () =>
            setSelection({ optionId: option.optionId, requestId: part.id })

          if (isRejectOption) {
            return (
              <div
                key={option.optionId}
                role="button"
                aria-pressed={selected}
                tabIndex={0}
                title={label}
                className={cn(
                  "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-all duration-150",
                  selected
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                    : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                )}
                onClick={selectOption}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) {
                    return
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    selectOption()
                  }
                }}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    selected
                      ? "bg-foreground text-background"
                      : "bg-background text-muted-foreground ring-1 ring-border"
                  )}
                >
                  {index + 1}
                </span>
                <input
                  value={feedback}
                  placeholder={t.studioPermissionFeedbackPlaceholder}
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onFocus={selectOption}
                  onChange={(event) => {
                    selectOption()
                    setFeedback(event.target.value)
                  }}
                />
              </div>
            )
          }

          return (
            <button
              key={option.optionId}
              type="button"
              aria-pressed={selected}
              title={label}
              className={cn(
                "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-all duration-150",
                selected
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                  : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
              )}
              onClick={() =>
                setSelection({ optionId: option.optionId, requestId: part.id })
              }
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  selected
                    ? "bg-foreground text-background"
                    : "bg-background text-muted-foreground ring-1 ring-border"
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {rejectOption ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs text-muted-foreground"
            onClick={() => submitOption(rejectOption)}
          >
            {t.studioPermissionSkip}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full bg-foreground px-4 text-xs text-background hover:bg-foreground/85"
          disabled={!selectedOption}
          onClick={() => submitOption(selectedOption)}
        >
          {t.studioPermissionSubmit}
        </Button>
      </div>
    </div>
  )
}
