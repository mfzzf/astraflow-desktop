import { ChevronDown } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import {
  FileChangeStats,
  getFilePathExtension,
  getFilePathName,
} from "@/components/studio-message-parts/file-output"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getStudioFileDescriptor } from "@/lib/studio-file-support"
import type { StudioFileWorkspaceTarget } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

export type StudioFileReferenceCardProps = {
  path: string
  name?: string
  kind?: "create" | "edit" | "delete" | "reference"
  workspace?: StudioFileWorkspaceTarget | null
  showDiffStats?: boolean
  additions?: number
  deletions?: number
  onOpenPreview?: (path: string) => void
  onOpenWith?: (path: string) => void
  onCopyPath?: (path: string) => void
  onCopyContents?: (path: string) => void
  onRevealInFileManager?: (path: string) => void
  className?: string
}

function getFileReferenceTypeLabel(
  path: string,
  t: ReturnType<typeof useI18n>["t"]
) {
  const extension = getFilePathExtension(path)
  const descriptor = getStudioFileDescriptor(path)

  if (extension === "html" || extension === "htm" || extension === "svg") {
    return t.studioFileWebsiteLabel
  }

  switch (descriptor.kind) {
    case "code":
      return t.studioFileCodeLabel
    case "markdown":
      return t.studioFileMarkdownLabel
    case "image":
      return t.studioFileImageLabel
    case "pdf":
      return t.studioFilePdfLabel
    case "document":
      return t.studioFileDocumentLabel
    case "presentation":
      return t.studioFilePresentationLabel
    case "spreadsheet":
      return t.studioFileSpreadsheetLabel
    case "notebook":
      return t.studioFileNotebookLabel
    case "molecule":
      return t.studioFileMoleculeLabel
    case "binary":
      return t.studioFileBinaryLabel
    case "text":
      return t.studioFileTextLabel
    case "unsupported":
      return t.studioFileGenericLabel
  }
}

export function StudioFileReferenceCard({
  path,
  name,
  kind = "reference",
  showDiffStats = false,
  additions = 0,
  deletions = 0,
  onOpenPreview,
  onOpenWith,
  onCopyPath,
  onCopyContents,
  onRevealInFileManager,
  className,
}: StudioFileReferenceCardProps) {
  const { t } = useI18n()
  const fileName = name ?? getFilePathName(path)
  const typeLabel = getFileReferenceTypeLabel(path, t)
  const extension = getFilePathExtension(path).toUpperCase()

  return (
    <div
      className={cn("studio-file-reference-card", className)}
      data-kind={kind}
    >
      <button
        type="button"
        className="studio-file-reference-card-main"
        onClick={() => onOpenPreview?.(path)}
      >
        <StudioFileTypeIcon path={path} size="medium" />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{fileName}</span>
            {kind === "edit" && showDiffStats ? (
              <FileChangeStats additions={additions} deletions={deletions} />
            ) : null}
          </span>
          <span className="truncate text-xs text-token-description-foreground">
            {extension ? `${typeLabel} · ${extension}` : typeLabel}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="studio-file-reference-card-trigger"
            onClick={(event) => event.stopPropagation()}
          >
            {t.studioFileOpenIn}
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!onOpenPreview}
            onSelect={() => onOpenPreview?.(path)}
          >
            {t.studioFileOpenFile}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!onOpenWith}
            onSelect={() => onOpenWith?.(path)}
          >
            {t.studioFileOpenWith}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!onCopyPath}
            onSelect={() => onCopyPath?.(path)}
          >
            {t.studioFileCopyPath}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!onCopyContents}
            onSelect={() => onCopyContents?.(path)}
          >
            {t.studioFileCopyContents}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!onRevealInFileManager}
            onSelect={() => onRevealInFileManager?.(path)}
          >
            {t.studioFileRevealInFinder}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
