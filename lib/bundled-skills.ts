import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, posix, relative, resolve, sep } from "node:path"

import { z } from "zod"

import type { SkillMeta } from "@/lib/skill-market"

const BUNDLED_INSTALL_PREFIX = "__bundled__"
const DEFAULT_SKILLS_ROOT_DIRECTORY = ".data"
const DEFAULT_SKILLS_ROOT_NAME = "studio-skills"

const bundledSkillSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1),
  bundleHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.string().min(1),
  license: z.string().min(1),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
})

const bundledManifestSchema = z.object({
  schemaVersion: z.literal(1),
  skills: z.array(bundledSkillSchema),
})

export type BundledStudioSkill = {
  bundleHash: string
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
  skill: SkillMeta
  skillMd: string
  slug: string
  version: string
}

function getBundledSkillsRoot() {
  return resolve(
    /* turbopackIgnore: true */
    process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH?.trim() ||
      join(process.cwd(), "bundled-skills")
  )
}

function getInstalledSkillsRoot() {
  const configured = process.env.ASTRAFLOW_STUDIO_SKILLS_PATH?.trim()

  return configured
    ? resolve(configured)
    : join(
        process.cwd(),
        DEFAULT_SKILLS_ROOT_DIRECTORY,
        DEFAULT_SKILLS_ROOT_NAME
      )
}

function sha256(buffer: Buffer | string) {
  return createHash("sha256").update(buffer).digest("hex")
}

