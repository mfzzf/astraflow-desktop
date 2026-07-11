import { File, FileImage, type LucideIcon } from "lucide-react"

import { getStudioFileDescriptor } from "@/lib/studio-file-support"
import { cn } from "@/lib/utils"

type StudioFileTypeIconProps = {
  path: string
  size?: "small" | "medium"
  className?: string
}

const toneClasses = {
  blue: "bg-[color-mix(in_oklab,var(--color-accent-blue)_13%,transparent)] text-[var(--color-accent-blue)]",
  cyan: "bg-[color-mix(in_oklab,var(--color-accent-blue)_10%,transparent)] text-[color-mix(in_oklab,var(--color-accent-blue)_78%,var(--color-accent-green))]",
  gold: "bg-[color-mix(in_oklab,var(--color-accent-yellow)_15%,transparent)] text-[color-mix(in_oklab,var(--color-accent-yellow)_72%,var(--color-text-foreground))]",
  green:
    "bg-[color-mix(in_oklab,var(--color-accent-green)_13%,transparent)] text-[var(--color-accent-green)]",
  orange:
    "bg-[color-mix(in_oklab,var(--color-accent-orange)_13%,transparent)] text-[var(--color-accent-orange)]",
  purple:
    "bg-[color-mix(in_oklab,var(--color-accent-purple)_13%,transparent)] text-[var(--color-accent-purple)]",
  red: "bg-[color-mix(in_oklab,var(--color-accent-red)_13%,transparent)] text-[var(--color-accent-red)]",
  slate: "bg-token-list-hover-background text-token-description-foreground",
} as const

const sizeClasses = {
  small: "size-5 rounded-[5px] text-[9px]",
  medium: "size-[27px] rounded-md text-[10px]",
} as const

export function StudioFileTypeIcon({
  path,
  size = "medium",
  className,
}: StudioFileTypeIconProps) {
  const descriptor = getStudioFileDescriptor(path)
  let Graphic: LucideIcon | null = null

  if (descriptor.kind === "image") {
    Graphic = FileImage
  } else if (descriptor.kind === "unsupported") {
    Graphic = File
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden font-sans leading-none font-bold tracking-[-0.04em]",
        toneClasses[descriptor.tone],
        sizeClasses[size],
        className
      )}
      title={descriptor.extension.toUpperCase() || "File"}
    >
      {Graphic ? (
        <Graphic className={size === "small" ? "size-3" : "size-3.5"} />
      ) : (
        descriptor.iconLabel
      )}
    </span>
  )
}
