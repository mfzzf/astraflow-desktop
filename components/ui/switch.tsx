"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

const SWITCH_TRACK_CLASS_NAME =
  "inline-flex h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2)] shrink-0 cursor-pointer items-center rounded-full border p-px outline-none transition-[background-color,box-shadow,border-color] duration-200 [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-unchecked:border-foreground/14 data-unchecked:bg-foreground/20 data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]"

const SWITCH_THUMB_CLASS_NAME =
  "pointer-events-none block aspect-square h-full origin-left translate-x-0 rounded-full bg-white shadow-sm ring-1 ring-black/5 will-change-transform [transition:translate_.2s_ease-out,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & { size?: "sm" | "default" }) {
  return (
    <SwitchPrimitive.Root
      className={cn(SWITCH_TRACK_CLASS_NAME, className)}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          SWITCH_THUMB_CLASS_NAME,
          "in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] data-checked:origin-[var(--thumb-size)_50%] data-checked:translate-x-[calc(var(--thumb-size)-4px)]"
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch, SWITCH_THUMB_CLASS_NAME, SWITCH_TRACK_CLASS_NAME }
