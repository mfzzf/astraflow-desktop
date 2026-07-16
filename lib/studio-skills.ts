import {
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, normalize, relative, sep } from "node:path"
import { posix } from "node:path"
import { unzipSync } from "fflate"

import type {
  InstalledSkill,
  InvalidSkillImportCandidate,
  SkillImportCandidate,
  SkillImportScanData,
  SkillMeta,
} from "@/lib/skill-market"
import { isBundledSkillInstallPath } from "@/lib/bundled-skills"
import { safeFileName } from "@/lib/studio-file-storage"

const DEFAULT_SKILLS_ROOT_DIRECTORY = ".data"
const DEFAULT_SKILLS_ROOT_NAME = "studio-skills"
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024
const MAX_UNPACKED_FILES = 2_000
const LOADED_SKILL_FILE_LIST_LIMIT = 300
export const DEFAULT_SKILL_FILE_TEXT_READ_BYTES = 256 * 1024
const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120_000
const SKILL_MD_FILE_NAME = "SKILL.md"
const LOCAL_SKILL_VERSION = "local"
const DEFAULT_LOCAL_SKILL_ROOTS = [
  "~/.agents/skills",
  "~/.codex/skills",
  "~/.claude/skills",
  "/Users/zzf/.agents/skills",
  "/Users/zzf/.codex/skills",
  "/Users/zzf/.claude/skills",
]

export type InstalledSkillFile = {
  path: string
  buffer: Buffer
  size: number
}

export type InstalledSkillFileStat = {
  path: string
  size: number
}

export type SkillSandboxSyncIssue = {
  path: string
  reason: string
  size: number
}

export type SkillSandboxSyncSummary = {
  attemptedFileCount: number
  failed: SkillSandboxSyncIssue[]
  reused?: boolean
  skipped: SkillSandboxSyncIssue[]
  syncedFileCount: number
  syncError?: string
  totalFileCount: number
}

export type StudioSkillExecutionEnvironment = "local" | "remote"

export type ArchiveFile = {
  path: string
  bytes: Uint8Array
}

type InstallSkillFilesResult = {
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
  skillMd: string
}

export type InstallLocalSkillFilesResult = InstallSkillFilesResult & {
  skill: SkillMeta
  slug: string
  version: string
}

function getConfiguredSkillsRoot() {
  return process.env.ASTRAFLOW_STUDIO_SKILLS_PATH?.trim() || null
}

function getSkillsRoot() {
  const configuredSkillsRoot = getConfiguredSkillsRoot()

  if (configuredSkillsRoot) {
    return configuredSkillsRoot
  }

  return join(
    /* turbopackIgnore: true */ process.cwd(),
    DEFAULT_SKILLS_ROOT_DIRECTORY,
    DEFAULT_SKILLS_ROOT_NAME
  )
}

function safeSkillSegment(value: string | undefined, fallback: string) {
  const safe = safeFileName(value?.trim() || fallback)
    .replace(/^\.+$/, "")
    .slice(0, 120)

  return safe || fallback
}

function createInstallPath(skill: SkillMeta) {
  const slug = safeSkillSegment(skill.Slug, "skill")
  const version = safeSkillSegment(skill.Version, "latest")

  return posix.join(slug, version)
}

function resolveSkillStoragePath(storagePath: string) {
  const normalized = normalize(storagePath).replace(/^(\.\.(\/|\\|$))+/, "")

  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Invalid skill storage path.")
  }

  return join(/* turbopackIgnore: true */ getSkillsRoot(), normalized)
}

function normalizeArchivePath(rawPath: string) {
  if (!rawPath || rawPath.includes("\0")) {
    throw new Error("Skill archive contains an invalid path.")
  }

  const unixPath = rawPath.replaceAll("\\", "/")

  if (posix.isAbsolute(unixPath) || /^[A-Za-z]:/.test(unixPath)) {
    throw new Error(`Skill archive contains an unsafe path: ${rawPath}`)
  }

  const normalized = posix.normalize(unixPath).replace(/^(\.\/)+/, "")
  const parts = normalized.split("/")

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    parts.includes("..")
  ) {
    throw new Error(`Skill archive contains an unsafe path: ${rawPath}`)
  }

  return normalized
}

function normalizeSkillFilePath(rawPath: string) {
  if (!rawPath || rawPath.includes("\0")) {
    throw new Error("Invalid skill file path.")
  }

  const unixPath = rawPath.replaceAll("\\", "/")

  if (posix.isAbsolute(unixPath) || /^[A-Za-z]:/.test(unixPath)) {
    throw new Error(`Unsafe skill file path: ${rawPath}`)
  }

  const normalized = posix.normalize(unixPath).replace(/^(\.\/)+/, "")
  const parts = normalized.split("/")

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    parts.includes("..")
  ) {
    throw new Error(`Unsafe skill file path: ${rawPath}`)
  }

  return normalized
}

