"use client"

import * as React from "react"

import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"

export const StudioFileWorkspaceContext =
  React.createContext<StudioFileWorkspaceTarget | null>(null)

export function useStudioFileWorkspace() {
  return React.useContext(StudioFileWorkspaceContext)
}
