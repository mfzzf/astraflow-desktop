import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type {
  AcpMcpKeyValue,
  AcpMcpServer,
  AcpSessionPlugins,
} from "@/lib/agent/acp/acp-runtime"
import { createAstraFlowToolMcpBridgeServer } from "@/lib/agent/acp/host-tools"
import type { AcpMcpBridgeServer } from "@/lib/agent/acp/mcp-bridge"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import { AGENT_CONDUCT_RULES } from "@/lib/agent/agent-conduct-rules"
import { createExpertRuntimeSystemPrompt } from "@/lib/agent/expert-runtime"
import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import { createAvailableSessionFilesManifest } from "@/lib/astraflow-session-sandbox"
import {
  keyValuesToRecord,
  sanitizeMcpToolNameSegment,
  type InstalledMcpServer,
  type McpKeyValue,
} from "@/lib/mcp"
import {
  getStudioModelverseApiKey,
  getStudioSessionExpert,
  getStudioSessionWorkspace,
  listStudioInstalledSkills,
  listStudioMcpServers,
} from "@/lib/studio-db"
import {
  formatLoadedSkillForModel,
  getInstalledSkillRootPath,
  readInstalledSkillFiles,
  summarizeInstalledSkillsForPrompt,
} from "@/lib/studio-skills"
import {
  type ExpertDeclaredSkill,
  formatExpertDeclaredSkillForModel,
  formatExpertDeclaredSkillsList,
  formatInstalledSkillsList,
  listExpertDeclaredSkillsFromSnapshot,
  summarizeExpertDeclaredSkillsForPrompt,
} from "@/lib/studio-session-skills"
import { getMobileChannelBindingBySessionId } from "@/lib/mobile-channels/store"

type SkillsMcpManifest = {
  listText: string
  skills: Array<{
    content: string
    files: Array<{
      binary: boolean
      path: string
      size: number
      text?: string | null
    }>
    rootPath?: string | null
    slug: string
  }>
}

const SKILLS_MCP_SERVER_NAME = "astraflow_skills"
const SKILLS_MCP_MANIFEST_FILE = ".astraflow-skills-mcp.json"
const MAX_SKILL_FILE_TEXT_BYTES = 256 * 1024

