import * as React from "react"
import {
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiFileAddLine,
  RiFileEditLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import {
  countUnifiedDiffChanges,
  countContentLines,
  synthesizeAdditionsDiff,
} from "@/components/studio-file-diff"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  openStudioReviewPanel,
  type StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { dispatchStudioLocalProjectsChanged } from "@/lib/studio-session-events"
import { cn } from "@/lib/utils"

import { FileChangeStats, FileTypeBadge, getFilePathName } from "./file-output"
import {
  assistantTraceContainerClassName,
  isZhLocale,
  useMessageRenderEnvironment,
} from "./shared"
import type { StudioFilePart } from "./types"

function getFilePartStats(part: StudioFilePart) {
  if (part.stats) {
    return part.stats
  }

  if (!part.diff) {
    // Files written outside a git repository carry no diff; count the
    // written content as additions so the UI never shows a bare +0 -0.
    if (part.kind !== "delete" && part.content) {
      return { additions: countContentLines(part.content), deletions: 0 }
    }

    return { additions: 0, deletions: 0 }
  }

  return countUnifiedDiffChanges(part.diff)
}

function getFilePartDiff(part: StudioFilePart) {
  if (part.diff?.trim()) {
    return part.diff
  }

  if (part.kind !== "delete" && part.content) {
    return synthesizeAdditionsDiff(part.path, part.content)
  }

  return null
}

function getFileChangeVerb({
  kind,
  isZh,
}: {
  kind: StudioFilePart["kind"]
  isZh: boolean
}) {
  if (kind === "create") {
    return isZh ? "\u5df2\u521b\u5efa" : "Created"
  }

  if (kind === "delete") {
    return isZh ? "\u5df2\u5220\u9664" : "Deleted"
  }

  return isZh ? "\u5df2\u66f4\u65b0" : "Updated"
}

function AssistantFileChangeRow({ part }: { part: StudioFilePart }) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const stats = getFilePartStats(part)
  const hasError = part.status === "error"
  const environment = useMessageRenderEnvironment()

  function handleOpenDiff() {
    const changes = aggregateTurnFileChanges([part], environment)

    if (changes.length > 0) {
      openStudioReviewPanel({ scopeLabel: null, files: changes })
    }
  }

  return (
    <button
      type="button"
      title={part.error ?? part.path}
      onClick={handleOpenDiff}
      className={cn(
        "flex min-h-6 w-full min-w-0 items-center gap-1.5 text-left text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground",
        hasError && "text-destructive hover:text-destructive"
      )}
    >
      <span className="shrink-0">
        {getFileChangeVerb({ kind: part.kind, isZh })}
      </span>
      <FileTypeBadge path={part.path} />
      <span
        className={cn(
          "min-w-0 truncate font-medium text-foreground",
          part.kind === "delete" && "line-through opacity-70",
          hasError && "text-destructive"
        )}
      >
        {getFilePathName(part.path)}
      </span>
      <FileChangeStats
        additions={stats.additions}
        deletions={stats.deletions}
      />
    </button>
  )
}

