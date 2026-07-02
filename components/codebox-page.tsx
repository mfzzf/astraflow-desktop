"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowRightUpLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeBoxLine,
  RiDatabase2Line,
  RiDeleteBin6Line,
  RiFileCopyLine,
  RiGithubLine,
  RiInformationLine,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
  RiRefreshLine,
  RiRestartLine,
  RiTerminalBoxLine,
} from "@remixicon/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CodeBoxGithubStatus,
  CodeBoxSandbox,
  CodeBoxStatus,
  CodeBoxVolume,
} from "@/lib/codebox-types"
import { cn } from "@/lib/utils"

type SandboxFilter = "all" | "running" | "paused"

type ApiEnvelope<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type GithubDeviceFlow = {
  flowId: string
  userCode: string
  verificationUri: string
  expiresAt: string
  interval: number
}

type GithubPollResult =
  | {
      status: "pending"
      interval?: number
    }
  | {
      status: "expired" | "error"
      message?: string
    }
  | {
      status: "complete"
      github: CodeBoxGithubStatus
    }

type ModelverseApiKeyOption = {
  id: string
  name: string
}

type ModelverseApiKeysResponse = {
  projectId: string
  items: ModelverseApiKeyOption[]
  selected: ModelverseApiKeyOption | null
}

type SaveModelverseApiKeyResponse = {
  projectId: string
  selected: ModelverseApiKeyOption
}

type ConfirmAction =
  | {
      kind: "volume"
      volume: CodeBoxVolume
    }
  | {
      kind: "sandbox"
      sandbox: CodeBoxSandbox
    }

const DEFAULT_VOLUME_NAME = "workspace"

async function apiRequest<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  })
  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.ok) {
    const message =
      payload && "message" in payload && payload.message
        ? payload.message
        : "Request failed."

    throw new Error(message)
  }

  return payload.data
}

function formatDate(value: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getSandboxStatusLabel(status: CodeBoxSandbox["status"]) {
  if (status === "running") {
    return "Running"
  }

  if (status === "paused") {
    return "Paused"
  }

  return "Unknown"
}

function copyWithFallback(value: string) {
  let eventCopied = false
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return
    }

    event.clipboardData.setData("text/plain", value)
    event.preventDefault()
    eventCopied = true
  }

  document.addEventListener("copy", onCopy)

  try {
    document.execCommand("copy")

    if (eventCopied) {
      return true
    }
  } finally {
    document.removeEventListener("copy", onCopy)
  }

  const textarea = document.createElement("textarea")
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
    selection?.removeAllRanges()
    selectedRanges.forEach((range) => selection?.addRange(range))
    activeElement?.focus({ preventScroll: true })
  }
}

