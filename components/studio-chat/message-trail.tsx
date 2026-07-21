"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import type { StudioMessage } from "@/lib/studio-types"
import {
  clampStudioMessageTrailTooltip,
  computeStudioMessageTrailFocusedIndex,
  computeStudioMessageTrailGeometry,
  computeStudioMessageTrailWeights,
  deriveStudioMessageTrailItems,
} from "@/lib/studio-message-trail"
import { cn } from "@/lib/utils"

const MIN_PANE_WIDTH = 864
const RAIL_WIDTH = 56
const TICK_LEFT = 14
const TICK_HEIGHT = 2
const TICK_BASE_WIDTH = 6
const TICK_MAX_WIDTH = 30
const TICK_REST_OPACITY = 0.2
const TICK_VISIBLE_OPACITY = 0.52
const TICK_ACTIVE_OPACITY = 0.9
const TOOLTIP_ESTIMATED_HEIGHT = 80

type TrailSnapshot = {
  currentId: string | null
  visibleIds: string[]
}

function sameSnapshot(left: TrailSnapshot, right: TrailSnapshot) {
  return (
    left.currentId === right.currentId &&
    left.visibleIds.length === right.visibleIds.length &&
    left.visibleIds.every((id, index) => id === right.visibleIds[index])
  )
}

function getMessageElement(scrollRoot: HTMLElement, id: string) {
  return Array.from(
    scrollRoot.querySelectorAll<HTMLElement>("[data-studio-message-id]")
  ).find((element) => element.dataset.studioMessageId === id)
}