export function AssistantFileChangeGroup({
  files,
}: {
  files: StudioFilePart[]
}) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const [open, setOpen] = React.useState(true)

  if (files.length === 0) {
    return null
  }

  if (files.length === 1) {
    return (
      <div
        className={cn(
          assistantTraceContainerClassName,
          "flex min-w-0 items-center gap-2 text-sm"
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <RiFileEditLine aria-hidden className="size-4" />
        </span>
        <AssistantFileChangeRow part={files[0]} />
      </div>
    )
  }

  const verb = getFileChangeVerb({
    kind: files.every((file) => file.kind === "create") ? "create" : "edit",
    isZh,
  })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(assistantTraceContainerClassName, "flex flex-col")}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-7 w-fit max-w-full items-center gap-2 text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <RiFileEditLine aria-hidden className="size-4" />
          </span>
          <span className="shrink-0 font-medium text-foreground">{verb}</span>
          <span className="min-w-0 truncate">
            {isZh
              ? `${files.length} \u4e2a\u6587\u4ef6`
              : `${files.length} file${files.length === 1 ? "" : "s"}`}
          </span>
          <RiArrowDownSLine
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform",
              !open && "-rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-2.5 flex flex-col gap-0.5 border-l border-border/70 pl-4">
          {files.map((file) => (
            <AssistantFileChangeRow key={file.id} part={file} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function aggregateTurnFileChanges(
  files: StudioFilePart[],
  environment: "local" | "remote" = "local"
): StudioReviewFileChange[] {
  const changes = new Map<string, StudioReviewFileChange>()

  for (const file of files) {
    if (file.status === "error") {
      continue
    }

    const stats = getFilePartStats(file)
    const hasRealDiff = Boolean(file.diff?.trim())
    const diff = getFilePartDiff(file)
    const existing = changes.get(file.path)

    if (!existing) {
      changes.set(file.path, {
        path: file.path,
        kind: file.kind,
        additions: stats.additions,
        deletions: stats.deletions,
        diff,
        environment,
      })
      continue
    }

    existing.kind = file.kind === "create" ? existing.kind : file.kind

    if (hasRealDiff) {
      existing.additions += stats.additions
      existing.deletions += stats.deletions
      existing.diff = [existing.diff, diff]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n")
      continue
    }

    // A synthesized diff reflects the file's entire written content, so a
    // repeated write replaces the previous entry instead of stacking on it.
    existing.additions = stats.additions
    existing.deletions = stats.deletions
    existing.diff = diff ?? existing.diff
  }

  return [...changes.values()]
}

export function StreamingEditedFilesSummary({
  files,
}: {
  files: StudioFilePart[]
}) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const changes = React.useMemo(() => aggregateTurnFileChanges(files), [files])
  const totals = React.useMemo(
    () =>
      changes.reduce(
        (sum, change) => ({
          additions: sum.additions + change.additions,
          deletions: sum.deletions + change.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [changes]
  )

  if (changes.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "flex min-h-7 min-w-0 items-center gap-2 text-sm text-token-text-secondary"
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
        <RiFileEditLine aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 truncate font-medium text-token-text-primary">
        {isZh
          ? `${changes.length} 个文件已更改`
          : `${changes.length} file${changes.length === 1 ? "" : "s"} changed`}
      </span>
      <span className="flex shrink-0 items-center gap-1 [font-family:var(--diffs-font-family)] text-xs tabular-nums">
        <span className="text-[var(--diffs-addition-base)]">
          +{totals.additions}
        </span>
        <span className="text-[var(--diffs-deletion-base)]">
          -{totals.deletions}
        </span>
      </span>
    </div>
  )
}

function splitFilePathLabel(path: string) {
  const segments = path.split(/[\\/]/)
  const basename = segments.pop() ?? path

  return {
    directory: segments.length > 0 ? `${segments.join("/")}/` : "",
    basename,
  }
}

const TURN_EDITED_FILES_VISIBLE_COUNT = 3
const MAX_TURN_PATCHES = 50
const MAX_TURN_PATCH_BYTES = 4 * 1024 * 1024
const MAX_SINGLE_TURN_PATCH_BYTES = 1024 * 1024

export type StudioTurnPatch = {
  path: string
  diff: string
}

function normalizeTurnPatchPath(path: string) {
  return path.replaceAll("\\", "/")
}

function isSafeTurnPatchPath(path: string) {
  const normalized = normalizeTurnPatchPath(path)
  const segments = normalized.split("/")

  return (
    normalized.length > 0 &&
    normalized.length <= 1024 &&
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:\//.test(normalized) &&
    !normalized.includes("\0") &&
    !normalized.includes("\n") &&
    !normalized.includes("\r") &&
    segments.every(
      (segment) => segment && segment !== "." && segment !== ".."
    ) &&
    !segments.includes(".git")
  )
}

function decodeTurnPatchQuotedPath(value: string) {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value
  }

  const source = value.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character !== "\\") {
      bytes.push(...encoder.encode(character))
      continue
    }

    const escape = source[index + 1]

    if (!escape) {
      return null
    }

    if (/[0-7]/.test(escape)) {
      const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)?.[0]

      if (!octal) {
        return null
      }

      bytes.push(Number.parseInt(octal, 8))
      index += octal.length
      continue
    }

    const escapedBytes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92,
    }
    const byte = escapedBytes[escape]

    if (byte === undefined) {
      return null
    }

    bytes.push(byte)
    index += 1
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes)
    )
  } catch {
    return null
  }
}

