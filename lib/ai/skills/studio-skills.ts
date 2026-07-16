import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import { ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS } from "@/lib/astraflow-sandbox-runtime"
import { connectStudioSessionWorkspaceSandbox } from "@/lib/astraflow-session-sandbox"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import {
  getStudioInstalledSkill,
  getStudioSessionSkillSync,
  getStudioSessionExpert,
  listStudioInstalledSkills,
  upsertStudioSessionSkillSync,
} from "@/lib/studio-db"
import {
  bufferToArrayBuffer,
  safeFileName,
} from "@/lib/studio-file-storage"
import {
  formatLoadedSkillForModel,
  formatSkillRuntimeGuidanceForModel,
  formatSkillSandboxPreparationForModel,
  getSandboxSkillPath,
  listInstalledSkillFileStats,
  readInstalledSkillFileText,
  readInstalledSkillFiles,
  summarizeInstalledSkillsForPrompt,
  type SkillSandboxSyncSummary,
} from "@/lib/studio-skills"
import {
  formatExpertDeclaredSkillForModel,
  formatExpertDeclaredSkillsList,
  formatInstalledSkillsList,
  listExpertDeclaredSkillsFromSnapshot,
  summarizeExpertDeclaredSkillsForPrompt,
} from "@/lib/studio-session-skills"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type StudioSkillsRuntimeOptions = {
  environment: "local" | "remote"
  sessionId: string
  workspaceId?: string | null
  modelverseApiKey?: string | null
}

const DEFAULT_SKILL_SANDBOX_MAX_FILE_BYTES = 8 * 1024 * 1024

function getSkillSandboxMaxFileBytes() {
  const value = Number(process.env.ASTRAFLOW_SKILL_SANDBOX_MAX_FILE_BYTES)

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_SKILL_SANDBOX_MAX_FILE_BYTES
  }

  return Math.trunc(value)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isPayloadTooLargeError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes("413") ||
    message.includes("request entity too large") ||
    message.includes("payload too large")
  )
}

async function syncSkillToSandbox({
  apiKey,
  files,
  sessionId,
  slug,
  version,
  workspaceId,
}: {
  apiKey: string
  files: ReturnType<typeof readInstalledSkillFiles>
  sessionId: string
  slug: string
  version: string
  workspaceId: string
}) {
  return await withStudioSessionLock(sessionId, async () => {
    const sandbox = await connectStudioSessionWorkspaceSandbox({
      sessionId,
      apiKey,
      workspaceId,
    })
    const sandboxPath = getSandboxSkillPath(slug)
    const existingSync = getStudioSessionSkillSync({ sessionId, slug })

    if (
      existingSync?.version === version &&
      existingSync.sandboxId === sandbox.sandboxId
    ) {
      return {
        sandboxPath: existingSync.sandboxPath,
        syncSummary: {
          attemptedFileCount: 0,
          failed: [],
          reused: true,
          skipped: [],
          syncedFileCount: 0,
          totalFileCount: files.length,
        } satisfies SkillSandboxSyncSummary,
      }
    }

    const maxFileBytes = getSkillSandboxMaxFileBytes()
    const syncSummary: SkillSandboxSyncSummary = {
      attemptedFileCount: 0,
      failed: [],
      skipped: [],
      syncedFileCount: 0,
      totalFileCount: files.length,
    }

    for (const file of files) {
      if (file.size > maxFileBytes) {
        syncSummary.skipped.push({
          path: file.path,
          reason: `larger than sandbox auto-sync limit (${maxFileBytes} bytes)`,
          size: file.size,
        })
        continue
      }

      syncSummary.attemptedFileCount += 1

      try {
        await sandbox.files.write(
          `${sandboxPath}/${file.path}`,
          bufferToArrayBuffer(file.buffer),
          { requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS }
        )
        syncSummary.syncedFileCount += 1
      } catch (error) {
        const issue = {
          path: file.path,
          reason: getErrorMessage(error),
          size: file.size,
        }

        if (isPayloadTooLargeError(error)) {
          syncSummary.skipped.push({
            ...issue,
            reason: "sandbox upload rejected the file as too large",
          })
        } else {
          syncSummary.failed.push(issue)
        }
      }
    }

    if (!syncSummary.failed.length) {
      upsertStudioSessionSkillSync({
        sessionId,
        slug,
        version,
        sandboxId: sandbox.sandboxId,
        sandboxPath,
      })
    }

    return { sandboxPath, syncSummary }
  })
}

