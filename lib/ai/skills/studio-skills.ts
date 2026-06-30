import { createMiddleware, tool } from "langchain"
import { z } from "zod"

import { ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS } from "@/lib/astraflow-sandbox-runtime"
import { getOrCreateSessionSandbox } from "@/lib/astraflow-session-sandbox"
import {
  getStudioInstalledSkill,
  getStudioSessionSkillSync,
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
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type StudioSkillsMiddlewareOptions = {
  sessionId: string
  modelverseApiKey?: string | null
}

function formatInstalledSkillsList() {
  const skills = listStudioInstalledSkills({ enabledOnly: true })

  if (!skills.length) {
    return "No AstraFlow skills are currently enabled."
  }

  return skills
    .map((skill) => {
      const name = skill.skill.Name?.trim() || skill.slug
      const description =
        skill.skill.DescZh?.trim() || skill.skill.Desc?.trim() || "No description"
      const category = skill.skill.Category?.trim() || "uncategorized"

      return `- ${skill.slug} | ${name} | v${skill.version} | ${category} | ${description}`
    })
    .join("\n")
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

  if (!installedSkills.length) {
    return null
  }

  const skillsPrompt = summarizeInstalledSkillsForPrompt(installedSkills)
  const listInstalledSkillsTool = tool(
    async () => {
      return formatInstalledSkillsList()
    },
    {
      name: "list_installed_skills",
      description:
        "List globally enabled AstraFlow Skills with slug, name, version, category, and description. Use this when choosing which skill to load.",
      schema: z.object({}),
    }
  )
  const loadSkillTool = tool(
    async ({ slug }) => {
      const normalizedSlug = slug.trim()
      const skill = getStudioInstalledSkill(normalizedSlug)

      if (!skill || !skill.enabled) {
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
        "Load a full AstraFlow Skill by slug. Returns the full SKILL.md, file list, and synced sandbox path. Call this before using any installed skill.",
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