function getTurnPatchHeaderPath(line: string) {
  const rawValue = line.slice(4).split("\t", 1)[0]?.trim()

  if (!rawValue) {
    return null
  }

  const decoded = decodeTurnPatchQuotedPath(rawValue)

  if (decoded === null) {
    return null
  }

  if (decoded === "/dev/null") {
    return decoded
  }

  return normalizeTurnPatchPath(decoded.replace(/^[ab]\//, ""))
}

function hasSingleFileUnifiedDiff(diff: string, expectedPath: string) {
  const lines = diff.split(/\r?\n/)
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "))

  if (firstHunkIndex < 0) {
    return false
  }

  if (
    lines.filter((line) => line.startsWith("diff --git ")).length > 1 ||
    lines.some(
      (line, index) =>
        index > firstHunkIndex &&
        line.startsWith("--- ") &&
        lines[index + 1]?.startsWith("+++ ")
    )
  ) {
    return false
  }

  const headerLines = lines.slice(0, firstHunkIndex)
  const oldHeaders = headerLines.filter((line) => line.startsWith("--- "))
  const newHeaders = headerLines.filter((line) => line.startsWith("+++ "))

  if (oldHeaders.length !== 1 || newHeaders.length !== 1) {
    return false
  }

  const oldPath = getTurnPatchHeaderPath(oldHeaders[0])
  const newPath = getTurnPatchHeaderPath(newHeaders[0])
  const normalizedExpectedPath = normalizeTurnPatchPath(expectedPath)

  return (
    oldPath !== null &&
    newPath !== null &&
    (oldPath === normalizedExpectedPath || oldPath === "/dev/null") &&
    (newPath === normalizedExpectedPath || newPath === "/dev/null") &&
    (oldPath === normalizedExpectedPath || newPath === normalizedExpectedPath)
  )
}

export function getReversibleTurnPatches(
  files: StudioFilePart[]
): StudioTurnPatch[] | null {
  if (files.length === 0 || files.length > MAX_TURN_PATCHES) {
    return null
  }

  const encoder = new TextEncoder()
  const paths = new Set<string>()
  const patches: StudioTurnPatch[] = []
  let totalBytes = 0

  for (const file of files) {
    const diff = file.diff
    const normalizedPath = normalizeTurnPatchPath(file.path)

    if (
      file.status !== "complete" ||
      !diff?.trim() ||
      !isSafeTurnPatchPath(file.path) ||
      !hasSingleFileUnifiedDiff(diff, normalizedPath) ||
      paths.has(normalizedPath)
    ) {
      return null
    }

    const patchBytes = encoder.encode(diff).byteLength

    if (patchBytes > MAX_SINGLE_TURN_PATCH_BYTES) {
      return null
    }

    totalBytes += patchBytes

    if (totalBytes > MAX_TURN_PATCH_BYTES) {
      return null
    }

    paths.add(normalizedPath)
    patches.push({ path: file.path, diff })
  }

  return patches
}

function TurnEditedFilesRow({
  change,
  onOpenFile,
  onOpenReview,
}: {
  change: StudioReviewFileChange
  onOpenFile: () => void
  onOpenReview: () => void
}) {
  const { directory, basename } = splitFilePathLabel(change.path)

  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          onOpenFile()
          return
        }

        onOpenReview()
      }}
      className="flex h-9 w-full min-w-0 items-center justify-between gap-3 px-3 text-left text-sm transition-colors hover:bg-token-list-hover-background focus-visible:bg-token-list-hover-background focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          change.kind === "delete" && "line-through opacity-70"
        )}
        title={change.path}
      >
        <span className="text-token-text-tertiary">{directory}</span>
        <span className="text-token-text-primary">{basename}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 [font-family:var(--diffs-font-family)] text-xs tabular-nums">
        <span className="text-[var(--diffs-addition-base)]">
          +{change.additions}
        </span>
        <span className="text-[var(--diffs-deletion-base)]">
          -{change.deletions}
        </span>
      </span>
    </button>
  )
}

