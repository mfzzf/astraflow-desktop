"use client"

import * as React from "react"
import {
  RiAddLine,
  RiChat3Line,
  RiCheckLine,
  RiDeleteBinLine,
  RiImageLine,
  RiKey2Line,
  RiLoader4Line,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { StudioApiSettingsPage } from "@/components/studio-api-settings-page"
import { StudioAudioWorkbench } from "@/components/studio-audio-workbench"
import { StudioChatWorkbench } from "@/components/studio-chat-workbench"
import { StudioImageWorkbench } from "@/components/studio-image-workbench"
import { StudioVideoWorkbench } from "@/components/studio-video-workbench"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import type { StudioMode, StudioSession } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type SessionsResponse =
  | {
      ok: true
      data: StudioSession[]
    }
  | {
      ok: false
      error: unknown
    }

type ModelverseApiKeysPayload = {
  projectId: string
  items: {
    id: string
    name: string
  }[]
  selected: {
    id: string
    name: string
  } | null
}

type ModelverseApiKeysResponse =
  | {
      ok: true
      data: ModelverseApiKeysPayload
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

type StudioShellProps = {
  initialMode?: StudioMode
  initialSessionId?: string
}

class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

function isLoginRequiredError(error: unknown) {
  return error instanceof LoginRequiredError
}

function throwIfUnauthorized(response: Response) {
  if (response.status === 401) {
    throw new LoginRequiredError()
  }
}

const studioModes: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

const STUDIO_MODE_STORAGE_KEY = "astraflow:studio-mode"
const STUDIO_SESSION_STORAGE_KEY = "astraflow:studio-session"

function isStudioMode(value: unknown): value is StudioMode {
  return (
    typeof value === "string" && studioModes.some((mode) => mode.id === value)
  )
}

function readStoredStudioMode(): StudioMode {
  if (typeof window === "undefined") {
    return "chat"
  }
  const stored = window.localStorage.getItem(STUDIO_MODE_STORAGE_KEY)
  return isStudioMode(stored) ? stored : "chat"
}

function readStoredStudioSessionId(): string {
  if (typeof window === "undefined") {
    return ""
  }
  return window.localStorage.getItem(STUDIO_SESSION_STORAGE_KEY) ?? ""
}

function readRequestedStudioMode(): StudioMode | null {
  if (typeof window === "undefined") {
    return null
  }

  const mode = new URLSearchParams(window.location.search).get("mode")

  return isStudioMode(mode) ? mode : null
}

function getStudioPath(mode: StudioMode, sessionId: string) {
  if (sessionId) {
    return `/studio/${mode}/${encodeURIComponent(sessionId)}`
  }

  return mode === "chat" ? "/studio" : `/studio?mode=${mode}`
}

async function fetchStudioSessions() {
  const response = await fetch("/api/studio/sessions")
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SessionsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load sessions")
  }

  return payload.data
}

async function renameStudioSession(sessionId: string, title: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to rename session")
  }
}

async function deleteStudioSessionRequest(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "DELETE",
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to delete session")
  }
}

async function fetchModelverseApiKeys(projectId?: string) {
  const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  const response = await fetch(`/api/studio/modelverse-api-keys${search}`)
  throwIfUnauthorized(response)

  const payload = (await response.json()) as ModelverseApiKeysResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load Modelverse API keys"
    )
  }

  return payload.data
}

