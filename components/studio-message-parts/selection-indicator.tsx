import { RiCheckLine } from "@remixicon/react"

import { cn } from "@/lib/utils"

// Radio-style indicator for the selectable option rows in pending-decision
// panels (user input, permission approval). It replaces the old numbered
// badges: a number reads as a keyboard shortcut hint, but no such shortcut
// exists, and the inverted circle was visually heavy for a radio choice.
export function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-transparent"
      )}
    >
      <RiCheckLine className="size-3" />
    </span>
  )
}
