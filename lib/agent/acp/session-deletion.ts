type AcpDeletionSnapshot = {
  sessionId: string | null
  session: {
    canDelete: boolean
  }
}

export async function deletePersistedAcpSession({
  deleteSession,
  getSnapshot,
  prepare,
  storedAgentSessionId,
}: {
  deleteSession: (agentSessionId: string) => Promise<void>
  getSnapshot: () => AcpDeletionSnapshot | null
  prepare: () => Promise<void>
  storedAgentSessionId: string | null
}) {
  let snapshot = getSnapshot()

  if (!snapshot && storedAgentSessionId) {
    await prepare()
    snapshot = getSnapshot()
  }

  const agentSessionId = snapshot?.sessionId || storedAgentSessionId

  if (!snapshot || !agentSessionId) {
    return { deleted: false, reason: "no_agent_session" as const }
  }

  if (!snapshot.session.canDelete) {
    return { deleted: false, reason: "unsupported" as const }
  }

  await deleteSession(agentSessionId)

  return { deleted: true, agentSessionId }
}