export function TurnEditedFilesCard({
  files,
  projectId = null,
}: {
  files: StudioFilePart[]
  projectId?: string | null
}) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const environment = useMessageRenderEnvironment()
  const [expanded, setExpanded] = React.useState(false)
  const [patchState, setPatchState] = React.useState<"applied" | "undone">(
    "applied"
  )
  const [patchPending, setPatchPending] = React.useState(false)
  const changes = React.useMemo(
    () => aggregateTurnFileChanges(files, environment),
    [environment, files]
  )
  const patches = React.useMemo(() => getReversibleTurnPatches(files), [files])
  const totals = React.useMemo(
    () =>
      changes.reduce(
        (sum, change) => ({
          additions: sum.additions + change.additions,
          deletions: sum.deletions + change.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [changes]
  )

  if (changes.length === 0) {
    return null
  }

  const alwaysVisibleChanges = changes.slice(0, TURN_EDITED_FILES_VISIBLE_COUNT)
  const collapsibleChanges = changes.slice(TURN_EDITED_FILES_VISIBLE_COUNT)
  const hiddenCount = changes.length - TURN_EDITED_FILES_VISIBLE_COUNT

  function handleReview(focusPath?: string) {
    openStudioReviewPanel({
      scopeLabel: isZh ? "本轮变更" : "Last turn",
      files: changes,
      focusPath: focusPath ?? null,
    })
  }

  function handleOpenFile(path: string) {
    window.dispatchEvent(
      new CustomEvent<StudioOpenMarkdownTargetDetail>(
        STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
        { detail: { href: path, source: "link" } }
      )
    )
  }

  async function handleApplyPatch() {
    if (
      environment === "remote" ||
      !projectId ||
      !patches ||
      patchPending
    ) {
      return
    }

    const direction = patchState === "applied" ? "reverse" : "forward"

    setPatchPending(true)

    try {
      const response = await fetch("/api/studio/local-projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: projectId,
          action: "apply-patch",
          direction,
          patches,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        ok?: unknown
        error?: unknown
      } | null

      if (!response.ok || payload?.ok !== true) {
        throw new Error(
          response.status === 409
            ? isZh
              ? "文件已发生变化，无法安全应用这组更改。请先审核当前更改。"
              : "The files changed, so this patch cannot be applied safely. Review the current changes first."
            : typeof payload?.error === "string"
              ? payload.error
              : isZh
                ? "文件已发生变化，无法安全应用这组更改。"
                : "The files changed, so this patch cannot be applied safely."
        )
      }

      const nextState = direction === "reverse" ? "undone" : "applied"

      setPatchState(nextState)
      dispatchStudioLocalProjectsChanged()
      toast.success(
        direction === "reverse"
          ? isZh
            ? "已撤销本轮文件更改"
            : "Turn changes undone"
          : isZh
            ? "已重新应用本轮文件更改"
            : "Turn changes reapplied"
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isZh
            ? "无法安全应用这组文件更改。"
            : "The file changes could not be applied safely."
      )
    } finally {
      setPatchPending(false)
    }
  }

  const patchActionAvailable = Boolean(
    environment === "local" && projectId && patches
  )
  const patchActionLabel =
    patchState === "applied"
      ? isZh
        ? "撤销"
        : "Undo"
      : isZh
        ? "重新应用"
        : "Reapply"
  const patchActionUnavailableLabel =
    environment === "remote"
      ? isZh
        ? "远程环境变更不能修改本地项目"
        : "Remote changes cannot modify the local project"
      : !projectId
        ? isZh
          ? "需要绑定本地项目才能撤销"
          : "Bind a local project to undo these changes"
        : isZh
          ? "缺少完整且唯一的文件补丁，无法安全撤销"
          : "A complete, unique patch is required for every file"
  const singleFileBasename =
    changes.length === 1 ? splitFilePathLabel(changes[0].path).basename : null

  return (
    <section className="not-prose mt-2 overflow-hidden rounded-xl border border-border-elevation bg-token-main-surface-primary text-token-text-primary">
      <div className="flex h-16 min-w-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => handleReview()}
          className="group/header flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-(--radius-lg) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-lg) bg-token-list-hover-background text-token-description-foreground">
            <RiFileAddLine aria-hidden className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {isZh
                ? singleFileBasename
                  ? `已编辑 ${singleFileBasename}`
                  : `已编辑 ${changes.length} 个文件`
                : singleFileBasename
                  ? `Edited ${singleFileBasename}`
                  : `Edited ${changes.length} files`}
            </span>
            <span className="relative block h-4 text-xs">
              <span className="flex items-center gap-1.5 [font-family:var(--diffs-font-family)] tabular-nums transition-opacity group-hover/header:opacity-0 group-focus-visible/header:opacity-0">
                <span className="text-[var(--diffs-addition-base)]">
                  +{totals.additions}
                </span>
                <span className="text-[var(--diffs-deletion-base)]">
                  -{totals.deletions}
                </span>
              </span>
              <span className="absolute inset-0 text-token-text-secondary opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-visible/header:opacity-100">
                {isZh ? "查看更改 →" : "Review changes →"}
              </span>
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-(--radius-lg) px-2.5 text-token-text-secondary"
            disabled={!patchActionAvailable || patchPending}
            title={
              patchActionAvailable
                ? patchActionLabel
                : patchActionUnavailableLabel
            }
            aria-label={patchActionLabel}
            onClick={() => void handleApplyPatch()}
          >
            <span>{patchActionLabel}</span>
            {patchPending ? (
              <RiLoader4Line aria-hidden className="size-4 animate-spin" />
            ) : patchState === "applied" ? (
              <RiArrowGoBackLine aria-hidden className="size-4" />
            ) : (
              <RiArrowGoForwardLine aria-hidden className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-[46px] rounded-(--radius-lg) border-border-elevation px-0"
            onClick={() => handleReview()}
          >
            {isZh ? "审核" : "Review"}
          </Button>
        </div>
      </div>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="border-t border-token-border-light">
          {alwaysVisibleChanges.map((change) => (
            <TurnEditedFilesRow
              key={change.path}
              change={change}
              onOpenFile={() => handleOpenFile(change.path)}
              onOpenReview={() => handleReview(change.path)}
            />
          ))}
          <CollapsibleContent>
            {collapsibleChanges.map((change) => (
              <TurnEditedFilesRow
                key={change.path}
                change={change}
                onOpenFile={() => handleOpenFile(change.path)}
                onOpenReview={() => handleReview(change.path)}
              />
            ))}
          </CollapsibleContent>
        </div>
        {hiddenCount > 0 ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center gap-1 border-t border-token-border-light px-3 text-sm font-medium text-token-text-secondary transition-colors hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <span>
                {expanded
                  ? isZh
                    ? "收起文件"
                    : "Collapse files"
                  : isZh
                    ? `再显示 ${hiddenCount} 个文件`
                    : `Show ${hiddenCount} more file${hiddenCount === 1 ? "" : "s"}`}
              </span>
              <RiArrowDownSLine
                aria-hidden
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </button>
          </CollapsibleTrigger>
        ) : null}
      </Collapsible>
    </section>
  )
}
