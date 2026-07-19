"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

const COLLAPSIBLE_PANEL_CLASS =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-220 ease-out motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]"

function SynaraCollapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="synara-collapsible" {...props} />
}

function SynaraCollapsibleTrigger({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn("cursor-pointer", className)}
      data-slot="synara-collapsible-trigger"
      {...props}
    />
  )
}

function SynaraCollapsiblePanel({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(COLLAPSIBLE_PANEL_CLASS, className)}
      data-slot="synara-collapsible-panel"
      {...props}
    />
  )
}

export {
  SynaraCollapsible,
  SynaraCollapsiblePanel,
  SynaraCollapsibleTrigger,
}
