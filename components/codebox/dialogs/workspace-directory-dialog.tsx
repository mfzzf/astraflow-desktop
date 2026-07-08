import * as React from "react"

import {
  RiArrowRightUpLine,
  RiArrowUpLine,
  RiFolderLine,
  RiLoader4Line,
  RiTerminalBoxLine,
  RiRefreshLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
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
  DEFAULT_CODEBOX_WORKSPACE_PATH,
  type CodeBoxDirectoryList,
  type CodeBoxSandbox,
} from "../types"
import {
  apiRequest,
  normalizeWorkspaceDirectoryPath,
} from "../utils"

export function WorkspaceDirectoryDialog({
  sandbox,
  value,
  defaultPath,
  onValueChange,
  onOpenChange,
  onOpen,
}: {
  sandbox: CodeBoxSandbox | null
  value: string
  defaultPath: string
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onOpen: (path: string) => void
}) {
  const { t } = useI18n()
  const [error, setError] = React.useState<string | null>(null)
  const [directoryData, setDirectoryData] =
    React.useState<CodeBoxDirectoryList | null>(null)
  const [directoryError, setDirectoryError] = React.useState<string | null>(null)
  const [isDirectoryLoading, setIsDirectoryLoading] = React.useState(false)

  const quickPaths = React.useMemo(
    () =>
      Array.from(
        new Set(
          [
            sandbox?.workspacePath,
            defaultPath,
            DEFAULT_CODEBOX_WORKSPACE_PATH,
            "/root",
            "/tmp",
          ].filter((path): path is string => Boolean(path?.trim()))
        )
      ),
    [defaultPath, sandbox?.workspacePath]
  )

  const loadDirectory = React.useCallback(
    async (nextPath: string) => {
      if (!sandbox) {
        return
      }

      let normalizedPath: string

      try {
        normalizedPath = normalizeWorkspaceDirectoryPath(nextPath)
      } catch {
        setError(t.codeboxWorkspaceDirectoryInvalid)
        return
      }

      setIsDirectoryLoading(true)
      setDirectoryError(null)
      setError(null)

      try {
        const data = await apiRequest<CodeBoxDirectoryList>(
          `/api/codebox/sandboxes/${encodeURIComponent(
            sandbox.sandboxId
          )}/directories?path=${encodeURIComponent(normalizedPath)}`,
          undefined,
          t.codeboxWorkspaceDirectoryLoadFailed
        )

        setDirectoryData(data)
        onValueChange(data.path)
      } catch (loadError) {
        setDirectoryError(
          loadError instanceof Error
            ? loadError.message
            : t.codeboxWorkspaceDirectoryLoadFailed
        )
      } finally {
        setIsDirectoryLoading(false)
      }
    },
    [onValueChange, sandbox, t]
  )

  React.useEffect(() => {
    if (!sandbox) {
      return
    }

    queueMicrotask(() => {
      void loadDirectory(
        sandbox.workspacePath || defaultPath || DEFAULT_CODEBOX_WORKSPACE_PATH
      )
    })
  }, [defaultPath, loadDirectory, sandbox])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = value.trim()

    if (!trimmed) {
      setError(t.codeboxWorkspaceDirectoryRequired)
      return
    }

    if (!trimmed.startsWith("/")) {
      setError(t.codeboxWorkspaceDirectoryAbsolute)
      return
    }

    try {
      const normalized = normalizeWorkspaceDirectoryPath(trimmed)

      setError(null)
      onValueChange(normalized)
      onOpen(normalized)
    } catch {
      setError(t.codeboxWorkspaceDirectoryInvalid)
    }
  }

  const currentDirectoryPath = directoryData?.path ?? value.trim()
  const parentDirectoryPath = directoryData?.parentPath ?? null

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <RiTerminalBoxLine className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t.codeboxWorkspaceDirectoryTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxWorkspaceDirectoryDescription}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium"
              htmlFor="codebox-workspace-directory"
            >
              {t.codeboxWorkspaceDirectoryLabel}
            </label>
            <Input
              id="codebox-workspace-directory"
              value={value}
              onChange={(event) => {
                onValueChange(event.target.value)
                setError(null)
              }}
              placeholder={DEFAULT_CODEBOX_WORKSPACE_PATH}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t.codeboxWorkspaceDirectoryHint}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t.codeboxWorkspaceDirectoryCurrent}
              </p>
              <div className="flex flex-wrap gap-2">
                {parentDirectoryPath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDirectory(parentDirectoryPath)}
                    disabled={isDirectoryLoading}
                  >
                    <RiArrowUpLine />
                    {t.codeboxWorkspaceDirectoryParent}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadDirectory(value)}
                  disabled={isDirectoryLoading}
                >
                  {isDirectoryLoading ? (
                    <RiLoader4Line className="animate-spin" />
                  ) : (
                    <RiRefreshLine />
                  )}
                  {t.codeboxWorkspaceDirectoryLoad}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border bg-background">
              <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                <RiFolderLine className="shrink-0" aria-hidden />
                <span className="truncate">
                  {currentDirectoryPath || DEFAULT_CODEBOX_WORKSPACE_PATH}
                </span>
              </div>
              <div className="flex max-h-52 min-h-28 flex-col overflow-y-auto p-1">
                {isDirectoryLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                    <RiLoader4Line className="animate-spin" aria-hidden />
                    {t.codeboxWorkspaceDirectoryLoading}
                  </div>
                ) : directoryError ? (
                  <div className="flex flex-1 items-center justify-center px-3 py-8 text-center text-sm text-destructive">
                    {directoryError}
                  </div>
                ) : directoryData && directoryData.directories.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-3 py-8 text-center text-sm text-muted-foreground">
                    {t.codeboxWorkspaceDirectoryEmpty}
                  </div>
                ) : (
                  directoryData?.directories.map((directory) => (
                    <Button
                      key={directory.path}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto justify-start px-3 py-2"
                      onClick={() => void loadDirectory(directory.path)}
                    >
                      <RiFolderLine className="shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">
                        {directory.name}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t.codeboxWorkspaceDirectoryQuickPick}
            </p>
            <div className="flex flex-wrap gap-2">
              {quickPaths.map((path) => (
                <Button
                  key={path}
                  type="button"
                  variant={value.trim() === path ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => void loadDirectory(path)}
                >
                  {path}
                </Button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.codeboxCancel}
            </Button>
            <Button type="submit">
              {t.codeboxOpenWorkspace}
              <RiArrowRightUpLine />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
