import * as React from "react"
import {
  IconAlertTriangle,
  IconDownload,
  IconFilePlus,
  IconFileTypeTxt,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  countUnifiedDiffChanges,
  synthesizeAdditionsDiff,
  UnifiedDiffView,
} from "@/components/studio-file-diff"
import {
  openStudioLocalFilePath,
  openStudioWorkspacePath,
  readStudioWorkspaceTextFile,
  resolveStudioWorkspaceFileReference,
  revealStudioWorkspacePath,
  type StudioWorkspaceTransport,
} from "@/components/studio-chat/workspace-transport"
import {
  StudioFileReferenceCard,
  type StudioFileReferenceCardProps,
} from "@/components/studio-file-reference-card"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { useI18n } from "@/components/i18n-provider"
import { Skeleton } from "@/components/ui/skeleton"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { isStudioFilePath } from "@/lib/studio-file-support"
import {
  extractMarkdownArtifactReferences,
  normalizeLocalArtifactPath,
  resolveStudioWorkspaceArtifact,
  type StudioWorkspaceArtifactResolution,
} from "@/lib/studio-markdown-artifacts"
import { getStudioFileDescriptor } from "@/lib/studio-file-support"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import { cn } from "@/lib/utils"

import { getFileToolTarget, parseToolInputObject } from "./shared"

export function FileTypeBadge({ path }: { path: string }) {
  return (
    <StudioFileTypeIcon
      path={path}
      size="small"
      className="size-4 rounded-[4px] text-[8px]"
    />
  )
}

export function FileChangeStats({
  additions,
  deletions,
  showZeros = false,
}: {
  additions: number
  deletions: number
  showZeros?: boolean
}) {
  if (!showZeros && additions <= 0 && deletions <= 0) {
    return null
  }

  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      {additions > 0 || showZeros ? (
        <span className="text-emerald-600">+{additions}</span>
      ) : null}
      {deletions > 0 || showZeros ? (
        <span className="text-destructive">-{deletions}</span>
      ) : null}
    </span>
  )
}

export function getFilePathExtension(path: string) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

  return name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : ""
}

export function getFilePathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function isPreviewableWrittenFile(path: string) {
  return isStudioFilePath(path)
}

export type WrittenFileInfo = {
  path: string
  kind: "create" | "edit"
  oldText: string
  newText: string
}

function asToolInputRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getToolInputString(
  records: Array<Record<string, unknown> | null>,
  ...keys: string[]
) {
  for (const record of records) {
    for (const key of keys) {
      const value = record?.[key]

      if (typeof value === "string") {
        return value
      }
    }
  }

  return null
}

function decodePartialJsonString(value: string) {
  let safeValue = value

  // A streamed snapshot may stop in the middle of an escape sequence. Drop
  // only that incomplete tail so the already received file text can render.
  safeValue = safeValue.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "")

  try {
    return JSON.parse(`"${safeValue}"`) as string
  } catch {
    return null
  }
}

function getPartialJsonStringProperty(input: string, property: string) {
  const propertyPattern = new RegExp(`"${property}"\\s*:\\s*"`, "g")
  const match = propertyPattern.exec(input)

  if (!match) {
    return null
  }

  const start = match.index + match[0].length
  let escaped = false
  let encoded = ""

  for (let index = start; index < input.length; index += 1) {
    const character = input[index]

    if (character === '"' && !escaped) {
      return decodePartialJsonString(encoded)
    }

    encoded += character

    if (character === "\\" && !escaped) {
      escaped = true
    } else {
      escaped = false
    }
  }

  return decodePartialJsonString(encoded)
}

function getActivityFileChangePath(activity: StudioMessageActivity) {
  const astraflow = asToolInputRecord(activity.meta?.astraflow)
  const fileChange = asToolInputRecord(astraflow?.fileChange)
  const path = fileChange?.path

  return typeof path === "string" ? path.trim() : ""
}