function StudioShell({
  initialMode = "chat",
  initialSessionId = "",
}: StudioShellProps = {}) {
  const { t } = useI18n()
  const [selectedMode, setSelectedMode] =
    React.useState<StudioMode>(initialMode)
  const modeHydratedRef = React.useRef(false)
  const sessionHydratedRef = React.useRef(false)
  const requestedModeRef = React.useRef<StudioMode | null>(null)
  const requestedSessionIdRef = React.useRef(initialSessionId)
  const [selectedSessionId, setSelectedSessionId] =
    React.useState(initialSessionId)
  const [sessions, setSessions] = React.useState<StudioSession[]>([])
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [menuSessionId, setMenuSessionId] = React.useState<string | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<StudioSession | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState("")
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<StudioSession | null>(
    null
  )
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  const [apiKeyConfigured, setApiKeyConfigured] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId
  )
  const activeMode = selectedSession?.mode ?? selectedMode
  const redirectToLogin = React.useCallback(() => {
    window.location.replace("/login")
  }, [])

  const reloadSessions = React.useCallback(async () => {
    try {
      setLoadFailed(false)
      setSessions(await fetchStudioSessions())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setLoadFailed(true)
    }
  }, [redirectToLogin])

  const reloadApiKeyStatus = React.useCallback(
    async (preferredProjectId?: string) => {
      try {
        const next = await fetchModelverseApiKeys(preferredProjectId)

        setApiKeyConfigured(Boolean(next.selected))
        return next
      } catch (error) {
        if (isLoginRequiredError(error)) {
          redirectToLogin()
          return null
        }

        setApiKeyConfigured(false)
        return null
      }
    },
    [redirectToLogin]
  )

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
      void reloadApiKeyStatus()
      const requestedMode = initialSessionId
        ? initialMode
        : readRequestedStudioMode()
      const storedMode = requestedMode ?? readStoredStudioMode()

      requestedModeRef.current = requestedMode
      requestedSessionIdRef.current = initialSessionId
      setSelectedMode(storedMode)

      if (initialSessionId) {
        setSelectedSessionId(initialSessionId)
        sessionHydratedRef.current = true
      } else if (requestedMode) {
        setSelectedSessionId("")
        sessionHydratedRef.current = true
      }

      modeHydratedRef.current = true
    })
  }, [initialMode, initialSessionId, reloadApiKeyStatus, reloadSessions])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!modeHydratedRef.current) return
    window.localStorage.setItem(STUDIO_MODE_STORAGE_KEY, selectedMode)
  }, [selectedMode])

  React.useEffect(() => {
    if (sessionHydratedRef.current) return
    if (sessions.length === 0) return
    if (requestedModeRef.current) {
      sessionHydratedRef.current = true
      return
    }

    const storedSessionId = readStoredStudioSessionId()
    sessionHydratedRef.current = true

    if (!storedSessionId) return

    const stored = sessions.find((session) => session.id === storedSessionId)
    if (!stored) return

    queueMicrotask(() => {
      setSelectedSessionId(stored.id)
      setSelectedMode(stored.mode)
    })
  }, [sessions])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!modeHydratedRef.current || !sessionHydratedRef.current) return

    const nextPath = getStudioPath(activeMode, selectedSessionId)
    const currentPath = `${window.location.pathname}${window.location.search}`

    if (currentPath !== nextPath) {
      window.history.replaceState(null, "", nextPath)
    }
  }, [activeMode, selectedMode, selectedSessionId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!sessionHydratedRef.current) return
    if (selectedSessionId) {
      window.localStorage.setItem(STUDIO_SESSION_STORAGE_KEY, selectedSessionId)
    } else {
      window.localStorage.removeItem(STUDIO_SESSION_STORAGE_KEY)
    }
  }, [selectedSessionId])

  React.useEffect(() => {
    function handleProjectChanged(event: Event) {
      const projectId =
        (event as CustomEvent<{ projectId?: string }>).detail?.projectId ?? ""

      void reloadApiKeyStatus(projectId)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [reloadApiKeyStatus])

  async function handleRenameSubmit() {
    const target = renameTarget
    const nextTitle = renameValue.trim()

    if (!target || !nextTitle) {
      return
    }

    try {
      setRenameSaving(true)
      await renameStudioSession(target.id, nextTitle)
      setRenameTarget(null)
      setRenameValue("")
      await reloadSessions()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      // Keep the dialog open so the user can retry.
    } finally {
      setRenameSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    const target = deleteTarget

    if (!target) {
      return
    }

    try {
      setDeleteSaving(true)
      await deleteStudioSessionRequest(target.id)

      if (selectedSessionId === target.id) {
        setSelectedSessionId("")
      }

      setDeleteTarget(null)
      await reloadSessions()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      // Keep the dialog open so the user can retry.
    } finally {
      setDeleteSaving(false)
    }
  }

  function getModeLabel(mode: StudioMode) {
    switch (mode) {
      case "chat":
        return t.studioModeChat
      case "image":
        return t.studioModeImage
      case "video":
        return t.studioModeVideo
      case "audio":
        return t.studioModeAudio
    }
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] min-h-0 overflow-hidden bg-background">
      <aside className="flex w-full min-w-0 flex-col border-r bg-background p-2 text-sidebar-foreground md:w-[168px] md:shrink-0 lg:w-[180px]">
        <div className="shrink-0">
          <Button
            type="button"
            className="mb-2 h-9 w-full justify-start text-sm"
            onClick={() => {
              setSettingsOpen(false)
              setSelectedMode("chat")
              setSelectedSessionId("")
            }}
          >
            <RiAddLine data-icon="inline-start" aria-hidden />
            <span>{t.studioNewSession}</span>
          </Button>

          <nav aria-label={t.studioModes} className="flex flex-col gap-1">
            {studioModes.map((mode) => {
              const Icon = mode.icon
              const isActive = !settingsOpen && mode.id === activeMode

              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  className="h-8 justify-start gap-2 rounded-md px-2 text-sm font-normal"
                  aria-pressed={isActive}
                  onClick={() => {
                    setSettingsOpen(false)
                    setSelectedMode(mode.id)
                    setSelectedSessionId("")
                  }}
                >
                  <Icon data-icon="inline-start" aria-hidden />
                  <span className="truncate">{getModeLabel(mode.id)}</span>
                </Button>
              )
            })}
          </nav>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden pt-1">
          <div className="px-2 pb-2 text-xs font-medium text-sidebar-foreground/70">
            {t.studioSessions}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessions.length > 0 ? (
              <div className="flex flex-col gap-1">
                {sessions.map((session) => {
                  const isActive = session.id === selectedSessionId

                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "group/session relative flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
                        isActive && "bg-sidebar-accent"
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md px-2 text-left text-sm outline-none hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          isActive &&
                            "font-medium text-sidebar-accent-foreground"
                        )}
                        onClick={() => {
                          setSettingsOpen(false)
                          setSelectedSessionId(session.id)
                          setSelectedMode(session.mode)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate pr-5">
                          {session.title}
                        </span>
                      </button>

                      <Popover
                        open={menuSessionId === session.id}
                        onOpenChange={(open) =>
                          setMenuSessionId(open ? session.id : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={t.studioSessionActions}
                            className={cn(
                              "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/70 opacity-0 transition group-hover/session:opacity-100 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100 [&_svg]:size-4",
                              menuSessionId === session.id && "opacity-100"
                            )}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <RiMore2Line aria-hidden />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="right"
                          className="w-40 gap-0.5 rounded-2xl p-1.5"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
                            onClick={() => {
                              setMenuSessionId(null)
                              setRenameValue(session.title)
                              setRenameTarget(session)
                            }}
                          >
                            <RiPencilLine aria-hidden />
                            {t.studioRename}
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 [&_svg]:size-4"
                            onClick={() => {
                              setMenuSessionId(null)
                              setDeleteTarget(session)
                            }}
                          >
                            <RiDeleteBinLine aria-hidden />
                            {t.studioDelete}
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                {loadFailed ? t.studioLoadFailed : t.studioNoSessions}
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 shrink-0 border-t pt-2">
          <Button
            type="button"
            variant={settingsOpen ? "secondary" : "ghost"}
            className="h-8 w-full justify-start gap-2 rounded-md px-2 text-sm font-normal"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <RiKey2Line data-icon="inline-start" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t.studioApiSettings}
            </span>
            {apiKeyConfigured ? (
              <RiCheckLine data-icon="inline-end" aria-hidden />
            ) : null}
          </Button>
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col overflow-hidden bg-background md:flex">
        {settingsOpen ? (
          <StudioApiSettingsPage onSelectedKeyChange={setApiKeyConfigured} />
        ) : activeMode === "chat" ? (
          <StudioChatWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("chat")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : activeMode === "image" ? (
          <StudioImageWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("image")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : activeMode === "video" ? (
          <StudioVideoWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("video")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : activeMode === "audio" ? (
          <StudioAudioWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("audio")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center px-10">
            <div className="flex max-w-md flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <RiChat3Line aria-hidden />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-2xl font-semibold">
                  {getModeLabel(activeMode)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t.studioModePending}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioRenameTitle}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            placeholder={t.studioRenamePlaceholder}
            maxLength={120}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleRenameSubmit()
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameTarget(null)
                setRenameValue("")
              }}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              onClick={handleRenameSubmit}
              disabled={renameSaving || renameValue.trim().length === 0}
            >
              {renameSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiCheckLine aria-hidden />
              )}
              <span>{t.studioSave}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioDeleteTitle}</DialogTitle>
            <DialogDescription>{t.studioDeleteConfirm}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <p className="truncate text-sm font-medium text-foreground">
              {deleteTarget.title}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteSaving}
            >
              {deleteSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioDelete}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export { StudioShell }
