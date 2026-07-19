import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-220 ease-out motion-reduce:transition-none"
const DISCLOSURE_CONTENT_MOTION_CLASS =
  "transition-[opacity,transform] duration-220 ease-out motion-reduce:transition-none"

function DisclosureRegion({
  open,
  children,
  className,
  contentClassName,
}: {
  open: boolean
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div
      className={cn(
        DISCLOSURE_SHELL_MOTION_CLASS,
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className
      )}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            DISCLOSURE_CONTENT_MOTION_CLASS,
            open
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-1 opacity-0",
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export { DisclosureRegion }
