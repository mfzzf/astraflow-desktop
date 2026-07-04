"use client"
import { RiClaudeFill, RiOpenaiFill } from "@remixicon/react"
import { Bot, Network } from "lucide-react"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { cn } from "@/lib/utils"

type AgentRuntimeIconProps = {
  runtimeId: string
  className?: string
}

function AgentRuntimeIcon({ runtimeId, className }: AgentRuntimeIconProps) {
  if (runtimeId === "langchain") {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center overflow-hidden",
          className
        )}
      >
        <AstraFlowLogo className="h-3.5 max-w-4 object-contain" />
      </span>
    )
  }

  const Icon =
    runtimeId === "deepagents"
      ? Network
      : runtimeId === "codex"
        ? RiOpenaiFill
        : runtimeId === "claude-code"
          ? RiClaudeFill
          : Bot

  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  )
}

export { AgentRuntimeIcon }