function stripCommonRoot(files: ArchiveFile[]) {
  const rootNames = new Set(
    files.map((file) => file.path.split("/")[0]).filter(Boolean)
  )

  if (
    files.some((file) => file.path === SKILL_MD_FILE_NAME) ||
    rootNames.size !== 1
  ) {
    return files
  }

  const [rootName] = Array.from(rootNames)

  if (!files.some((file) => file.path === `${rootName}/${SKILL_MD_FILE_NAME}`)) {
    return files
  }

  return files.map((file) => ({
    ...file,
    path: file.path.slice(rootName.length + 1),
  }))
}

function cleanYamlScalar(value: string) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function parseSkillFrontmatter(skillMd: string) {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)

  if (!match) {
    throw new Error("Invalid SKILL.md: missing YAML frontmatter.")
  }

  const metadata: Record<string, string> = {}
  const lines = match[1].split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const scalarMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)

    if (!scalarMatch) {
      continue
    }

    const key = scalarMatch[1]
    const value = scalarMatch[2]

    if (value.trim() === "|" || value.trim() === ">") {
      const blockLines: string[] = []
      let nextIndex = index + 1

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex]

        if (/^[A-Za-z0-9_-]+:\s*/.test(nextLine)) {
          break
        }

        blockLines.push(nextLine.replace(/^\s{2,}/, ""))
        nextIndex += 1
      }

      metadata[key] =
        value.trim() === ">"
          ? blockLines.map((line) => line.trim()).join(" ").trim()
          : blockLines.join("\n").trim()
      index = nextIndex - 1
      continue
    }

    metadata[key] = cleanYamlScalar(value)
  }

  const name = metadata.name?.trim()
  const description = metadata.description?.trim()

  if (!name || !description) {
    throw new Error(
      "Invalid SKILL.md: frontmatter must include name and description."
    )
  }

  return {
    author: metadata.author?.trim() || undefined,
    description,
    license: metadata.license?.trim() || undefined,
    name,
  }
}

function createLocalSkillMeta({
  fileCount,
  fallbackSlug,
  sizeBytes,
  skillMd,
}: {
  fallbackSlug: string
  fileCount: number
  sizeBytes: number
  skillMd: string
}) {
  const frontmatter = parseSkillFrontmatter(skillMd)
  const slug = safeSkillSegment(frontmatter.name, fallbackSlug)
  const skill: SkillMeta = {
    Slug: slug,
    Version: LOCAL_SKILL_VERSION,
    Name: frontmatter.name,
    ...(frontmatter.author ? { Author: frontmatter.author } : {}),
    Desc: frontmatter.description,
    Category: "Imported",
    FileCount: fileCount,
    SizeBytes: sizeBytes,
    UpStream: "local",
    ...(frontmatter.license ? { License: frontmatter.license } : {}),
  }

  return {
    skill,
    slug,
    version: LOCAL_SKILL_VERSION,
  }
}

function ensureArchiveLimits(files: ArchiveFile[]) {
  if (files.length > MAX_UNPACKED_FILES) {
    throw new Error(`Skill contains more than ${MAX_UNPACKED_FILES} files.`)
  }

  const totalBytes = files.reduce((total, file) => total + file.bytes.length, 0)

  if (totalBytes > MAX_UNPACKED_BYTES) {
    throw new Error("Skill is larger than the unpacked size limit.")
  }

  return totalBytes
}

function buildLocalSkillFiles({
  fallbackSlug,
  files,
}: {
  fallbackSlug: string
  files: ArchiveFile[]
}) {
  const normalizedFiles = stripCommonRoot(
    files.map((file) => ({
      path: normalizeArchivePath(file.path),
      bytes: file.bytes,
    }))
  )
  const totalBytes = ensureArchiveLimits(normalizedFiles)
  const skillMdFile = normalizedFiles.find(
    (file) => file.path === SKILL_MD_FILE_NAME
  )

  if (!skillMdFile) {
    throw new Error("Invalid skill folder: missing SKILL.md.")
  }

  const skillMd = Buffer.from(skillMdFile.bytes).toString("utf8")
  const meta = createLocalSkillMeta({
    fallbackSlug,
    fileCount: normalizedFiles.length,
    sizeBytes: totalBytes,
    skillMd,
  })

  return {
    ...meta,
    files: normalizedFiles,
    installedFileCount: normalizedFiles.length,
    installedSizeBytes: totalBytes,
    skillMd,
  }
}

function expandHomePath(rawPath: string) {
  if (rawPath === "~") {
    return homedir()
  }

  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2))
  }

  return rawPath
}

