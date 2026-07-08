import * as React from "react"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"

type SearchInputSize = "xs" | "sm" | "default"

type SearchInputBaseProps = Omit<
  React.ComponentProps<"input">,
  "onChange" | "size" | "value"
> & {
  value: string
  onValueChange: (value: string) => void
  clearLabel?: string
  clearable?: boolean
  containerClassName?: string
  inputClassName?: string
  size?: SearchInputSize
}

const tokenInputSizeClass: Record<SearchInputSize, string> = {
  xs: "h-7 rounded-(--radius-md) text-xs",
  sm: "h-8 rounded-(--radius-md) text-sm",
  default: "h-9 rounded-(--radius-md) text-sm",
}

const tokenIconSizeClass: Record<SearchInputSize, string> = {
  xs: "left-2.5 size-4",
  sm: "left-2.5 size-4",
  default: "left-3 size-4",
}

const panelInputSizeClass: Record<SearchInputSize, string> = {
  xs: "h-7 rounded-lg pl-7 text-xs",
  sm: "h-8 rounded-lg pl-8 text-xs",
  default: "h-9 rounded-lg pl-8 text-xs",
}

const panelIconSizeClass: Record<SearchInputSize, string> = {
  xs: "left-2 size-3.5",
  sm: "left-2.5 size-3.5",
  default: "left-2.5 size-3.5",
}

function TokenSearchInput({
  "aria-label": ariaLabel,
  clearLabel = "Clear search",
  clearable = false,
  containerClassName,
  inputClassName,
  onValueChange,
  placeholder,
  size = "sm",
  value,
  ...props
}: SearchInputBaseProps) {
  return (
    <div className={cn("no-drag relative", containerClassName)}>
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-token-description-foreground",
          tokenIconSizeClass[size]
        )}
      />
      <input
        {...props}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "w-full border border-token-border-light bg-token-input-background pl-8 outline-none placeholder:text-token-description-foreground focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/20",
          clearable ? "pr-8" : "pr-2.5",
          tokenInputSizeClass[size],
          inputClassName
        )}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {clearable && value ? (
        <button
          aria-label={clearLabel}
          className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-token-description-foreground hover:text-token-foreground"
          onClick={() => onValueChange("")}
          type="button"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

function PanelSearchInput({
  "aria-label": ariaLabel,
  containerClassName,
  inputClassName,
  onValueChange,
  placeholder,
  size = "default",
  value,
  ...props
}: SearchInputBaseProps) {
  return (
    <label className={cn("relative block", containerClassName)}>
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          panelIconSizeClass[size]
        )}
      />
      <input
        {...props}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "w-full border bg-background transition-colors outline-none focus:border-ring",
          panelInputSizeClass[size],
          inputClassName
        )}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  )
}

export { PanelSearchInput, TokenSearchInput }