function normalizeRelativePath(path: string) {
  const normalized = posix.normalize(path.replaceAll("\\", "/"))

  if (
    !normalized ||
    normalized === "." ||
    posix.isAbsolute(normalized) ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Bundled skill contains an unsafe path: ${path}`)
  }

  return normalized
}

function listFiles(root: string) {
  const files: string[] = []

  function walk(directory: string) {
    for (const entry of readdirSync(
      /* turbopackIgnore: true */ directory,
      { withFileTypes: true }
    )) {
      const absolutePath = join(
        /* turbopackIgnore: true */ directory,
        entry.name
      )

      if (entry.isSymbolicLink()) {
        throw new Error(`Bundled skill contains a symbolic link: ${absolutePath}`)
      }

      if (entry.isDirectory()) {
        // Python bytecode caches appear when a bundled skill runs; they are
        // runtime artifacts, not bundle content.
        if (entry.name === "__pycache__") {
          continue
        }

        walk(absolutePath)
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".pyc")) {
          continue
        }

        files.push(relative(root, absolutePath).split(sep).join("/"))
      }
    }
  }

  walk(root)
  return files.sort()
}

function parseDescription(skillMd: string) {
  const match = skillMd.match(
    /^---\r?\n[\s\S]*?^description:\s*(.+?)\s*$[\s\S]*?^---\s*$/m
  )
  const raw = match?.[1]?.trim() || ""

  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw.slice(1, -1)
    }
  }

  return raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw
}

function skillDisplayMeta({
  fileCount,
  license,
  sizeBytes,
  skillMd,
  slug,
  source,
  version,
}: {
  fileCount: number
  license: string
  sizeBytes: number
  skillMd: string
  slug: string
  source: string
  version: string
}): SkillMeta {
  const displayBySlug: Record<
    string,
    { category: string; descZh: string; name: string }
  > = {
    "ardot-design-core": {
      name: "Ardot 设计核心",
      descZh: "Ardot 画布设计的基础工作流与通用规则。",
      category: "Design",
    },
    "ardot-design-router": {
      name: "Ardot 设计路由",
      descZh: "根据意图分发到合适的 Ardot 设计技能。",
      category: "Design",
    },
    "ardot-design-to-code": {
      name: "Ardot 设计转代码",
      descZh: "将 Ardot 设计稿转换为前端代码或提取设计系统。",
      category: "Design",
    },
    "ardot-poster": {
      name: "Ardot 海报设计",
      descZh: "海报、Banner、传单、品牌视觉等设计。",
      category: "Design",
    },
    "ardot-slides": {
      name: "Ardot 幻灯片设计",
      descZh: "幻灯片、演示文稿、Keynote 风格设计稿。",
      category: "Design",
    },
    "ardot-ui-design": {
      name: "Ardot UI 设计",
      descZh: "网页、App、Dashboard、组件库等 UI 设计。",
      category: "Design",
    },
    docx: {
      name: "Word",
      descZh: "创建、读取、编辑和验证 Word 文档、批注与修订。",
      category: "Productivity",
    },
    "expert-manager": {
      name: "专家包管理器",
      descZh: "创建、维护、打包 AstraFlow 专家包。",
      category: "Productivity",
    },
    "finance-skill": {
      name: "金融分析",
      descZh: "金融场景总入口，数据路由与红线规则。",
      category: "Finance",
    },
    pdf: {
      name: "PDF",
      descZh: "读取、创建、拆分、合并、检查和填写 PDF 文档。",
      category: "Productivity",
    },
    pptx: {
      name: "PowerPoint",
      descZh: "创建、修改、检查和验证可编辑的 PowerPoint 演示文稿。",
      category: "Productivity",
    },
    "skill-creator": {
      name: "Skill 创建器",
      descZh: "创建、编辑、打包 AstraFlow Skill 的指南。",
      category: "Productivity",
    },
    "westock-data": {
      name: "自选股数据",
      descZh: "腾讯自选股结构化行情与基本面数据查询。",
      category: "Finance",
    },
    "westock-tool": {
      name: "自选股选股",
      descZh: "按条件、策略、标签、事件、排行筛选股票与 ETF。",
      category: "Finance",
    },
    xlsx: {
      name: "Excel",
      descZh: "创建、修改、检查和验证 Excel 工作簿、公式、表格与图表。",
      category: "Productivity",
    },
  }
  const display = displayBySlug[slug]

  return {
    Slug: slug,
    Version: version,
    Name: display?.name ?? slug,
    Author: "AstraFlow",
    Desc: parseDescription(skillMd),
    DescZh: display?.descZh ?? parseDescription(skillMd),
    Category: display?.category ?? "Productivity",
    License: license,
    FileCount: fileCount,
    SizeBytes: sizeBytes,
    UpStream: source,
    Latest: true,
  }
}

function verifyBundleHash(files: Record<string, string>, expected: string) {
  const payload = Object.entries(files)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join("")
  const actual = sha256(payload)

  if (actual !== expected) {
    throw new Error(
      `Bundled skill manifest hash mismatch: expected ${expected}, received ${actual}.`
    )
  }
}

function destinationMatches(
  destinationRoot: string,
  files: Record<string, string>
) {
  if (!existsSync(destinationRoot)) {
    return false
  }

  try {
    const destinationFiles = listFiles(destinationRoot)
    const expectedFiles = Object.keys(files).sort()

    return (
      destinationFiles.length === expectedFiles.length &&
      expectedFiles.every(
        (path, index) =>
          destinationFiles[index] === path &&
          sha256(
            readFileSync(
              /* turbopackIgnore: true */ join(destinationRoot, path)
            )
          ) === files[path]
      )
    )
  } catch {
    return false
  }
}

export function installBundledStudioSkills(): BundledStudioSkill[] {
  const sourceRoot = getBundledSkillsRoot()
  const manifestPath = join(
    /* turbopackIgnore: true */ sourceRoot,
    "manifest.json"
  )

  if (!existsSync(manifestPath)) {
    throw new Error(`Bundled skill manifest is missing: ${manifestPath}`)
  }

  const manifest = bundledManifestSchema.parse(
    JSON.parse(
      readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8")
    )
  )
  const installedRoot = getInstalledSkillsRoot()
  const installed: BundledStudioSkill[] = []

  for (const entry of manifest.skills) {
    const sourceSkillRoot = join(
      /* turbopackIgnore: true */ sourceRoot,
      entry.slug
    )
    const actualFiles = listFiles(sourceSkillRoot)
    const expectedFiles = Object.keys(entry.files)
      .map(normalizeRelativePath)
      .sort()

    if (
      actualFiles.length !== expectedFiles.length ||
      actualFiles.some((path, index) => path !== expectedFiles[index])
    ) {
      throw new Error(
        `Bundled skill ${entry.slug} file list does not match manifest.json.`
      )
    }

    let installedSizeBytes = 0

    for (const path of expectedFiles) {
      const sourcePath = join(
        /* turbopackIgnore: true */ sourceSkillRoot,
        path
      )
      const buffer = readFileSync(/* turbopackIgnore: true */ sourcePath)
      const actualHash = sha256(buffer)

      if (actualHash !== entry.files[path]) {
        throw new Error(
          `Bundled skill ${entry.slug}/${path} failed SHA-256 verification.`
        )
      }

      installedSizeBytes += buffer.byteLength
    }

    verifyBundleHash(entry.files, entry.bundleHash)

    const installPath = posix.join(
      BUNDLED_INSTALL_PREFIX,
      entry.slug,
      entry.version
    )
    const destinationRoot = join(installedRoot, ...installPath.split("/"))

    if (!destinationMatches(destinationRoot, entry.files)) {
      rmSync(destinationRoot, { recursive: true, force: true })

      for (const path of expectedFiles) {
        const destination = join(destinationRoot, ...path.split("/"))
        const sourcePath = join(
          /* turbopackIgnore: true */ sourceSkillRoot,
          path
        )
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(
          /* turbopackIgnore: true */ destination,
          readFileSync(/* turbopackIgnore: true */ sourcePath)
        )
      }
    }

    const skillMd = readFileSync(
      /* turbopackIgnore: true */ join(sourceSkillRoot, "SKILL.md"),
      "utf8"
    )
    const installedFileCount = expectedFiles.length

    installed.push({
      bundleHash: entry.bundleHash,
      installPath,
      installedFileCount,
      installedSizeBytes,
      skill: skillDisplayMeta({
        fileCount: installedFileCount,
        license: entry.license,
        sizeBytes: installedSizeBytes,
        skillMd,
        slug: entry.slug,
        source: entry.source,
        version: entry.version,
      }),
      skillMd,
      slug: entry.slug,
      version: entry.version,
    })
  }

  return installed
}

export function isBundledSkillInstallPath(installPath: string) {
  return normalizeRelativePath(installPath).startsWith(
    `${BUNDLED_INSTALL_PREFIX}/`
  )
}
