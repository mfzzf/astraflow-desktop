import { isAbsolute, resolve } from "node:path"

import type { SessionInfo } from "@agentclientprotocol/sdk"

import type { StudioSession } from "@/lib/studio-types"

type CreateContinuationSession = (input: {
  mode: "chat"
  title?: string
  workspaceId: string | null
  projectId: string | null
  permissionMode: StudioSession["permissionMode"]
  chatModel: string | null
  chatRuntimeId: string
  chatReasoningEffort: string | null
}) => StudioSession

export type ContinueAcpSessionInput = {
  activeWorkspace: string
  agentSession: SessionInfo
  createSession: CreateContinuationSession
  deleteCreatedSession: (sessionId: string) => void
  findExistingSession: () => StudioSession | null
  recordSelection: (session: StudioSession) => void
  runtimeId: string
  sourceSession: StudioSession
}

function sameWorkspace(left: string, right: string) {
  return resolve(left) === resolve(right)
}

export function assertAcpSessionCanContinue({
  activeWorkspace,
  agentSession,
}: Pick<ContinueAcpSessionInput, "activeWorkspace" | "agentSession">) {
  if (!isAbsolute(agentSession.cwd)) {
    throw new Error("The ACP agent returned a non-absolute session cwd.")
  }

  if (!sameWorkspace(agentSession.cwd, activeWorkspace)) {
    throw new Error(
      "Open the agent session from its original Studio workspace."
    )
  }
}

export function continueAcpSessionInStudio({
  activeWorkspace,
  agentSession,
  createSession,
  deleteCreatedSession,
  findExistingSession,
  recordSelection,
  runtimeId,
  sourceSession,
}: ContinueAcpSessionInput) {
  assertAcpSessionCanContinue({ activeWorkspace, agentSession })

  const existing = findExistingSession()

  if (
    existing?.mode === "chat" &&
    existing.workspaceId === sourceSession.workspaceId &&
    (existing.chatRuntimeId === runtimeId ||
      (!existing.chatRuntimeId && runtimeId === "astraflow"))
  ) {
    return { session: existing, reused: true }
  }

  const created = createSession({
    mode: "chat",
    title: agentSession.title?.trim() || undefined,
    workspaceId: sourceSession.workspaceId,
    projectId: sourceSession.projectId,
    permissionMode: sourceSession.permissionMode,
    chatModel: sourceSession.chatModel,
    chatRuntimeId: runtimeId,
    chatReasoningEffort: sourceSession.chatReasoningEffort,
  })

  try {
    recordSelection(created)
  } catch (error) {
    deleteCreatedSession(created.id)
    throw error
  }

  return { session: created, reused: false }
}
