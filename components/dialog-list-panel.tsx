import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type DialogListSectionProps = {
  title: React.ReactNode
  action?: React.ReactNode
  count?: React.ReactNode
  countVariant?: React.ComponentProps<typeof Badge>["variant"]
  children: React.ReactNode
  className?: string
}

function DialogListSection({
  title,
  action,
  count,
  countVariant = "secondary",
  children,
  className,
}: DialogListSectionProps) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {action}
          {count !== undefined ? (
            <Badge variant={countVariant}>{count}</Badge>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function DialogListGrid({
  className,
  twoColumns = false,
  ...props
}: React.ComponentProps<"div"> & {
  twoColumns?: boolean
}) {
  return (
    <div
      className={cn("grid gap-2", twoColumns && "sm:grid-cols-2", className)}
      {...props}
    />
  )
}

function DialogListEmpty({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "rounded-2xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

const dialogListItemClassName =
  "rounded-2xl border bg-background px-3 py-2"
const dialogListMutedItemClassName =
  "rounded-2xl border bg-muted/25 px-3 py-2"
const dialogListDangerItemClassName =
  "rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"

export {
  DialogListEmpty,
  DialogListGrid,
  DialogListSection,
  dialogListDangerItemClassName,
  dialogListItemClassName,
  dialogListMutedItemClassName,
}