async function syncSkillToLocalSandbox({
  files,
  sessionId,
  slug,
  version,
}: {
  files: ReturnType<typeof readInstalledSkillFiles>
  sessionId: string
  slug: string
  version: string
}) {
  return await withStudioSessionLock(sessionId, async () => {
    const sandboxPath = join(
      ensureLocalSandboxWorkspace(sessionId),
      "skills",
      safeFileName(slug)
    )
    const existingSync = getStudioSessionSkillSync({ sessionId, slug })
    const isCurrent =
      existingSync?.version === version &&
      existingSync.sandboxId === "local" &&
      existingSync.sandboxPath === sandboxPath &&
      files.every((file) => {
        const destination = join(
          /* turbopackIgnore: true */ sandboxPath,
          ...file.path.split("/")
        )

        return (
          existsSync(/* turbopackIgnore: true */ destination) &&
          readFileSync(/* turbopackIgnore: true */ destination).equals(
            file.buffer
          )
        )
      })

    if (isCurrent) {
      return {
        sandboxPath,
        syncSummary: {
          attemptedFileCount: 0,
          failed: [],
          reused: true,
          skipped: [],
          syncedFileCount: 0,
          totalFileCount: files.length,
        } satisfies SkillSandboxSyncSummary,
      }
    }

    rmSync(/* turbopackIgnore: true */ sandboxPath, {
      recursive: true,
      force: true,
    })
    mkdirSync(/* turbopackIgnore: true */ sandboxPath, { recursive: true })

    const syncSummary: SkillSandboxSyncSummary = {
      attemptedFileCount: files.length,
      failed: [],
      skipped: [],
      syncedFileCount: 0,
      totalFileCount: files.length,
    }

    for (const file of files) {
      try {
        const destination = resolve(
          sandboxPath,
          ...file.path.replaceAll("\\", "/").split("/")
        )
        const destinationRelative = relative(sandboxPath, destination)

        if (
          !destinationRelative ||
          destinationRelative === ".." ||
          destinationRelative.startsWith(`..${sep}`)
        ) {
          throw new Error(`Unsafe skill path: ${file.path}`)
        }

        mkdirSync(/* turbopackIgnore: true */ dirname(destination), {
          recursive: true,
        })
        writeFileSync(/* turbopackIgnore: true */ destination, file.buffer)
        syncSummary.syncedFileCount += 1
      } catch (error) {
        syncSummary.failed.push({
          path: file.path,
          reason: getErrorMessage(error),
          size: file.size,
        })
      }
    }

    if (!syncSummary.failed.length) {
      upsertStudioSessionSkillSync({
        sessionId,
        slug,
        version,
        sandboxId: "local",
        sandboxPath,
      })
    }

    return { sandboxPath, syncSummary }
  })
}