function isDirectory(path: string) {
  try {
    return statSync(/* turbopackIgnore: true */ path).isDirectory()
  } catch {
    return false
  }
}

export function getDefaultLocalSkillImportRoots() {
  const roots: string[] = []
  const seen = new Set<string>()

  for (const root of DEFAULT_LOCAL_SKILL_ROOTS) {
    const expanded = normalize(expandHomePath(root))

    if (!isDirectory(expanded)) {
      continue
    }

    const real = realpathSync(/* turbopackIgnore: true */ expanded)

    if (seen.has(real)) {
      continue
    }

    seen.add(real)
    roots.push(real)
  }

  return roots
}

function isSameOrInside(parent: string, child: string) {
  const relativePath = relative(parent, child)

  return (
    !relativePath ||
    (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))
  )
}

export function isAllowedLocalSkillImportPath(sourcePath: string) {
  let sourceRealPath: string

  try {
    sourceRealPath = realpathSync(
      /* turbopackIgnore: true */ normalize(sourcePath)
    )
  } catch {
    return false
  }

  return getDefaultLocalSkillImportRoots().some((root) =>
    isSameOrInside(root, sourceRealPath)
  )
}

function findSkillDirectories(root: string) {
  const directories: string[] = []
  const seen = new Set<string>()

  function addIfSkillDirectory(directory: string) {
    const skillMdPath = join(directory, SKILL_MD_FILE_NAME)

    if (!existsSync(/* turbopackIgnore: true */ skillMdPath)) {
      return false
    }

    const real = realpathSync(/* turbopackIgnore: true */ directory)

    if (!seen.has(real)) {
      seen.add(real)
      directories.push(real)
    }

    return true
  }

  const entries = readdirSync(/* turbopackIgnore: true */ root, {
    withFileTypes: true,
  })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const firstLevel = join(root, entry.name)

    if (addIfSkillDirectory(firstLevel)) {
      continue
    }

    const childEntries = readdirSync(/* turbopackIgnore: true */ firstLevel, {
      withFileTypes: true,
    })

    for (const childEntry of childEntries) {
      if (!childEntry.isDirectory()) {
        continue
      }

      addIfSkillDirectory(join(firstLevel, childEntry.name))
    }
  }

  return directories
}

function readLocalSkillDirectoryFiles(sourcePath: string) {
  const root = realpathSync(/* turbopackIgnore: true */ normalize(sourcePath))

  if (!isDirectory(root)) {
    throw new Error("Skill source path is not a directory.")
  }

  const files: ArchiveFile[] = []
  let totalBytes = 0

  function walk(directory: string) {
    const entries = readdirSync(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)

      if (entry.isSymbolicLink()) {
        throw new Error("Skill folder contains a symbolic link.")
      }

      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (files.length + 1 > MAX_UNPACKED_FILES) {
        throw new Error(`Skill contains more than ${MAX_UNPACKED_FILES} files.`)
      }

      const bytes = readFileSync(/* turbopackIgnore: true */ absolutePath)
      totalBytes += bytes.byteLength

      if (totalBytes > MAX_UNPACKED_BYTES) {
        throw new Error("Skill is larger than the unpacked size limit.")
      }

      files.push({
        path: normalizeArchivePath(relative(root, absolutePath).split(sep).join("/")),
        bytes,
      })
    }
  }

  walk(root)

  return {
    fallbackSlug: safeSkillSegment(basename(root), "skill"),
    files,
    root,
  }
}

function createImportCandidate({
  alreadyInstalled,
  duplicateOf,
  sourcePath,
  sourceRoot,
  summary,
}: {
  alreadyInstalled: boolean
  duplicateOf?: string
  sourcePath: string
  sourceRoot: string
  summary: ReturnType<typeof buildLocalSkillFiles>
}): SkillImportCandidate {
  return {
    slug: summary.slug,
    name: summary.skill.Name?.trim() || summary.slug,
    description: summary.skill.Desc?.trim() || "",
    version: summary.version,
    sourcePath,
    sourceRoot,
    fileCount: summary.installedFileCount,
    sizeBytes: summary.installedSizeBytes,
    alreadyInstalled,
    ...(duplicateOf ? { duplicateOf } : {}),
  }
}

