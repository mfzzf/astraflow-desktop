import * as React from "react"

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type DialogIconHeaderTone = "secondary" | "destructive" | "primary"

type DialogIconHeaderProps = {
  icon: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  tone?: DialogIconHeaderTone
  className?: string
  iconClassName?: string
}

const dialogIconHeaderToneClassNames: Record<DialogIconHeaderTone, string> = {
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "bg-destructive/10 text-destructive",
  primary: "bg-primary/10 text-primary",
}

function DialogIconHeader({
  icon,
  title,
  description,
  tone = "secondary",
  className,
  iconClassName,
}: DialogIconHeaderProps) {
  return (
    <DialogHeader className={className}>
      <div
        className={cn(
          "mb-1 flex size-10 items-center justify-center rounded-2xl",
          dialogIconHeaderToneClassNames[tone],
          iconClassName
        )}
      >
        {icon}
      </div>
      <DialogTitle>{title}</DialogTitle>
      {description ? (
        <DialogDescription>{description}</DialogDescription>
      ) : null}
    </DialogHeader>
  )
}

export { DialogIconHeader }
