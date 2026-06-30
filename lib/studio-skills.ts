import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, normalize, relative, sep } from "node:path"
import { posix } from "node:path"
import { unzipSync } from "fflate"

import type { InstalledSkill, SkillMeta } from "@/lib/skill-market"
import { safeFileName } from "@/lib/studio-file-storage"

const DEFAULT_SKILLS_ROOT_DIRECTORY = ".data"
const DEFAULT_SKILLS_ROOT_NAME = "studio-skills"
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024
const MAX_UNPACKED_FILES = 2_000
const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120_000
const SKILL_MD_FILE_NAME = "SKILL.md"

export type InstalledSkillFile = {
  path: string
  buffer: Buffer
  size: number
}

type ArchiveFile = {
  path: string
  bytes: Uint8Array
}

type InstallSkillFilesResult = {
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
  skillMd: string
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

export function removeInstalledSkillFiles(installPath: string) {
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

export function getSandboxSkillPath(slug: string) {
  return posix.join("/home/user/astraflow/skills", safeSkillSegment(slug, "skill"))
}

export function summarizeInstalledSkillsForPrompt(skills: InstalledSkill[]) {
  if (!skills.length) {
    return ""
  }

  return [
    "Installed AstraFlow Skills are globally enabled for this chat. Do not assume a skill's full instructions from the catalog alone. First call load_skill with the matching slug, then follow the returned SKILL.md and use the provided sandbox path with file tools when needed.",
    "Installed skills catalog:",
    ...skills.map((skill) => {
      const description =
        skill.skill.DescZh?.trim() || skill.skill.Desc?.trim() || "No description"
      const category = skill.skill.Category?.trim() || "uncategorized"
      const name = skill.skill.Name?.trim() || skill.slug

      return `- ${skill.slug} | ${name} | v${skill.version} | ${category} | ${description}`
    }),
  ].join("\n")
}

export function formatLoadedSkillForModel({
  files,
  sandboxPath,
  skill,
}: {
  files: InstalledSkillFile[]
  sandboxPath: string | null
  skill: InstalledSkill
}) {
  const fileList = files
    .map((file) => `- ${file.path} (${file.size} bytes)`)
    .join("\n")

  return [
    `Skill loaded: ${skill.skill.Name?.trim() || skill.slug}`,
    `Slug: ${skill.slug}`,
    `Version: ${skill.version}`,
    sandboxPath ? `Sandbox path: ${sandboxPath}` : "Sandbox path: unavailable",
    "",
    "Files:",
    fileList || "- SKILL.md",
    "",
    "SKILL.md:",
    skill.skillMd,
  ].join("\n")
}
