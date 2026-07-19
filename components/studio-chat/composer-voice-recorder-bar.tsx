import * as React from "react"
import {
  IconArrowUp,
  IconLoader2,
  IconPlayerStopFilled,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"

const BAR_WIDTH_PX = 2
const BAR_GAP_PX = 2
const BAR_MIN_HEIGHT_PX = 3
const BAR_MAX_HEIGHT_PX = 22

export const ComposerVoiceRecorderBar = React.memo(
  function ComposerVoiceRecorderBar({
    disabled,
    durationLabel,
    isTranscribing,
    labels,
    onStop,
    onSubmit,
    waveformLevels,
  }: {
    disabled?: boolean
    durationLabel: string
    isTranscribing: boolean
    labels: {
      stop: string
      submit: string
      transcribing: string
    }
    onStop: () => void
    onSubmit: () => void
    waveformLevels: readonly number[]
  }) {
    const trackRef = React.useRef<HTMLDivElement | null>(null)
    const [visibleBarCount, setVisibleBarCount] = React.useState(96)

    React.useEffect(() => {
      const node = trackRef.current

      if (!node) {
        return
      }

      const computeVisibleBars = () => {
        if (node.clientWidth > 0) {
          setVisibleBarCount(
            Math.max(
              8,
              Math.floor(node.clientWidth / (BAR_WIDTH_PX + BAR_GAP_PX))
            )
          )
        }
      }

      computeVisibleBars()
      const observer = new ResizeObserver(computeVisibleBars)
      observer.observe(node)

      return () => observer.disconnect()
    }, [])

    const visibleLevels = waveformLevels.slice(-visibleBarCount)

    return (
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
        <div
          ref={trackRef}
          className="relative flex h-7 min-w-0 flex-1 items-center overflow-hidden"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-border"
          />
          <div
            className="relative ml-auto flex h-full items-center"
            style={{ gap: `${BAR_GAP_PX}px` }}
          >
            {visibleLevels.map((level, index) => {
              const clamped = Math.max(0.04, Math.min(1, level))
              const height = Math.round(
                BAR_MIN_HEIGHT_PX +
                  clamped * (BAR_MAX_HEIGHT_PX - BAR_MIN_HEIGHT_PX)
              )

              return (
                <span
                  key={visibleLevels.length - index}
                  aria-hidden
                  className={cn(
                    "shrink-0 rounded-[1px] bg-foreground",
                    isTranscribing && "opacity-50"
                  )}
                  style={{ width: BAR_WIDTH_PX, height }}
                />
              )
            })}
          </div>
        </div>

        <span className="shrink-0 text-xs font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
          {durationLabel}
        </span>

        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={isTranscribing ? labels.transcribing : labels.stop}
          title={isTranscribing ? labels.transcribing : labels.stop}
          disabled={disabled || isTranscribing}
          onClick={onStop}
        >
          {isTranscribing ? (
            <IconLoader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <IconPlayerStopFilled aria-hidden className="size-3" />
          )}
        </button>

        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          aria-label={isTranscribing ? labels.transcribing : labels.submit}
          title={isTranscribing ? labels.transcribing : labels.submit}
          disabled={disabled || isTranscribing}
          onClick={onSubmit}
        >
          {isTranscribing ? (
            <IconLoader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <IconArrowUp aria-hidden className="size-4" stroke={2.25} />
          )}
        </button>
      </div>
    )
  }
)
