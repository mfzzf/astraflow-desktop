import { cn } from "@/lib/utils"

type AppPageInsetVariant =
  | "catalog"
  | "embedded"
  | "market"
  | "standard"
  | "toolbar"

const appPageInsetClassNames: Record<
  Exclude<AppPageInsetVariant, "embedded">,
  { default: string; offset: string }
> = {
  catalog: {
    default: "p-4 lg:p-6",
    offset: "px-4 pt-14 pb-4 lg:px-6 lg:pt-16 lg:pb-6",
  },
  market: {
    default: "px-6 pt-3 lg:px-8",
    offset: "px-6 pt-14 lg:px-8 lg:pt-16",
  },
  standard: {
    default: "px-4 py-4 sm:px-6",
    offset: "px-4 pt-14 pb-4 sm:px-6 sm:pt-16",
  },
  toolbar: {
    default: "px-4 py-3 sm:px-6",
    offset: "px-4 pt-14 pb-3 sm:px-6 sm:pt-16",
  },
}

function getSidebarAwarePageInsetClassName({
  className,
  needsSidebarToggleOffset,
  variant,
}: {
  className?: string
  needsSidebarToggleOffset: boolean
  variant: AppPageInsetVariant
}) {
  if (variant === "embedded") {
    return cn("px-5 py-4", className)
  }

  const variantClassNames = appPageInsetClassNames[variant]

  return cn(
    needsSidebarToggleOffset
      ? variantClassNames.offset
      : variantClassNames.default,
    className
  )
}

export { getSidebarAwarePageInsetClassName }
