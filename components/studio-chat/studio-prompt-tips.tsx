"use client"

import * as React from "react"
import { RiArrowRightUpLine, RiSparkling2Line } from "@remixicon/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

type StudioPromptTipsProps = {
  disabled?: boolean
  label: string
  onAsk: (prompt: string) => void
  prompts: readonly string[]
}

export function getNextStudioPromptTipState(
  index: number,
  direction: 1 | -1,
  promptCount: number
) {
  if (promptCount <= 1) {
    return { direction, index: 0 }
  }

  const reachedEnd = direction === 1 && index >= promptCount - 1
  const reachedStart = direction === -1 && index <= 0
  const nextDirection = reachedEnd ? -1 : reachedStart ? 1 : direction

  return {
    direction: nextDirection,
    index: index + nextDirection,
  }
}

export function StudioPromptTips({
  disabled = false,
  label,
  onAsk,
  prompts,
}: StudioPromptTipsProps) {
  const prefersReducedMotion = useReducedMotion()
  const [tipState, setTipState] = React.useState<{
    direction: 1 | -1
    index: number
  }>({ direction: 1, index: 0 })
  const [paused, setPaused] = React.useState(false)
  const prompt = prompts[tipState.index] ?? prompts[0] ?? ""

  React.useEffect(() => {
    if (paused || prefersReducedMotion || prompts.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setTipState((current) =>
        getNextStudioPromptTipState(
          current.index,
          current.direction,
          prompts.length
        )
      )
    }, 3200)

    return () => window.clearInterval(timer)
  }, [paused, prefersReducedMotion, prompts.length])

  if (!prompt) {
    return null
  }

  return (
    <button
      type="button"
      data-testid="studio-prompt-tips"
      disabled={disabled}
      aria-label={`${label}：${prompt}`}
      className={cn(
        "group mx-auto flex w-full max-w-lg items-center gap-2 rounded-full border border-border/70 bg-background/75 px-3 py-2 text-left shadow-[0_8px_24px_-18px_color-mix(in_srgb,var(--color-primary)_55%,transparent)] backdrop-blur-sm transition-[border-color,background-color,box-shadow,transform] duration-200",
        "hover:-translate-y-px hover:border-primary/30 hover:bg-primary/[0.045] hover:shadow-[0_12px_28px_-18px_color-mix(in_srgb,var(--color-primary)_70%,transparent)]",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50"
      )}
      onBlur={() => setPaused(false)}
      onClick={() => onAsk(prompt)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <RiSparkling2Line aria-hidden className="size-3.5" />
      </span>
      <span className="shrink-0 text-[11px] font-semibold tracking-wide text-primary">
        {label}
      </span>
      <span aria-hidden className="size-1 rounded-full bg-border" />
      <span className="relative h-4 min-w-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={prompt}
            initial={{
              opacity: 0,
              y: tipState.direction === 1 ? 12 : -12,
            }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: tipState.direction === 1 ? -12 : 12,
            }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 truncate text-xs leading-4 text-foreground/80"
          >
            {prompt}
          </motion.span>
        </AnimatePresence>
      </span>
      <RiArrowRightUpLine
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
      />
    </button>
  )
}
