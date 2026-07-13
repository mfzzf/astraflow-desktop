"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { dispatchStudioSessionsChanged } from "@/lib/studio-session-events"
import { studioModes, type StudioMode } from "@/lib/studio-types"
import { StudioPerformanceProfiler } from "@/components/studio-chat/performance-profiler"

type StudioShellProps = {
  initialMode?: StudioMode
  initialSessionId?: string
}

type StudioWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type StudioChatWorkbenchProps = StudioWorkbenchProps & {
  workspaceId?: string
}

function StudioWorkbenchLoading() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center">
      <div
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70"
      />
    </div>
  )
}

const StudioChatWorkbench = dynamic<StudioChatWorkbenchProps>(
  () =>
    import("@/components/studio-chat-workbench").then(
      (mod) => mod.StudioChatWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioImageWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-image-workbench").then(
      (mod) => mod.StudioImageWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioVideoWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-video-workbench").then(
      (mod) => mod.StudioVideoWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioAudioWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-audio-workbench").then(
      (mod) => mod.StudioAudioWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && studioModes.includes(value as StudioMode)
}

function getStudioPath(
  mode: StudioMode,
  sessionId: string,
  workspaceId: string
) {
  if (sessionId) {
    return `/studio/${mode}/${encodeURIComponent(sessionId)}`
  }

  if (mode === "chat" && workspaceId) {
    return `/studio?workspace=${encodeURIComponent(workspaceId)}`
  }

  return mode === "chat" ? "/studio" : `/studio?mode=${mode}`
}

function StudioShell({
  initialMode = "chat",
  initialSessionId = "",
}: StudioShellProps = {}) {
  const searchParams = useSearchParams()
  const requestedMode = searchParams.get("mode")
  const requestedWorkspaceId = searchParams.get("workspace")?.trim() ?? ""
  const routeMode = initialSessionId
    ? initialMode
    : isStudioMode(requestedMode)
      ? requestedMode
      : "chat"

  return (
    <StudioShellInner
      key={`${routeMode}:${initialSessionId}:${requestedWorkspaceId}`}
      initialMode={routeMode}
      initialSessionId={initialSessionId}
      initialWorkspaceId={requestedWorkspaceId}
    />
  )
}

function StudioShellInner({
  initialMode,
  initialSessionId,
  initialWorkspaceId,
}: {
  initialMode: StudioMode
  initialSessionId: string
  initialWorkspaceId: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedMode, setSelectedMode] =
    React.useState<StudioMode>(initialMode)
  const [selectedSessionId, setSelectedSessionId] =
    React.useState(initialSessionId)

  React.useEffect(() => {
    const nextPath = getStudioPath(
      selectedMode,
      selectedSessionId,
      initialWorkspaceId
    )
    const currentSearch = searchParams.toString()
    const currentPath = currentSearch ? `${pathname}?${currentSearch}` : pathname

    if (currentPath !== nextPath) {
      router.replace(nextPath, { scroll: false })
    }
  }, [
    initialWorkspaceId,
    pathname,
    router,
    searchParams,
    selectedMode,
    selectedSessionId,
  ])

  const handleSessionChange = React.useCallback(
    (mode: StudioMode, nextSessionId: string) => {
      setSelectedMode(mode)
      setSelectedSessionId(nextSessionId)
      dispatchStudioSessionsChanged()
    },
    []
  )

  return (
    <main className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      {selectedMode === "chat" ? (
        <StudioPerformanceProfiler id="StudioChatWorkbench">
          <StudioChatWorkbench
            sessionId={selectedSessionId}
            workspaceId={initialWorkspaceId || undefined}
            onSessionChange={(nextSessionId) =>
              handleSessionChange("chat", nextSessionId)
            }
            onSessionsChange={dispatchStudioSessionsChanged}
          />
        </StudioPerformanceProfiler>
      ) : selectedMode === "image" ? (
        <StudioImageWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("image", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      ) : selectedMode === "video" ? (
        <StudioVideoWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("video", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      ) : (
        <StudioAudioWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("audio", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      )}
    </main>
  )
}

export { StudioShell }
