"use client"

import { StudioTerminalSurface } from "@/components/studio-terminal-panel"

import type { StudioWorkspaceTerminalTab } from "../types"
import type { StudioRightPanelLabels } from "./labels"

export function StudioSideTerminal({
  active,
  sessionId,
  labels,
  activeTabId,
  tabs,
  onResolvedCwd,
}: {
  active: boolean
  sessionId: string
  labels: StudioRightPanelLabels
  activeTabId: string
  tabs: StudioWorkspaceTerminalTab[]
  onResolvedCwd: (tabId: string, resolvedCwd: string) => void
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  return (
    <div
      aria-label={labels.terminal}
      className="relative h-full min-h-0 bg-background"
    >
      {tabs.map((tab) => (
        <StudioTerminalSurface
          key={tab.id}
          active={active && tab.id === activeTab?.id}
          cwd={tab.cwd}
          fitEnabled={active && tab.id === activeTab?.id}
          sessionId={sessionId}
          onResolvedCwd={(resolvedCwd) => onResolvedCwd(tab.id, resolvedCwd)}
        />
      ))}
    </div>
  )
}