function scriptPath(name: string) {
  const bundledNodeModules =
    process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim()
  const candidates = [
    bundledNodeModules
      ? join(dirname(bundledNodeModules), "scripts", name)
      : null,
    join(process.cwd(), "scripts", name),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return (
    candidates.find((candidate) =>
      existsSync(/* turbopackIgnore: true */ candidate)
    ) ?? candidates[0]
  )
}

function toAcpKeyValues(entries: McpKeyValue[] | undefined): AcpMcpKeyValue[] {
  return (entries ?? [])
    .map((entry) => ({
      name: entry.name.trim(),
      value: entry.value ?? "",
    }))
    .filter((entry) => entry.name && entry.value)
}

function toProcessEnv(env: Record<string, string>): AcpMcpKeyValue[] {
  return Object.entries(env).map(([name, value]) => ({ name, value }))
}

function serializeSkillFile(file: ReturnType<typeof readInstalledSkillFiles>[number]) {
  const isBinary =
    file.buffer.includes(0) || file.size > MAX_SKILL_FILE_TEXT_BYTES

  return {
    binary: isBinary,
    path: file.path,
    size: file.size,
  }
}

function buildSkillEntry(
  skill: ReturnType<typeof listStudioInstalledSkills>[number]
) {
  try {
    const files = readInstalledSkillFiles(skill.installPath)

    return {
      slug: skill.slug,
      content: formatLoadedSkillForModel({
        capabilities: {
          fileAccess: "read_skill_file",
          sandbox: "unavailable",
        },
        files,
        skill,
      }),
      rootPath: getInstalledSkillRootPath(skill.installPath),
      files: files.map(serializeSkillFile),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return formatLoadedSkillForModel({
      capabilities: {
        fileAccess: "read_skill_file",
        sandbox: "unavailable",
      },
      files: [],
      skill: {
        ...skill,
        skillMd: `Skill "${skill.slug}" could not be loaded: ${message}`,
      },
    })
  }
}

function buildExpertSkillEntry(skill: ExpertDeclaredSkill) {
  return {
    slug: skill.slug,
    content: formatExpertDeclaredSkillForModel(skill),
    files: [
      {
        binary: false,
        path: "SKILL.md",
        size: Buffer.byteLength(skill.skillMd, "utf8"),
        text: skill.skillMd,
      },
    ],
  }
}

function createSkillsManifest(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>,
  expertSkills: ExpertDeclaredSkill[]
) {
  const workspace = ensureAcpWorkspace(sessionId)
  const manifestPath = join(workspace, SKILLS_MCP_MANIFEST_FILE)
  const manifest: SkillsMcpManifest = {
    listText: [
      "Globally enabled skills:",
      formatInstalledSkillsList(skills),
      "",
      "Selected expert skills:",
      formatExpertDeclaredSkillsList(expertSkills),
    ].join("\n"),
    skills: [
      ...skills.map((skill) => {
        const entry = buildSkillEntry(skill)

        return typeof entry === "string"
          ? {
              slug: skill.slug,
              content: entry,
              rootPath: null,
              files: [],
            }
          : entry
      }),
      ...expertSkills.map(buildExpertSkillEntry),
    ],
  }

  mkdirSync(workspace, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8")

  return manifestPath
}

function createSkillsMcpServer(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>,
  expertSkills: ExpertDeclaredSkill[]
): AcpMcpServer | null {
  if (!skills.length && !expertSkills.length) {
    return null
  }

  const serverPath = scriptPath("astraflow-skills-mcp-server.mjs")

  if (!existsSync(serverPath)) {
    return null
  }

  return {
    name: SKILLS_MCP_SERVER_NAME,
    command: process.execPath,
    args: [serverPath],
    env: toProcessEnv({
      ASTRAFLOW_SKILLS_MCP_MANIFEST: createSkillsManifest(
        sessionId,
        skills,
        expertSkills
      ),
      ELECTRON_RUN_AS_NODE: "1",
    }),
  }
}

function createSkillsMcpBridgeServer(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>,
  expertSkills: ExpertDeclaredSkill[]
): AcpMcpBridgeServer | null {
  if (!skills.length && !expertSkills.length) {
    return null
  }

  const serverPath = scriptPath("astraflow-skills-mcp-server.mjs")

  if (!existsSync(serverPath)) {
    return null
  }

  return {
    name: SKILLS_MCP_SERVER_NAME,
    serverId: "astraflow:skills",
    config: {
      type: "stdio",
      command: process.execPath,
      args: [serverPath],
      cwd: null,
      env: [
        {
          name: "ASTRAFLOW_SKILLS_MCP_MANIFEST",
          value: createSkillsManifest(sessionId, skills, expertSkills),
          isSecret: false,
        },
        {
          name: "ELECTRON_RUN_AS_NODE",
          value: "1",
          isSecret: false,
        },
      ],
    },
  }
}

function createWrappedStdioServer({
  config,
  name,
}: {
  config: Extract<InstalledMcpServer["config"], { type: "stdio" }>
  name: string
}): AcpMcpServer {
  return {
    name,
    command: process.execPath,
    args: [scriptPath("astraflow-mcp-stdio-wrapper.mjs")],
    env: toProcessEnv({
      ASTRAFLOW_MCP_STDIO_CONFIG: JSON.stringify({
        args: config.args ?? [],
        command: config.command,
        cwd: config.cwd,
        env: keyValuesToRecord(config.env),
      }),
      ELECTRON_RUN_AS_NODE: "1",
    }),
  }
}

function convertStudioMcpServer(
  runtimeId: AgentRuntimeId,
  server: InstalledMcpServer
): AcpMcpServer | null {
  const name = sanitizeMcpToolNameSegment(server.id)
  const config = server.config

  if (config.type === "stdio") {
    if (config.cwd?.trim()) {
      return createWrappedStdioServer({ config, name })
    }

    return {
      name,
      command: config.command,
      args: config.args ?? [],
      env: toAcpKeyValues(config.env),
    }
  }

  if (runtimeId === "codex" && config.type === "sse") {
    return null
  }

  return {
    name,
    type: config.type === "streamable-http" ? "http" : "sse",
    url: config.url,
    headers: toAcpKeyValues(config.headers),
  }
}

function createBridgeMcpServer(server: InstalledMcpServer): AcpMcpBridgeServer {
  return {
    name: sanitizeMcpToolNameSegment(server.id),
    serverId: `studio:${server.id}`,
    config: server.config,
    _meta: {
      astraflow: {
        source: server.source,
        transport: server.transport,
      },
    },
  }
}

function createStudioToolsMcpBridgeServer(sessionId: string) {
  const workspace = getStudioSessionWorkspace(sessionId)
  const toolWorkspace = workspace
    ? {
        id: workspace.id,
        rootPath: workspace.rootPath,
        type: workspace.type,
      }
    : {
        id: sessionId,
        rootPath: ensureAcpWorkspace(sessionId),
        type: "local" as const,
      }
  const tools = createStudioAgentTools({
    sessionId,
    mobileChannelBound: Boolean(
      getMobileChannelBindingBySessionId(sessionId)
    ),
    workspace: toolWorkspace,
    modelverseApiKey: getStudioModelverseApiKey()?.key ?? null,
  })

  return createAstraFlowToolMcpBridgeServer({ tools })
}

function listAcpMcpServers({
  runtimeId,
  sessionId,
  skills,
  expertSkills,
}: {
  runtimeId: AgentRuntimeId
  sessionId: string
  skills: ReturnType<typeof listStudioInstalledSkills>
  expertSkills: ExpertDeclaredSkill[]
}) {
  const studioMcpServers = listStudioMcpServers({
    enabledOnly: true,
    includeSecrets: true,
  })
  const studioMcpBridgeServers = [
    createStudioToolsMcpBridgeServer(sessionId),
    ...studioMcpServers.map(createBridgeMcpServer),
  ]
  const directStudioMcpServers = studioMcpServers
    .map((server) => convertStudioMcpServer(runtimeId, server))
    .filter((server): server is AcpMcpServer => Boolean(server))
  const skillsMcpServer = createSkillsMcpServer(sessionId, skills, expertSkills)
  const skillsMcpBridgeServer = createSkillsMcpBridgeServer(
    sessionId,
    skills,
    expertSkills
  )

  return {
    hasSkillsMcpServer: Boolean(skillsMcpServer),
    mcpBridgeServers: skillsMcpBridgeServer
      ? [skillsMcpBridgeServer, ...studioMcpBridgeServers]
      : studioMcpBridgeServers,
    mcpServers: skillsMcpServer
      ? [skillsMcpServer, ...directStudioMcpServers]
      : directStudioMcpServers,
  }
}

export function createStudioAcpSessionPlugins({
  runtimeId,
  sessionId,
}: {
  runtimeId: AgentRuntimeId
  sessionId: string
}): AcpSessionPlugins {
  const skills = listStudioInstalledSkills({ enabledOnly: true })
  const expertSnapshot =
    getStudioSessionExpert(sessionId)?.snapshot ?? null
  const expertSkills = listExpertDeclaredSkillsFromSnapshot(
    expertSnapshot
  )
  const { hasSkillsMcpServer, mcpBridgeServers, mcpServers } =
    listAcpMcpServers({
    runtimeId,
    sessionId,
    skills,
    expertSkills,
  })
  const promptPreamble = [
    createExpertRuntimeSystemPrompt(expertSnapshot) || null,
    createAvailableSessionFilesManifest(sessionId) || null,
    hasSkillsMcpServer
      ? [
          summarizeInstalledSkillsForPrompt(skills, {
            sandboxPreparation: false,
          }),
          summarizeExpertDeclaredSkillsForPrompt(expertSkills),
          "AstraFlow Skills are exposed to Sandbox and external ACP Agents through the astraflow_skills MCP server. Use list_installed_skills to inspect the catalog, load_skill before following a skill, and read_skill_file when the loaded skill references bundled files.",
        ].join("\n\n")
      : null,
    AGENT_CONDUCT_RULES.join("\n"),
    "The text immediately following this line is the active user request. Treat it as actionable user input:\n",
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    mcpBridgeServers,
    mcpServers,
    promptPreamble,
  }
}