function inspectLocalSkillDirectory({
  installedSlugs,
  seenSlugs,
  sourcePath,
  sourceRoot,
}: {
  installedSlugs: Set<string>
  seenSlugs: Map<string, string>
  sourcePath: string
  sourceRoot: string
}) {
  try {
    const directory = readLocalSkillDirectoryFiles(sourcePath)
    const summary = buildLocalSkillFiles({
      fallbackSlug: directory.fallbackSlug,
      files: directory.files,
    })
    const duplicateOf = seenSlugs.get(summary.slug)
    const alreadyInstalled = installedSlugs.has(summary.slug)

    if (duplicateOf || alreadyInstalled) {
      seenSlugs.set(summary.slug, duplicateOf ?? summary.slug)

      return {
        duplicate: createImportCandidate({
          alreadyInstalled,
          duplicateOf,
          sourcePath: directory.root,
          sourceRoot,
          summary,
        }),
      }
    }

    seenSlugs.set(summary.slug, summary.slug)

    return {
      candidate: createImportCandidate({
        alreadyInstalled: false,
        sourcePath: directory.root,
        sourceRoot,
        summary,
      }),
    }
  } catch (error) {
    return {
      invalid: {
        sourcePath,
        sourceRoot,
        message: error instanceof Error ? error.message : "Invalid skill folder.",
      } satisfies InvalidSkillImportCandidate,
    }
  }
}

export function scanLocalSkillImportCandidates({
  installedSlugs = new Set<string>(),
}: {
  installedSlugs?: Set<string>
} = {}): SkillImportScanData {
  const roots = getDefaultLocalSkillImportRoots()
  const candidates: SkillImportCandidate[] = []
  const duplicates: SkillImportCandidate[] = []
  const invalid: InvalidSkillImportCandidate[] = []
  const seenSlugs = new Map<string, string>()

  for (const root of roots) {
    for (const sourcePath of findSkillDirectories(root)) {
      const result = inspectLocalSkillDirectory({
        installedSlugs,
        seenSlugs,
        sourcePath,
        sourceRoot: root,
      })

      if (result.candidate) {
        candidates.push(result.candidate)
      } else if (result.duplicate) {
        duplicates.push(result.duplicate)
      } else if (result.invalid) {
        invalid.push(result.invalid)
      }
    }
  }

  return {
    roots,
    candidates,
    duplicates,
    invalid,
  }
}

export function readLocalSkillImportCandidate({
  installedSlugs = new Set<string>(),
  sourcePath,
  sourceRoot = "",
}: {
  installedSlugs?: Set<string>
  sourcePath: string
  sourceRoot?: string
}) {
  const directory = readLocalSkillDirectoryFiles(sourcePath)
  const summary = buildLocalSkillFiles({
    fallbackSlug: directory.fallbackSlug,
    files: directory.files,
  })

  return createImportCandidate({
    alreadyInstalled: installedSlugs.has(summary.slug),
    sourcePath: directory.root,
    sourceRoot,
    summary,
  })
}

function decodeArchive(bytes: Uint8Array) {
  let entries: Record<string, Uint8Array>

  try {
    entries = unzipSync(bytes)
  } catch (error) {
    throw new Error(
      `Failed to unpack skill archive: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    )
  }

  const files = stripCommonRoot(
    Object.entries(entries)
      .filter(([rawPath]) => !rawPath.endsWith("/"))
      .map(([rawPath, fileBytes]) => ({
        path: normalizeArchivePath(rawPath),
        bytes: fileBytes,
      }))
  )

  if (files.length > MAX_UNPACKED_FILES) {
    throw new Error(
      `Skill archive contains more than ${MAX_UNPACKED_FILES} files.`
    )
  }

  const totalBytes = files.reduce((total, file) => total + file.bytes.length, 0)

  if (totalBytes > MAX_UNPACKED_BYTES) {
    throw new Error("Skill archive is larger than the unpacked size limit.")
  }

  return files
}

async function readResponseBytes(response: Response) {
  const contentLength = Number(response.headers.get("content-length"))

  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Skill archive is larger than the download size limit.")
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())

    if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error("Skill archive is larger than the download size limit.")
    }

    return new Uint8Array(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    totalBytes += value.byteLength

    if (totalBytes > MAX_ARCHIVE_BYTES) {
      await reader.cancel()
      throw new Error("Skill archive is larger than the download size limit.")
    }

    chunks.push(value)
  }

  const buffer = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return buffer
}

async function downloadArchive(archiveUrl: string) {
  const url = new URL(archiveUrl)

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Skill archive URL must be http or https.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ARCHIVE_DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Failed to download skill archive: HTTP ${response.status}`)
    }

    return await readResponseBytes(response)
  } finally {
    clearTimeout(timeout)
  }
}