export function getWrittenFileInfo(
  activity: StudioMessageActivity
): WrittenFileInfo | null {
  const toolName = normalizeAgentToolName(activity.toolName)

  if (toolName !== "write_file" && toolName !== "edit_file") {
    return null
  }

  const parsedInput = parseToolInputObject(activity.input)
  const rawInput = asToolInputRecord(activity.rawInput)
  const records = [rawInput, parsedInput]
  const trimmedInput = activity.input.trim()
  const path =
    getToolInputString(
      records,
      "absolutePath",
      "absolute_path",
      "filePath",
      "file_path",
      "path"
    )?.trim() ||
    getPartialJsonStringProperty(trimmedInput, "path")?.trim() ||
    activity.locations?.find((location) => location.path.trim())?.path.trim() ||
    getActivityFileChangePath(activity) ||
    (!trimmedInput.startsWith("{") && !trimmedInput.startsWith("[")
      ? getFileToolTarget(activity.input)
      : "")

  if (!path) {
    return null
  }

  if (toolName === "write_file") {
    const content =
      getToolInputString(records, "content", "text") ??
      getPartialJsonStringProperty(trimmedInput, "content") ??
      ""

    return { path, kind: "create", oldText: "", newText: content }
  }

  const oldText =
    getToolInputString(records, "old_string", "oldText") ??
    getPartialJsonStringProperty(trimmedInput, "old_string") ??
    ""
  const newText =
    getToolInputString(records, "new_string", "newText") ??
    getPartialJsonStringProperty(trimmedInput, "new_string") ??
    ""
  const edits = records.find((record) => Array.isArray(record?.edits))?.edits
  const piEdits = Array.isArray(edits)
    ? edits.flatMap((edit) => {
        if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
          return []
        }

        const change = edit as Record<string, unknown>

        return typeof change.oldText === "string" &&
          typeof change.newText === "string"
          ? [{ oldText: change.oldText, newText: change.newText }]
          : []
      })
    : []
  const resolvedOldText =
    oldText || piEdits.map((edit) => edit.oldText).join("\n")
  const resolvedNewText =
    newText || piEdits.map((edit) => edit.newText).join("\n")

  if (!resolvedOldText && !resolvedNewText) {
    return null
  }

  return {
    path,
    kind: "edit",
    oldText: resolvedOldText,
    newText: resolvedNewText,
  }
}

type DiffLine = { type: "add" | "del" | "context"; text: string }

const MAX_DIFF_LINES = 600

function splitDiffTextLines(text: string) {
  if (!text) {
    return []
  }

  const lines = text.split("\n")

  if (lines.at(-1) === "") {
    lines.pop()
  }

  return lines
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitDiffTextLines(oldText)
  const newLines = splitDiffTextLines(newText)

  if (oldLines.length === 0) {
    return newLines.map((text) => ({ type: "add", text }))
  }

  if (newLines.length === 0) {
    return oldLines.map((text) => ({ type: "del", text }))
  }

  // Guard against an oversized DP matrix for very large edits.
  if (oldLines.length * newLines.length > 2_000_000) {
    return [
      ...oldLines.map((text): DiffLine => ({ type: "del", text })),
      ...newLines.map((text): DiffLine => ({ type: "add", text })),
    ]
  }

  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  )

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "context", text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: oldLines[i] })
      i++
    } else {
      result.push({ type: "add", text: newLines[j] })
      j++
    }
  }

  while (i < n) {
    result.push({ type: "del", text: oldLines[i] })
    i++
  }

  while (j < m) {
    result.push({ type: "add", text: newLines[j] })
    j++
  }

  return result
}

function createWrittenFileDiff(info: WrittenFileInfo) {
  if (info.kind === "create") {
    return synthesizeAdditionsDiff(info.path, info.newText)
  }

  const lines = computeLineDiff(info.oldText, info.newText)
  const visibleLines = lines.slice(0, MAX_DIFF_LINES)
  const hiddenCount = Math.max(0, lines.length - visibleLines.length)
  const oldCount = visibleLines.filter((line) => line.type !== "add").length
  const newCount = visibleLines.filter((line) => line.type !== "del").length

  if (visibleLines.length === 0) {
    return null
  }

  return [
    `--- a/${info.path}`,
    `+++ b/${info.path}`,
    `@@ -${oldCount > 0 ? 1 : 0},${oldCount} +${newCount > 0 ? 1 : 0},${newCount} @@`,
    ...visibleLines.map(
      (line) =>
        `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`
    ),
    ...(hiddenCount > 0
      ? [`\\ ${hiddenCount} additional lines omitted from the inline diff`]
      : []),
  ].join("\n")
}

export function FileDiffView({
  info,
  streaming = false,
}: {
  info: WrittenFileInfo
  streaming?: boolean
}) {
  const diff = React.useMemo(() => createWrittenFileDiff(info), [info])
  const stats = React.useMemo(
    () =>
      diff ? countUnifiedDiffChanges(diff) : { additions: 0, deletions: 0 },
    [diff]
  )

  return (
    <div className="overflow-hidden rounded-lg border border-token-border-light bg-[var(--diffs-bg)]">
      <div className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b border-token-border-light bg-[var(--diffs-bg-context-gutter)] px-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          {info.kind === "create" ? (
            <IconFilePlus aria-hidden className="size-4 shrink-0" />
          ) : (
            <IconFileTypeTxt aria-hidden className="size-4 shrink-0" />
          )}
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {getFilePathName(info.path)}
          </span>
        </div>
        <FileChangeStats
          additions={stats.additions}
          deletions={stats.deletions}
          showZeros
        />
      </div>
      {diff ? (
        <div className="max-h-[min(70vh,44rem)] [scrollbar-gutter:stable] overflow-auto">
          <UnifiedDiffView
            diff={diff}
            language={getStudioFileDescriptor(info.path).language}
            streaming={streaming}
          />
        </div>
      ) : null}
    </div>
  )
}

