import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { StudioMessageTodo } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import {
  assistantTraceContainerClassName,
  assistantTraceTriggerClassName,
} from "./shared"

export function getAssistantPlanProgress(todos: StudioMessageTodo[]) {
  const activeIndex = todos.findIndex((todo) => todo.status === "in_progress")
  const pendingIndex = todos.findIndex((todo) => todo.status === "pending")
  const currentIndex =
    activeIndex >= 0
      ? activeIndex
      : pendingIndex >= 0
        ? pendingIndex
        : Math.max(0, todos.length - 1)

  return {
    currentIndex,
    currentStep: todos.length > 0 ? currentIndex + 1 : 0,
    completedCount: todos.filter((todo) => todo.status === "completed").length,
    complete:
      todos.length > 0 && todos.every((todo) => todo.status === "completed"),
  }
}

export function isAssistantPlanComplete(todos: StudioMessageTodo[]) {
  return getAssistantPlanProgress(todos).complete
}

export function AssistantPlan({
  todos,
  partId,
  expandOnHover = false,
  inline = false,
}: {
  todos: StudioMessageTodo[]
  partId?: string
  expandOnHover?: boolean
  inline?: boolean
}) {
  const { t } = useI18n()

  if (todos.length === 0) {
    return null
  }

  const progress = getAssistantPlanProgress(todos)

  const planList = (
    <ul className="flex flex-col gap-2.5">
      {todos.map((todo, index) => {
        const active = index === progress.currentIndex && !progress.complete

        return (
          <li
            key={`${index}-${todo.text}`}
            className="flex min-w-0 items-start gap-2.5"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border bg-background",
                todo.status === "completed" &&
                  "border-primary/40 bg-primary/10 text-primary",
                active &&
                  "border-primary/60 text-primary ring-2 ring-primary/10",
                todo.status === "pending" &&
                  !active &&
                  "border-muted-foreground/35 text-muted-foreground"
              )}
              aria-hidden
            >
              {todo.status === "completed" ? (
                <RiCheckLine className="size-3" />
              ) : active ? (
                <span className="size-1.5 rounded-full bg-primary" />
              ) : null}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 text-sm leading-5 text-muted-foreground",
                active && "font-medium text-foreground"
              )}
            >
              {todo.text}
            </span>
          </li>
        )
      })}
    </ul>
  )

  const planItems = (
    <CardContent className="max-h-56 overflow-y-auto px-4 py-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {planList}
    </CardContent>
  )

  const progressBadge = (
    <Badge
      variant="outline"
      className="h-8 gap-2 border-border/80 bg-card px-3 text-sm font-normal text-muted-foreground shadow-sm"
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-full border",
          progress.complete
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-primary/40 text-primary"
        )}
        aria-hidden
      >
        {progress.complete ? (
          <RiCheckLine />
        ) : (
          <span className="size-1.5 rounded-full bg-primary" />
        )}
      </span>
      <span className="tabular-nums">
        {t.studioPlanStep(progress.currentStep, todos.length)}
      </span>
    </Badge>
  )

  if (inline) {
    return (
      <Collapsible
        className={cn(
          assistantTraceContainerClassName,
          "flex min-w-0 flex-col"
        )}
        data-studio-plan
        data-studio-message-part-id={partId}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              assistantTraceTriggerClassName,
              "group/plan-trigger flex w-fit items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                progress.complete
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-primary/40 text-primary"
              )}
              aria-hidden
            >
              {progress.complete ? (
                <RiCheckLine className="size-3" />
              ) : (
                <span className="size-1.5 rounded-full bg-primary" />
              )}
            </span>
            <span className="truncate">{t.studioPlanLabel}</span>
            <span className="shrink-0 text-xs text-muted-foreground/75 tabular-nums">
              {t.studioPlanStep(progress.currentStep, todos.length)}
            </span>
            <RiArrowDownSLine
              aria-hidden
              className="size-4 shrink-0 transition-transform group-data-[state=open]/plan-trigger:rotate-180"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 ml-2 border-l border-border/70 py-1 pl-4">
            {planList}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  if (expandOnHover) {
    return (
      <div
        className={cn(
          assistantTraceContainerClassName,
          "relative mx-auto flex w-full max-w-lg justify-center"
        )}
        data-studio-plan
        data-studio-message-part-id={partId}
      >
        <div className="group/plan pointer-events-auto relative w-fit">
          <div
            className="pointer-events-none invisible absolute bottom-full left-1/2 w-[min(32rem,calc(100vw-4rem))] -translate-x-1/2 translate-y-1 pb-2 opacity-0 transition-[opacity,transform,visibility] duration-150 ease-out group-hover/plan:visible group-hover/plan:translate-y-0 group-hover/plan:opacity-100 motion-reduce:transition-none"
          >
            <Card
              size="sm"
              className="gap-0 overflow-hidden rounded-2xl py-0 shadow-lg ring-border/70"
            >
              {planItems}
            </Card>
          </div>

          {progressBadge}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "relative mx-auto w-full max-w-lg pb-7"
      )}
      data-studio-plan
      data-studio-message-part-id={partId}
    >
      <Card
        size="sm"
        className="relative gap-0 overflow-visible rounded-2xl py-0 shadow-lg ring-border/70"
      >
        {planItems}

        <CardFooter className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 px-0">
          {progressBadge}
        </CardFooter>
      </Card>
    </div>
  )
}