function writeFilesToInstallPath({
  files,
  installPath,
  skillMd,
}: {
  files: ArchiveFile[]
  installPath: string
  skillMd: string
}) {
  const root = resolveSkillStoragePath(installPath)

  rmSync(/* turbopackIgnore: true */ root, { recursive: true, force: true })
  mkdirSync(/* turbopackIgnore: true */ root, { recursive: true })

  for (const file of files) {
    const absolutePath = join(/* turbopackIgnore: true */ root, file.path)
    const relativePath = relative(root, absolutePath)

    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      relativePath.includes(`..${sep}`)
    ) {
      throw new Error(`Skill archive contains an unsafe path: ${file.path}`)
    }

    mkdirSync(/* turbopackIgnore: true */ dirname(absolutePath), {
      recursive: true,
    })
    writeFileSync(/* turbopackIgnore: true */ absolutePath, file.bytes)
  }

  const skillMdPath = join(root, SKILL_MD_FILE_NAME)

  if (!existsSync(/* turbopackIgnore: true */ skillMdPath)) {
    if (!skillMd.trim()) {
      throw new Error("Skill is missing SKILL.md content.")
    }

    writeFileSync(/* turbopackIgnore: true */ skillMdPath, skillMd)
  }
}

function readInstalledSkillMd(installPath: string) {
  const skillMdPath = join(
    /* turbopackIgnore: true */ resolveSkillStoragePath(installPath),
    SKILL_MD_FILE_NAME
  )

  if (!existsSync(/* turbopackIgnore: true */ skillMdPath)) {
    return ""
  }

  return readFileSync(/* turbopackIgnore: true */ skillMdPath, "utf8")
}

function countInstalledFiles(installPath: string) {
  const root = resolveSkillStoragePath(installPath)
  let fileCount = 0
  let totalBytes = 0

  function walk(directory: string) {
    const entries = readdirSync(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      fileCount += 1
      totalBytes += readFileSync(
        /* turbopackIgnore: true */ absolutePath
      ).byteLength
    }
  }

  walk(root)

  return {
    installedFileCount: fileCount,
    installedSizeBytes: totalBytes,
  }
}

export async function installStudioSkillFiles({
  skill,
  skillMd,
}: {
  skill: SkillMeta
  skillMd: string
}): Promise<InstallSkillFilesResult> {
  const installPath = createInstallPath(skill)
  const archiveUrl = skill.ArchiveUrl?.trim()
  const files = archiveUrl ? decodeArchive(await downloadArchive(archiveUrl)) : []

  if (files.length === 0) {
    if (!skillMd.trim()) {
      throw new Error("Skill has no archive or SKILL.md content.")
    }

    files.push({
      path: SKILL_MD_FILE_NAME,
      bytes: new TextEncoder().encode(skillMd),
    })
  }

  writeFilesToInstallPath({ files, installPath, skillMd })

  const installedSkillMd = readInstalledSkillMd(installPath) || skillMd
  const counts = countInstalledFiles(installPath)

  return {
    installPath,
    installedFileCount: counts.installedFileCount,
    installedSizeBytes: counts.installedSizeBytes,
    skillMd: installedSkillMd,
  }
}

export function installLocalStudioSkillDirectory({
  sourcePath,
}: {
  sourcePath: string
}): InstallLocalSkillFilesResult {
  const directory = readLocalSkillDirectoryFiles(sourcePath)
  const summary = buildLocalSkillFiles({
    fallbackSlug: directory.fallbackSlug,
    files: directory.files,
  })
  const installPath = createInstallPath(summary.skill)

  writeFilesToInstallPath({
    files: summary.files,
    installPath,
    skillMd: summary.skillMd,
  })

  const installedSkillMd = readInstalledSkillMd(installPath) || summary.skillMd
  const counts = countInstalledFiles(installPath)

  return {
    installPath,
    installedFileCount: counts.installedFileCount,
    installedSizeBytes: counts.installedSizeBytes,
    skill: summary.skill,
    skillMd: installedSkillMd,
    slug: summary.slug,
    version: summary.version,
  }
}

function buildUploadedSkillGroups(files: ArchiveFile[]) {
  const normalized = files.map((file) => ({
    path: normalizeArchivePath(file.path),
    bytes: file.bytes,
  }))
  const skillDirs = new Set<string>()

  for (const file of normalized) {
    const parts = file.path.split("/")

    if (parts[parts.length - 1] === SKILL_MD_FILE_NAME) {
      skillDirs.add(parts.slice(0, -1).join("/"))
    }
  }

  const sortedDirs = Array.from(skillDirs).sort((a, b) => b.length - a.length)
  const groups = new Map<string, ArchiveFile[]>()

  for (const file of normalized) {
    const owner = sortedDirs.find(
      (dir) => dir === "" || file.path.startsWith(`${dir}/`)
    )

    if (owner === undefined) {
      continue
    }

    const relativePath = owner === "" ? file.path : file.path.slice(owner.length + 1)
    const groupFiles = groups.get(owner) ?? []

    groupFiles.push({ path: relativePath, bytes: file.bytes })
    groups.set(owner, groupFiles)
  }

  return groups
}

function makeUploadedGroupId(dir: string) {
  return dir === "" ? "." : dir
}

