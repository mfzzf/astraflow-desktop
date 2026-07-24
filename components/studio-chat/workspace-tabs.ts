"use client"

import * as React from "react"

import type { StudioOpenReviewPanelDetail } from "@/lib/studio-review-panel"
import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"
import type { StudioWorkspace } from "@/lib/studio-types"
import { createClientId } from "@/lib/utils"

import type {
  ChatRunEnvironment,
  StudioBrowserTab,
  StudioRightPanelMode,
  StudioTerminalTab,
  StudioWorkspaceBrowserTab,
  StudioWorkspaceFileTab,
  StudioWorkspaceReviewTab,
  StudioWorkspaceSideChatTab,
  StudioWorkspaceSubagentTab,
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
  workspace: Pick<StudioWorkspace, "name" | "rootPath">,
  fallbackTitle: string,
  sequence = 1
): StudioTerminalTab {
  const cwd = workspace.rootPath
  const title = workspace.name || getPathTail(cwd) || fallbackTitle

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

function normalizeWorkspaceArtifactPath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+/g, "/")

  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}

export function getWorkspaceArtifactPathKey(
  workspace: StudioFileWorkspaceTarget,
  path: string | null | undefined
) {
  const rawPath = path?.trim() ?? ""
  const hasUriScheme =
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawPath) &&
    !/^[A-Za-z]:[\\/]/.test(rawPath)

  if (hasUriScheme || /^~(?:[\\/]|$)/.test(rawPath)) {
    return null
  }

  const normalizedPath = normalizeWorkspaceArtifactPath(rawPath)
  const normalizedRoot = normalizeWorkspaceArtifactPath(
    workspace.rootPath
  ).replace(/\/+$/, "")

  if (!normalizedPath || !normalizedRoot) {
    return null
  }

  let relativePath = normalizedPath

  if (normalizedPath === normalizedRoot) {
    relativePath = ""
  } else if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    relativePath = normalizedPath.slice(normalizedRoot.length + 1)
  } else if (/^(?:[A-Za-z]:)?\//.test(normalizedPath)) {
    return null
  } else {
    relativePath = normalizedPath.replace(/^(?:\.\/)+/, "")
  }

  const segments = relativePath.split("/").filter(Boolean)

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null
  }

  return `${workspace.type}\0${workspace.id}\0${segments.join("/")}`
}

export function findWorkspaceFileTabForArtifact(
  tabs: readonly StudioWorkspaceTab[],
  workspace: StudioFileWorkspaceTarget,
  entryPath: string | null | undefined
) {
  const artifactKey = getWorkspaceArtifactPathKey(workspace, entryPath)

  if (!artifactKey) {
    return null
  }

  return (
    tabs.find(
      (tab): tab is StudioWorkspaceFileTab =>
        tab.kind === "files" &&
        tab.entry !== null &&
        getWorkspaceArtifactPathKey(tab.workspace, tab.entry.path) ===
          artifactKey
    ) ?? null
  )
}

export function getWorkspaceBrowserRevisionKey(
  tab: Pick<StudioWorkspaceBrowserTab, "id" | "revision" | "serviceId">
) {
  return `${tab.id}:${tab.serviceId ?? ""}:${tab.revision ?? ""}`
}

const AUTO_PREVIEW_SUPPRESSION_SEPARATOR = "\u001f"

export function isAuthoritativeWorkspaceFileRevision(
  revision: string | null | undefined
) {
  return /^[a-f0-9]{64}$/i.test(revision?.trim() ?? "")
}

export function getAutoPreviewSuppressionKey(
  originatingRunId: string | null | undefined,
  identity: string | null | undefined
) {
  const normalizedRunId = originatingRunId?.trim()
  const normalizedIdentity = identity?.trim()

  if (!normalizedRunId || !normalizedIdentity) {
    return null
  }

  return `${normalizedRunId}${AUTO_PREVIEW_SUPPRESSION_SEPARATOR}${normalizedIdentity}`
}

