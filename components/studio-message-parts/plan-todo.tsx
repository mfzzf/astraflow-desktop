import { RiCheckLine } from "@remixicon/react"

import type { StudioMessagePart } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { assistantTraceContainerClassName } from "./shared"

export function AssistantPlan({
  todos,
}: {
  todos: Extract<StudioMessagePart, { type: "plan" }>["todos"]
}) {
  if (todos.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground"
      )}
    >
      <ul className="flex flex-col gap-1.5">
        {todos.map((todo) => (
          <li
            key={`${todo.status}-${todo.text}`}
            className={cn(
              "flex min-w-0 items-start gap-2",
              todo.status === "completed" && "text-muted-foreground",
              todo.status === "in_progress" && "text-primary"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                todo.status === "completed" &&
                  "border-primary bg-primary text-primary-foreground",
                todo.status === "in_progress" &&
                  "border-primary bg-primary/10 text-primary",
                todo.status === "pending" && "border-border bg-background"
              )}
            >
              {todo.status === "completed" ? (
                <RiCheckLine aria-hidden className="size-3" />
              ) : todo.status === "in_progress" ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </span>
            <span
              className={cn(
                "min-w-0 leading-5",
                todo.status === "completed" &&
                  "line-through decoration-muted-foreground/70"
              )}
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