export function parseUploadedSkillCandidates({
  files,
  installedSlugs = new Set<string>(),
}: {
  files: ArchiveFile[]
  installedSlugs?: Set<string>
}): SkillImportScanData {
  const groups = buildUploadedSkillGroups(files)
  const candidates: SkillImportCandidate[] = []
  const duplicates: SkillImportCandidate[] = []
  const invalid: InvalidSkillImportCandidate[] = []
  const seenSlugs = new Map<string, string>()

  if (groups.size === 0) {
    invalid.push({
      sourcePath: ".",
      sourceRoot: "",
      message: "Invalid skill folder: missing SKILL.md.",
    })
  }

  for (const [dir, groupFiles] of groups) {
    const groupId = makeUploadedGroupId(dir)

    try {
      const summary = buildLocalSkillFiles({
        fallbackSlug: safeSkillSegment(basename(dir) || "skill", "skill"),
        files: groupFiles,
      })
      const duplicateOf = seenSlugs.get(summary.slug)
      const alreadyInstalled = installedSlugs.has(summary.slug)

      if (duplicateOf || alreadyInstalled) {
        seenSlugs.set(summary.slug, duplicateOf ?? summary.slug)
        duplicates.push(
          createImportCandidate({
            alreadyInstalled,
            duplicateOf,
            sourcePath: groupId,
            sourceRoot: "",
            summary,
          })
        )
        continue
      }

      seenSlugs.set(summary.slug, summary.slug)
      candidates.push(
        createImportCandidate({
          alreadyInstalled: false,
          sourcePath: groupId,
          sourceRoot: "",
          summary,
        })
      )
    } catch (error) {
      invalid.push({
        sourcePath: groupId,
        sourceRoot: "",
        message: error instanceof Error ? error.message : "Invalid skill folder.",
      })
    }
  }

  return { roots: [], candidates, duplicates, invalid }
}

export function installUploadedStudioSkillGroups({
  files,
  selectedPaths,
  installedSlugs = new Set<string>(),
}: {
  files: ArchiveFile[]
  selectedPaths?: string[]
  installedSlugs?: Set<string>
}) {
  const groups = buildUploadedSkillGroups(files)
  const selected = selectedPaths ? new Set(selectedPaths) : null
  const imported: InstallLocalSkillFilesResult[] = []
  const skipped: SkillImportCandidate[] = []
  const failed: InvalidSkillImportCandidate[] = []
  const installedSlugSet = new Set(installedSlugs)

  for (const [dir, groupFiles] of groups) {
    const groupId = makeUploadedGroupId(dir)

    if (selected && !selected.has(groupId)) {
      continue
    }

    try {
      const summary = buildLocalSkillFiles({
        fallbackSlug: safeSkillSegment(basename(dir) || "skill", "skill"),
        files: groupFiles,
      })

      if (installedSlugSet.has(summary.slug)) {
        skipped.push(
          createImportCandidate({
            alreadyInstalled: true,
            sourcePath: groupId,
            sourceRoot: "",
            summary,
          })
        )
        continue
      }

      const installPath = createInstallPath(summary.skill)

      writeFilesToInstallPath({
        files: summary.files,
        installPath,
        skillMd: summary.skillMd,
      })

      const installedSkillMd = readInstalledSkillMd(installPath) || summary.skillMd
      const counts = countInstalledFiles(installPath)

      installedSlugSet.add(summary.slug)
      imported.push({
        installPath,
        installedFileCount: counts.installedFileCount,
        installedSizeBytes: counts.installedSizeBytes,
        skill: summary.skill,
        skillMd: installedSkillMd,
        slug: summary.slug,
        version: summary.version,
      })
    } catch (error) {
      failed.push({
        sourcePath: groupId,
        sourceRoot: "",
        message:
          error instanceof Error ? error.message : "Failed to import skill.",
      })
    }
  }

  return { imported, skipped, failed }
}

export function removeInstalledSkillFiles(installPath: string) {
  if (isBundledSkillInstallPath(installPath)) {
    throw new Error(
      "Bundled skills are managed by AstraFlow and cannot be removed. Disable the skill instead."
    )
  }

  const root = resolveSkillStoragePath(installPath)

  rmSync(/* turbopackIgnore: true */ root, { recursive: true, force: true })
}

export function readInstalledSkillFiles(installPath: string) {
  const root = resolveSkillStoragePath(installPath)
  const files: InstalledSkillFile[] = []

  function walk(directory: string) {
    const entries = readdirSync(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const relativePath = relative(root, absolutePath).split(sep).join("/")
      const buffer = readFileSync(/* turbopackIgnore: true */ absolutePath)

      files.push({
        path: relativePath,
        buffer,
        size: buffer.byteLength,
      })
    }
  }

  walk(root)

  return files
}