export function clearAutoPreviewSuppressionsForIdentity(
  suppressions: Set<string>,
  identity: string | null | undefined
) {
  const normalizedIdentity = identity?.trim()

  if (!normalizedIdentity) {
    return
  }

  const suffix = `${AUTO_PREVIEW_SUPPRESSION_SEPARATOR}${normalizedIdentity}`

  for (const suppression of suppressions) {
    if (suppression.endsWith(suffix)) {
      suppressions.delete(suppression)
    }
  }
}

export function collectAutoPreviewSuppressionKeys(
  tabs: readonly StudioWorkspaceTab[]
) {
  const paths = new Set<string>()
  const services = new Set<string>()

  for (const tab of tabs) {
    if (
      (tab.kind !== "files" && tab.kind !== "browser") ||
      !tab.autoPreview ||
      !tab.originatingRunId
    ) {
      continue
    }

    if (tab.kind === "files" && tab.entry?.path) {
      const pathKey = getAutoPreviewSuppressionKey(
        tab.originatingRunId,
        tab.entry.path
      )

      if (pathKey) {
        paths.add(pathKey)
      }

      const artifactKey = getWorkspaceArtifactPathKey(
        tab.workspace,
        tab.entry.path
      )
      const artifactSuppressionKey = getAutoPreviewSuppressionKey(
        tab.originatingRunId,
        artifactKey
      )

      if (artifactSuppressionKey) {
        paths.add(artifactSuppressionKey)
      }
    }

    if (tab.kind === "browser") {
      for (const identity of [tab.serviceId, tab.artifactKey]) {
        const suppressionKey = getAutoPreviewSuppressionKey(
          tab.originatingRunId,
          identity
        )

        if (suppressionKey) {
          services.add(suppressionKey)
        }
      }

      if (tab.workspace && tab.entryPath) {
        const pathKey = getAutoPreviewSuppressionKey(
          tab.originatingRunId,
          tab.entryPath
        )

        if (pathKey) {
          paths.add(pathKey)
        }

        const artifactSuppressionKey = getAutoPreviewSuppressionKey(
          tab.originatingRunId,
          getWorkspaceArtifactPathKey(tab.workspace, tab.entryPath)
        )

        if (artifactSuppressionKey) {
          paths.add(artifactSuppressionKey)
        }
      }
    }
  }

  return { paths, services }
}

export function createWorkspaceFileTab(
  workspace: StudioFileWorkspaceTarget,
  entry: AstraFlowSidePanelDirectoryEntry | null,
  fallbackTitle: string,
  focusLine: number | null = null,
  focusColumn: number | null = null,
  focusEndLine: number | null = null,
  revision: string | null = null,
  autoPreview = false,
  originatingRunId: string | null = null
): StudioWorkspaceFileTab {
  return {
    id: createClientId(),
    kind: "files",
    title: entry?.name ?? fallbackTitle,
    workspace,
    entry,
    focusLine,
    focusColumn,
    focusEndLine,
    revision,
    autoPreview,
    originatingRunId,
  }
}

export function findReusableWorkspaceFilePreviewTab(
  tabs: StudioWorkspaceTab[],
  previewTabIds: ReadonlySet<string>
) {
  return (
    tabs.find(
      (tab): tab is StudioWorkspaceFileTab =>
        tab.kind === "files" && tab.entry !== null && previewTabIds.has(tab.id)
    ) ?? null
  )
}

export function createWorkspaceTerminalTab(
  workspace: Pick<StudioWorkspace, "name" | "rootPath">,
  fallbackTitle: string,
  sequence: number
): StudioWorkspaceTerminalTab {
  return {
    ...createStudioTerminalTab(workspace, fallbackTitle, sequence),
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

export function createWorkspaceSubagentTab({
  title,
  subagent,
  environment,
}: {
  title: string
  subagent: StudioWorkspaceSubagentTab["subagent"]
  environment: ChatRunEnvironment
}): StudioWorkspaceSubagentTab {
  return {
    id: `studio-right-panel:subagent:${subagent.taskId}`,
    kind: "subagent",
    title,
    subagent,
    environment,
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
