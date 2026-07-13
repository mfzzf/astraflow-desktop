"use client"

import * as React from "react"

import { MessagePartsRenderer } from "@/components/studio-message-parts-renderer"
import { Message, MessageContent } from "@/components/ui/message"
import type { StudioMessagePart } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import type { ChatRunEnvironment, StudioSubagentPart } from "../types"

function getSubagentRenderableParts(
  subagent: StudioSubagentPart
): StudioMessagePart[] {
  const parts: StudioMessagePart[] = []

  if (subagent.todos.length > 0) {
    parts.push({
      id: `${subagent.id}:plan`,
      type: "plan",
      content: "",
      todos: subagent.todos,
    })
  }

  parts.push(
    ...subagent.activities.map((activity): StudioMessagePart => ({
      id: activity.id,
      type: "tool",
      activity,
    }))
  )

  const body = subagent.summary?.trim() || subagent.content.trim()

  if (body) {
    parts.push({
      id: `${subagent.id}:content`,
      type: "text",
      content: body,
    })
  }

  return parts
}

export function StudioRightPanelSubagentChat({
  subagent,
  sessionId,
  environment,
  workspaceRoot,
}: {
  subagent: StudioSubagentPart
  sessionId: string
  environment: ChatRunEnvironment
  workspaceRoot?: string | null
}) {
  const parts = React.useMemo(
    () => getSubagentRenderableParts(subagent),
    [subagent]
  )
  const taskInput = subagent.taskInput.trim()
  const error = subagent.error?.trim()

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {taskInput ? (
            <Message className="w-full justify-end">
              <div className="flex w-full flex-col items-end gap-2">
                <MessageContent
                  markdown
                  className="chatgpt-user-message w-fit max-w-[78%] rounded-[19px] bg-muted px-4 py-2.5 text-foreground [--markdown-font-size:14px] [--markdown-line-height:21px]"
                >
                  {taskInput}
                </MessageContent>
              </div>
            </Message>
          ) : null}

          <Message className="justify-start">
            <div className="flex w-full flex-col gap-2">
              <MessagePartsRenderer
                content=""
                activities={[]}
                parts={parts}
                sessionId={sessionId}
                workspaceRoot={workspaceRoot}
                streaming={subagent.status === "running"}
                environment={environment}
              />
              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
          </Message>

          {parts.length === 0 && !error ? (
            <div
              className={cn(
                "flex min-h-32 items-center justify-center rounded-xl border border-dashed",
                "text-sm text-muted-foreground"
              )}
            >
              {subagent.name}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
