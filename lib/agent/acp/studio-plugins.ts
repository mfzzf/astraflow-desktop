import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type {
  AcpMcpKeyValue,
  AcpMcpServer,
  AcpSessionPlugins,
} from "@/lib/agent/acp/acp-runtime"
import type { AcpMcpBridgeServer } from "@/lib/agent/acp/mcp-bridge"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import {
  keyValuesToRecord,
  sanitizeMcpToolNameSegment,
  type InstalledMcpServer,
  type McpKeyValue,
} from "@/lib/mcp"
import {
  listStudioInstalledSkills,
  listStudioMcpServers,
} from "@/lib/studio-db"
import {
  formatLoadedSkillForModel,
  readInstalledSkillFiles,
  summarizeInstalledSkillsForPrompt,
} from "@/lib/studio-skills"

type SkillsMcpManifest = {
  listText: string
  skills: Array<{
    content: string
    files: Array<{
      binary: boolean
      path: string
      size: number
      text: string | null
    }>
    slug: string
  }>
}

const SKILLS_MCP_SERVER_NAME = "astraflow_skills"
const SKILLS_MCP_MANIFEST_FILE = ".astraflow-skills-mcp.json"
const MAX_SKILL_FILE_TEXT_BYTES = 256 * 1024

function scriptPath(name: string) {
  return join(process.cwd(), "scripts", name)
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

function formatInstalledSkillsList(
  skills: ReturnType<typeof listStudioInstalledSkills>
) {
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

function serializeSkillFile(file: ReturnType<typeof readInstalledSkillFiles>[number]) {
  const isBinary =
    file.buffer.includes(0) || file.size > MAX_SKILL_FILE_TEXT_BYTES

  return {
    binary: isBinary,
    path: file.path,
    size: file.size,
    text: isBinary ? null : file.buffer.toString("utf8"),
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
        files,
        sandboxPath: null,
        skill,
      }),
      files: files.map(serializeSkillFile),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return formatLoadedSkillForModel({
      files: [],
      sandboxPath: null,
      skill: {
        ...skill,
        skillMd: `Skill "${skill.slug}" could not be loaded: ${message}`,
      },
    })
  }
}

function createSkillsManifest(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>
) {
  const workspace = ensureAcpWorkspace(sessionId)
  const manifestPath = join(workspace, SKILLS_MCP_MANIFEST_FILE)
  const manifest: SkillsMcpManifest = {
    listText: formatInstalledSkillsList(skills),
    skills: skills.map((skill) => {
      const entry = buildSkillEntry(skill)

      return typeof entry === "string"
        ? {
            slug: skill.slug,
            content: entry,
            files: [],
          }
        : entry
    }),
  }

  mkdirSync(workspace, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8")

  return manifestPath
}

function createSkillsMcpServer(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>
): AcpMcpServer | null {
  if (!skills.length) {
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
      ASTRAFLOW_SKILLS_MCP_MANIFEST: createSkillsManifest(sessionId, skills),
      ELECTRON_RUN_AS_NODE: "1",
    }),
  }
}

function createSkillsMcpBridgeServer(
  sessionId: string,
  skills: ReturnType<typeof listStudioInstalledSkills>
): AcpMcpBridgeServer | null {
  if (!skills.length) {
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
          value: createSkillsManifest(sessionId, skills),
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

function listAcpMcpServers({
  runtimeId,
  sessionId,
  skills,
}: {
  runtimeId: AgentRuntimeId
  sessionId: string
  skills: ReturnType<typeof listStudioInstalledSkills>
}) {
  const studioMcpServers = listStudioMcpServers({
    enabledOnly: true,
    includeSecrets: true,
  })
  const studioMcpBridgeServers = studioMcpServers.map(createBridgeMcpServer)
  const directStudioMcpServers = studioMcpServers
    .map((server) => convertStudioMcpServer(runtimeId, server))
    .filter((server): server is AcpMcpServer => Boolean(server))
  const skillsMcpServer = createSkillsMcpServer(sessionId, skills)
  const skillsMcpBridgeServer = createSkillsMcpBridgeServer(sessionId, skills)

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
  const { hasSkillsMcpServer, mcpBridgeServers, mcpServers } =
    listAcpMcpServers({
    runtimeId,
    sessionId,
    skills,
  })

  return {
    mcpBridgeServers,
    mcpServers,
    promptPreamble: hasSkillsMcpServer
      ? [
          summarizeInstalledSkillsForPrompt(skills),
          "For Codex, Claude Code, and OpenCode, AstraFlow Skills are exposed through the astraflow_skills MCP server. Use list_installed_skills to inspect the catalog, load_skill before following a skill, and read_skill_file when the loaded skill references bundled files.",
        ].join("\n\n")
      : null,
  }
}
