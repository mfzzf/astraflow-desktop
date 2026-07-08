"use client"

import * as React from "react"

import type { StudioOpenReviewPanelDetail } from "@/lib/studio-review-panel"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
import { createClientId } from "@/lib/utils"

import type {
  StudioBrowserTab,
  StudioRightPanelMode,
  StudioTerminalTab,
  StudioWorkspaceBrowserTab,
  StudioWorkspaceFileTab,
  StudioWorkspaceReviewTab,
  StudioWorkspaceSideChatTab,
  StudioWorkspaceTab,
  StudioWorkspaceTerminalTab,
} from "./types"

export function getPathTail(path: string | null | undefined) {
  const normalized = path?.replace(/\/+$/, "").trim()

  if (!normalized) {
    return ""
  }

  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

export function createStudioTerminalTab(
  project: StudioLocalProjectWithGitInfo | null,
  fallbackTitle: string,
  sequence = 1
): StudioTerminalTab {
  const cwd = project?.path ?? null
  const title = project?.name || getPathTail(cwd) || fallbackTitle

  return {
    id: createClientId(),
    cwd,
    sequence,
    title: formatTerminalTabTitle(title, sequence),
  }
}

export function formatTerminalTabTitle(title: string, sequence: number) {
  return sequence > 1 ? `${title} ${sequence}` : title
}

export function createStudioBrowserTab(): StudioBrowserTab {
  return {
    id: createClientId(),
    title: "新选项卡",
    address: "",
    url: "",
  }
}

export function createWorkspaceBrowserTab(): StudioWorkspaceBrowserTab {
  return {
    ...createStudioBrowserTab(),
    kind: "browser",
  }
}

export function createWorkspaceFileTab(
  entry: AstraFlowSidePanelDirectoryEntry | null,
  fallbackTitle: string,
  focusLine: number | null = null
): StudioWorkspaceFileTab {
  return {
    id: createClientId(),
    kind: "files",
    title: entry?.name ?? fallbackTitle,
    entry,
    focusLine,
  }
}

export function createWorkspaceTerminalTab(
  project: StudioLocalProjectWithGitInfo | null,
  fallbackTitle: string,
  sequence: number
): StudioWorkspaceTerminalTab {
  return {
    ...createStudioTerminalTab(project, fallbackTitle, sequence),
    kind: "terminal",
  }
}

export function createWorkspaceSideChatTab(
  title: string
): StudioWorkspaceSideChatTab {
  return {
    id: createClientId(),
    kind: "side-chat",
    title,
  }
}

export function createWorkspaceReviewTab(
  title: string,
  detail: StudioOpenReviewPanelDetail
): StudioWorkspaceReviewTab {
  return {
    id: createClientId(),
    kind: "review",
    title,
    detail,
  }
}

export function getWorkspaceTabMode(
  tab: StudioWorkspaceTab
): StudioRightPanelMode {
  return tab.kind
}

export function getWorkspaceTabTitle(tab: StudioWorkspaceTab) {
  if (tab.kind === "files") {
    return tab.entry?.name ?? tab.title
  }

  return tab.title
}

export function useCloseTabCommand(handler: () => void, active = true) {
  const handlerRef = React.useRef(handler)

  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  React.useEffect(() => {
    if (!active) {
      return
    }

    const disposeDesktopListener = window.astraflowDesktop?.onCloseTabCommand?.(
      () => {
        handlerRef.current()
      }
    )

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault()
        handlerRef.current()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)

    return () => {
      disposeDesktopListener?.()
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [active])
}
