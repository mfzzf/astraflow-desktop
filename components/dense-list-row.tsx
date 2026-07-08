import * as React from "react"

import { cn } from "@/lib/utils"

type DenseListRowProps = React.HTMLAttributes<HTMLElement> & {
  as?: "article" | "div"
  interactive?: boolean
}

function DenseListRow({
  as: Comp = "article",
  className,
  interactive = true,
  ...props
}: DenseListRowProps) {
  return (
    <Comp
      className={cn(
        "flex min-w-0 items-center gap-4 border-b py-3.5",
        interactive && "transition-colors hover:bg-muted/40",
        className
      )}
      {...props}
    />
  )
}

export { DenseListRow }