export function createStudioSkillsRuntime({
  environment,
  sessionId,
  workspaceId,
  modelverseApiKey,
}: StudioSkillsRuntimeOptions) {
  const installedSkills = listStudioInstalledSkills({ enabledOnly: true })
  const expertSkills = listExpertDeclaredSkillsFromSnapshot(
    getStudioSessionExpert(sessionId)?.snapshot ?? null
  )

  if (!installedSkills.length && !expertSkills.length) {
    return null
  }

  const sandboxAvailable =
    environment === "local" ||
    Boolean(modelverseApiKey && sessionId && workspaceId)
  const pptxRuntimeGuidance = installedSkills.some(
    (skill) => skill.slug === "pptx"
  )
    ? formatSkillRuntimeGuidanceForModel({
        environment,
        platform: process.platform,
        slug: "pptx",
      })
    : ""

  const skillsPrompt = [
    summarizeInstalledSkillsForPrompt(installedSkills, {
      sandboxPreparation: sandboxAvailable,
    }),
    summarizeExpertDeclaredSkillsForPrompt(expertSkills),
    pptxRuntimeGuidance,
  ]
    .filter(Boolean)
    .join("\n\n")
  const listInstalledSkillsTool = createAstraFlowTool(
    async () => {
      return [
        "Globally enabled skills:",
        formatInstalledSkillsList(installedSkills),
        "",
        "Selected expert skills:",
        formatExpertDeclaredSkillsList(expertSkills),
      ].join("\n")
    },
    {
      name: "list_installed_skills",
      description:
        "List AstraFlow Skills available in this chat, including globally enabled skills and selected expert skills. Use this when choosing which skill to load.",
      schema: z.object({}),
    }
  )
  const loadSkillTool = createAstraFlowTool(
    async ({ slug }) => {
      const normalizedSlug = slug.trim()
      const skill = getStudioInstalledSkill(normalizedSlug)

      if (!skill || !skill.enabled) {
        const expertSkill = expertSkills.find(
          (candidate) => candidate.slug === normalizedSlug
        )

        if (expertSkill) {
          return formatExpertDeclaredSkillForModel(expertSkill)
        }

        return `Skill "${normalizedSlug}" is not installed or is disabled.`
      }

      const files = listInstalledSkillFileStats(skill.installPath)

      return formatLoadedSkillForModel({
        capabilities: {
          fileAccess: "read_skill_file",
          sandbox: sandboxAvailable ? "prepare_on_demand" : "unavailable",
        },
        files,
        runtimeGuidance: formatSkillRuntimeGuidanceForModel({
          environment,
          platform: process.platform,
          slug: skill.slug,
        }),
        skill,
      })
    },
    {
      name: "load_skill",
      description:
        "Load a full AstraFlow Skill by slug. Returns the full SKILL.md and bundled file list. Call this before using any available skill. Read bundled files with read_skill_file; if SKILL.md requires executing bundled files in the sandbox, call prepare_skill_sandbox first.",
      schema: z.object({
        slug: z.string().trim().min(1),
      }),
    }
  )
  const readSkillFileTool = createAstraFlowTool(
    async ({ path, slug }) => {
      const normalizedSlug = slug.trim()
      const normalizedPath = path.trim()
      const skill = getStudioInstalledSkill(normalizedSlug)

      if (!skill || !skill.enabled) {
        const expertSkill = expertSkills.find(
          (candidate) => candidate.slug === normalizedSlug
        )
        const expertPath = normalizedPath
          .replaceAll("\\", "/")
          .replace(/^(\.\/)+/, "")

        if (expertSkill && expertPath === "SKILL.md") {
          return [
            `Skill file: ${expertSkill.slug}/SKILL.md`,
            `Bytes: ${Buffer.byteLength(expertSkill.skillMd, "utf8")}`,
            "",
            expertSkill.skillMd,
          ].join("\n")
        }

        if (expertSkill) {
          return `Skill file "${normalizedSlug}/${normalizedPath}" is not available.`
        }

        return `Skill "${normalizedSlug}" is not installed or is disabled.`
      }

      try {
        const file = readInstalledSkillFileText({
          installPath: skill.installPath,
          path: normalizedPath,
        })

        return [
          `Skill file: ${skill.slug}/${file.path}`,
          `Bytes: ${file.size}`,
          "",
          file.text,
        ].join("\n")
      } catch (error) {
        return `Skill file "${normalizedSlug}/${normalizedPath}" could not be read: ${getErrorMessage(error)}`
      }
    },
    {
      name: "read_skill_file",
      description:
        "Read a bundled file from an installed AstraFlow Skill after load_skill. Use this instead of local read_file/ls for skill supporting files referenced by SKILL.md.",
      schema: z.object({
        slug: z.string().trim().min(1),
        path: z.string().trim().min(1),
      }),
    }
  )

  const optionalTools =
    sandboxAvailable && sessionId
      ? [
          createAstraFlowTool(
            async ({ slug }) => {
              const normalizedSlug = slug.trim()
              const skill = getStudioInstalledSkill(normalizedSlug)

              if (!skill || !skill.enabled) {
                const expertSkill = expertSkills.find(
                  (candidate) => candidate.slug === normalizedSlug
                )

                if (expertSkill) {
                  return `Skill "${normalizedSlug}" is an expert-declared skill with no bundled files. Follow its SKILL.md directly.`
                }

                return `Skill "${normalizedSlug}" is not installed or is disabled.`
              }

              const files = readInstalledSkillFiles(skill.installPath)

              try {
                const result =
                  environment === "local"
                    ? await syncSkillToLocalSandbox({
                        files,
                        sessionId,
                        slug: skill.slug,
                        version: skill.version,
                      })
                    : await syncSkillToSandbox({
                        apiKey: modelverseApiKey as string,
                        files,
                        sessionId,
                        slug: skill.slug,
                        version: skill.version,
                        workspaceId: workspaceId as string,
                      })

                return formatSkillSandboxPreparationForModel({
                  environment,
                  sandboxPath: result.sandboxPath,
                  slug: skill.slug,
                  summary: result.syncSummary,
                })
              } catch (error) {
                const message = getErrorMessage(error)

                return `Sandbox preparation failed: ${message}. The skill instructions from load_skill are still valid; read bundled files with read_skill_file.`
              }
            },
            {
              name: "prepare_skill_sandbox",
              description:
                "Sync an installed AstraFlow Skill's bundled files into the current local or remote session sandbox and return its root path. Call this only when SKILL.md requires executing bundled scripts. To read file contents, use read_skill_file instead.",
              schema: z.object({
                slug: z.string().trim().min(1),
              }),
            }
          ),
        ]
      : []

  return {
    systemPrompt: skillsPrompt,
    tools: [
      listInstalledSkillsTool,
      loadSkillTool,
      readSkillFileTool,
      ...optionalTools,
    ],
  }
}
