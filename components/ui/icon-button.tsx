"use client"

import { forwardRef, type ComponentProps, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { SynaraButton } from "./synara-button"
import {
  SynaraTooltip,
  SynaraTooltipPopup,
  SynaraTooltipTrigger,
} from "./synara-tooltip"

type IconButtonProps = Omit<
  ComponentProps<typeof SynaraButton>,
  "aria-label" | "children"
> & {
  label: string
  tooltip?: ReactNode
  tooltipAlign?: ComponentProps<typeof SynaraTooltipPopup>["align"]
  tooltipSide?: ComponentProps<typeof SynaraTooltipPopup>["side"]
  children: ReactNode
}

// Direct port of Synara's IconButton wrapper: one owner for the accessible
// label, Base UI trigger composition, sizing, and tooltip behavior.
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      tooltip,
      tooltipAlign = "center",
      tooltipSide = "top",
      title,
      className,
      size = "icon-xs",
      variant = "ghost",
      children,
      ...buttonProps
    },
    ref
  ) {
    if (tooltip === undefined || tooltip === null) {
      return (
        <SynaraButton
          {...buttonProps}
          ref={ref}
          aria-label={label}
          className={cn(
            "[&_svg,&_[data-slot=central-icon]]:mx-0",
            className
          )}
          size={size}
          title={title}
          variant={variant}
        >
          {children}
        </SynaraButton>
      )
    }

    return (
      <SynaraTooltip>
        <SynaraTooltipTrigger
          render={
            <SynaraButton
              {...buttonProps}
              ref={ref}
              aria-label={label}
              className={cn(
                "[&_svg,&_[data-slot=central-icon]]:mx-0",
                className
              )}
              size={size}
              title={title}
              variant={variant}
            />
          }
        >
          {children}
        </SynaraTooltipTrigger>
        <SynaraTooltipPopup align={tooltipAlign} side={tooltipSide}>
          {typeof tooltip === "string" ? <p>{tooltip}</p> : tooltip}
        </SynaraTooltipPopup>
      </SynaraTooltip>
    )
  }
)

export { IconButton }
export type { IconButtonProps }
