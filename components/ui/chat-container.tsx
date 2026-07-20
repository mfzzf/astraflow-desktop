"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

const STICK_TO_BOTTOM_OFFSET_PX = 70

export function canAutoScrollChat(escapedFromBottom: boolean) {
  return !escapedFromBottom
}

type ChatContainerContextValue = {
  scheduleScrollToBottom: () => void
  setContentElement: (element: HTMLDivElement | null) => void
}

const ChatContainerContext =
  React.createContext<ChatContainerContextValue | null>(null)

export type ChatContainerRootProps = {
  children: React.ReactNode
  className?: string
  followOutput?: boolean
} & React.HTMLAttributes<HTMLDivElement>

export type ChatContainerContentProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

export type ChatContainerScrollAnchorProps = {
  className?: string
  ref?: React.RefObject<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>

function ChatContainerRoot({
  children,
  className,
  followOutput = false,
  onKeyDown,
  onPointerDown,
  onPointerUp,
  onScroll,
  onWheel,
  ...props
}: ChatContainerRootProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const escapedFromBottomRef = React.useRef(false)
  const mutationObserverRef = React.useRef<MutationObserver | null>(null)
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const pendingFrameRef = React.useRef<number | null>(null)
  const pointerScrollingRef = React.useRef(false)

  const scrollToBottom = React.useCallback(() => {
    const element = scrollRef.current

    if (!element || !canAutoScrollChat(escapedFromBottomRef.current)) {
      return
    }

    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  }, [])

  const scheduleScrollToBottom = React.useCallback(() => {
    if (
      pendingFrameRef.current !== null ||
      !canAutoScrollChat(escapedFromBottomRef.current)
    ) {
      return
    }

    pendingFrameRef.current = window.requestAnimationFrame(() => {
      pendingFrameRef.current = null
      scrollToBottom()
    })
  }, [scrollToBottom])

  React.useEffect(() => {
    if (!followOutput) return

    escapedFromBottomRef.current = false
    scheduleScrollToBottom()
  }, [followOutput, scheduleScrollToBottom])

  const setContentElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      mutationObserverRef.current?.disconnect()
      mutationObserverRef.current = null
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null

      if (!element) {
        return
      }

      resizeObserverRef.current = new ResizeObserver(scheduleScrollToBottom)
      resizeObserverRef.current.observe(element)
      mutationObserverRef.current = new MutationObserver(scheduleScrollToBottom)
      mutationObserverRef.current.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      })
      scheduleScrollToBottom()
    },
    [scheduleScrollToBottom]
  )

  React.useEffect(
    () => () => {
      mutationObserverRef.current?.disconnect()
      resizeObserverRef.current?.disconnect()

      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current)
        pendingFrameRef.current = null
      }
    },
    []
  )

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      const distanceFromBottom =
        element.scrollHeight - element.clientHeight - element.scrollTop

      if (distanceFromBottom <= STICK_TO_BOTTOM_OFFSET_PX) {
        escapedFromBottomRef.current = false
      } else if (pointerScrollingRef.current) {
        escapedFromBottomRef.current = true
      }

      onScroll?.(event)
    },
    [onScroll]
  )

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        escapedFromBottomRef.current = true
      }

      onWheel?.(event)
    },
    [onWheel]
  )

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointerScrollingRef.current = true
      onPointerDown?.(event)
    },
    [onPointerDown]
  )

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointerScrollingRef.current = false
      onPointerUp?.(event)
    },
    [onPointerUp]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home"
      ) {
        escapedFromBottomRef.current = true
      } else if (event.key === "End") {
        escapedFromBottomRef.current = false
        scheduleScrollToBottom()
      }

      onKeyDown?.(event)
    },
    [onKeyDown, scheduleScrollToBottom]
  )

  const context = React.useMemo(
    () => ({ scheduleScrollToBottom, setContentElement }),
    [scheduleScrollToBottom, setContentElement]
  )

  return (
    <ChatContainerContext.Provider value={context}>
      <div
        ref={scrollRef}
        className={cn(
          "flex flex-col overflow-x-hidden overflow-y-auto",
          className
        )}
        style={{ scrollbarGutter: "stable" }}
        role="log"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onScroll={handleScroll}
        onWheel={handleWheel}
        {...props}
      >
        {children}
      </div>
    </ChatContainerContext.Provider>
  )
}

function ChatContainerContent({
  children,
  className,
  ...props
}: ChatContainerContentProps) {
  const context = React.useContext(ChatContainerContext)

  if (!context) {
    throw new Error(
      "ChatContainerContent must be used inside ChatContainerRoot."
    )
  }

  React.useLayoutEffect(() => {
    context.scheduleScrollToBottom()
  }, [children, context])

  return (
    <div
      ref={(element) => context.setContentElement(element)}
      className={cn("flex w-full shrink-0 flex-col", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ChatContainerScrollAnchor({
  className,
  ...props
}: ChatContainerScrollAnchorProps) {
  return (
    <div
      className={cn("h-px w-full shrink-0 scroll-mt-4", className)}
      aria-hidden="true"
      {...props}
    />
  )
}

export { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor }
