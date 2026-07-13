"use client"

import * as React from "react"
import type {
  PresentationData as PptxPresentationData,
  PptxViewer as PptxViewerInstance,
  SlideHandle as PptxSlideHandle,
} from "@aiden0z/pptx-renderer"

import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import { Markdown } from "@/components/prompt-kit/markdown"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getStudioFileDescriptor } from "@/lib/studio-file-support"
import { parseLegacyXls } from "@/lib/studio-xls"
import { cn } from "@/lib/utils"

const MAX_TABLE_ROWS = 200
const MAX_TABLE_COLUMNS = 50
const MAX_NOTEBOOK_CELLS = 100
const MAX_NOTEBOOK_OUTPUTS_PER_CELL = 64
const MAX_NOTEBOOK_TOTAL_OUTPUTS = 256
const MAX_NOTEBOOK_TEXT_CHARS = 40_000
const MAX_NOTEBOOK_TOTAL_TEXT_CHARS = 400_000
const MAX_PDB_ATOMS = 800
const MAX_PDB_BONDS = 1_200
const MAX_DOCUMENT_PARAGRAPHS = 500
const MAX_OFFICE_ARCHIVE_ENTRIES = 5_000
const MAX_OFFICE_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_OFFICE_COMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_OFFICE_UNCOMPRESSED_BYTES = 96 * 1024 * 1024
const MAX_OFFICE_ENTRY_BYTES = 24 * 1024 * 1024
const MAX_OFFICE_XML_BYTES = 2 * 1024 * 1024
const MAX_OFFICE_SELECTED_ENTRIES = 64
const MAX_OFFICE_SELECTED_BYTES = 48 * 1024 * 1024
const MAX_OFFICE_ENTRY_NAME_BYTES = 1_024
const MAX_OFFICE_RELATIONSHIP_ATTRIBUTE_CHARS = 2_048
const MAX_OFFICE_RELATIONSHIP_TARGET_CHARS = 2_048
const MAX_OFFICE_RELATIONSHIPS = 1_024
const MAX_DOCX_XML_NODES = 160_000
const MAX_DOCX_PARAGRAPH_NODES = 4_096
const MAX_DOCX_TEXT_RUNS_PER_PARAGRAPH = 1_024
const MAX_XLSX_WORKSHEET_NODES = 240_000
const MAX_XLSX_ROW_NODES = 4_096
const MAX_XLSX_CELLS_PER_ROW = 256
const MAX_XLSX_CELL_NODES = 256
const MAX_XLSX_SHARED_STRING_NODES = 240_000
const MAX_XLSX_SHARED_ITEM_NODES = 2_048
const MAX_XLSX_TEXT_RUNS_PER_SHARED_STRING = 256
const MAX_XLSX_SHARED_STRINGS = 20_000
const MAX_XLSX_WORKBOOK_XML_NODES = 20_000
const MAX_XLSX_WORKBOOK_SHEETS = 256
const PPTX_THUMBNAILS_RENDERED_EAGERLY = 8

const PPTX_RENDERER_ZIP_LIMITS = {
  maxEntries: 4_000,
  maxEntryUncompressedBytes: MAX_OFFICE_ENTRY_BYTES,
  maxTotalUncompressedBytes: MAX_OFFICE_UNCOMPRESSED_BYTES,
  maxMediaBytes: MAX_OFFICE_SELECTED_BYTES,
  maxConcurrency: 4,
} as const

function getColumnLabel(index: number) {
  let value = index + 1
  let label = ""

  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }

  return label
}

function parseDelimitedText(content: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]

    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }

    if (character === '"' && cell.length === 0) {
      quoted = true
      continue
    }

    if (character === delimiter) {
      row.push(cell)
      cell = ""
      continue
    }

    if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") {
        index += 1
      }

      row.push(cell)
      rows.push(row.slice(0, MAX_TABLE_COLUMNS))
      row = []
      cell = ""

      if (rows.length >= MAX_TABLE_ROWS) {
        break
      }
      continue
    }

    cell += character
  }

  if ((cell.length > 0 || row.length > 0) && rows.length < MAX_TABLE_ROWS) {
    row.push(cell)
    rows.push(row.slice(0, MAX_TABLE_COLUMNS))
  }

  return rows
}

