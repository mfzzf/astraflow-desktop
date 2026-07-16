import { randomUUID } from "node:crypto"

import { resetAcpSessionsForStudioSession } from "@/lib/agent/acp/acp-runtime"
import {
  beginPiWorkspaceHistorySnapshot,
  finishPiWorkspaceHistorySnapshot,
  restorePiWorkspaceHistory,
  restorePiWorkspaceHistorySafety,
} from "@/lib/agent/pi-workspace-history"
import {
  getStudioMessage,
  listStudioMessages,
  listStudioWorkspaceHistoryTurns,
  markStudioWorkspaceHistoryRedone,
  markStudioWorkspaceHistoryUndone,
  resetStudioSessionProviderResume,
  updateStudioWorkspaceHistoryAfterRef,
} from "@/lib/studio-db"

export type StudioWorkspaceHistoryAction =
  | "checkpoint"
  | "redo"
  | "rewind"
  | "undo"

export function getStudioWorkspaceHistoryState(sessionId: string) {
  const turns = listStudioWorkspaceHistoryTurns(sessionId)

  return {
    turns,
    canUndo: turns.some((turn) => turn.state === "active"),
    canRedo: turns.some((turn) => turn.state === "undone"),
  }
}

function resetProviderResumeAfterRestore(sessionId: string) {
  try {
    resetStudioSessionProviderResume(sessionId)
    resetAcpSessionsForStudioSession(sessionId)
  } catch (error) {
    console.warn("[studio-chat] workspace_history_provider_reset_failed", error)
  }
}

function createDraft(userMessageId: string | null) {
  if (!userMessageId) {
    return null
  }

  const message = getStudioMessage(userMessageId)

  if (!message || message.role !== "user") {
    return null
  }

  return message.content
}

async function restoreAndCommitConversation({
  assistantMessageIds,
  expectedCurrentRef,
  projectPath,
  sessionId,
  targetRef,
}: {
  assistantMessageIds: string[]
  expectedCurrentRef: string
  projectPath: string
  sessionId: string
  targetRef: string
}) {
  const restore = await restorePiWorkspaceHistory({
    expectedCurrentRef,
    projectPath,
    sessionId,
    targetRef,
  })

  try {
    markStudioWorkspaceHistoryUndone(sessionId, assistantMessageIds)
  } catch (error) {
    await restorePiWorkspaceHistorySafety({
      projectPath,
      safetyRef: restore.safetyRef,
      sessionId,
    }).catch(() => undefined)
    throw error
  }

  resetProviderResumeAfterRestore(sessionId)
}

async function undoOrRewind({
  assistantMessageId,
  sessionId,
}: {
  assistantMessageId?: string
  sessionId: string
}) {
  const turns = listStudioWorkspaceHistoryTurns(sessionId)
  const activeTurns = turns.filter((turn) => turn.state === "active")

  if (activeTurns.length === 0) {
    throw new Error("There is no AstraFlow workspace checkpoint to undo.")
  }

  const targetIndex = assistantMessageId
    ? activeTurns.findIndex(
        (turn) => turn.assistantMessageId === assistantMessageId
      )
    : activeTurns.length - 1

  if (targetIndex < 0) {
    throw new Error("The selected message is not available to rewind.")
  }

  const target = activeTurns[targetIndex]
  const current = activeTurns.at(-1)

  if (!target || !current) {
    throw new Error("Workspace history is incomplete.")
  }

  const affected = activeTurns.slice(targetIndex)

  await restoreAndCommitConversation({
    assistantMessageIds: affected.map((turn) => turn.assistantMessageId),
    expectedCurrentRef: current.afterRef,
    projectPath: target.projectPath,
    sessionId,
    targetRef: target.beforeRef,
  })

  return createDraft(target.userMessageId)
}

async function redo(sessionId: string) {
  const turns = listStudioWorkspaceHistoryTurns(sessionId)
  const target = turns.find((turn) => turn.state === "undone")

  if (!target) {
    throw new Error("There is no AstraFlow workspace checkpoint to redo.")
  }

  const restore = await restorePiWorkspaceHistory({
    expectedCurrentRef: target.beforeRef,
    projectPath: target.projectPath,
    sessionId,
    targetRef: target.afterRef,
  })

  try {
    markStudioWorkspaceHistoryRedone(sessionId, target.assistantMessageId)
  } catch (error) {
    await restorePiWorkspaceHistorySafety({
      projectPath: target.projectPath,
      safetyRef: restore.safetyRef,
      sessionId,
    }).catch(() => undefined)
    throw error
  }

  resetProviderResumeAfterRestore(sessionId)
  return null
}

async function checkpoint(sessionId: string) {
  const active = listStudioWorkspaceHistoryTurns(sessionId)
    .filter((turn) => turn.state === "active")
    .at(-1)

  if (!active) {
    throw new Error("Run AstraFlow Agent once before creating a checkpoint.")
  }

  const checkpointId = `checkpoint-${randomUUID()}`
  const snapshot = await beginPiWorkspaceHistorySnapshot({
    projectPath: active.projectPath,
    sessionId,
    turnId: checkpointId,
  })
  const result = await finishPiWorkspaceHistorySnapshot({
    snapshot,
    turnId: checkpointId,
  })
  const updated = updateStudioWorkspaceHistoryAfterRef({
    afterRef: result.afterRef,
    assistantMessageId: active.assistantMessageId,
    projectPath: result.projectPath,
    sessionId,
  })

  if (!updated) {
    throw new Error("The active AstraFlow checkpoint changed unexpectedly.")
  }

  return null
}

export async function executeStudioWorkspaceHistoryAction({
  action,
  assistantMessageId,
  sessionId,
}: {
  action: StudioWorkspaceHistoryAction
  assistantMessageId?: string
  sessionId: string
}) {
  const draft =
    action === "redo"
      ? await redo(sessionId)
      : action === "checkpoint"
        ? await checkpoint(sessionId)
        : await undoOrRewind({
            assistantMessageId:
              action === "rewind" ? assistantMessageId : undefined,
            sessionId,
          })
  const state = getStudioWorkspaceHistoryState(sessionId)

  return {
    ...state,
    draft,
    messages: listStudioMessages(sessionId),
  }
}