// Stat-only variant for listings (e.g. load_skill) that never touch file
// contents, so a large skill bundle is not read into memory just to print
// names and sizes.
export function listInstalledSkillFileStats(
  installPath: string
): InstalledSkillFileStat[] {
  const root = resolveSkillStoragePath(installPath)
  const files: InstalledSkillFileStat[] = []

  function walk(directory: string) {
    const entries = readdirSync(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      files.push({
        path: relative(root, absolutePath).split(sep).join("/"),
        size: statSync(/* turbopackIgnore: true */ absolutePath).size,
      })
    }
  }

  walk(root)

  return files
}

export function readInstalledSkillFileText({
  installPath,
  maxBytes = DEFAULT_SKILL_FILE_TEXT_READ_BYTES,
  path,
}: {
  installPath: string
  maxBytes?: number
  path: string
}) {
  const root = resolveSkillStoragePath(installPath)
  const relativePath = normalizeSkillFilePath(path)
  const absolutePath = join(/* turbopackIgnore: true */ root, relativePath)
  const stat = statSync(/* turbopackIgnore: true */ absolutePath)

  if (!stat.isFile()) {
    throw new Error("Skill path is not a file.")
  }

  if (stat.size > maxBytes) {
    throw new Error(
      `Skill file is larger than the text read limit (${stat.size} bytes).`
    )
  }

  const buffer = readFileSync(/* turbopackIgnore: true */ absolutePath)

  if (buffer.includes(0)) {
    throw new Error("Skill file appears to be binary.")
  }

  return {
    path: relativePath,
    size: buffer.byteLength,
    text: buffer.toString("utf8"),
  }
}

export function getInstalledSkillRootPath(installPath: string) {
  return resolveSkillStoragePath(installPath)
}

export function getSandboxSkillPath(slug: string) {
  return posix.join("/home/user/astraflow/skills", safeSkillSegment(slug, "skill"))
}

// Catalog text comes from marketplace metadata or imported frontmatter and is
// injected into the system prompt, so it must stay a single bounded line:
// embedded newlines could otherwise smuggle instruction-like text into the
// prompt, and unbounded descriptions bloat every request.
const SKILL_CATALOG_TEXT_MAX_CHARS = 240

export function sanitizeSkillCatalogText(
  value: string | undefined,
  fallback: string
) {
  const singleLine = value?.replace(/\s+/g, " ").trim() ?? ""

  if (!singleLine) {
    return fallback
  }

  if (singleLine.length <= SKILL_CATALOG_TEXT_MAX_CHARS) {
    return singleLine
  }

  return `${singleLine.slice(0, SKILL_CATALOG_TEXT_MAX_CHARS - 3)}...`
}

export function summarizeInstalledSkillsForPrompt(
  skills: InstalledSkill[],
  { sandboxPreparation }: { sandboxPreparation: boolean }
) {
  if (!skills.length) {
    return ""
  }

  const introLine = sandboxPreparation
    ? "Installed AstraFlow Skills are globally enabled for this chat. Do not assume a skill's full instructions from the catalog alone. First call load_skill with the matching slug, then follow the returned SKILL.md. Use read_skill_file for bundled files referenced by SKILL.md; do not use local read_file/ls on skill paths. When SKILL.md requires executing bundled files in the sandbox, call prepare_skill_sandbox first and use only the sandbox root it returns."
    : "Installed AstraFlow Skills are globally enabled for this chat. Do not assume a skill's full instructions from the catalog alone. First call load_skill with the matching slug, then follow the returned SKILL.md. Use read_skill_file for bundled files referenced by SKILL.md; do not use local read_file/ls on skill paths."

  return [
    introLine,
    "Installed skills catalog:",
    ...skills.map((skill) => {
      const description = sanitizeSkillCatalogText(
        skill.skill.DescZh || skill.skill.Desc,
        "No description"
      )
      const category = sanitizeSkillCatalogText(
        skill.skill.Category,
        "uncategorized"
      )
      const name = sanitizeSkillCatalogText(skill.skill.Name, skill.slug)

      return `- ${skill.slug} | ${name} | v${skill.version} | ${category} | ${description}`
    }),
  ].join("\n")
}

function formatSkillBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function formatLoadedSkillFileList(files: InstalledSkillFileStat[]) {
  if (!files.length) {
    return "- SKILL.md"
  }

  const visibleFiles = files.slice(0, LOADED_SKILL_FILE_LIST_LIMIT)
  const lines = visibleFiles.map(
    (file) => `- ${file.path} (${file.size} bytes)`
  )

  if (files.length > visibleFiles.length) {
    lines.push(
      `- ... ${files.length - visibleFiles.length} more files omitted from this load_skill listing. Use SKILL.md references or read_skill_file when available for specific bundled files.`
    )
  }

  return lines.join("\n")
}