function dispatchOpenFilePreview(
  path: string,
  workspace: StudioWorkspaceTransport,
  intent: "preview" | "download" = "preview"
) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      { detail: { href: path, source: "link", workspace, intent } }
    )
  )
}

const MAX_MARKDOWN_ARTIFACT_CARDS = 12

export type ResolvedArtifactCard = {
  resolution: Exclude<StudioWorkspaceArtifactResolution, { status: "invalid" }>
  repaired: boolean
}

export async function resolveWorkspaceArtifactCard(
  resolution: Exclude<StudioWorkspaceArtifactResolution, { status: "invalid" }>,
  workspace: StudioWorkspaceTransport
): Promise<ResolvedArtifactCard | null> {
  if (resolution.status === "outside_workspace") {
    return workspace.type === "local" ? { resolution, repaired: true } : null
  }

  const lookup = await resolveStudioWorkspaceFileReference(
    workspace,
    resolution.artifact.path
  )

  if (!lookup.path) {
    return lookup.candidates.length > 1 ? { resolution, repaired: false } : null
  }

  const repairedResolution = resolveStudioWorkspaceArtifact({
    reference: lookup.path,
    source: resolution.artifact.source,
    workspace,
  })

  return repairedResolution.status === "invalid"
    ? null
    : { resolution: repairedResolution, repaired: true }
}

