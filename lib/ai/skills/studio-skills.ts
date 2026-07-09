import { createMiddleware, tool } from "langchain"
import { z } from "zod"

import { ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS } from "@/lib/astraflow-sandbox-runtime"
import { getOrCreateSessionSandbox } from "@/lib/astraflow-session-sandbox"
import {
  getStudioInstalledSkill,
  getStudioSessionSkillSync,
  getStudioSessionExpert,
  listStudioInstalledSkills,
  upsertStudioSessionSkillSync,
} from "@/lib/studio-db"
import { bufferToArrayBuffer } from "@/lib/studio-file-storage"
import {
  formatLoadedSkillForModel,
  getSandboxSkillPath,
  readInstalledSkillFiles,
  summarizeInstalledSkillsForPrompt,
} from "@/lib/studio-skills"
import {
  formatExpertDeclaredSkillForModel,
  formatExpertDeclaredSkillsList,
  formatInstalledSkillsList,
  listExpertDeclaredSkillsFromSnapshot,
  summarizeExpertDeclaredSkillsForPrompt,
} from "@/lib/studio-session-skills"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type StudioSkillsMiddlewareOptions = {
  sessionId: string
  modelverseApiKey?: string | null
}

async function syncSkillToSandbox({
  apiKey,
  files,
  sessionId,
  slug,
  version,
}: {
  apiKey: string
  files: ReturnType<typeof readInstalledSkillFiles>
  sessionId: string
  slug: string
  version: string
}) {
  return await withStudioSessionLock(sessionId, async () => {
    const sandbox = await getOrCreateSessionSandbox({ sessionId, apiKey })
    const sandboxPath = getSandboxSkillPath(slug)
    const existingSync = getStudioSessionSkillSync({ sessionId, slug })

    if (
      existingSync?.version === version &&
      existingSync.sandboxId === sandbox.sandboxId
    ) {
      return existingSync.sandboxPath
    }

    for (const file of files) {
      await sandbox.files.write(
        `${sandboxPath}/${file.path}`,
        bufferToArrayBuffer(file.buffer),
        { requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS }
      )
    }

    upsertStudioSessionSkillSync({
      sessionId,
      slug,
      version,
      sandboxId: sandbox.sandboxId,
      sandboxPath,
    })

    return sandboxPath
  })
}

export function createStudioSkillsMiddleware({
  sessionId,
  modelverseApiKey,
}: StudioSkillsMiddlewareOptions) {
  const installedSkills = listStudioInstalledSkills({ enabledOnly: true })
  const expertSkills = listExpertDeclaredSkillsFromSnapshot(
    getStudioSessionExpert(sessionId)?.snapshot ?? null
  )

  if (!installedSkills.length && !expertSkills.length) {
    return null
  }

  const skillsPrompt = [
    summarizeInstalledSkillsForPrompt(installedSkills),
    summarizeExpertDeclaredSkillsForPrompt(expertSkills),
  ]
    .filter(Boolean)
    .join("\n\n")
  const listInstalledSkillsTool = tool(
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
  const loadSkillTool = tool(
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

      const files = readInstalledSkillFiles(skill.installPath)
      const sandboxPath =
        modelverseApiKey && sessionId
          ? await syncSkillToSandbox({
              apiKey: modelverseApiKey,
              files,
              sessionId,
              slug: skill.slug,
              version: skill.version,
            })
          : null

      return formatLoadedSkillForModel({
        files,
        sandboxPath,
        skill,
      })
    },
    {
      name: "load_skill",
      description:
        "Load a full AstraFlow Skill by slug. Returns the full SKILL.md, file list, and synced sandbox path when available. Call this before using any available skill.",
      schema: z.object({
        slug: z.string().trim().min(1),
      }),
    }
  )

  return createMiddleware({
    name: "AstraFlowStudioSkills",
    tools: [listInstalledSkillsTool, loadSkillTool] as const,
    wrapModelCall: async (request, handler) => {
      const basePrompt = request.systemPrompt ?? ""

      return handler({
        ...request,
        systemPrompt: [basePrompt, skillsPrompt].filter(Boolean).join("\n\n"),
      })
    },
  })
}
