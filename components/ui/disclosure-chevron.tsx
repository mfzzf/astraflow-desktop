import { IconChevronRight } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

function DisclosureChevron({
  open,
  className,
}: {
  open: boolean
  className?: string
}) {
  return (
    <IconChevronRight
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground transition-transform duration-220 ease-out motion-reduce:transition-none",
        open && "rotate-90",
        className
      )}
    />
  )
}

export { DisclosureChevron }