export function StudioMessageTrail({
  messages,
}: {
  messages: readonly StudioMessage[]
}) {
  const { locale } = useI18n()
  const rootRef = React.useRef<HTMLElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const tickRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const items = React.useMemo(
    () => deriveStudioMessageTrailItems(messages),
    [messages]
  )
  const geometry = React.useMemo(
    () => computeStudioMessageTrailGeometry({ count: items.length }),
    [items.length]
  )
  const [hasGutter, setHasGutter] = React.useState(false)
  const [snapshot, setSnapshot] = React.useState<TrailSnapshot>({
    currentId: null,
    visibleIds: [],
  })
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null)
  const [tooltipTop, setTooltipTop] = React.useState(0)

  const visible = hasGutter && items.length > 1 && geometry !== null
  const selectedIndex = hoveredIndex ?? focusedIndex
  const activeIndex = items.findIndex((item) => item.id === snapshot.currentId)
  const visibleIds = React.useMemo(
    () => new Set(snapshot.visibleIds),
    [snapshot.visibleIds]
  )

  React.useEffect(() => {
    const pane = rootRef.current?.parentElement

    if (!pane || typeof ResizeObserver === "undefined") return

    let frame: number | null = null
    const measure = () => {
      frame = null
      setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH)
    }
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)

    observer.observe(pane)
    schedule()

    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  React.useEffect(() => {
    const pane = rootRef.current?.parentElement
    const scrollRoot = pane?.querySelector<HTMLElement>("[role='log']")

    if (!scrollRoot || items.length === 0) return

    let frame: number | null = null
    const update = () => {
      frame = null
      const viewport = scrollRoot.getBoundingClientRect()
      const readingLine = viewport.top + Math.min(120, viewport.height * 0.25)
      let currentId = items[0]?.id ?? null
      const nextVisibleIds: string[] = []

      for (const item of items) {
        const element = getMessageElement(scrollRoot, item.id)

        if (!element) continue

        const rect = element.getBoundingClientRect()

        if (rect.top <= readingLine) currentId = item.id
        if (rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
          nextVisibleIds.push(item.id)
        }
      }

      const next = { currentId, visibleIds: nextVisibleIds }
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next))
    }
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }

    scrollRoot.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    schedule()

    return () => {
      scrollRoot.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [items])

  const handleSelect = React.useCallback((id: string) => {
    const pane = rootRef.current?.parentElement
    const scrollRoot = pane?.querySelector<HTMLElement>("[role='log']")
    const target = scrollRoot ? getMessageElement(scrollRoot, id) : null

    target?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  const updateTooltipPosition = React.useCallback(
    (index: number) => {
      const viewport = viewportRef.current
      const tooltip = tooltipRef.current
      const centerY = geometry?.centerYs[index]

      if (!viewport || centerY === undefined) return

      setTooltipTop(
        viewport.offsetTop +
          clampStudioMessageTrailTooltip(
            centerY - viewport.scrollTop,
            tooltip?.offsetHeight || TOOLTIP_ESTIMATED_HEIGHT,
            viewport.clientHeight
          )
      )
    },
    [geometry]
  )

  if (!geometry) return null

  const focusedCenter =
    selectedIndex === null ? null : geometry.centerYs[selectedIndex]
  const weights =
    focusedCenter === null
      ? geometry.centerYs.map(() => 0)
      : computeStudioMessageTrailWeights(
          geometry.centerYs,
          focusedCenter,
          Math.min(22, Math.max(8, geometry.spacing * 1.5))
        )
  const tooltipItem = selectedIndex === null ? null : items[selectedIndex]

  return (
    <nav
      ref={rootRef}
      aria-hidden={!visible}
      aria-label={locale === "zh" ? "消息导航" : "Message navigation"}
      className={cn(
        "absolute inset-y-0 left-0 z-20 hidden flex-col justify-center transition-opacity duration-200 sm:flex motion-reduce:transition-none",
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      style={{ width: RAIL_WIDTH }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setFocusedIndex(null)
        }
      }}
      onKeyDown={(event) => {
        const current = focusedIndex ?? Math.max(0, activeIndex)
        let next = current

        if (event.key === "ArrowDown") next = Math.min(items.length - 1, current + 1)
        else if (event.key === "ArrowUp") next = Math.max(0, current - 1)
        else if (event.key === "Home") next = 0
        else if (event.key === "End") next = items.length - 1
        else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          handleSelect(items[current]!.id)
          return
        } else return

        event.preventDefault()
        setFocusedIndex(next)
        updateTooltipPosition(next)
        tickRefs.current[next]?.focus()
      }}
    >
      <div
        ref={viewportRef}
        className="studio-message-trail-scroll relative w-full overflow-y-auto overscroll-contain"
        style={{ maxHeight: "80%" }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return

          setHoveredIndex(null)
          if (focusedIndex !== null) updateTooltipPosition(focusedIndex)
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return

          const rect = event.currentTarget.getBoundingClientRect()
          const pointerY = event.clientY - rect.top + event.currentTarget.scrollTop
          const index = computeStudioMessageTrailFocusedIndex(pointerY, geometry)

          setHoveredIndex(index)
          updateTooltipPosition(index)
        }}
        onScroll={() => {
          if (selectedIndex !== null) updateTooltipPosition(selectedIndex)
        }}
      >
        <div className="relative w-full" style={{ height: geometry.contentHeight }}>
          {items.map((item, index) => {
            const isSelected = index === selectedIndex
            const isActive = index === activeIndex
            const opacity = isSelected
              ? 1
              : isActive
                ? TICK_ACTIVE_OPACITY
                : visibleIds.has(item.id)
                  ? TICK_VISIBLE_OPACITY
                  : TICK_REST_OPACITY

            return (
              <button
                ref={(element) => {
                  tickRefs.current[index] = element
                }}
                aria-current={isActive ? "location" : undefined}
                aria-label={`${locale === "zh" ? "消息" : "Message"} ${item.ordinal}: ${item.preview.slice(0, 60)}`}
                className="absolute rounded-full bg-foreground outline-none transition-[width,opacity] duration-100 ease-out focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                key={item.id}
                onClick={() => handleSelect(item.id)}
                onFocus={() => {
                  setFocusedIndex(index)
                  updateTooltipPosition(index)
                }}
                style={{
                  left: TICK_LEFT,
                  top: (geometry.centerYs[index] ?? 0) - TICK_HEIGHT / 2,
                  height: TICK_HEIGHT,
                  width:
                    TICK_BASE_WIDTH +
                    (TICK_MAX_WIDTH - TICK_BASE_WIDTH) * (weights[index] ?? 0),
                  opacity,
                }}
                tabIndex={
                  visible && index === Math.max(0, activeIndex) ? 0 : -1
                }
                type="button"
              />
            )
          })}
        </div>
      </div>

      <div
        ref={tooltipRef}
        aria-hidden={!tooltipItem}
        className={cn(
          "pointer-events-none absolute z-30 w-72 -translate-y-1/2 rounded-2xl border border-border/70 bg-popover/96 px-4 py-3 text-popover-foreground shadow-xl backdrop-blur-xl transition-[opacity,visibility] duration-150",
          tooltipItem ? "visible opacity-100" : "invisible opacity-0"
        )}
        role="tooltip"
        style={{ left: RAIL_WIDTH + 8, top: tooltipTop }}
      >
        <div className="line-clamp-2 text-sm leading-5 font-medium">
          {tooltipItem?.preview ||
            (locale === "zh" ? "包含附件的消息" : "Message with attachments")}
        </div>
        {tooltipItem?.responsePreview ? (
          <div className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">
            {tooltipItem.responsePreview}
          </div>
        ) : null}
      </div>
    </nav>
  )
}
