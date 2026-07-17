import * as React from "react"
import {
  RiArrowRightLine,
  RiCloseLine,
  RiPencilLine,
} from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import type { StudioUserInputAnswer } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import type { StudioUserInputPart, StudioUserInputStatus } from "./types"

const USER_INPUT_OTHER_OPTION_ID = "__other__"

type UserInputSelection = {
  optionId: string
  text: string
}

function getUserInputLabels(t: ReturnType<typeof useI18n>["t"]) {
  const isZh = t.studioThinking === "正在思考"

  return isZh
    ? {
        recommended: "推荐",
        other: "其他",
        otherPlaceholder: "输入你的选择",
        skip: "跳过",
        close: "关闭",
        confirm: "确定",
      }
    : {
        recommended: "Recommended",
        other: "Other",
        otherPlaceholder: "Type your choice",
        skip: "Skip",
        close: "Close",
        confirm: "Confirm",
      }
}

function createUserInputSelections(
  part: StudioUserInputPart
): Record<string, UserInputSelection> {
  // Start with nothing selected: a pre-filled default would count as an
  // answer and let the first click submit every question with defaults.
  return Object.fromEntries(
    part.questions.map((question) => [
      question.id,
      { optionId: "", text: "" },
    ])
  )
}

function buildUserInputAnswers(
  part: StudioUserInputPart,
  selections: Record<string, UserInputSelection>
) {
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

// Frosted-glass decision card that replaces the composer while the agent
// waits. Options submit on a single click — once every question has an
// answer the card resolves immediately, without a separate submit button.
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
  const singleQuestion = part.questions.length === 1
  const canConfirm =
    buildUserInputAnswers(part, selections).length === part.questions.length

  function cancel() {
    onDecision(part.id, [], "cancelled")
  }

  function submitIfComplete(
    nextSelections: Record<string, UserInputSelection>
  ) {
    const answers = buildUserInputAnswers(part, nextSelections)

    if (answers.length === part.questions.length) {
      onDecision(part.id, answers, "answered")
    }
  }

  function confirm() {
    if (canConfirm) {
      onDecision(part.id, buildUserInputAnswers(part, selections), "answered")
    }
  }

  function chooseOption(questionId: string, optionId: string) {
    const nextSelections = {
      ...selections,
      [questionId]: {
        optionId,
        text: selections[questionId]?.text ?? "",
      },
    }

    setSelections(nextSelections)

    // Single-question cards decide on a single click. With several questions
    // a click only selects — submitting early would send the untouched
    // questions with no answer, so those use the confirm button instead.
    if (singleQuestion) {
      submitIfComplete(nextSelections)
    }
  }

  function updateOtherText(questionId: string, text: string) {
    setSelections((current) => ({
      ...current,
      [questionId]: { optionId: USER_INPUT_OTHER_OPTION_ID, text },
    }))
  }

  return (
    <div className="animate-in rounded-3xl border border-border/60 bg-background/75 p-3.5 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl backdrop-saturate-150 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      {part.questions.map((question, questionIndex) => {
        const selection = selections[question.id] ?? {
          optionId: "",
          text: "",
        }

        return (
          <section
            key={question.id}
            className={cn(
              questionIndex > 0 && "mt-3.5 border-t border-border/50 pt-3.5"
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                {question.header ? (
                  <div className="text-xs text-muted-foreground">
                    {question.header}
                  </div>
                ) : null}
                <h2 className="text-[15px] leading-6 font-semibold text-foreground">
                  {question.question}
                </h2>
              </div>
              {questionIndex === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.close}
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={cancel}
                >
                  <RiCloseLine aria-hidden />
                </Button>
              ) : null}
            </div>

            <div className="mt-2 flex flex-col gap-0.5">
              {question.options.map((option, index) => {
                const selected = selection.optionId === option.optionId

                return (
                  <button
                    key={option.optionId}
                    type="button"
                    aria-pressed={selected}
                    title={option.description || option.label}
                    className={cn(
                      "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150",
                      selected ? "bg-muted" : "hover:bg-muted/60"
                    )}
                    onClick={() => chooseOption(question.id, option.optionId)}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-1 ring-border/70">
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 truncate text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      {index === 0 ? (
                        <Badge
                          variant="secondary"
                          className="h-5 shrink-0 rounded-full px-1.5 text-[11px] font-normal"
                        >
                          {labels.recommended}
                        </Badge>
                      ) : null}
                      {option.description ? (
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}

              {question.allowOther ? (
                <div
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150",
                    selection.optionId === USER_INPUT_OTHER_OPTION_ID
                      ? "bg-muted"
                      : "hover:bg-muted/60"
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/70">
                    <RiPencilLine aria-hidden className="size-3.5" />
                  </span>
                  <input
                    type={question.isSecret ? "password" : "text"}
                    value={
                      selection.optionId === USER_INPUT_OTHER_OPTION_ID
                        ? selection.text
                        : ""
                    }
                    placeholder={`${labels.other}: ${labels.otherPlaceholder}`}
                    aria-label={labels.other}
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    onFocus={() =>
                      setSelections((current) => ({
                        ...current,
                        [question.id]: {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text:
                            current[question.id]?.optionId ===
                            USER_INPUT_OTHER_OPTION_ID
                              ? (current[question.id]?.text ?? "")
                              : "",
                        },
                      }))
                    }
                    onChange={(event) =>
                      updateOtherText(question.id, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        submitIfComplete(selections)
                      }
                    }}
                  />
                  {selection.optionId === USER_INPUT_OTHER_OPTION_ID &&
                  selection.text.trim() ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={labels.skip}
                      className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => submitIfComplete(selections)}
                    >
                      <RiArrowRightLine aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        )
      })}

      <div className="mt-1.5 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground"
          onClick={cancel}
        >
          {labels.skip}
        </Button>
        {singleQuestion ? null : (
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full bg-foreground px-4 text-xs text-background hover:bg-foreground/85"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {labels.confirm}
          </Button>
        )}
      </div>
    </div>
  )
}
