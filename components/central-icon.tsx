"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

const CENTRAL_ICON_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const CENTRAL_ICON_SLOT = "central-icon"
const CENTRAL_ICON_BASE_PATHS = {
  reversed: "/central-icons-reversed",
  fill: "/central-icons-fill",
} as const
type CentralIconVariant = keyof typeof CENTRAL_ICON_BASE_PATHS

type CentralIconProps = Omit<React.ComponentProps<"span">, "children"> & {
  name: string
  label?: string
  variant?: CentralIconVariant
}

function getCentralIconUrl(
  name: string,
  variant: CentralIconVariant = "reversed"
) {
  const normalized = name.endsWith(".svg") ? name.slice(0, -4) : name

  if (!CENTRAL_ICON_NAME_PATTERN.test(normalized)) {
    return null
  }

  return `${CENTRAL_ICON_BASE_PATHS[variant]}/${encodeURIComponent(normalized)}.svg`
}

const CentralIcon = React.forwardRef<HTMLSpanElement, CentralIconProps>(
  function CentralIcon(
    { name, label, variant, className, style, ...props },
    ref
  ) {
    const iconUrl = getCentralIconUrl(name, variant)

    if (!iconUrl) {
      return null
    }

    const mask = `url("${iconUrl}") center / contain no-repeat`

    return (
      <span
        {...props}
        ref={ref}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        data-slot={CENTRAL_ICON_SLOT}
        className={cn("inline-block size-4 shrink-0 bg-current", className)}
        style={{ WebkitMask: mask, mask, ...style }}
      />
    )
  }
)

function extendButtonIconChildSelectors(className: string) {
  let result = className

  result = result.replace(
    /\[&_svg:not\(\[class\*='opacity-'\]\)\]:([^\s"']+)/g,
    (match, utility) =>
      `${match} [&_[data-slot=${CENTRAL_ICON_SLOT}]:not([class*='opacity-'])]:${utility}`
  )
  result = result.replace(
    /((?:sm:|not-in-data-\[slot=input-group\]:)?\[&_svg:not\(\[class\*='size-'\]\)\]:[^\s"']+)/g,
    (match) =>
      `${match} ${match.replace(
        "[&_svg:not",
        `[&_[data-slot=${CENTRAL_ICON_SLOT}]:not`
      )}`
  )
  result = result.replace(
    /\[&_svg\]:([a-z0-9\-/[\].]+)/g,
    (_match, utility) =>
      `[&_svg,&_[data-slot=${CENTRAL_ICON_SLOT}]]:${utility}`
  )

  return result
}

CentralIcon.displayName = "CentralIcon"

export {
  CENTRAL_ICON_SLOT,
  CentralIcon,
  extendButtonIconChildSelectors,
  getCentralIconUrl,
}
export type { CentralIconProps, CentralIconVariant }
