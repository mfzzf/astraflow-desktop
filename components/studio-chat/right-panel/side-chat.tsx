"use client"

import * as React from "react"
import { RiArrowUpLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { cn, createClientId } from "@/lib/utils"

import type { StudioSideChatMessage } from "../types"
import type { StudioRightPanelLabels } from "./labels"

const sideChatMessagesBySession = new Map<string, StudioSideChatMessage[]>()
const sideChatListeners = new Set<() => void>()
const EMPTY_SIDE_CHAT_MESSAGES: StudioSideChatMessage[] = []

function getSideChatKey(sessionId: string) {
  return sessionId || "draft"
}

// Pure snapshot: never mutates the store. Sessions are seeded lazily by
// ensureSideChatSession so server renders share no per-request state.
function getSideChatMessages(sessionId: string) {
  return (
    sideChatMessagesBySession.get(getSideChatKey(sessionId)) ??
    EMPTY_SIDE_CHAT_MESSAGES
  )
}

function ensureSideChatSession(
  sessionId: string,
  labels: StudioRightPanelLabels
) {
  const key = getSideChatKey(sessionId)

  if (sideChatMessagesBySession.has(key)) {
    return
  }

  sideChatMessagesBySession.set(key, [
    {
      id: "welcome",
      role: "assistant",
      content: labels.sideChatGreeting,
    },
  ])
  sideChatListeners.forEach((listener) => listener())
}

function appendSideChatMessage(sessionId: string, message: StudioSideChatMessage) {
  const key = getSideChatKey(sessionId)
  const current = sideChatMessagesBySession.get(key) ?? []

  sideChatMessagesBySession.set(key, [...current, message])
  sideChatListeners.forEach((listener) => listener())
}

function subscribeSideChat(listener: () => void) {
  sideChatListeners.add(listener)

  return () => {
    sideChatListeners.delete(listener)
  }
}

export function StudioRightPanelSideChat({
  labels,
  sessionId,
}: {
  labels: StudioRightPanelLabels
  sessionId: string
}) {
  const [draft, setDraft] = React.useState("")

  React.useEffect(() => {
    ensureSideChatSession(sessionId, labels)
  }, [sessionId, labels])

  const messages = React.useSyncExternalStore(
    subscribeSideChat,
    () => getSideChatMessages(sessionId),
    () => EMPTY_SIDE_CHAT_MESSAGES
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const content = draft.trim()

    if (!content) {
      return
    }

    appendSideChatMessage(sessionId, {
      id: createClientId(),
      role: "user",
      content,
    })
    setDraft("")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-2">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[88%] rounded-xl px-3 py-2 text-xs leading-5",
                message.role === "user"
                  ? "self-end bg-foreground text-background"
                  : "self-start bg-muted text-foreground"
              )}
            >
              {message.content}
            </div>
          ))}
        </div>
      </div>

      <form className="shrink-0 border-t p-3" onSubmit={handleSubmit}>
        {/* TODO: wire this to the main Studio composer submission pipeline. */}
        <div className="flex items-center gap-2 rounded-xl border bg-background p-1.5">
          <input
            value={draft}
            placeholder={labels.sideChatPlaceholder}
            className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="icon-sm" disabled={!draft.trim()}>
            <RiArrowUpLine aria-hidden className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
