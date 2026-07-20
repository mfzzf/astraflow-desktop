import type { StudioSession } from "@/lib/studio-types"

export function findFinishedStudioSessions(
  previous: ReadonlyMap<string, boolean>,
  sessions: StudioSession[]
) {
  return sessions.filter(
    (session) => previous.get(session.id) === true && !session.isRunning
  )
}