async function writeClipboard(value: string) {
  if (copyWithFallback(value)) {
    return true
  }

  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function CodeBoxPage() {
  const [status, setStatus] = React.useState<CodeBoxStatus | null>(null)
  const [volumes, setVolumes] = React.useState<CodeBoxVolume[]>([])
  const [sandboxes, setSandboxes] = React.useState<CodeBoxSandbox[]>([])
  const [selectedVolumeId, setSelectedVolumeId] = React.useState("")
  const [volumeName, setVolumeName] = React.useState(DEFAULT_VOLUME_NAME)
  const [repoUrl, setRepoUrl] = React.useState("")
  const [apiKeys, setApiKeys] = React.useState<ModelverseApiKeyOption[]>([])
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState("")
  const [apiKeyProjectId, setApiKeyProjectId] = React.useState("")
  const [isApiKeyLoading, setIsApiKeyLoading] = React.useState(true)
  const [sandboxFilter, setSandboxFilter] = React.useState<SandboxFilter>("all")
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [githubFlow, setGithubFlow] = React.useState<GithubDeviceFlow | null>(
    null
  )
  const [githubDialogOpen, setGithubDialogOpen] = React.useState(false)
  const [githubMessage, setGithubMessage] = React.useState("")
  const [confirmAction, setConfirmAction] =
    React.useState<ConfirmAction | null>(null)

  React.useEffect(() => {
    if (!notice) {
      return
    }

    const timeout = window.setTimeout(() => setNotice(null), 3200)

    return () => window.clearTimeout(timeout)
  }, [notice])

  const selectedVolume = React.useMemo(
    () => volumes.find((volume) => volume.volumeId === selectedVolumeId),
    [selectedVolumeId, volumes]
  )

  const loadData = React.useCallback(async () => {
    setError(null)
    setIsApiKeyLoading(true)

    try {
      const [nextStatus, apiKeyData] = await Promise.all([
        apiRequest<CodeBoxStatus>("/api/codebox/status"),
        apiRequest<ModelverseApiKeysResponse>(
          "/api/studio/modelverse-api-keys"
        ),
      ])

      setStatus(nextStatus)
      setApiKeys(apiKeyData.items)
      setApiKeyProjectId(apiKeyData.projectId)
      setSelectedApiKeyId(apiKeyData.selected?.id ?? "")

      if (!nextStatus.modelverseApiKey.configured) {
        setVolumes([])
        setSandboxes([])
        setSelectedVolumeId("")
        return
      }

      const [nextVolumes, nextSandboxes] = await Promise.all([
        apiRequest<CodeBoxVolume[]>("/api/codebox/volumes"),
        apiRequest<CodeBoxSandbox[]>(
          `/api/codebox/sandboxes?state=${sandboxFilter}`
        ),
      ])

      setVolumes(nextVolumes)
      setSandboxes(nextSandboxes)
      setSelectedVolumeId((current) => {
        if (
          current &&
          nextVolumes.some((volume) => volume.volumeId === current)
        ) {
          return current
        }

        return nextVolumes[0]?.volumeId ?? ""
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load CodeBox data."
      )
    } finally {
      setIsLoading(false)
      setIsApiKeyLoading(false)
    }
  }, [sandboxFilter])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  React.useEffect(() => {
    if (!githubFlow) {
      return
    }

    const activeFlow = githubFlow
    let cancelled = false
    let timer: number | undefined
    let nextIntervalSeconds = Math.max(3, activeFlow.interval)

    async function pollGithub() {
      try {
        const result = await apiRequest<GithubPollResult>(
          `/api/codebox/github/device/${activeFlow.flowId}/poll`,
          {
            method: "POST",
          }
        )

        if (cancelled) {
          return
        }

        if (result.status === "pending") {
          if (result.interval) {
            nextIntervalSeconds = Math.max(3, result.interval)
          }

          setGithubMessage("Waiting for GitHub authorization...")
          timer = window.setTimeout(
            () => void pollGithub(),
            nextIntervalSeconds * 1000
          )
          return
        }

        if (result.status === "complete") {
          setStatus((current) =>
            current
              ? {
                  ...current,
                  github: result.github,
                }
              : current
          )
          setGithubMessage("GitHub is connected.")
          setGithubFlow(null)
          setGithubDialogOpen(false)
          setNotice(
            "GitHub token will be injected into new and resumed sandboxes."
          )
          void loadData()
          return
        }

        setGithubMessage(result.message ?? "GitHub authorization stopped.")
        setGithubFlow(null)
      } catch (pollError) {
        if (!cancelled) {
          setGithubMessage(
            pollError instanceof Error
              ? pollError.message
              : "GitHub authorization failed."
          )
          setGithubFlow(null)
        }
      }
    }

    queueMicrotask(() => {
      setGithubMessage("Waiting for GitHub authorization...")
    })
    timer = window.setTimeout(
      () => void pollGithub(),
      nextIntervalSeconds * 1000
    )

    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [githubFlow, loadData])

  async function refresh() {
    setIsLoading(true)
    await loadData()
  }

  async function selectApiKey(apiKeyId: string) {
    const normalizedApiKeyId = apiKeyId.trim()

    if (!normalizedApiKeyId || normalizedApiKeyId === "__empty") {
      return
    }

    setSelectedApiKeyId(normalizedApiKeyId)
    setBusyAction("save-api-key")
    setError(null)
    setNotice(null)

    try {
      const saved = await apiRequest<SaveModelverseApiKeyResponse>(
        "/api/studio/modelverse-api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            apiKeyId: normalizedApiKeyId,
            projectId: apiKeyProjectId || undefined,
          }),
        }
      )

      setNotice(`API key ${saved.selected.name} is selected.`)
      await loadData()
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Failed to select API key."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createVolume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusyAction("create-volume")
    setError(null)
    setNotice(null)

    try {
      const volume = await apiRequest<CodeBoxVolume>("/api/codebox/volumes", {
        method: "POST",
        body: JSON.stringify({ name: volumeName }),
      })

      setVolumes((current) => [volume, ...current])
      setSelectedVolumeId(volume.volumeId)
      setVolumeName(DEFAULT_VOLUME_NAME)
      setNotice(`Volume ${volume.name} is ready.`)
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create volume."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteVolume(volume: CodeBoxVolume) {
    setBusyAction(`delete-volume:${volume.volumeId}`)
    setError(null)
    setNotice(null)

    try {
      await apiRequest<{ volumeId: string }>(
        `/api/codebox/volumes/${volume.volumeId}`,
        {
          method: "DELETE",
        }
      )
      await loadData()
      setNotice(`Volume ${volume.name} was deleted.`)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete volume."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createSandbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedVolumeId) {
      setError("Create a volume before launching a sandbox.")
      return
    }

    setBusyAction("create-sandbox")
    setError(null)
    setNotice(null)

    try {
      const sandbox = await apiRequest<CodeBoxSandbox>(
        "/api/codebox/sandboxes",
        {
          method: "POST",
          body: JSON.stringify({
            volumeId: selectedVolumeId,
            repoUrl,
          }),
        }
      )

      setSandboxes((current) => [sandbox, ...current])
      setRepoUrl("")
      const passwordCopied = await copyText(sandbox.password)
      setNotice(
        passwordCopied
          ? `code-server is running for ${sandbox.volumeName ?? "the selected volume"}. Password copied.`
          : `code-server is running for ${sandbox.volumeName ?? "the selected volume"}.`
      )
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create sandbox."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function runSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    setBusyAction(`${action}:${sandbox.sandboxId}`)
    setError(null)
    setNotice(null)

    try {
      await apiRequest<{ sandboxId: string }>(
        `/api/codebox/sandboxes/${sandbox.sandboxId}/${action}`,
        {
          method: "POST",
        }
      )
      await loadData()
      setNotice(`Sandbox ${action} completed.`)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `Failed to ${action} sandbox.`
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    if (action === "kill") {
      setConfirmAction({ kind: "sandbox", sandbox })
      return
    }

    await runSandboxAction(sandbox, action)
  }

  async function confirmDestructiveAction() {
    const action = confirmAction

    if (!action) {
      return
    }

    setConfirmAction(null)

    if (action.kind === "volume") {
      await deleteVolume(action.volume)
      return
    }

    await runSandboxAction(action.sandbox, "kill")
  }

  async function startGithubLogin() {
    setBusyAction("github-login")
    setError(null)
    setGithubMessage("")

    try {
      const flow = await apiRequest<GithubDeviceFlow>(
        "/api/codebox/github/device",
        {
          method: "POST",
        }
      )

      setGithubFlow(flow)
      setGithubDialogOpen(true)
      setGithubMessage("Waiting for GitHub authorization...")
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Failed to start GitHub login."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function logoutGithub() {
    setBusyAction("github-logout")
    setError(null)

    try {
      const github = await apiRequest<CodeBoxGithubStatus>(
        "/api/codebox/github/logout",
        {
          method: "POST",
        }
      )

      setStatus((current) =>
        current
          ? {
              ...current,
              github,
            }
          : current
      )
      setNotice("GitHub authorization was removed from CodeBox.")
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "Failed to log out GitHub."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function copyText(value: string | null | undefined) {
    if (!value) {
      return false
    }

    return writeClipboard(value)
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] max-h-[calc(100svh-4rem)] min-h-0 flex-col overflow-hidden bg-background">
      <section className="flex min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
          {error ? (
            <Alert variant="destructive" className="shrink-0">
              <RiInformationLine />
              <AlertTitle>CodeBox needs attention</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {notice ? (
            <Alert className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100 [&_[data-slot=alert-description]]:text-emerald-700 dark:[&_[data-slot=alert-description]]:text-emerald-200/80">
              <RiCheckLine />
              <AlertTitle>Done</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(280px,0.72fr)_minmax(640px,1.6fr)]">
            <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <Panel
                title="Volumes"
                description={`${volumes.length} volume${volumes.length === 1 ? "" : "s"}`}
                icon={<RiDatabase2Line className="size-4" aria-hidden />}
                className="flex min-h-0 flex-1 flex-col"
                bodyClassName="flex min-h-0 flex-1 flex-col"
              >
                <form className="flex gap-2" onSubmit={createVolume}>
                  <Input
                    value={volumeName}
                    onChange={(event) => setVolumeName(event.target.value)}
                    placeholder="workspace"
                    className="h-9"
                    disabled={busyAction === "create-volume"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busyAction === "create-volume"}
                  >
                    {busyAction === "create-volume" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiAddLine />
                    )}
                    Create
                  </Button>
                </form>

                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {volumes.length === 0 ? (
                    <EmptyBlock text="Create a persistent volume first." />
                  ) : (
                    volumes.map((volume) => (
                      <VolumeItem
                        key={volume.volumeId}
                        volume={volume}
                        selected={volume.volumeId === selectedVolumeId}
                        busy={busyAction === `delete-volume:${volume.volumeId}`}
                        onSelect={() => setSelectedVolumeId(volume.volumeId)}
                        onDelete={() =>
                          setConfirmAction({ kind: "volume", volume })
                        }
                      />
                    ))
                  )}
                </div>
              </Panel>

              <Panel
                title="GitHub"
                description={
                  status?.github.configured
                    ? (status.github.login ?? "Connected")
                    : "Device Flow login"
                }
                icon={<RiGithubLine className="size-4" aria-hidden />}
                className="shrink-0"
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void startGithubLogin()}
                    disabled={busyAction === "github-login"}
                  >
                    {busyAction === "github-login" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiGithubLine />
                    )}
                    {status?.github.configured ? "Reconnect" : "Connect"}
                  </Button>
                  {status?.github.configured ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void logoutGithub()}
                      disabled={busyAction === "github-logout"}
                    >
                      <RiCloseLine />
                      Logout
                    </Button>
                  ) : null}
                </div>
              </Panel>
            </div>

            <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <Panel
                title="New Sandbox"
                description={
                  selectedVolume
                    ? `Mounts ${selectedVolume.name} at /workspace`
                    : "Select or create a volume"
                }
                icon={<RiTerminalBoxLine className="size-4" aria-hidden />}
                className="shrink-0"
              >
                <form
                  className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(180px,0.8fr)_minmax(260px,1.2fr)_auto]"
                  onSubmit={createSandbox}
                >
                  <Select
                    value={selectedApiKeyId || undefined}
                    onValueChange={(value) => {
                      const nextValue = value.trim()

                      if (nextValue && nextValue !== "__empty") {
                        void selectApiKey(nextValue)
                      }
                    }}
                    disabled={isApiKeyLoading || busyAction === "save-api-key"}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          isApiKeyLoading ? "Loading API keys" : "API key"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {apiKeys.length === 0 ? (
                          <SelectItem value="__empty" disabled>
                            No API keys
                          </SelectItem>
                        ) : (
                          apiKeys.map((apiKey) => (
                            <SelectItem key={apiKey.id} value={apiKey.id}>
                              {apiKey.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedVolumeId}
                    onValueChange={setSelectedVolumeId}
                    disabled={volumes.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select volume" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {volumes.map((volume) => (
                          <SelectItem
                            key={volume.volumeId}
                            value={volume.volumeId}
                          >
                            {volume.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Input
                    type="url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="Optional GitHub repo URL"
                    className="h-9"
                  />

                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busyAction === "create-sandbox" ||
                      busyAction === "save-api-key" ||
                      !selectedVolumeId ||
                      !selectedApiKeyId
                    }
                  >
                    {busyAction === "create-sandbox" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiPlayLine />
                    )}
                    Launch
                  </Button>
                </form>
              </Panel>

              <Panel
                title="Sandboxes"
                description={`${sandboxes.length} shown`}
                icon={<RiCodeBoxLine className="size-4" aria-hidden />}
                className="flex min-h-0 flex-1 flex-col"
                bodyClassName="min-h-0 flex-1"
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void refresh()}
                      disabled={isLoading}
                      aria-label="Refresh sandboxes"
                    >
                      <RiRefreshLine
                        className={cn(isLoading && "animate-spin")}
                      />
                    </Button>
                    <Select
                      value={sandboxFilter}
                      onValueChange={(value) =>
                        setSandboxFilter(value as SandboxFilter)
                      }
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="running">Running</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                }
              >
                <div className="flex max-h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {isLoading && sandboxes.length === 0 ? (
                    <LoadingBlock />
                  ) : sandboxes.length === 0 ? (
                    <EmptyBlock text="No CodeBox sandboxes yet." />
                  ) : (
                    sandboxes.map((sandbox) => (
                      <SandboxItem
                        key={sandbox.sandboxId}
                        sandbox={sandbox}
                        busyAction={busyAction}
                        onCopy={copyText}
                        onAction={handleSandboxAction}
                      />
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </section>

      <GithubDeviceDialog
        open={githubDialogOpen}
        onOpenChange={setGithubDialogOpen}
        flow={githubFlow}
        message={githubMessage}
        onCopy={copyText}
      />
      <ConfirmActionDialog
        action={confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null)
          }
        }}
        onConfirm={() => void confirmDestructiveAction()}
      />
    </main>
  )
}

function Panel({
  title,
  description,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  icon: React.ReactNode
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

function VolumeItem({
  volume,
  selected,
  busy,
  onSelect,
  onDelete,
}: {
  volume: CodeBoxVolume
  selected: boolean
  busy: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-2xl border p-2 transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-background"
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
      >
        <div className="truncate text-sm font-medium">{volume.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatDate(volume.createdAt)} / seen {formatDate(volume.lastSeenAt)}
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Delete ${volume.name}`}
      >
        {busy ? (
          <RiLoader4Line className="animate-spin" />
        ) : (
          <RiDeleteBin6Line />
        )}
      </Button>
    </div>
  )
}

function SandboxItem({
  sandbox,
  busyAction,
  onCopy,
  onAction,
}: {
  sandbox: CodeBoxSandbox
  busyAction: string | null
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onAction: (
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) => Promise<void>
}) {
  const statusLabel = getSandboxStatusLabel(sandbox.status)
  const isPaused = sandbox.status === "paused"
  const isRunning = sandbox.status === "running"

  return (
    <article className="rounded-2xl border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-[220px] truncate text-sm font-semibold">
              {sandbox.volumeName ?? sandbox.sandboxId}
            </h3>
            <Badge
              variant={
                isRunning ? "default" : isPaused ? "secondary" : "outline"
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {sandbox.sandboxId} / updated {formatDate(sandbox.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {isRunning && sandbox.codeServerUrl ? (
            <Button asChild size="sm">
              <a href={sandbox.codeServerUrl} target="_blank" rel="noreferrer">
                Open
                <RiArrowRightUpLine />
              </a>
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "pause")}
              disabled={busyAction === `pause:${sandbox.sandboxId}`}
              aria-label="Pause sandbox"
            >
              {busyAction === `pause:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiPauseLine />
              )}
            </Button>
          ) : null}
          {isPaused ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "resume")}
              disabled={busyAction === `resume:${sandbox.sandboxId}`}
              aria-label="Resume sandbox"
            >
              {busyAction === `resume:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiRestartLine />
              )}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="icon-sm"
            onClick={() => void onAction(sandbox, "kill")}
            disabled={busyAction === `kill:${sandbox.sandboxId}`}
            aria-label="Kill sandbox"
          >
            {busyAction === `kill:${sandbox.sandboxId}` ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiDeleteBin6Line />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <CopyLine
          label="URL"
          value={sandbox.codeServerUrl ?? "-"}
          onCopy={() => onCopy(sandbox.codeServerUrl)}
        />
        <CopyLine
          label="Password"
          value={sandbox.password ?? "-"}
          onCopy={() => onCopy(sandbox.password)}
        />
        <InfoLine label="Workspace" value={sandbox.workspacePath} />
        <InfoLine label="Repo" value={sandbox.repoUrl ?? "-"} />
      </div>
    </article>
  )
}

function CopyLine({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => Promise<boolean>
}) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => setCopied(false), 1200)

    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    setCopied(await onCopy())
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void handleCopy()}
        disabled={value === "-"}
        aria-label={`Copy ${label}`}
      >
        {copied ? <RiCheckLine /> : <RiFileCopyLine />}
      </Button>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
    </div>
  )
}

function LoadingBlock() {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background text-sm text-muted-foreground">
      <RiLoader4Line className="mr-2 size-4 animate-spin" aria-hidden />
      Loading
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background px-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function GithubDeviceDialog({
  open,
  onOpenChange,
  flow,
  message,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: GithubDeviceFlow | null
  message: string
  onCopy: (value: string | null | undefined) => Promise<boolean>
}) {
  const [copyState, setCopyState] = React.useState<{
    userCode: string | null
    status: "idle" | "copied" | "blocked"
  }>({
    userCode: null,
    status: "idle",
  })
  const activeCopyStatus =
    open && copyState.userCode === flow?.userCode ? copyState.status : "idle"

  async function handleCopyCode() {
    if (!flow?.userCode) {
      return
    }

    setCopyState({
      userCode: flow.userCode,
      status: (await onCopy(flow.userCode)) ? "copied" : "blocked",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect GitHub</DialogTitle>
          <DialogDescription>
            Authorize the device code in GitHub. CodeBox will poll until the
            token is ready or the code expires.
          </DialogDescription>
        </DialogHeader>

        {flow ? (
          <div className="grid gap-3">
            <div className="rounded-2xl border bg-background p-4 text-center">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                Device code
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-normal">
                {flow.userCode}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void handleCopyCode()}
              >
                {activeCopyStatus === "copied" ? (
                  <RiCheckLine />
                ) : (
                  <RiFileCopyLine />
                )}
                {activeCopyStatus === "copied" ? "Copied" : "Copy code"}
              </Button>
              {activeCopyStatus === "blocked" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Copy is blocked here. Select the code manually.
                </p>
              ) : null}
            </div>

            <Button asChild>
              <a href={flow.verificationUri} target="_blank" rel="noreferrer">
                Open GitHub
                <RiArrowRightUpLine />
              </a>
            </Button>

            <p className="text-sm text-muted-foreground">
              {message || `Expires at ${formatDate(flow.expiresAt)}.`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {message || "No active GitHub device flow."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConfirmActionDialog({
  action,
  onOpenChange,
  onConfirm,
}: {
  action: ConfirmAction | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const isVolume = action?.kind === "volume"
  const target =
    action?.kind === "volume"
      ? action.volume.name
      : (action?.sandbox.volumeName ?? action?.sandbox.sandboxId ?? "")

  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <RiDeleteBin6Line className="size-5" aria-hidden />
          </div>
          <DialogTitle>
            {isVolume ? "Delete volume?" : "Kill sandbox?"}
          </DialogTitle>
          <DialogDescription>
            {isVolume
              ? `Delete ${target}? Files on this volume will be removed.`
              : `Kill ${target}? The running code-server session will stop immediately.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <RiDeleteBin6Line />
            {isVolume ? "Delete" : "Kill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CodeBoxPage }
