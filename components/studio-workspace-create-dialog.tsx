"use client"

import Link from "next/link"
import * as React from "react"
import {
  RiArrowUpLine,
  RiCheckLine,
  RiFolderLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"
import { Cloud, Folder, FolderOpen, Server } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
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
import type { CodeBoxDirectoryList, CodeBoxSandbox } from "@/lib/codebox-types"
import type { StudioWorkspace } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import {
  apiRequest,
  formatDate,
  normalizeWorkspaceDirectoryPath,
} from "./codebox/utils"

type WorkspaceKind = StudioWorkspace["type"]

function isPathInsideRoot(path: string, root: string) {
  return root === "/" || path === root || path.startsWith(`${root}/`)
}

function getPathName(path: string) {
  return path.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ?? path
}

function getStatusClasses(status: CodeBoxSandbox["status"]) {
  if (status === "running") {
    return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
  }

  if (status === "paused") {
    return "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300"
  }

  return "border-border bg-muted text-muted-foreground"
}

export function StudioWorkspaceCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workspace: StudioWorkspace) => void | Promise<void>
}) {
  const { locale, t } = useI18n()
  const [kind, setKind] = React.useState<WorkspaceKind>("sandbox")
  const [sandboxes, setSandboxes] = React.useState<CodeBoxSandbox[]>([])
  const [sandboxesLoading, setSandboxesLoading] = React.useState(false)
  const [sandboxesLoaded, setSandboxesLoaded] = React.useState(false)
  const [selectedSandboxId, setSelectedSandboxId] = React.useState("")
  const [directory, setDirectory] = React.useState<CodeBoxDirectoryList | null>(
    null
  )
  const [directoryPath, setDirectoryPath] = React.useState("")
  const [directoryLoading, setDirectoryLoading] = React.useState(false)
  const [workspaceName, setWorkspaceName] = React.useState("")
  const [localPath, setLocalPath] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const selectedSandbox =
    sandboxes.find((sandbox) => sandbox.sandboxId === selectedSandboxId) ?? null

  const copy =
    locale === "zh"
      ? {
          chooseSandbox: "选择已有 Code 沙箱",
          chooseSandboxHint: "工作区只绑定目录，不会创建或销毁沙箱。",
          chooseFolder: "选择沙箱中的工作目录",
          emptySandbox: "暂无可用 Code 沙箱",
          emptySandboxHint: "请先在 Code 沙箱页面创建一个沙箱，再返回选择。",
          goCodebox: "前往 Code 沙箱创建",
          loadingSandbox: "正在加载 Code 沙箱…",
          loadFailed: "加载 Code 沙箱失败。",
          directoryFailed: "读取沙箱目录失败。",
          directoryPath: "工作目录",
          directoryPathHint: "填写沙箱内绝对路径，或从下方目录列表选择。",
          directoryPathOpen: "转到",
          rootOnly: "Studio 工作区必须位于沙箱工作目录内。",
          workspaceName: "工作区名称",
          workspaceNamePlaceholder: "默认使用文件夹名称",
          selectSandboxRequired: "请先选择一个 Code 沙箱。",
          selectDirectoryRequired: "请选择沙箱中的工作目录。",
          created: "工作区已打开。",
          createFailed: "创建工作区失败。",
          localCreated: "本地工作区已打开。",
          currentDirectory: "当前目录",
          noDirectories: "当前目录没有子文件夹",
          create: "打开工作区",
        }
      : {
          chooseSandbox: "Choose an existing Code Sandbox",
          chooseSandboxHint:
            "A workspace only binds a folder. It never creates or deletes the sandbox.",
          chooseFolder: "Choose a folder in the sandbox",
          emptySandbox: "No Code Sandboxes available",
          emptySandboxHint:
            "Create a sandbox on the Code Sandbox page, then return here to select it.",
          goCodebox: "Create a Code Sandbox",
          loadingSandbox: "Loading Code Sandboxes…",
          loadFailed: "Failed to load Code Sandboxes.",
          directoryFailed: "Failed to read sandbox folders.",
          directoryPath: "Working folder",
          directoryPathHint:
            "Enter an absolute sandbox path or choose one from the folder list below.",
          directoryPathOpen: "Go",
          rootOnly:
            "Studio workspaces must stay inside the sandbox workspace root.",
          workspaceName: "Workspace name",
          workspaceNamePlaceholder: "Defaults to the folder name",
          selectSandboxRequired: "Choose a Code Sandbox first.",
          selectDirectoryRequired: "Choose a folder in the sandbox.",
          created: "Workspace opened.",
          createFailed: "Failed to create workspace.",
          localCreated: "Local workspace opened.",
          currentDirectory: "Current folder",
          noDirectories: "No child folders",
          create: "Open workspace",
        }

  const reset = React.useCallback(() => {
    setKind("sandbox")
    setSandboxesLoaded(false)
    setSelectedSandboxId("")
    setDirectory(null)
    setDirectoryPath("")
    setWorkspaceName("")
    setLocalPath("")
    setSaving(false)
  }, [])

  const loadSandboxes = React.useCallback(async () => {
    setSandboxesLoading(true)

    try {
      const next = await apiRequest<CodeBoxSandbox[]>(
        "/api/codebox/sandboxes?state=all",
        undefined,
        copy.loadFailed
      )
      setSandboxes(next)
      setSandboxesLoaded(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
      setSandboxesLoaded(true)
    } finally {
      setSandboxesLoading(false)
    }
  }, [copy.loadFailed])

  React.useEffect(() => {
    if (!open || sandboxesLoaded || sandboxesLoading) {
      return
    }

    queueMicrotask(() => void loadSandboxes())
  }, [loadSandboxes, open, sandboxesLoaded, sandboxesLoading])

  async function loadDirectory(sandbox: CodeBoxSandbox, requestedPath: string) {
    let root: string
    let path: string

    try {
      root = normalizeWorkspaceDirectoryPath(
        sandbox.workspacePath || "/workspace"
      )
      path = normalizeWorkspaceDirectoryPath(requestedPath || root)
    } catch {
      toast.error(t.codeboxWorkspaceDirectoryInvalid)
      return
    }

    if (!isPathInsideRoot(path, root)) {
      toast.error(copy.rootOnly)
      return
    }

    setDirectoryLoading(true)

    try {
      const next = await apiRequest<CodeBoxDirectoryList>(
        `/api/codebox/sandboxes/${encodeURIComponent(
          sandbox.sandboxId
        )}/directories?path=${encodeURIComponent(path)}`,
        undefined,
        copy.directoryFailed
      )

      if (!isPathInsideRoot(normalizeWorkspaceDirectoryPath(next.path), root)) {
        throw new Error(copy.rootOnly)
      }

      setDirectory(next)
      setDirectoryPath(next.path)
      setWorkspaceName((current) => current || getPathName(next.path))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.directoryFailed)
    } finally {
      setDirectoryLoading(false)
    }
  }

  function handleSelectSandbox(sandbox: CodeBoxSandbox) {
    const root = sandbox.workspacePath || "/workspace"

    setSelectedSandboxId(sandbox.sandboxId)
    setDirectory(null)
    setDirectoryPath(root)
    setWorkspaceName(sandbox.name?.trim() || getPathName(root))
    void loadDirectory(sandbox, root)
  }

  async function handlePickLocalFolder() {
    if (!window.astraflowDesktop?.pickFolder || saving) {
      return
    }

    try {
      const path = await window.astraflowDesktop.pickFolder()

      if (path) {
        setLocalPath(path)
      }
    } catch {
      toast.error(t.studioLocalProjectCreateFailed)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) {
      return
    }

    if (kind === "sandbox" && !selectedSandbox) {
      toast.error(copy.selectSandboxRequired)
      return
    }

    if (kind === "sandbox" && !directoryPath.trim()) {
      toast.error(copy.selectDirectoryRequired)
      return
    }

    let normalizedDirectoryPath = directoryPath.trim()

    if (kind === "sandbox" && selectedSandbox) {
      try {
        const root = normalizeWorkspaceDirectoryPath(
          selectedSandbox.workspacePath || "/workspace"
        )
        normalizedDirectoryPath = normalizeWorkspaceDirectoryPath(directoryPath)

        if (!isPathInsideRoot(normalizedDirectoryPath, root)) {
          toast.error(copy.rootOnly)
          return
        }
      } catch {
        toast.error(t.codeboxWorkspaceDirectoryInvalid)
        return
      }
    }

    if (kind === "local" && !localPath.trim()) {
      toast.error(t.studioLocalProjectPathRequired)
      return
    }

    setSaving(true)

    try {
      const workspace = await apiRequest<StudioWorkspace>(
        "/api/studio/workspaces",
        {
          method: "POST",
          body: JSON.stringify(
            kind === "local"
              ? { type: "local", path: localPath.trim() }
              : {
                  type: "sandbox",
                  sandboxId: selectedSandbox?.sandboxId,
                  rootPath: normalizedDirectoryPath,
                  name: workspaceName.trim() || undefined,
                }
          ),
        },
        copy.createFailed
      )

      toast.success(kind === "local" ? copy.localCreated : copy.created)
      await onCreated(workspace)
      onOpenChange(false)
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.createFailed)
    } finally {
      setSaving(false)
    }
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)

    if (!nextOpen) {
      reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-hidden sm:max-w-xl">
        <form
          className="flex max-h-[calc(100vh-5rem)] min-h-0 flex-col gap-5 sm:max-h-[712px]"
          onSubmit={handleSubmit}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <DialogHeader>
              <DialogTitle>{t.studioWorkspaceCreateTitle}</DialogTitle>
              <DialogDescription>
                {t.studioWorkspaceCreateDescription}
              </DialogDescription>
            </DialogHeader>

            <div
              className="grid grid-cols-2 gap-2"
              aria-label={t.studioWorkspaceTypeLabel}
            >
              <WorkspaceTypeButton
                active={kind === "sandbox"}
                icon={<Cloud aria-hidden className="size-4" />}
                title={t.studioWorkspaceTypeSandbox}
                description={t.studioWorkspaceTypeSandboxDescription}
                tone="sandbox"
                onClick={() => setKind("sandbox")}
              />
              <WorkspaceTypeButton
                active={kind === "local"}
                icon={<Folder aria-hidden className="size-4" />}
                title={t.studioWorkspaceTypeLocal}
                description={t.studioWorkspaceTypeLocalDescription}
                tone="local"
                onClick={() => setKind("local")}
              />
            </div>

            {kind === "local" ? (
              <div className="space-y-2">
                <label
                  htmlFor="studio-local-workspace-path"
                  className="text-sm font-medium text-foreground"
                >
                  {t.studioWorkspaceLocalPath}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="studio-local-workspace-path"
                    autoFocus
                    value={localPath}
                    placeholder={t.studioLocalProjectPathPlaceholder}
                    onChange={(event) => setLocalPath(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={saving}
                    onClick={() => void handlePickLocalFolder()}
                  >
                    <FolderOpen aria-hidden />
                    {t.studioWorkspaceLocalChoose}
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t.studioWorkspaceTypeLocalDescription}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {copy.chooseSandbox}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {copy.chooseSandboxHint}
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/15 p-1.5">
                  {sandboxesLoading ? (
                    <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <RiLoader4Line aria-hidden className="animate-spin" />
                      {copy.loadingSandbox}
                    </div>
                  ) : sandboxes.length === 0 ? (
                    <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-6 text-center">
                      <span className="grid size-10 place-items-center rounded-xl border bg-background text-muted-foreground shadow-sm">
                        <Server aria-hidden className="size-4" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {copy.emptySandbox}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {copy.emptySandboxHint}
                        </p>
                      </div>
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link href="/codebox">{copy.goCodebox}</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {sandboxes.map((sandbox) => {
                        const active = sandbox.sandboxId === selectedSandboxId

                        return (
                          <button
                            key={sandbox.sandboxId}
                            type="button"
                            aria-pressed={active}
                            className={cn(
                              "flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                              active
                                ? "border-sky-500/35 bg-background shadow-sm"
                                : "border-transparent hover:bg-background/75"
                            )}
                            onClick={() => handleSelectSandbox(sandbox)}
                          >
                            <span
                              className={cn(
                                "grid size-8 shrink-0 place-items-center rounded-lg",
                                active
                                  ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              <Server aria-hidden className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {sandbox.name || sandbox.sandboxId}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                {sandbox.sandboxId.slice(0, 8)} ·{" "}
                                {sandbox.workspacePath || "/workspace"} ·{" "}
                                {formatDate(sandbox.lastUsedAt, locale)}
                              </span>
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 rounded-md px-1.5 text-[10px] font-medium",
                                getStatusClasses(sandbox.status)
                              )}
                            >
                              {sandbox.status === "running"
                                ? t.codeboxStatusRunning
                                : sandbox.status === "paused"
                                  ? t.codeboxStatusPaused
                                  : t.codeboxStatusUnknown}
                            </Badge>
                            {active ? (
                              <RiCheckLine
                                aria-hidden
                                className="size-4 shrink-0 text-sky-600"
                              />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {selectedSandbox ? (
                  <div className="space-y-3 rounded-xl border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {copy.chooseFolder}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {directoryPath || selectedSandbox.workspacePath}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={
                            directoryLoading ||
                            !directory?.parentPath ||
                            !isPathInsideRoot(
                              directory.parentPath,
                              selectedSandbox.workspacePath || "/workspace"
                            )
                          }
                          aria-label={t.codeboxWorkspaceDirectoryParent}
                          title={t.codeboxWorkspaceDirectoryParent}
                          onClick={() =>
                            directory?.parentPath &&
                            void loadDirectory(
                              selectedSandbox,
                              directory.parentPath
                            )
                          }
                        >
                          <RiArrowUpLine aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={directoryLoading}
                          aria-label={t.codeboxWorkspaceDirectoryLoad}
                          title={t.codeboxWorkspaceDirectoryLoad}
                          onClick={() =>
                            void loadDirectory(selectedSandbox, directoryPath)
                          }
                        >
                          <RiRefreshLine
                            aria-hidden
                            className={cn(directoryLoading && "animate-spin")}
                          />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="studio-sandbox-workspace-path"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {copy.directoryPath}
                      </label>
                      <div className="flex gap-2">
                        <Input
                          id="studio-sandbox-workspace-path"
                          value={directoryPath}
                          autoComplete="off"
                          spellCheck={false}
                          className="font-mono text-xs"
                          placeholder={
                            selectedSandbox.workspacePath || "/workspace"
                          }
                          onChange={(event) =>
                            setDirectoryPath(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return
                            }

                            event.preventDefault()
                            void loadDirectory(selectedSandbox, directoryPath)
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          disabled={directoryLoading || !directoryPath.trim()}
                          onClick={() =>
                            void loadDirectory(selectedSandbox, directoryPath)
                          }
                        >
                          {directoryLoading ? (
                            <RiLoader4Line
                              aria-hidden
                              className="animate-spin"
                            />
                          ) : (
                            <RiFolderLine aria-hidden />
                          )}
                          {copy.directoryPathOpen}
                        </Button>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {copy.directoryPathHint}
                      </p>
                    </div>

                    <div className="max-h-36 min-h-20 overflow-y-auto rounded-lg border bg-muted/15 p-1">
                      {directoryLoading && !directory ? (
                        <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground">
                          <RiLoader4Line aria-hidden className="animate-spin" />
                          {t.codeboxWorkspaceDirectoryLoading}
                        </div>
                      ) : directory?.directories.length ? (
                        directory.directories.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-background"
                            onClick={() =>
                              void loadDirectory(selectedSandbox, entry.path)
                            }
                          >
                            <RiFolderLine
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{entry.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">
                          {copy.noDirectories}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="studio-sandbox-workspace-name"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {copy.workspaceName}
                      </label>
                      <Input
                        id="studio-sandbox-workspace-name"
                        value={workspaceName}
                        maxLength={64}
                        placeholder={copy.workspaceNamePlaceholder}
                        onChange={(event) =>
                          setWorkspaceName(event.target.value)
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                (kind === "local"
                  ? !localPath.trim()
                  : !selectedSandbox || !directoryPath.trim())
              }
            >
              {saving ? (
                <RiLoader4Line aria-hidden className="animate-spin" />
              ) : kind === "local" ? (
                <FolderOpen aria-hidden />
              ) : (
                <Cloud aria-hidden />
              )}
              {saving ? t.studioThinking : copy.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceTypeButton({
  active,
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  description: string
  tone: WorkspaceKind
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active && tone === "sandbox"
          ? "border-sky-500/45 bg-sky-500/8 shadow-sm"
          : active
            ? "border-foreground/25 bg-muted/70 shadow-sm"
            : "border-border bg-muted/20 hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          active && tone === "sandbox"
            ? "bg-sky-500/12 text-sky-600 dark:text-sky-400"
            : active
              ? "bg-background text-foreground shadow-sm"
              : "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}