function formatSyncIssues(label: string, issues: SkillSandboxSyncIssue[]) {
  if (!issues.length) {
    return []
  }

  const visibleIssues = issues.slice(0, 8)
  const lines = [
    `${label}:`,
    ...visibleIssues.map(
      (issue) =>
        `- ${issue.path} (${formatSkillBytes(issue.size)}): ${issue.reason}`
    ),
  ]

  if (issues.length > visibleIssues.length) {
    lines.push(`- ... ${issues.length - visibleIssues.length} more`)
  }

  return lines
}

export function formatSkillSandboxPreparationForModel({
  environment,
  sandboxPath,
  slug,
  summary,
}: {
  environment: StudioSkillExecutionEnvironment
  sandboxPath: string
  slug: string
  summary: SkillSandboxSyncSummary
}): string {
  const lines = [
    `Skill sandbox prepared: ${slug}`,
    `Sandbox root: ${sandboxPath}`,
    summary.reused
      ? "Sync: reused the existing synced copy for this skill version."
      : `Sync: ${summary.syncedFileCount}/${summary.totalFileCount} files synced (${summary.attemptedFileCount} attempted).`,
  ]

  if (summary.skipped.length) {
    lines.push(`${summary.skipped.length} files were skipped.`)
    lines.push(...formatSyncIssues("Skipped files", summary.skipped))
  }

  if (summary.failed.length) {
    lines.push(`${summary.failed.length} files failed to sync.`)
    lines.push(...formatSyncIssues("Failed files", summary.failed))
  }

  if (summary.skipped.length || summary.failed.length) {
    lines.push(
      "Skipped or failed files are NOT present in the sandbox. Use upload_file to add a specific file if a bundled script requires it."
    )
  }

  lines.push(
    environment === "local"
      ? "Run bundled files with the local `bash` tool and use the exact sandbox root above. To read file contents into the conversation, use read_skill_file instead."
      : "Run bundled files with sandbox tools (run_code, run_command) under this root. To read file contents into the conversation, use read_skill_file instead."
  )

  return lines.join("\n")
}

export function formatSkillRuntimeGuidanceForModel({
  environment,
  platform,
  slug,
}: {
  environment: StudioSkillExecutionEnvironment
  platform: NodeJS.Platform
  slug: string
}) {
  if (
    environment !== "local" ||
    platform !== "darwin" ||
    slug.trim().toLowerCase() !== "pptx"
  ) {
    return ""
  }

  return [
    "## Local macOS runtime override",
    "",
    "This override supersedes conflicting rendering and visual-QA instructions in SKILL.md.",
    "",
    "- Do not invoke, probe, install, or request approval for LibreOffice (`soffice`/`libreoffice`), Poppler (`pdftoppm`), or Quick Look (`qlmanage`).",
    "- After `prepare_skill_sandbox`, run `python <skill-root>/scripts/structural_qa.py output.pptx` for package/XML/relationship checks and `python -m markitdown output.pptx` for content checks.",
    "- Complete a content-and-structure fix/verify cycle. Rendered visual QA is unavailable in local macOS mode and is not a completion blocker.",
    "- Do not rewrite PptxGenJS notes-master ordering solely to satisfy the bundled strict XSD validator; use the local structural QA path instead.",
  ].join("\n")
}

export type LoadedSkillCapabilities = {
  fileAccess: "read_skill_file" | "skill_md_only"
  sandbox: "prepare_on_demand" | "unavailable"
}

export function formatLoadedSkillForModel({
  capabilities,
  files,
  runtimeGuidance,
  skill,
}: {
  capabilities: LoadedSkillCapabilities
  files: InstalledSkillFileStat[]
  runtimeGuidance?: string
  skill: InstalledSkill
}) {
  const fileList = formatLoadedSkillFileList(files)

  const capabilityLines = [
    capabilities.fileAccess === "read_skill_file"
      ? "Skill file access: use read_skill_file with this slug and a skill-relative path from the Files list."
      : "Skill file access: only SKILL.md is available for this skill.",
  ]

  if (capabilities.sandbox === "prepare_on_demand") {
    capabilityLines.push(
      "Sandbox execution: if SKILL.md requires running bundled files, call prepare_skill_sandbox with this slug first and use only the sandbox root it returns. Do not guess sandbox paths and do not use local file tools on sandbox paths."
    )
  }

  return [
    `Skill loaded: ${skill.skill.Name?.trim() || skill.slug}`,
    `Slug: ${skill.slug}`,
    `Version: ${skill.version}`,
    ...capabilityLines,
    "",
    "Files:",
    fileList,
    "",
    "SKILL.md:",
    skill.skillMd,
    ...(runtimeGuidance ? ["", runtimeGuidance] : []),
  ].join("\n")
}