function StudioSpreadsheetPreview({
  rows,
  rowNumbers,
  filename,
}: {
  rows: string[][]
  rowNumbers?: number[]
  filename: string
}) {
  const columnCount = Math.min(
    MAX_TABLE_COLUMNS,
    Math.max(
      1,
      ...Array.from({ length: rows.length }, (_, index) =>
        Math.max(0, rows[index]?.length ?? 0)
      )
    )
  )

  return (
    <div className="min-h-full min-w-max bg-muted/20 pb-16">
      <div className="sticky top-0 z-20 flex h-9 items-center gap-2 border-b bg-background px-3 text-xs text-muted-foreground">
        <span className="font-serif text-sm font-semibold text-[var(--color-accent-green)]">
          fx
        </span>
        <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono">
          A1
        </span>
        <span className="max-w-72 truncate text-foreground">{filename}</span>
      </div>
      <table className="border-separate border-spacing-0 bg-background text-xs">
        <thead className="sticky top-9 z-10">
          <tr>
            <th className="h-7 w-11 min-w-11 border-r border-b bg-muted/75" />
            {Array.from({ length: columnCount }, (_, index) => (
              <th
                key={getColumnLabel(index)}
                className="h-7 min-w-28 border-r border-b bg-muted/75 px-2 text-center font-medium text-muted-foreground"
              >
                {getColumnLabel(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("\u0000").slice(0, 80)}`}>
              <th className="sticky left-0 h-8 border-r border-b bg-muted/75 px-2 text-center font-medium text-muted-foreground">
                {rowNumbers?.[rowIndex] ?? rowIndex + 1}
              </th>
              {Array.from({ length: columnCount }, (_, cellIndex) => (
                <td
                  key={`${rowIndex}-${cellIndex}`}
                  className="h-8 max-w-72 min-w-28 border-r border-b px-2 text-foreground"
                  title={row[cellIndex] ?? ""}
                >
                  <span className="block truncate">{row[cellIndex] ?? ""}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type NotebookOutput = {
  text: string
}

type NotebookCell = {
  cellType: "code" | "markdown" | "raw"
  executionCount: number | null
  source: string
  outputs: NotebookOutput[]
}

type NotebookPreview = {
  cells: NotebookCell[]
  kernelName: string
  language: string
}

function isNotebookRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeNotebookText(value: unknown, maxChars: number) {
  if (typeof value === "string") {
    return value.slice(0, maxChars)
  }

  if (Array.isArray(value)) {
    let text = ""

    for (const item of value) {
      if (typeof item !== "string") {
        return null
      }

      if (text.length < maxChars) {
        text += item.slice(0, maxChars - text.length)
      }
    }

    return text
  }

  return null
}

function normalizeNotebook(content: string): NotebookPreview | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    return null
  }

  if (!isNotebookRecord(parsed) || !Array.isArray(parsed.cells)) {
    return null
  }

  let kernelName = "Python"
  let language = "python"
  let remainingTextChars = MAX_NOTEBOOK_TOTAL_TEXT_CHARS
  let totalOutputs = 0

  function consumeNotebookText(value: unknown) {
    const text = normalizeNotebookText(
      value,
      Math.min(MAX_NOTEBOOK_TEXT_CHARS, remainingTextChars)
    )

    if (text !== null) {
      remainingTextChars -= text.length
    }

    return text
  }

  function normalizeNotebookLanguage(value: string) {
    const normalized = value.trim().toLowerCase()

    return /^[a-z\d][a-z\d_+.#-]{0,39}$/.test(normalized)
      ? normalized
      : "plaintext"
  }

  if (parsed.metadata !== undefined) {
    if (!isNotebookRecord(parsed.metadata)) {
      return null
    }

    const kernelspec = parsed.metadata.kernelspec

    if (kernelspec !== undefined) {
      if (!isNotebookRecord(kernelspec)) {
        return null
      }

      if (kernelspec.display_name !== undefined) {
        if (typeof kernelspec.display_name !== "string") {
          return null
        }

        kernelName = kernelspec.display_name.slice(0, 100) || kernelName
      }

      if (kernelspec.language !== undefined) {
        if (typeof kernelspec.language !== "string") {
          return null
        }

        language = normalizeNotebookLanguage(kernelspec.language)
      }
    }

    const languageInfo = parsed.metadata.language_info

    if (languageInfo !== undefined) {
      if (!isNotebookRecord(languageInfo)) {
        return null
      }

      if (languageInfo.name !== undefined) {
        if (typeof languageInfo.name !== "string") {
          return null
        }

        language = normalizeNotebookLanguage(languageInfo.name)
      }
    }
  }

  const cells: NotebookCell[] = []

  for (const rawCell of parsed.cells.slice(0, MAX_NOTEBOOK_CELLS)) {
    if (!isNotebookRecord(rawCell)) {
      return null
    }

    const cellType = rawCell.cell_type

    if (cellType !== "code" && cellType !== "markdown" && cellType !== "raw") {
      return null
    }

    const source = consumeNotebookText(rawCell.source)

    if (source === null) {
      return null
    }

    const rawExecutionCount = rawCell.execution_count
    let executionCount: number | null = null

    if (rawExecutionCount !== undefined && rawExecutionCount !== null) {
      if (
        typeof rawExecutionCount !== "number" ||
        !Number.isSafeInteger(rawExecutionCount) ||
        rawExecutionCount < 0
      ) {
        return null
      }

      executionCount = rawExecutionCount
    }

    const rawOutputs = rawCell.outputs ?? []

    if (!Array.isArray(rawOutputs)) {
      return null
    }

    const outputs: NotebookOutput[] = []

    for (const rawOutput of rawOutputs.slice(
      0,
      MAX_NOTEBOOK_OUTPUTS_PER_CELL
    )) {
      if (totalOutputs >= MAX_NOTEBOOK_TOTAL_OUTPUTS) {
        break
      }

      if (!isNotebookRecord(rawOutput)) {
        return null
      }

      let outputText = ""

      if (rawOutput.text !== undefined) {
        const text = consumeNotebookText(rawOutput.text)

        if (text === null) {
          return null
        }

        outputText = text
      }

      if (rawOutput.data !== undefined) {
        if (!isNotebookRecord(rawOutput.data)) {
          return null
        }

        const plainText = rawOutput.data["text/plain"]

        if (plainText !== undefined) {
          const text = consumeNotebookText(plainText)

          if (text === null) {
            return null
          }

          outputText ||= text
        }
      }

      const errorParts: string[] = []

      for (const field of ["ename", "evalue"] as const) {
        const value = rawOutput[field]

        if (value !== undefined) {
          if (typeof value !== "string") {
            return null
          }

          if (value) {
            const text = consumeNotebookText(value)

            if (text === null) {
              return null
            }

            errorParts.push(text)
          }
        }
      }

      outputText ||= errorParts.join(": ")

      if (outputText) {
        outputs.push({ text: outputText })
        totalOutputs += 1
      }
    }

    cells.push({ cellType, executionCount, source, outputs })
  }

  return { cells, kernelName, language }
}

function StudioNotebookPreview({ content }: { content: string }) {
  const { locale } = useI18n()
  const notebook = React.useMemo(() => normalizeNotebook(content), [content])

  if (!notebook) {
    return (
      <ArtifactState
        title={
          locale === "zh" ? "Notebook 无法解析" : "Notebook could not be parsed"
        }
        detail={
          locale === "zh"
            ? "文件不是有效的 ipynb JSON。"
            : "The file is not valid ipynb JSON."
        }
      />
    )
  }

  return (
    <div className="min-h-full bg-background pb-16">
      <header className="sticky top-0 z-10 flex h-10 items-center justify-between border-b bg-background/95 px-4 text-xs text-muted-foreground backdrop-blur">
        <span className="font-medium text-foreground">Jupyter Notebook</span>
        <span>{notebook.kernelName}</span>
      </header>
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-5">
        {notebook.cells.map((cell, index) => {
          const isMarkdown = cell.cellType === "markdown"

          return (
            <section
              key={`${cell.cellType}-${index}`}
              className={cn(
                "grid grid-cols-[52px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/75",
                isMarkdown
                  ? "border-l-[3px] border-l-[var(--color-accent-orange)]"
                  : "border-l-[3px] border-l-[var(--color-accent-blue)]"
              )}
            >
              <span className="border-r bg-muted/25 px-2 py-3 text-right font-mono text-[11px] text-muted-foreground">
                {isMarkdown ? "" : `[${cell.executionCount ?? " "}]:`}
              </span>
              <div className="min-w-0 p-3">
                {isMarkdown ? (
                  <Markdown
                    autoPreviewHtml={false}
                    openLinksInWorkspace
                    className="[--markdown-font-size:14px] [--markdown-line-height:22px]"
                  >
                    {cell.source}
                  </Markdown>
                ) : (
                  <CodeBlock className="rounded-lg border-0 bg-muted/20">
                    <CodeBlockCode
                      code={cell.source}
                      language={
                        cell.cellType === "code"
                          ? notebook.language
                          : "plaintext"
                      }
                      className="max-h-80 text-[12px] [&>pre]:px-3 [&>pre]:py-2.5"
                    />
                  </CodeBlock>
                )}
                {cell.outputs.map((output, outputIndex) => {
                  return (
                    <pre
                      key={`${index}-output-${outputIndex}`}
                      className="mt-2 max-h-64 overflow-auto border-t pt-2 font-mono text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground"
                    >
                      {output.text}
                    </pre>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

type PdbAtom = {
  x: number
  y: number
  z: number
  element: string
}

const pdbElementColors: Record<string, string> = {
  C: "#8b95a5",
  N: "#5b8def",
  O: "#ef6666",
  S: "#e3b341",
  P: "#d77be7",
  H: "#d9dde5",
  FE: "#d98545",
}

function parsePdbAtoms(content: string) {
  const atoms: PdbAtom[] = []

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) {
      continue
    }

    const x = Number.parseFloat(line.slice(30, 38))
    const y = Number.parseFloat(line.slice(38, 46))
    const z = Number.parseFloat(line.slice(46, 54))
    const element =
      line.slice(76, 78).trim().toUpperCase() ||
      line.slice(12, 16).trim().replace(/\d/g, "").slice(0, 2).toUpperCase()

    if ([x, y, z].every(Number.isFinite)) {
      atoms.push({ x, y, z, element })
    }

    if (atoms.length >= MAX_PDB_ATOMS) {
      break
    }
  }

  return atoms
}

function StudioMoleculePreview({
  content,
  filename,
}: {
  content: string
  filename: string
}) {
  const { locale } = useI18n()
  const atoms = React.useMemo(() => parsePdbAtoms(content), [content])

  if (atoms.length === 0) {
    return (
      <ArtifactState
        title={locale === "zh" ? "没有可显示的原子" : "No atoms to display"}
        detail={
          locale === "zh"
            ? "未找到 ATOM 或 HETATM 记录。"
            : "No ATOM or HETATM records were found."
        }
      />
    )
  }

  const minX = Math.min(...atoms.map((atom) => atom.x))
  const maxX = Math.max(...atoms.map((atom) => atom.x))
  const minY = Math.min(...atoms.map((atom) => atom.y))
  const maxY = Math.max(...atoms.map((atom) => atom.y))
  const scale = Math.min(
    430 / Math.max(1, maxX - minX),
    300 / Math.max(1, maxY - minY)
  )
  const projected = atoms.map((atom) => ({
    ...atom,
    px: 35 + (atom.x - minX) * scale,
    py: 35 + (atom.y - minY) * scale,
  }))
  const bonds: Array<[number, number]> = []

  for (
    let left = 0;
    left < atoms.length && bonds.length < MAX_PDB_BONDS;
    left += 1
  ) {
    for (
      let right = left + 1;
      right < Math.min(atoms.length, left + 12) && bonds.length < MAX_PDB_BONDS;
      right += 1
    ) {
      const dx = atoms[left].x - atoms[right].x
      const dy = atoms[left].y - atoms[right].y
      const dz = atoms[left].z - atoms[right].z
      const distanceSquared = dx * dx + dy * dy + dz * dz

      if (distanceSquared > 0.16 && distanceSquared < 3.9) {
        bonds.push([left, right])
      }
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-[#0e1320] text-white">
      <div className="flex min-h-[420px] flex-1 items-center justify-center overflow-auto p-5">
        <svg
          role="img"
          aria-label={
            locale === "zh" ? "PDB 分子结构" : "PDB molecule structure"
          }
          viewBox={`0 0 ${Math.max(500, 70 + (maxX - minX) * scale)} ${Math.max(370, 70 + (maxY - minY) * scale)}`}
          className="max-h-[70vh] min-h-80 w-full min-w-[480px]"
        >
          <g stroke="#94a3b8" strokeOpacity="0.45" strokeWidth="1.5">
            {bonds.map(([left, right]) => (
              <line
                key={`${left}-${right}`}
                x1={projected[left].px}
                y1={projected[left].py}
                x2={projected[right].px}
                y2={projected[right].py}
              />
            ))}
          </g>
          <g>
            {projected.map((atom, index) => (
              <circle
                key={`${index}-${atom.element}`}
                cx={atom.px}
                cy={atom.py}
                r={atom.element === "H" ? 2.7 : 4.3}
                fill={pdbElementColors[atom.element] ?? "#9b8bd8"}
                stroke="#ffffff"
                strokeOpacity="0.28"
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="flex h-11 items-center gap-3 border-t border-white/10 bg-black/25 px-4 text-xs text-white/65">
        <strong className="text-white">{filename}</strong>
        <span>{atoms.length} atoms</span>
        <span>{bonds.length} bonds</span>
      </div>
    </div>
  )
}

export function StudioStructuredTextFilePreview({
  entry,
  file,
  truncatedLabel,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  truncatedLabel: string
}) {
  const { locale } = useI18n()
  const descriptor = getStudioFileDescriptor(entry.path)
  let preview: React.ReactNode = null

  if (descriptor.kind === "spreadsheet") {
    const delimiter = descriptor.extension === "tsv" ? "\t" : ","
    preview = (
      <StudioSpreadsheetPreview
        filename={entry.name}
        rows={parseDelimitedText(file.content, delimiter)}
      />
    )
  } else if (descriptor.kind === "notebook") {
    if (file.truncated) {
      return (
        <ArtifactState
          path={entry.path}
          title={
            locale === "zh"
              ? "Notebook 超出预览大小限制"
              : "Notebook exceeds the preview size limit"
          }
          detail={truncatedLabel}
        />
      )
    }

    preview = <StudioNotebookPreview content={file.content} />
  } else if (descriptor.kind === "molecule") {
    preview = (
      <StudioMoleculePreview content={file.content} filename={entry.name} />
    )
  }

  if (!preview) {
    return null
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="min-h-0 flex-1">{preview}</div>
      {file.truncated ? (
        <p className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
          {truncatedLabel}
        </p>
      ) : null}
    </div>
  )
}

type DocumentParagraph = {
  text: string
  heading: boolean
}

type OfficePreview =
  | { kind: "document"; paragraphs: DocumentParagraph[] }
  | { kind: "spreadsheet"; rows: string[][]; rowNumbers: number[] }

type OfficePreviewKind = OfficePreview["kind"]

type OfficeZipEntry = {
  name: string
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

type OfficeZipSelection = {
  entries: Map<string, OfficeZipEntry>
  totalUncompressedBytes: number
}

type OfficeZipArchive = {
  entries: Map<string, OfficeZipEntry>
}

async function dataUrlToBytes(dataUrl: string) {
  const response = await fetch(dataUrl)

  if (!response.ok) {
    throw new Error("File data could not be read")
  }

  return new Uint8Array(await response.arrayBuffer())
}

function normalizeOfficeZipEntryName(name: string) {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name)
  ) {
    throw new Error("Office ZIP entry name is invalid")
  }

  const isDirectory = name.endsWith("/")
  const segments = name.split("/")

  if (isDirectory) {
    segments.pop()
  }

  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Office ZIP entry name is invalid")
  }

  return `${segments.join("/")}${isDirectory ? "/" : ""}`
}

function decodeOfficeZipEntryName(
  bytes: Uint8Array,
  offset: number,
  length: number
) {
  if (length === 0 || length > MAX_OFFICE_ENTRY_NAME_BYTES) {
    throw new Error("Office ZIP entry name exceeds the preview safety limit")
  }

  try {
    return normalizeOfficeZipEntryName(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(offset, offset + length)
      )
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Office ZIP")) {
      throw error
    }

    throw new Error("Office ZIP entry name is invalid")
  }
}

function validateOptionalZipDigitalSignature(
  view: DataView,
  startOffset: number,
  endOffset: number
) {
  if (startOffset === endOffset) {
    return
  }

  if (
    startOffset + 6 > endOffset ||
    view.getUint32(startOffset, true) !== 0x05054b50 ||
    startOffset + 6 + view.getUint16(startOffset + 4, true) !== endOffset
  ) {
    throw new Error("Office ZIP directory boundaries are invalid")
  }
}

function getOfficeMetadataPaths(kind: OfficePreviewKind) {
  if (kind === "document") {
    return ["word/document.xml"]
  }

  return ["xl/workbook.xml", "xl/_rels/workbook.xml.rels"]
}

function getOfficeFinalPaths(
  kind: OfficePreviewKind,
  metadataFiles: Record<string, Uint8Array>
) {
  const metadataPaths = getOfficeMetadataPaths(kind)

  if (kind === "document") {
    return metadataPaths
  }

  const { sharedStringsPath, worksheetPath } =
    getXlsxRelatedParts(metadataFiles)

  return [
    ...metadataPaths,
    ...(sharedStringsPath ? [sharedStringsPath] : []),
    worksheetPath,
  ]
}

function createOfficeZipSelection(
  archive: OfficeZipArchive,
  requestedNames: string[]
): OfficeZipSelection {
  const selectedNames = [...new Set(requestedNames)]

  if (selectedNames.length > MAX_OFFICE_SELECTED_ENTRIES) {
    throw new Error("Office preview selects too many archive entries")
  }

  let totalUncompressedBytes = 0
  const selectedEntries = new Map<string, OfficeZipEntry>()

  for (const name of selectedNames) {
    const entry = archive.entries.get(name)

    if (!entry) {
      throw new Error(`Office package part is missing: ${name}`)
    }

    if (entry.uncompressedSize > MAX_OFFICE_XML_BYTES) {
      throw new Error("Office XML exceeds the preview safety limit")
    }

    totalUncompressedBytes += entry.uncompressedSize

    if (totalUncompressedBytes > MAX_OFFICE_SELECTED_BYTES) {
      throw new Error("Office preview exceeds the extraction safety limit")
    }

    selectedEntries.set(entry.name, entry)
  }

  return { entries: selectedEntries, totalUncompressedBytes }
}

function validateOfficeZipArchive(bytes: Uint8Array): OfficeZipArchive {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_OFFICE_ARCHIVE_BYTES) {
    throw new Error("Office archive exceeds the preview safety limit")
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  let endOffset = -1

  for (
    let offset = bytes.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength
    ) {
      endOffset = offset
      break
    }
  }

  if (endOffset < 0) {
    throw new Error("Office ZIP directory is missing")
  }

  const diskNumber = view.getUint16(endOffset + 4, true)
  const directoryDisk = view.getUint16(endOffset + 6, true)
  const diskEntryCount = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralDirectorySize = view.getUint32(endOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true)

  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    diskEntryCount !== entryCount
  ) {
    throw new Error("Multi-disk Office ZIP files are not previewed")
  }

  if (
    diskEntryCount === 0xffff ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 Office files are not previewed")
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize

  if (
    entryCount === 0 ||
    entryCount > MAX_OFFICE_ARCHIVE_ENTRIES ||
    centralDirectoryOffset > endOffset ||
    centralDirectoryEnd > endOffset
  ) {
    throw new Error("Office archive exceeds the preview safety limit")
  }

  let offset = centralDirectoryOffset
  let uncompressedBytes = 0
  let compressedBytes = 0
  const entries: OfficeZipEntry[] = []
  const entryNames = new Set<string>()
  const localHeaderOffsets = new Set<number>()
  const occupiedRanges: Array<{ start: number; end: number; name: string }> = []

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > centralDirectoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new Error("Office ZIP directory is invalid")
    }

    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const crc32 = view.getUint32(offset + 16, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const diskStart = view.getUint16(offset + 34, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength

    if (nextOffset > centralDirectoryEnd) {
      throw new Error("Office ZIP directory is invalid")
    }

    if ((flags & (0x0001 | 0x0040 | 0x2000)) !== 0) {
      throw new Error("Encrypted Office ZIP entries are not previewed")
    }

    if ((flags & ~(0x0002 | 0x0004 | 0x0008 | 0x0800)) !== 0) {
      throw new Error("Office ZIP entry flags are not supported")
    }

    if (method !== 0 && method !== 8) {
      throw new Error("Office ZIP compression method is not supported")
    }

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new Error("ZIP64 Office files are not previewed")
    }

    if (diskStart !== 0) {
      throw new Error("Multi-disk Office ZIP files are not previewed")
    }

    if (
      compressedSize > MAX_OFFICE_ENTRY_BYTES ||
      uncompressedSize > MAX_OFFICE_ENTRY_BYTES
    ) {
      throw new Error("Office archive entry exceeds the preview safety limit")
    }

    if (method === 0 && compressedSize !== uncompressedSize) {
      throw new Error("Stored Office ZIP entry sizes do not match")
    }

    const name = decodeOfficeZipEntryName(bytes, offset + 46, nameLength)

    if (entryNames.has(name)) {
      throw new Error("Office ZIP contains duplicate entry names")
    }

    entryNames.add(name)
    compressedBytes += compressedSize
    uncompressedBytes += uncompressedSize

    if (
      compressedBytes > MAX_OFFICE_COMPRESSED_BYTES ||
      uncompressedBytes > MAX_OFFICE_UNCOMPRESSED_BYTES
    ) {
      throw new Error("Office archive exceeds the preview safety limit")
    }

    if (localHeaderOffsets.has(localHeaderOffset)) {
      throw new Error("Office ZIP contains duplicate local header offsets")
    }

    localHeaderOffsets.add(localHeaderOffset)

    if (
      localHeaderOffset + 30 > centralDirectoryOffset ||
      view.getUint32(localHeaderOffset, true) !== 0x04034b50
    ) {
      throw new Error("Office ZIP local header is invalid")
    }

    const localFlags = view.getUint16(localHeaderOffset + 6, true)
    const localMethod = view.getUint16(localHeaderOffset + 8, true)
    const localCrc32 = view.getUint32(localHeaderOffset + 14, true)
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true)
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true)
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const localPayloadOffset =
      localHeaderOffset + 30 + localNameLength + localExtraLength
    const localPayloadEnd = localPayloadOffset + compressedSize

    if (
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength > MAX_OFFICE_ENTRY_NAME_BYTES ||
      localPayloadOffset > centralDirectoryOffset ||
      localPayloadEnd > centralDirectoryOffset
    ) {
      throw new Error("Office ZIP local header does not match its directory")
    }

    if (
      localCompressedSize === 0xffffffff ||
      localUncompressedSize === 0xffffffff
    ) {
      throw new Error("ZIP64 Office files are not previewed")
    }

    const localName = decodeOfficeZipEntryName(
      bytes,
      localHeaderOffset + 30,
      localNameLength
    )

    if (localName !== name) {
      throw new Error("Office ZIP local entry name does not match")
    }

    const usesDataDescriptor = (flags & 0x0008) !== 0

    if (usesDataDescriptor) {
      if (
        (localCrc32 !== 0 && localCrc32 !== crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localUncompressedSize !== 0 &&
          localUncompressedSize !== uncompressedSize)
      ) {
        throw new Error("Office ZIP local entry sizes do not match")
      }
    } else if (
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error("Office ZIP local entry sizes do not match")
    }

    occupiedRanges.push({
      start: localHeaderOffset,
      end: localPayloadEnd,
      name,
    })
    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    offset = nextOffset
  }

  validateOptionalZipDigitalSignature(view, offset, centralDirectoryEnd)
  validateOptionalZipDigitalSignature(view, centralDirectoryEnd, endOffset)

  occupiedRanges.sort((left, right) => left.start - right.start)

  for (let index = 1; index < occupiedRanges.length; index += 1) {
    const previous = occupiedRanges[index - 1]
    const current = occupiedRanges[index]

    if (current.start < previous.end) {
      throw new Error(
        `Office ZIP entry payloads overlap: ${previous.name}, ${current.name}`
      )
    }
  }

  return {
    entries: new Map(entries.map((entry) => [entry.name, entry])),
  }
}

function parseXml(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_OFFICE_XML_BYTES) {
    throw new Error("Office XML exceeds the preview safety limit")
  }

  const xml = new TextDecoder().decode(bytes)

  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error("Office XML document types are not previewed")
  }

  const document = new DOMParser().parseFromString(xml, "application/xml")
  const root = document.documentElement

  if (
    root.localName === "parsererror" ||
    root.namespaceURI === "http://www.mozilla.org/newlayout/xml/parsererror.xml"
  ) {
    throw new Error("Invalid Office XML")
  }

  return document
}

function elementsByLocalName(
  root: Node,
  localName: string,
  maxMatches: number,
  maxVisitedNodes: number,
  accept?: (element: Element) => boolean
) {
  const ownerDocument =
    root.nodeType === Node.DOCUMENT_NODE
      ? (root as Document)
      : root.ownerDocument

  if (!ownerDocument) {
    throw new Error("Office XML has no owner document")
  }

  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const matches: Element[] = []
  let visitedNodes = 0
  let current = walker.nextNode()

  while (current) {
    visitedNodes += 1

    if (visitedNodes > maxVisitedNodes) {
      throw new Error("Office XML exceeds the traversal safety limit")
    }

    const element = current as Element

    if (element.localName === localName && (!accept || accept(element))) {
      matches.push(element)

      if (matches.length >= maxMatches) {
        break
      }
    }

    current = walker.nextNode()
  }

  return matches
}

type OfficeRelationship = {
  id: string
  target: string
  targetMode: string
  type: string
}

const officeDocumentRelationshipNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
] as const

const packageRelationshipNamespace =
  "http://schemas.openxmlformats.org/package/2006/relationships"

const spreadsheetRelationshipNamespaces = new Map([
  [
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    officeDocumentRelationshipNamespaces[0],
  ],
  [
    "http://purl.oclc.org/ooxml/spreadsheetml/main",
    officeDocumentRelationshipNamespaces[1],
  ],
])

function getOfficeRelationshipReference(
  element: Element,
  expectedNamespace: string
) {
  for (const namespace of officeDocumentRelationshipNamespaces) {
    if (
      namespace !== expectedNamespace &&
      element.getAttributeNS(namespace, "id")
    ) {
      throw new Error("Office relationship dialects conflict")
    }
  }

  return element.getAttributeNS(expectedNamespace, "id") ?? ""
}

function getOfficeMainRelationshipNamespace(
  document: XMLDocument,
  expectedRootName: string,
  dialects: ReadonlyMap<string, string>
) {
  const root = document.documentElement
  const relationshipNamespace = dialects.get(root.namespaceURI ?? "")

  if (root.localName !== expectedRootName || !relationshipNamespace) {
    throw new Error(`Office ${expectedRootName} root is invalid`)
  }

  return { relationshipNamespace, root }
}

function getSingleDirectOfficeChild(
  parent: Element,
  localName: string,
  namespace: string,
  maxVisitedChildren: number
) {
  let match: Element | null = null

  for (let index = 0; index < parent.children.length; index += 1) {
    if (index >= maxVisitedChildren) {
      throw new Error("Office XML exceeds the child traversal safety limit")
    }

    const child = parent.children.item(index)

    if (child?.localName === localName && child.namespaceURI === namespace) {
      if (match) {
        throw new Error(`Office XML contains duplicate ${localName} elements`)
      }

      match = child
    }
  }

  return match
}

function getDirectOfficeChildren(
  parent: Element,
  localName: string,
  namespace: string,
  maxMatches: number,
  maxVisitedChildren: number
) {
  const matches: Element[] = []

  for (let index = 0; index < parent.children.length; index += 1) {
    if (index >= maxVisitedChildren) {
      throw new Error("Office XML exceeds the child traversal safety limit")
    }

    const child = parent.children.item(index)

    if (child?.localName === localName && child.namespaceURI === namespace) {
      matches.push(child)

      if (matches.length >= maxMatches) {
        break
      }
    }
  }

  return matches
}

function getOfficeRelationshipPartPath(sourcePart: string) {
  const slashIndex = sourcePart.lastIndexOf("/")
  const directory = slashIndex >= 0 ? sourcePart.slice(0, slashIndex) : ""
  const filename = sourcePart.slice(slashIndex + 1)

  return `${directory ? `${directory}/` : ""}_rels/${filename}.rels`
}

function resolveOfficeRelationshipTarget(sourcePart: string, target: string) {
  if (
    !target ||
    target !== target.trim() ||
    target.includes("\0") ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  ) {
    throw new Error("Office relationship target is invalid")
  }

  const isAbsolute = target.startsWith("/")
  const segments = isAbsolute ? [] : sourcePart.split("/").slice(0, -1)
  const targetSegments = (isAbsolute ? target.slice(1) : target).split("/")

  for (const segment of targetSegments) {
    if (!segment) {
      throw new Error("Office relationship target is invalid")
    }

    if (segment === ".") {
      continue
    }

    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error("Office relationship target escapes the package")
      }

      segments.pop()
      continue
    }

    segments.push(segment)
  }

  return normalizeOfficeZipEntryName(segments.join("/"))
}

function parseOfficeRelationships(
  files: Record<string, Uint8Array>,
  sourcePart: string
) {
  const relationshipPart = getOfficeRelationshipPartPath(sourcePart)
  const relationshipBytes = files[relationshipPart]

  if (!relationshipBytes) {
    throw new Error(`Office relationships are missing: ${relationshipPart}`)
  }

  const document = parseXml(relationshipBytes)
  const root = document.documentElement

  if (
    root.localName !== "Relationships" ||
    root.namespaceURI !== packageRelationshipNamespace
  ) {
    throw new Error("Office relationships root is invalid")
  }

  const relationships = new Map<string, OfficeRelationship>()

  for (let index = 0; index < root.children.length; index += 1) {
    if (index >= MAX_OFFICE_RELATIONSHIPS) {
      throw new Error("Office relationships exceed the preview safety limit")
    }

    const element = root.children.item(index)

    if (
      !element ||
      element.localName !== "Relationship" ||
      element.namespaceURI !== packageRelationshipNamespace
    ) {
      throw new Error("Office relationships are invalid")
    }

    const id = element.getAttribute("Id") ?? ""
    const type = element.getAttribute("Type") ?? ""
    const target = element.getAttribute("Target") ?? ""
    const targetMode = element.getAttribute("TargetMode") ?? "Internal"

    if (
      !id ||
      !type ||
      !target ||
      id.length > MAX_OFFICE_RELATIONSHIP_ATTRIBUTE_CHARS ||
      type.length > MAX_OFFICE_RELATIONSHIP_ATTRIBUTE_CHARS ||
      target.length > MAX_OFFICE_RELATIONSHIP_TARGET_CHARS ||
      relationships.has(id)
    ) {
      throw new Error("Office relationships are invalid")
    }

    if (targetMode !== "Internal" && targetMode !== "External") {
      throw new Error("Office relationship target mode is invalid")
    }

    relationships.set(id, { id, target, targetMode, type })
  }

  return relationships
}

function resolveInternalOfficeRelationship(
  relationship: OfficeRelationship | undefined,
  sourcePart: string,
  expectedType: string,
  relationshipNamespace: string
) {
  if (
    !relationship ||
    relationship.targetMode === "External" ||
    relationship.type !== `${relationshipNamespace}/${expectedType}`
  ) {
    throw new Error(`Office ${expectedType} relationship is invalid`)
  }

  return resolveOfficeRelationshipTarget(sourcePart, relationship.target)
}

function getXlsxRelatedParts(files: Record<string, Uint8Array>) {
  const workbookPart = "xl/workbook.xml"
  const workbookBytes = files[workbookPart]

  if (!workbookBytes) {
    throw new Error("XLSX workbook.xml is missing")
  }

  const workbookDocument = parseXml(workbookBytes)
  const { relationshipNamespace, root } = getOfficeMainRelationshipNamespace(
    workbookDocument,
    "workbook",
    spreadsheetRelationshipNamespaces
  )
  const spreadsheetNamespace = root.namespaceURI ?? ""
  const sheetsElement = getSingleDirectOfficeChild(
    root,
    "sheets",
    spreadsheetNamespace,
    256
  )

  if (!sheetsElement) {
    throw new Error("XLSX sheets list is missing")
  }

  const relationships = parseOfficeRelationships(files, workbookPart)
  const sheets = getDirectOfficeChildren(
    sheetsElement,
    "sheet",
    spreadsheetNamespace,
    MAX_XLSX_WORKBOOK_SHEETS,
    MAX_XLSX_WORKBOOK_XML_NODES
  )
  let worksheetPath = ""

  for (const sheet of sheets) {
    const relationshipId = getOfficeRelationshipReference(
      sheet,
      relationshipNamespace
    )
    const relationship = relationships.get(relationshipId)

    if (!relationship) {
      throw new Error("XLSX sheet relationship is missing")
    }

    if (relationship.type === `${relationshipNamespace}/worksheet`) {
      if (relationship.targetMode === "External") {
        throw new Error("External XLSX worksheets are not previewed")
      }

      worksheetPath = resolveOfficeRelationshipTarget(
        workbookPart,
        relationship.target
      )
      break
    }
  }

  if (!worksheetPath) {
    throw new Error("XLSX worksheet is missing")
  }

  const sharedStringsRelationships = Array.from(relationships.values()).filter(
    (relationship) =>
      relationship.type === `${relationshipNamespace}/sharedStrings`
  )
  if (sharedStringsRelationships.length > 1) {
    throw new Error("XLSX contains duplicate shared-string relationships")
  }

  const sharedStringsRelationship = sharedStringsRelationships[0]
  const sharedStringsPath = sharedStringsRelationship
    ? resolveInternalOfficeRelationship(
        sharedStringsRelationship,
        workbookPart,
        "sharedStrings",
        relationshipNamespace
      )
    : null

  return { sharedStringsPath, spreadsheetNamespace, worksheetPath }
}

function parseDocx(files: Record<string, Uint8Array>): OfficePreview {
  const bytes = files["word/document.xml"]

  if (!bytes) {
    throw new Error("DOCX document.xml is missing")
  }

  const document = parseXml(bytes)
  const paragraphs = elementsByLocalName(
    document,
    "p",
    MAX_DOCUMENT_PARAGRAPHS,
    MAX_DOCX_XML_NODES
  )
    .map((paragraph) => {
      const text = elementsByLocalName(
        paragraph,
        "t",
        MAX_DOCX_TEXT_RUNS_PER_PARAGRAPH,
        MAX_DOCX_PARAGRAPH_NODES
      )
        .map((element) => element.textContent ?? "")
        .join("")
        .trim()
      const style = elementsByLocalName(
        paragraph,
        "pStyle",
        1,
        MAX_DOCX_PARAGRAPH_NODES
      )[0]
      const styleName =
        style?.getAttribute("w:val") ?? style?.getAttribute("val") ?? ""

      return { text, heading: /heading|title/i.test(styleName) }
    })
    .filter((paragraph) => paragraph.text)

  return { kind: "document", paragraphs }
}

function parseWorksheetCellReference(reference: string) {
  if (!reference) {
    return null
  }

  const match = /^([A-Z]+)(\d+)$/i.exec(reference)

  if (!match || match[2].length > 9) {
    throw new Error("XLSX cell reference is invalid")
  }

  let column = 0

  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64

    if (column > MAX_TABLE_COLUMNS) {
      break
    }
  }

  const row = Number.parseInt(match[2], 10)

  if (!Number.isSafeInteger(row) || row < 1) {
    throw new Error("XLSX cell reference is invalid")
  }

  return { columnIndex: column - 1, rowNumber: row }
}

function parseWorksheetRowNumber(reference: string) {
  if (!/^\d{1,9}$/.test(reference)) {
    throw new Error("XLSX row reference is invalid")
  }

  const rowNumber = Number.parseInt(reference, 10)

  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) {
    throw new Error("XLSX row reference is invalid")
  }

  return rowNumber
}

function parseXlsx(files: Record<string, Uint8Array>): OfficePreview {
  const { sharedStringsPath, spreadsheetNamespace, worksheetPath } =
    getXlsxRelatedParts(files)

  const document = parseXml(files[worksheetPath])
  const rowElements = elementsByLocalName(
    document,
    "row",
    MAX_TABLE_ROWS,
    MAX_XLSX_WORKSHEET_NODES,
    (rowElement) => {
      const reference = rowElement.getAttribute("r")

      return !reference || parseWorksheetRowNumber(reference) <= MAX_TABLE_ROWS
    }
  )
  const parsedRows: Array<{
    rowNumber: number
    cells: Array<{
      columnIndex: number
      type: string | null
      rawValue: string
      inlineValue: string
      formula?: string
    }>
  }> = []
  const seenRows = new Set<number>()
  let nextImplicitRow = 1
  let largestSharedStringIndex = -1

  for (const rowElement of rowElements) {
    const cells = elementsByLocalName(
      rowElement,
      "c",
      MAX_XLSX_CELLS_PER_ROW,
      MAX_XLSX_ROW_NODES
    )
    const firstCellReference = parseWorksheetCellReference(
      cells[0]?.getAttribute("r") ?? ""
    )
    const explicitRowReference = rowElement.getAttribute("r")
    const rowNumber = explicitRowReference
      ? parseWorksheetRowNumber(explicitRowReference)
      : (firstCellReference?.rowNumber ?? nextImplicitRow)

    if (rowNumber > MAX_TABLE_ROWS) {
      continue
    }

    if (seenRows.has(rowNumber)) {
      throw new Error("XLSX contains duplicate row coordinates")
    }

    seenRows.add(rowNumber)
    nextImplicitRow = Math.max(nextImplicitRow, rowNumber + 1)

    const parsedCells: Array<{
      columnIndex: number
      type: string | null
      rawValue: string
      inlineValue: string
      formula?: string
    }> = []
    const seenColumns = new Set<number>()
    let nextImplicitColumn = 0

    for (const cell of cells) {
      const reference = parseWorksheetCellReference(
        cell.getAttribute("r") ?? ""
      )
      const columnIndex = reference?.columnIndex ?? nextImplicitColumn

      if (reference && reference.rowNumber !== rowNumber) {
        throw new Error("XLSX cell and row coordinates do not match")
      }

      nextImplicitColumn = Math.max(nextImplicitColumn, columnIndex + 1)

      if (columnIndex < 0 || columnIndex >= MAX_TABLE_COLUMNS) {
        continue
      }

      if (seenColumns.has(columnIndex)) {
        throw new Error("XLSX contains duplicate cell coordinates")
      }

      seenColumns.add(columnIndex)

      const type = cell.getAttribute("t")
      const rawValue =
        elementsByLocalName(cell, "v", 1, MAX_XLSX_CELL_NODES)[0]
          ?.textContent ?? ""
      const inlineValue = elementsByLocalName(
        cell,
        "t",
        MAX_XLSX_TEXT_RUNS_PER_SHARED_STRING,
        MAX_XLSX_CELL_NODES
      )
        .map((element) => element.textContent ?? "")
        .join("")
      const formula = elementsByLocalName(cell, "f", 1, MAX_XLSX_CELL_NODES)[0]
        ?.textContent

      if (type === "s") {
        if (!/^\d{1,9}$/.test(rawValue)) {
          throw new Error("XLSX shared-string index is invalid")
        }

        const sharedStringIndex = Number.parseInt(rawValue, 10)

        if (
          !Number.isSafeInteger(sharedStringIndex) ||
          sharedStringIndex < 0 ||
          sharedStringIndex >= MAX_XLSX_SHARED_STRINGS
        ) {
          throw new Error("XLSX shared-string index exceeds the preview limit")
        }

        largestSharedStringIndex = Math.max(
          largestSharedStringIndex,
          sharedStringIndex
        )
      }

      parsedCells.push({
        columnIndex,
        type,
        rawValue,
        inlineValue,
        formula: formula ?? undefined,
      })
    }

    parsedRows.push({ rowNumber, cells: parsedCells })
  }

  const sharedStringsBytes = sharedStringsPath
    ? files[sharedStringsPath]
    : undefined

  if (largestSharedStringIndex >= 0 && !sharedStringsBytes) {
    throw new Error("XLSX shared strings are required but missing")
  }

  const sharedStringLimit = Math.min(
    MAX_XLSX_SHARED_STRINGS,
    largestSharedStringIndex + 1
  )
  let sharedStrings: string[] = []

  if (sharedStringsBytes && sharedStringLimit > 0) {
    const sharedStringsDocument = parseXml(sharedStringsBytes)
    const sharedStringsRoot = sharedStringsDocument.documentElement

    if (
      sharedStringsRoot.localName !== "sst" ||
      sharedStringsRoot.namespaceURI !== spreadsheetNamespace
    ) {
      throw new Error("XLSX shared strings root is invalid")
    }

    sharedStrings = getDirectOfficeChildren(
      sharedStringsRoot,
      "si",
      spreadsheetNamespace,
      sharedStringLimit,
      MAX_XLSX_SHARED_STRING_NODES
    ).map((item) =>
      elementsByLocalName(
        item,
        "t",
        MAX_XLSX_TEXT_RUNS_PER_SHARED_STRING,
        MAX_XLSX_SHARED_ITEM_NODES
      )
        .map((element) => element.textContent ?? "")
        .join("")
    )
  }

  parsedRows.sort((left, right) => left.rowNumber - right.rowNumber)

  const rows = parsedRows.map(({ cells }) => {
    const row: string[] = []

    for (const cell of cells) {
      let value = cell.inlineValue || cell.rawValue

      if (cell.type === "s") {
        const sharedString = sharedStrings[Number.parseInt(cell.rawValue, 10)]

        if (sharedString === undefined) {
          throw new Error("XLSX shared-string index is out of range")
        }

        value = sharedString
      } else if (cell.type === "b") {
        value = cell.rawValue === "1" ? "TRUE" : "FALSE"
      }

      row[cell.columnIndex] = cell.formula
        ? `${value}  (${cell.formula})`
        : value
    }

    return row.slice(0, MAX_TABLE_COLUMNS)
  })

  return {
    kind: "spreadsheet",
    rows,
    rowNumbers: parsedRows.map((row) => row.rowNumber),
  }
}

type OfficeUnzip = (typeof import("fflate"))["unzip"]

function extractOfficeZipSelection(
  unzip: OfficeUnzip,
  bytes: Uint8Array,
  selection: OfficeZipSelection,
  onTerminate: (terminate: () => void) => void
) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    const terminate = unzip(
      bytes,
      {
        filter(info) {
          try {
            const entry = selection.entries.get(
              normalizeOfficeZipEntryName(info.name)
            )

            return Boolean(
              entry &&
              info.compression === entry.method &&
              info.size === entry.compressedSize &&
              info.originalSize === entry.uncompressedSize
            )
          } catch {
            return false
          }
        },
      },
      (error, files) => {
        if (error) {
          reject(error)
          return
        }

        try {
          const selectedFiles = Object.create(null) as Record<
            string,
            Uint8Array
          >
          let selectedCount = 0
          let totalUncompressedBytes = 0

          for (const [rawName, contents] of Object.entries(files)) {
            const name = normalizeOfficeZipEntryName(rawName)
            const entry = selection.entries.get(name)

            if (
              !entry ||
              Object.hasOwn(selectedFiles, name) ||
              contents.byteLength !== entry.uncompressedSize
            ) {
              throw new Error("Office ZIP extraction result is invalid")
            }

            selectedCount += 1
            totalUncompressedBytes += contents.byteLength

            if (
              totalUncompressedBytes > MAX_OFFICE_SELECTED_BYTES ||
              selectedCount > MAX_OFFICE_SELECTED_ENTRIES
            ) {
              throw new Error(
                "Office preview exceeds the extraction safety limit"
              )
            }

            selectedFiles[name] = contents
          }

          if (
            selectedCount !== selection.entries.size ||
            totalUncompressedBytes !== selection.totalUncompressedBytes
          ) {
            throw new Error("Office ZIP extraction is incomplete")
          }

          resolve(selectedFiles)
        } catch (validationError) {
          reject(validationError)
        }
      }
    )

    onTerminate(terminate)
  })
}

function useOfficePreview(
  file: AstraFlowSidePanelDataUrlFile,
  kind: OfficePreviewKind
) {
  const [state, setState] = React.useState<{
    dataUrl: string
    kind: OfficePreviewKind | null
    preview: OfficePreview | null
    error: string
    loading: boolean
  }>({ dataUrl: "", kind: null, preview: null, error: "", loading: true })

  React.useEffect(() => {
    let cancelled = false
    let terminateUnzip: (() => void) | null = null

    function captureTerminate(terminate: () => void) {
      if (cancelled) {
        terminate()
      } else {
        terminateUnzip = terminate
      }
    }

    async function loadPreview() {
      const [{ unzip }, bytes] = await Promise.all([
        import("fflate"),
        dataUrlToBytes(file.dataUrl),
      ])

      if (cancelled) {
        return null
      }

      const archive = validateOfficeZipArchive(bytes)
      const metadataSelection = createOfficeZipSelection(
        archive,
        getOfficeMetadataPaths(kind)
      )
      const metadataFiles = await extractOfficeZipSelection(
        unzip,
        bytes,
        metadataSelection,
        captureTerminate
      )

      if (cancelled) {
        return null
      }

      let files = metadataFiles

      if (kind !== "document") {
        const finalSelection = createOfficeZipSelection(
          archive,
          getOfficeFinalPaths(kind, metadataFiles)
        )
        files = await extractOfficeZipSelection(
          unzip,
          bytes,
          finalSelection,
          captureTerminate
        )
      }

      if (cancelled) {
        return null
      }

      if (kind === "document") {
        return parseDocx(files)
      }

      return parseXlsx(files)
    }

    void loadPreview()
      .then((preview) => {
        if (!cancelled && preview) {
          setState({
            dataUrl: file.dataUrl,
            kind,
            preview,
            error: "",
            loading: false,
          })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setState({
          dataUrl: file.dataUrl,
          kind,
          preview: null,
          error: error instanceof Error ? error.message : "Preview failed",
          loading: false,
        })
      })

    return () => {
      cancelled = true
      terminateUnzip?.()
    }
  }, [file.dataUrl, kind])

  if (state.dataUrl !== file.dataUrl || state.kind !== kind) {
    return { preview: null, error: "", loading: true }
  }

  return state
}

function ArtifactState({
  path,
  title,
  detail,
}: {
  path?: string
  title: string
  detail?: string
}) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center p-8 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        {path ? <StudioFileTypeIcon path={path} size="medium" /> : null}
        <strong className="text-sm font-semibold text-foreground">
          {title}
        </strong>
        {detail ? (
          <span className="text-xs leading-5 text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  )
}

type StudioPptxPreviewState = {
  dataUrl: string
  viewer: PptxViewerInstance | null
  presentation: PptxPresentationData | null
  renderSlide: PptxRenderSlide | null
  slideCount: number
  activeSlide: number
  error: string
}

type PptxRenderSlide = (typeof import("@aiden0z/pptx-renderer"))["renderSlide"]

function StudioPptxThumbnail({
  presentation,
  renderSlide,
  index,
  active,
  locale,
  scrollRootRef,
  onSelect,
}: {
  presentation: PptxPresentationData
  renderSlide: PptxRenderSlide
  index: number
  active: boolean
  locale: "zh" | "en"
  scrollRootRef: React.RefObject<HTMLDivElement | null>
  onSelect: (index: number) => void
}) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const renderTargetRef = React.useRef<HTMLDivElement | null>(null)
  const [shouldRender, setShouldRender] = React.useState(
    index < PPTX_THUMBNAILS_RENDERED_EAGERLY
  )

  React.useEffect(() => {
    if (shouldRender) {
      return
    }

    const target = buttonRef.current

    if (!target || typeof IntersectionObserver === "undefined") {
      const timeout = window.setTimeout(() => setShouldRender(true), 0)

      return () => window.clearTimeout(timeout)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      {
        root: scrollRootRef.current,
        rootMargin: "160px 0px",
      }
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [scrollRootRef, shouldRender])

  React.useEffect(() => {
    if (!shouldRender) {
      return
    }

    const target = renderTargetRef.current

    if (!target) {
      return
    }

    target.replaceChildren()
    const slide = presentation.slides[index]

    if (!slide || presentation.width <= 0) {
      return
    }

    // Main-view navigation disposes the viewer's shared chart instances.
    // Standalone handles keep chart thumbnails intact when slides change.
    const handle: PptxSlideHandle = renderSlide(presentation, slide, {
      pdfjs: false,
    })
    const scale = 104 / presentation.width
    const wrapper = document.createElement("div")

    wrapper.style.width = "104px"
    wrapper.style.height = `${presentation.height * scale}px`
    wrapper.style.overflow = "hidden"
    wrapper.style.position = "relative"
    handle.element.style.transform = `scale(${scale})`
    handle.element.style.transformOrigin = "top left"
    wrapper.appendChild(handle.element)
    target.appendChild(wrapper)

    void handle.ready.catch(() => undefined)

    return () => {
      handle.dispose()
      wrapper.remove()
      target.replaceChildren()
    }
  }, [index, presentation, renderSlide, shouldRender])

  const label = locale === "zh" ? `第 ${index + 1} 页` : `Slide ${index + 1}`

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={active ? "secondary" : "outline"}
      size="sm"
      className="h-auto w-full flex-col items-stretch gap-1 rounded-lg p-1"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={() => onSelect(index)}
    >
      <span className="px-1 text-left text-[10px] text-muted-foreground">
        {index + 1}
      </span>
      {shouldRender ? (
        <div
          ref={renderTargetRef}
          className="pointer-events-none overflow-hidden rounded-sm bg-background"
        />
      ) : (
        <Skeleton className="aspect-video w-full rounded-sm" />
      )}
    </Button>
  )
}

function StudioPptxPreview({
  entry,
  file,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelDataUrlFile
}) {
  const { locale } = useI18n()
  const slideContainerRef = React.useRef<HTMLDivElement | null>(null)
  const thumbnailScrollRef = React.useRef<HTMLDivElement | null>(null)
  const [state, setState] = React.useState<StudioPptxPreviewState>({
    dataUrl: "",
    viewer: null,
    presentation: null,
    renderSlide: null,
    slideCount: 0,
    activeSlide: 0,
    error: "",
  })

  React.useEffect(() => {
    const container = slideContainerRef.current

    if (!container) {
      return
    }

    const viewerContainer = container
    let cancelled = false
    let loadedViewer: PptxViewerInstance | null = null
    const abortController = new AbortController()

    viewerContainer.replaceChildren()

    async function loadPreview() {
      const [{ PptxViewer, renderSlide }, bytes] = await Promise.all([
        import("@aiden0z/pptx-renderer"),
        dataUrlToBytes(file.dataUrl),
      ])

      if (cancelled) {
        return
      }

      loadedViewer = new PptxViewer(viewerContainer, {
        fitMode: "contain",
        zipLimits: PPTX_RENDERER_ZIP_LIMITS,
        lazyMedia: true,
        lazySlides: true,
        pdfjs: false,
        onSlideChange(index) {
          if (cancelled) {
            return
          }

          setState((current) =>
            current.viewer === loadedViewer
              ? { ...current, activeSlide: index }
              : current
          )
        },
      })

      await loadedViewer.open(bytes, {
        renderMode: "slide",
        signal: abortController.signal,
        lazyMedia: true,
        lazySlides: true,
      })

      if (cancelled) {
        loadedViewer.destroy()
        return
      }

      if (loadedViewer.slideCount === 0) {
        throw new Error("PPTX contains no slides")
      }

      const presentation = loadedViewer.presentationData

      if (!presentation) {
        throw new Error("PPTX presentation model is unavailable")
      }

      setState({
        dataUrl: file.dataUrl,
        viewer: loadedViewer,
        presentation,
        renderSlide,
        slideCount: loadedViewer.slideCount,
        activeSlide: loadedViewer.currentSlideIndex,
        error: "",
      })
    }

    void loadPreview().catch((error: unknown) => {
      if (cancelled) {
        return
      }

      loadedViewer?.destroy()
      setState({
        dataUrl: file.dataUrl,
        viewer: null,
        presentation: null,
        renderSlide: null,
        slideCount: 0,
        activeSlide: 0,
        error: error instanceof Error ? error.message : "Preview failed",
      })
    })

    return () => {
      cancelled = true
      abortController.abort()
      loadedViewer?.destroy()
    }
  }, [file.dataUrl])

  const current = state.dataUrl === file.dataUrl ? state : null
  const viewer = current?.viewer ?? null
  const thumbnailPresentation = current?.presentation ?? null
  const thumbnailRenderer = current?.renderSlide ?? null

  function handleSelectSlide(index: number) {
    if (!viewer) {
      return
    }

    setState((latest) =>
      latest.viewer === viewer ? { ...latest, activeSlide: index } : latest
    )
    void viewer.goToSlide(index).catch(() => undefined)
  }

  return (
    <div className="flex h-full min-h-[360px] min-w-[620px] bg-muted/55">
      {viewer && current && thumbnailPresentation && thumbnailRenderer ? (
        <aside
          ref={thumbnailScrollRef}
          className="flex w-32 shrink-0 flex-col gap-2 overflow-y-auto border-r bg-background/70 p-2"
          aria-label={locale === "zh" ? "幻灯片列表" : "Slide list"}
        >
          {Array.from({ length: current.slideCount }, (_, index) => (
            <StudioPptxThumbnail
              key={index}
              presentation={thumbnailPresentation}
              renderSlide={thumbnailRenderer}
              index={index}
              active={current.activeSlide === index}
              locale={locale}
              scrollRootRef={thumbnailScrollRef}
              onSelect={handleSelectSlide}
            />
          ))}
        </aside>
      ) : null}

      <div className="relative min-w-0 flex-1 overflow-auto p-5">
        <div
          ref={slideContainerRef}
          className="mx-auto min-h-[320px] w-full min-w-[440px]"
        />

        {!current || current.error ? (
          <div className="absolute inset-0 bg-muted/55">
            <ArtifactState
              path={entry.path}
              title={
                current?.error
                  ? locale === "zh"
                    ? "此 PPTX 文件无法预览"
                    : "This PPTX cannot be previewed"
                  : locale === "zh"
                    ? "正在渲染幻灯片…"
                    : "Rendering slides…"
              }
              detail={current?.error}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StudioDocumentPreview({
  path,
  preview,
}: {
  path: string
  preview: Extract<OfficePreview, { kind: "document" }>
}) {
  const paragraphs = preview.paragraphs
  const title =
    paragraphs.find((paragraph) => paragraph.heading)?.text ??
    paragraphs[0]?.text ??
    path.split(/[\\/]/).at(-1) ??
    path

  return (
    <div className="min-h-full bg-muted/55 px-6 py-7 pb-20">
      <article className="mx-auto min-h-[680px] max-w-2xl bg-background px-10 py-9 shadow-lg">
        <header className="mb-14 flex items-center gap-2 text-xs text-muted-foreground">
          <StudioFileTypeIcon path={path} size="small" />
          <span>DOCX</span>
        </header>
        <h1 className="mb-6 font-sans text-3xl leading-tight font-semibold text-foreground">
          {title}
        </h1>
        <div className="flex flex-col gap-3">
          {paragraphs
            .slice(paragraphs[0]?.text === title ? 1 : 0)
            .map((paragraph, index) =>
              paragraph.heading ? (
                <h2
                  key={`${index}-${paragraph.text}`}
                  className="mt-5 font-sans text-lg font-semibold"
                >
                  {paragraph.text}
                </h2>
              ) : (
                <p
                  key={`${index}-${paragraph.text.slice(0, 50)}`}
                  className="text-sm leading-6 text-foreground/85"
                >
                  {paragraph.text}
                </p>
              )
            )}
        </div>
      </article>
    </div>
  )
}

function StudioOfficePreview({
  entry,
  file,
  kind,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelDataUrlFile
  kind: OfficePreviewKind
}) {
  const { locale } = useI18n()
  const state = useOfficePreview(file, kind)

  if (state.loading) {
    return (
      <ArtifactState
        path={entry.path}
        title={locale === "zh" ? "正在解析文件…" : "Parsing file…"}
      />
    )
  }

  if (!state.preview) {
    return (
      <ArtifactState
        path={entry.path}
        title={
          locale === "zh" ? "此文件无法预览" : "This file cannot be previewed"
        }
        detail={state.error}
      />
    )
  }

  if (state.preview.kind === "document") {
    return <StudioDocumentPreview path={entry.path} preview={state.preview} />
  }

  return (
    <StudioSpreadsheetPreview
      filename={entry.name}
      rows={state.preview.rows}
      rowNumbers={state.preview.rowNumbers}
    />
  )
}

function useLegacyXlsPreview(
  file: AstraFlowSidePanelDataUrlFile,
  enabled: boolean
) {
  const [state, setState] = React.useState<{
    dataUrl: string
    rows: string[][] | null
    error: string
    loading: boolean
  }>({ dataUrl: "", rows: null, error: "", loading: enabled })

  React.useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false

    void dataUrlToBytes(file.dataUrl)
      .then((bytes) => parseLegacyXls(bytes, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS))
      .then((preview) => {
        if (!cancelled) {
          setState({
            dataUrl: file.dataUrl,
            rows: preview.rows,
            error: "",
            loading: false,
          })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            dataUrl: file.dataUrl,
            rows: null,
            error: error instanceof Error ? error.message : "Preview failed",
            loading: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [enabled, file.dataUrl])

  if (!enabled || state.dataUrl !== file.dataUrl) {
    return { rows: null, error: "", loading: enabled }
  }

  return state
}

type WasmSectionPreview = {
  id: number
  name: string
  size: number
}

type WasmModulePreview = {
  version: number
  sections: WasmSectionPreview[]
}

function readWasmVarUint(bytes: Uint8Array, startOffset: number) {
  let offset = startOffset
  let value = 0
  let shift = 0

  while (offset < bytes.length && shift < 35) {
    const byte = bytes[offset]
    offset += 1
    value |= (byte & 0x7f) << shift

    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, offset }
    }

    shift += 7
  }

  throw new Error("WASM section length is invalid")
}

function parseWasmModule(bytes: Uint8Array): WasmModulePreview {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error("WASM module header is invalid")
  }

  const version = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(
    0,
    true
  )
  const sectionNames = [
    "Custom",
    "Type",
    "Import",
    "Function",
    "Table",
    "Memory",
    "Global",
    "Export",
    "Start",
    "Element",
    "Code",
    "Data",
    "Data count",
    "Tag",
  ]
  const sections: WasmSectionPreview[] = []
  let offset = 8

  while (offset < bytes.length && sections.length < 128) {
    const id = bytes[offset]
    offset += 1
    const sectionSize = readWasmVarUint(bytes, offset)
    offset = sectionSize.offset
    const sectionEnd = offset + sectionSize.value

    if (sectionEnd > bytes.length) {
      throw new Error("WASM section is truncated")
    }

    let name = sectionNames[id] ?? `Section ${id}`

    if (id === 0 && sectionSize.value > 0) {
      const customNameSize = readWasmVarUint(bytes, offset)
      const customNameEnd = Math.min(
        sectionEnd,
        customNameSize.offset + customNameSize.value
      )
      const customName = new TextDecoder()
        .decode(bytes.subarray(customNameSize.offset, customNameEnd))
        .trim()

      if (customName) {
        name = customName
      }
    }

    sections.push({ id, name, size: sectionSize.value })
    offset = sectionEnd
  }

  return { version, sections }
}

function useWasmPreview(file: AstraFlowSidePanelDataUrlFile, enabled: boolean) {
  const [state, setState] = React.useState<{
    dataUrl: string
    preview: WasmModulePreview | null
    error: string
    loading: boolean
  }>({ dataUrl: "", preview: null, error: "", loading: enabled })

  React.useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false

    void dataUrlToBytes(file.dataUrl)
      .then(parseWasmModule)
      .then((preview) => {
        if (!cancelled) {
          setState({
            dataUrl: file.dataUrl,
            preview,
            error: "",
            loading: false,
          })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            dataUrl: file.dataUrl,
            preview: null,
            error: error instanceof Error ? error.message : "Preview failed",
            loading: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [enabled, file.dataUrl])

  if (!enabled || state.dataUrl !== file.dataUrl) {
    return { preview: null, error: "", loading: enabled }
  }

  return state
}

function StudioWasmPreview({
  entry,
  file,
  preview,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelDataUrlFile
  preview: WasmModulePreview
}) {
  const { locale } = useI18n()

  return (
    <div className="min-h-full bg-muted/25 p-6 pb-16">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-background shadow-sm">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <StudioFileTypeIcon path={entry.path} size="medium" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {entry.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              WebAssembly {locale === "zh" ? "模块" : "module"} · v
              {preview.version} · {file.size.toLocaleString()} bytes
            </p>
          </div>
        </header>
        <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] text-xs">
          {preview.sections.map((section, index) => (
            <React.Fragment key={`${index}-${section.id}-${section.name}`}>
              <span className="border-b px-3 py-2 text-right font-mono text-muted-foreground">
                {section.id}
              </span>
              <span className="min-w-0 truncate border-b px-3 py-2 font-medium text-foreground">
                {section.name}
              </span>
              <span className="border-b px-3 py-2 font-mono text-muted-foreground tabular-nums">
                {section.size.toLocaleString()} B
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

export function StudioBinaryFilePreview({
  entry,
  file,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelDataUrlFile
}) {
  const { locale } = useI18n()
  const descriptor = getStudioFileDescriptor(entry.path)
  const legacyXls = useLegacyXlsPreview(
    file,
    descriptor.kind === "spreadsheet" && descriptor.extension === "xls"
  )
  const wasm = useWasmPreview(
    file,
    descriptor.kind === "binary" && descriptor.extension === "wasm"
  )

  if (descriptor.kind === "pdf") {
    return (
      <object
        data={file.dataUrl}
        type="application/pdf"
        className="h-full min-h-[520px] w-full bg-background"
        aria-label={entry.name}
      >
        <ArtifactState
          path={entry.path}
          title={locale === "zh" ? "PDF 无法嵌入" : "PDF could not be embedded"}
        />
      </object>
    )
  }

  if (descriptor.kind === "document") {
    return <StudioOfficePreview entry={entry} file={file} kind="document" />
  }

  if (descriptor.kind === "presentation") {
    return <StudioPptxPreview entry={entry} file={file} />
  }

  if (descriptor.kind === "spreadsheet" && descriptor.extension === "xlsx") {
    return <StudioOfficePreview entry={entry} file={file} kind="spreadsheet" />
  }

  if (descriptor.kind === "spreadsheet" && descriptor.extension === "xls") {
    if (legacyXls.loading) {
      return (
        <ArtifactState
          path={entry.path}
          title={locale === "zh" ? "正在解析文件…" : "Parsing file…"}
        />
      )
    }

    if (legacyXls.rows) {
      return (
        <StudioSpreadsheetPreview filename={entry.name} rows={legacyXls.rows} />
      )
    }

    return (
      <ArtifactState
        path={entry.path}
        title={
          locale === "zh"
            ? "此 XLS 文件无法预览"
            : "This XLS cannot be previewed"
        }
        detail={legacyXls.error}
      />
    )
  }

  if (descriptor.kind === "binary" && descriptor.extension === "wasm") {
    if (wasm.loading) {
      return (
        <ArtifactState
          path={entry.path}
          title={locale === "zh" ? "正在解析文件…" : "Parsing file…"}
        />
      )
    }

    if (wasm.preview) {
      return (
        <StudioWasmPreview entry={entry} file={file} preview={wasm.preview} />
      )
    }

    return (
      <ArtifactState
        path={entry.path}
        title={
          locale === "zh"
            ? "此 WebAssembly 模块无法预览"
            : "This WebAssembly module cannot be previewed"
        }
        detail={wasm.error}
      />
    )
  }

  return (
    <ArtifactState
      path={entry.path}
      title={
        locale === "zh"
          ? "此格式只能在外部应用中打开"
          : "Open this format in an external app"
      }
      detail={
        locale === "zh"
          ? "此二进制格式没有可用的内置预览。"
          : "No built-in preview is available for this binary format."
      }
    />
  )
}