export function MarkdownArtifactOpenCards({
  markdown,
  excludedPaths,
  workspace,
}: {
  markdown: string
  excludedPaths: string[]
  workspace: StudioWorkspaceTransport
}) {
  const hrefs = React.useMemo(
    () => extractMarkdownArtifactReferences(markdown),
    [markdown]
  )
  const requestKey = React.useMemo(
    () =>
      JSON.stringify({
        hrefs,
        excludedPaths,
        workspace,
      }),
    [excludedPaths, hrefs, workspace]
  )
  const [resolved, setResolved] = React.useState<{
    key: string
    artifacts: ResolvedArtifactCard[]
  }>({ key: "", artifacts: [] })

  React.useEffect(() => {
    if (hrefs.length === 0) {
      return
    }

    let cancelled = false

    void (async () => {
      const candidates = new Map<
        string,
        Exclude<StudioWorkspaceArtifactResolution, { status: "invalid" }>
      >()

      for (const href of hrefs) {
        const resolution = resolveStudioWorkspaceArtifact({
          reference: href,
          source: "markdown",
          workspace,
        })

        if (resolution.status === "invalid") {
          continue
        }

        const key = normalizeLocalArtifactPath(
          resolution.status === "available"
            ? resolution.artifact.path
            : resolution.path
        )

        if (!candidates.has(key)) {
          candidates.set(key, resolution)
        }

        if (candidates.size >= MAX_MARKDOWN_ARTIFACT_CARDS) {
          break
        }
      }

      const excludedKeys = new Set(
        excludedPaths.flatMap((path) => {
          const resolution = resolveStudioWorkspaceArtifact({
            reference: path,
            source: "tool",
            workspace,
          })

          return [
            normalizeLocalArtifactPath(path),
            ...(resolution.status === "available"
              ? [normalizeLocalArtifactPath(resolution.artifact.path)]
              : []),
          ]
        })
      )
      const artifacts = await Promise.all(
        [...candidates.values()].map(async (resolution) => {
          return resolveWorkspaceArtifactCard(resolution, workspace)
        })
      )
      const visibleArtifacts = artifacts.flatMap((card) =>
        card &&
        !excludedKeys.has(
          normalizeLocalArtifactPath(
            card.resolution.status === "available"
              ? card.resolution.artifact.path
              : card.resolution.path
          )
        )
          ? [card]
          : []
      )

      if (!cancelled) {
        setResolved({ key: requestKey, artifacts: visibleArtifacts })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [excludedPaths, hrefs, requestKey, workspace])

  const visibleArtifacts = resolved.key === requestKey ? resolved.artifacts : []

  return visibleArtifacts.map((card) => (
    <WorkspaceArtifactOpenCard
      key={
        card.resolution.status === "available"
          ? card.resolution.artifact.path
          : card.resolution.path
      }
      resolution={card.resolution}
      repaired={card.repaired}
      workspace={workspace}
    />
  ))
}

export function WrittenFileOpenCard({
  info,
  source = "tool",
  workspace,
}: {
  info: Pick<WrittenFileInfo, "path"> & { kind?: WrittenFileInfo["kind"] }
  source?: "tool" | "generated"
  workspace?: StudioWorkspaceTransport | null
}) {
  if (!workspace) {
    return null
  }

  const resolution = resolveStudioWorkspaceArtifact({
    reference: info.path,
    source,
    workspace,
  })

  if (resolution.status === "invalid") {
    return null
  }

  if (resolution.status === "available") {
    return (
      <ResolvedWorkspaceArtifactOpenCard
        hideWhenMissing={source === "generated"}
        kind={info.kind}
        resolution={resolution}
        workspace={workspace}
      />
    )
  }

  return (
    <WorkspaceArtifactOpenCard
      kind={info.kind}
      resolution={resolution}
      workspace={workspace}
    />
  )
}

function ResolvedWorkspaceArtifactOpenCard({
  hideWhenMissing,
  kind,
  resolution,
  workspace,
}: {
  hideWhenMissing: boolean
  kind?: StudioFileReferenceCardProps["kind"]
  resolution: Extract<
    StudioWorkspaceArtifactResolution,
    { status: "available" }
  >
  workspace: StudioWorkspaceTransport
}) {
  const requestKey = React.useMemo(
    () => JSON.stringify({ path: resolution.artifact.path, workspace }),
    [resolution.artifact.path, workspace]
  )
  const [resolved, setResolved] = React.useState<{
    key: string
    card: ResolvedArtifactCard | null
  }>({ key: "", card: null })

  React.useEffect(() => {
    let cancelled = false

    void resolveWorkspaceArtifactCard(resolution, workspace)
      .then((card) => {
        if (!cancelled) {
          setResolved({ key: requestKey, card })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({ key: requestKey, card: null })
        }
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, resolution, workspace])

  const card = resolved.key === requestKey ? resolved.card : null

  if (resolved.key !== requestKey) {
    return (
      <div
        aria-label={resolution.artifact.name}
        className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2 shadow-sm"
      >
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-sm font-medium">
            {resolution.artifact.name}
          </span>
          <Skeleton className="h-3 w-28" />
        </span>
      </div>
    )
  }

  if (!card) {
    return hideWhenMissing ? null : (
      <WorkspaceArtifactOpenCard
        kind={kind}
        resolution={resolution}
        repaired={false}
        workspace={workspace}
      />
    )
  }

  return (
    <WorkspaceArtifactOpenCard
      kind={kind}
      resolution={card.resolution}
      repaired={card.repaired}
      workspace={workspace}
    />
  )
}

function WorkspaceArtifactOpenCard({
  kind,
  repaired = true,
  resolution,
  workspace,
}: {
  kind?: StudioFileReferenceCardProps["kind"]
  repaired?: boolean
  resolution: Exclude<StudioWorkspaceArtifactResolution, { status: "invalid" }>
  workspace: StudioWorkspaceTransport
}) {
  const { t } = useI18n()
  const available = resolution.status === "available"
  const path = available ? resolution.artifact.path : resolution.path
  const name = available ? resolution.artifact.name : resolution.name
  const openable = available || workspace.type === "local"

  if (!openable) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 shadow-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <IconAlertTriangle className="size-5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {t.studioArtifactOutsideWorkspace}
          </span>
        </span>
      </div>
    )
  }

  const handleCopyPath = async (target: string) => {
    try {
      await navigator.clipboard.writeText(target)
      toast.success(t.copied)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    }
  }

  const handleCopyContents = async (target: string) => {
    try {
      const contents = await readStudioWorkspaceTextFile(workspace, target)
      await navigator.clipboard.writeText(contents.content)
      toast.success(t.copied)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    }
  }

  const handleOpenWith = async (target: string) => {
    try {
      if (available) {
        await openStudioWorkspacePath(workspace, target)
      } else {
        await openStudioLocalFilePath(target)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    }
  }

  const handleRevealInFileManager = async (target: string) => {
    try {
      await revealStudioWorkspacePath(workspace, target)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <StudioFileReferenceCard
        path={path}
        name={name}
        kind={kind ?? "reference"}
        workspace={workspace}
        onOpenPreview={(target) => dispatchOpenFilePreview(target, workspace)}
        onCopyPath={(target) => void handleCopyPath(target)}
        onCopyContents={(target) => void handleCopyContents(target)}
        onOpenWith={
          workspace.type === "local"
            ? (target) => void handleOpenWith(target)
            : undefined
        }
        onRevealInFileManager={
          workspace.type === "local" && available
            ? (target) => void handleRevealInFileManager(target)
            : undefined
        }
        className={cn(
          "min-w-0 flex-1",
          !repaired && "border-amber-500/25 bg-amber-500/5"
        )}
      />
      {workspace.type === "sandbox" ? (
        <button
          type="button"
          aria-label={t.studioFileDownload}
          title={t.studioFileDownload}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation()
            dispatchOpenFilePreview(path, workspace, "download")
          }}
        >
          <IconDownload aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
