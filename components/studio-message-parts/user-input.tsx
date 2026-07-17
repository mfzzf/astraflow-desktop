import * as React from "react"
import { RiQuestionLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import type { StudioUserInputAnswer, StudioUserInputOption } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import type { StudioUserInputPart, StudioUserInputStatus } from "./types"
import { SelectionIndicator } from "./selection-indicator"

const USER_INPUT_OTHER_OPTION_ID = "__other__"

type UserInputSelection = {
  optionId: string
  text: string
}

function getDefaultUserInputOption(options: StudioUserInputOption[]) {
  return options[0] ?? null
}

function getUserInputLabels(t: ReturnType<typeof useI18n>["t"]) {
  const isZh = t.studioThinking === "正在思考"

  return isZh
    ? {
        title: "请选择后继续",
        description: "AstraFlow 需要你确认一个偏好后继续。",
        other: "其他",
        otherPlaceholder: "输入你的选择",
        skip: "取消",
      }
    : {
        title: "Choose before continuing",
        description: "AstraFlow needs one preference before it continues.",
        other: "Other",
        otherPlaceholder: "Type your choice",
        skip: "Cancel",
      }
}

function createUserInputSelections(
  part: StudioUserInputPart
): Record<string, UserInputSelection> {
  return Object.fromEntries(
    part.questions.map((question) => {
      const defaultOption = getDefaultUserInputOption(question.options)

      return [
        question.id,
        {
          optionId:
            defaultOption?.optionId ??
            (question.allowOther ? USER_INPUT_OTHER_OPTION_ID : ""),
          text: "",
        },
      ]
    })
  )
}

export function PendingUserInputPanel({
  part,
  onDecision,
}: {
  part: StudioUserInputPart
  onDecision: (
    requestId: string,
    answers: StudioUserInputAnswer[],
    status: StudioUserInputStatus
  ) => void
}) {
  const { t } = useI18n()
  const labels = getUserInputLabels(t)
  const [selections, setSelections] = React.useState(() =>
    createUserInputSelections(part)
  )

  function updateSelection(questionId: string, selection: UserInputSelection) {
    setSelections((current) => ({
      ...current,
      [questionId]: selection,
    }))
  }

  function buildAnswers() {
    return part.questions
      .map((question) => {
        const selection = selections[question.id]
        const isOther = selection?.optionId === USER_INPUT_OTHER_OPTION_ID
        const option = isOther
          ? null
          : (question.options.find(
              (candidate) => candidate.optionId === selection?.optionId
            ) ?? null)
        const text = isOther ? selection.text.trim() : (option?.label ?? "")

        if (!text) {
          return null
        }

        return {
          questionId: question.id,
          optionId: option?.optionId ?? null,
          label: option?.label ?? null,
          text,
        } satisfies StudioUserInputAnswer
      })
      .filter((answer): answer is StudioUserInputAnswer => Boolean(answer))
  }

  const answers = buildAnswers()
  const canSubmit = answers.length === part.questions.length

  return (
    <div className="animate-in rounded-3xl border bg-background/98 p-3 shadow-xl ring-1 shadow-foreground/10 ring-foreground/5 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-5 font-semibold text-foreground">
            {labels.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {labels.description}
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          {t.studioToolDisplayName("request_user_input")}
        </Badge>
      </div>

      <div className="mt-3 space-y-3">
        {part.questions.map((question) => {
          const selection = selections[question.id] ?? {
            optionId: "",
            text: "",
          }

          return (
            <section key={question.id} className="space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  <RiQuestionLine aria-hidden className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">
                    {question.header}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {question.question}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl bg-muted/45 p-1">
                {question.options.map((option) => {
                  const selected = selection.optionId === option.optionId

                  return (
                    <button
                      key={option.optionId}
                      type="button"
                      aria-pressed={selected}
                      title={option.description || option.label}
                      className={cn(
                        "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-all duration-150",
                        selected
                          ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                          : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                      )}
                      onClick={() =>
                        updateSelection(question.id, {
                          optionId: option.optionId,
                          text: selection.text,
                        })
                      }
                    >
                      <SelectionIndicator selected={selected} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}

                {question.allowOther ? (
                  <div
                    role="button"
                    aria-pressed={
                      selection.optionId === USER_INPUT_OTHER_OPTION_ID
                    }
                    tabIndex={0}
                    className={cn(
                      "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-all duration-150",
                      selection.optionId === USER_INPUT_OTHER_OPTION_ID
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                        : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                    )}
                    onClick={() =>
                      updateSelection(question.id, {
                        optionId: USER_INPUT_OTHER_OPTION_ID,
                        text: selection.text,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) {
                        return
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: selection.text,
                        })
                      }
                    }}
                  >
                    <SelectionIndicator
                      selected={selection.optionId === USER_INPUT_OTHER_OPTION_ID}
                    />
                    <input
                      type={question.isSecret ? "password" : "text"}
                      value={selection.text}
                      placeholder={`${labels.other}: ${labels.otherPlaceholder}`}
                      className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      onFocus={() =>
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: selection.text,
                        })
                      }
                      onChange={(event) =>
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: event.target.value,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground"
          onClick={() => onDecision(part.id, [], "cancelled")}
        >
          {labels.skip}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full bg-foreground px-4 text-xs text-background hover:bg-foreground/85"
          disabled={!canSubmit}
          onClick={() => onDecision(part.id, answers, "answered")}
        >
          {t.studioPermissionSubmit}
        </Button>
      </div>
    </div>
  )
}
