export const skillOrderByOptions = [
  "popular",
  "stars",
  "recent",
  "name",
] as const

export type SkillOrderBy = (typeof skillOrderByOptions)[number]

export type SkillSubCategory = {
  key: string
  name: string
}

export type SkillMeta = {
  Slug?: string
  Version?: string
  Name?: string
  Author?: string
  Desc?: string
  DescZh?: string
  Category?: string
  License?: string
  Downloads?: number
  FileCount?: number
  SizeBytes?: number
  ArchiveUrl?: string
  UpStreamUrl?: string
  UpStreamUpdatedAt?: number
  FilesJson?: string
  SkillMdUrl?: string
  UpStream?: string
  Latest?: boolean
  IconUrl?: string
  Stars?: number
  SubCategories?: SkillSubCategory[]
}

export type InstalledSkill = {
  slug: string
  version: string
  skill: SkillMeta
  skillMd: string
  enabled: boolean
  bundled: boolean
  bundleHash?: string | null
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
  installedAt: string
  updatedAt: string
}

export type SkillMarketApiResponse =
  | {
      ok: true
      data: SkillMeta[]
      totalCount: number
      allCategories: string[]
      allSubCategories: SkillSubCategory[]
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type SkillDetailApiResponse =
  | {
      ok: true
      data: {
        skill: SkillMeta
        skillMd: string
      }
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type InstalledSkillsApiResponse =
  | {
      ok: true
      data: InstalledSkill[]
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type InstalledSkillApiResponse =
  | {
      ok: true
      data: InstalledSkill
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type SkillImportCandidate = {
  slug: string
  name: string
  description: string
  version: string
  sourcePath: string
  sourceRoot: string
  fileCount: number
  sizeBytes: number
  alreadyInstalled: boolean
  duplicateOf?: string
}

export type InvalidSkillImportCandidate = {
  sourcePath: string
  sourceRoot: string
  message: string
}

export type SkillImportScanData = {
  roots: string[]
  candidates: SkillImportCandidate[]
  duplicates: SkillImportCandidate[]
  invalid: InvalidSkillImportCandidate[]
}

export type SkillImportCandidatesApiResponse =
  | {
      ok: true
      data: SkillImportScanData
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type SkillImportResultData = {
  imported: InstalledSkill[]
  skipped: SkillImportCandidate[]
  failed: InvalidSkillImportCandidate[]
}

export type SkillImportApiResponse =
  | {
      ok: true
      data: SkillImportResultData
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export function isSkillOrderBy(value: string): value is SkillOrderBy {
  return skillOrderByOptions.includes(value as SkillOrderBy)
}
