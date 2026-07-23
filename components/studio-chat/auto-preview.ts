import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"
import type {
  StudioChatRunSnapshot,
  StudioMessage,
  StudioWorkspace,
} from "@/lib/studio-types"
import {
  getStudioWorkspaceServiceResult,
  isStudioWorkspaceServiceResultForContext,
} from "@/lib/studio-workspace-service-result"

import {
  getWorkspaceArtifactPathKey,
  isAuthoritativeWorkspaceFileRevision,
} from "./workspace-tabs"

export type StudioAutoPreviewCandidate =
  | {
      kind: "file"
      href: string
      revision: string
      workspace: StudioFileWorkspaceTarget
    }
  | {
      kind: "service"
      href: string
      revision: string
      workspace: StudioFileWorkspaceTarget
      serviceId: string
      artifactKey: string | null
      entryPath: string | null
    }

function isSameWorkspace(
  target: StudioFileWorkspaceTarget,
  workspace: StudioWorkspace
) {
  return (
    target.id === workspace.id &&
    target.type === workspace.type &&
    target.rootPath === workspace.rootPath
  )
}

function isIndexHtml(path: string) {
  return /(?:^|[/\\])index\.html?$/i.test(path)
}

export function getTerminalStudioAutoPreviewCandidate({
  run,
  message,
  panelWorkspace,
}: {
  run: StudioChatRunSnapshot
  message: StudioMessage | null | undefined
  panelWorkspace: StudioWorkspace | null
}): StudioAutoPreviewCandidate | null {
  if (
    run.status !== "complete" ||
    !message ||
    message.role !== "assistant" ||
    message.status !== "complete" ||
    message.id !== run.assistantMessageId ||
    message.sessionId !== run.sessionId ||
    !panelWorkspace
  ) {
    return null
  }

  const targetWorkspace: StudioFileWorkspaceTarget =
    message.workspace ?? panelWorkspace

  if (!isSameWorkspace(targetWorkspace, panelWorkspace)) {
    return null
  }

  let serviceCandidate: StudioAutoPreviewCandidate | null = null

  if (panelWorkspace.type === "sandbox") {
    for (const activity of message.activities) {
      if (
        activity.toolName !== "sandbox_start_service" ||
        activity.status !== "complete"
      ) {
        continue
      }

      const service =
        getStudioWorkspaceServiceResult(activity.rawOutput) ??
        getStudioWorkspaceServiceResult(activity.meta)

      if (
        !service?.publicUrl ||
        !service.serviceId ||
        service.status !== "healthy" ||
        !isStudioWorkspaceServiceResultForContext(service, {
          sessionId: run.sessionId,
          workspaceId: panelWorkspace.id,
          sandboxId: panelWorkspace.sandboxId,
        })
      ) {
        continue
      }

      serviceCandidate = {
        kind: "service",
        href: service.publicUrl,
        revision:
          service.specRevision ||
          service.specFingerprint ||
          service.serviceId,
        workspace: targetWorkspace,
        serviceId: service.serviceId,
        artifactKey: service.artifactKey,
        entryPath: service.entryPath,
      }
    }
  }

  if (serviceCandidate) {
    return serviceCandidate
  }

  let indexCandidate: StudioAutoPreviewCandidate | null = null
  let lastHtmlCandidate: StudioAutoPreviewCandidate | null = null

  for (const part of message.parts) {
    if (
      part.type !== "file" ||
      part.status !== "complete" ||
      part.kind === "delete" ||
      !/\.html?$/i.test(part.path) ||
      !isAuthoritativeWorkspaceFileRevision(part.revision) ||
      !getWorkspaceArtifactPathKey(targetWorkspace, part.path)
    ) {
      continue
    }

    const candidate: StudioAutoPreviewCandidate = {
      kind: "file",
      href: part.path,
      revision: part.revision!.trim().toLowerCase(),
      workspace: targetWorkspace,
    }

    lastHtmlCandidate = candidate

    if (isIndexHtml(part.path)) {
      indexCandidate = candidate
    }
  }

  return indexCandidate ?? lastHtmlCandidate
}
