import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

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
import { isCompShareChannel } from "@/lib/compshare/config"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import { createEnvironmentRuntimeTools } from "@/lib/ai/tools/environment"
import {
  createStudioSkillsRuntime,
  type StudioSkillSyncAdapter,
} from "@/lib/ai/skills/studio-skills"
import { createAvailableSessionFilesManifest } from "@/lib/astraflow-session-sandbox"
import {
  sanitizeMcpToolNameSegment,
  type InstalledMcpServer,
} from "@/lib/mcp"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"
import {
  getLatestStudioAcpSessionSelection,
  getStudioModelverseApiKey,
  getStudioSession,
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
import { safeFileName } from "@/lib/studio-file-storage"
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
const ENVIRONMENT_MCP_SERVER_NAME = "astraflow_environment"
const ENVIRONMENT_MCP_SERVER_ID = "astraflow:environment"
const SKILLS_MCP_MANIFEST_FILE = ".astraflow-skills-mcp.json"
const NATIVE_AGENT_SKILLS_ROOT = ".native-agent-skills"
const MAX_SKILL_FILE_TEXT_BYTES = 256 * 1024

function skillsRevision(
  skills: ReturnType<typeof listStudioInstalledSkills>,
  expertSkills: ExpertDeclaredSkill[]
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        installed: skills.map((skill) => ({
          bundleHash: skill.bundleHash ?? null,
          slug: skill.slug,
          updatedAt: skill.updatedAt,
          version: skill.version,
        })),
        expert: expertSkills.map((skill) => ({
          skillMd: skill.skillMd,
          slug: skill.slug,
        })),
      })
    )
    .digest("hex")
}

function nativeSkillSlug(value: string) {
  const slug = safeFileName(value)

  return slug === "." || slug === ".." ? "skill" : slug
}

export function normalizeNativeAgentSkillMarkdown({
  description,
  skillMd,
  slug,
}: {
  description: string
  skillMd: string
  slug: string
}) {
  const normalizedSlug = nativeSkillSlug(slug)
  const normalizedDescription =
    description.replace(/\s+/g, " ").trim() ||
    `AstraFlow Skill ${normalizedSlug}`
  const normalized = skillMd.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  const lines = normalized.split("\n")
  const frontmatterEnd =
    lines[0]?.trim() === "---"
      ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
      : -1

  if (frontmatterEnd > 0) {
    const frontmatter = lines.slice(1, frontmatterEnd)
    let hasName = false
    let hasDescription = false
    const normalizedFrontmatter = frontmatter.map((line) => {
      if (/^name\s*:/i.test(line)) {
        hasName = true
        return `name: ${JSON.stringify(normalizedSlug)}`
      }

      if (/^description\s*:/i.test(line)) {
        hasDescription = true
        return `description: ${JSON.stringify(normalizedDescription)}`
      }

      return line
    })

    if (!hasDescription) {
      normalizedFrontmatter.unshift(
        `description: ${JSON.stringify(normalizedDescription)}`
      )
    }

    if (!hasName) {
      normalizedFrontmatter.unshift(`name: ${JSON.stringify(normalizedSlug)}`)
    }

    return [
      "---",
      ...normalizedFrontmatter,
      "---",
      ...lines.slice(frontmatterEnd + 1),
    ].join("\n")
  }

  return [
    "---",
    `name: ${JSON.stringify(normalizedSlug)}`,
    `description: ${JSON.stringify(normalizedDescription)}`,
    "---",
    normalized.trimStart(),
  ].join("\n")
}

function writeSkillFiles(
  targetRoot: string,
  files: ReturnType<typeof readInstalledSkillFiles>,
  sourceRoot: string
) {
  mkdirSync(targetRoot, { recursive: true })

  for (const file of files) {
    const target = join(targetRoot, ...file.path.split("/"))
    const sourceMode = statSync(join(sourceRoot, ...file.path.split("/"))).mode

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.buffer, { mode: sourceMode })
  }
}

function projectInstalledSkill(
  targetRoot: string,
  skill: ReturnType<typeof listStudioInstalledSkills>[number]
) {
  const sourceRoot = resolve(getInstalledSkillRootPath(skill.installPath))
  const files = readInstalledSkillFiles(skill.installPath)

  writeSkillFiles(targetRoot, files, sourceRoot)
  writeFileSync(
    join(targetRoot, "SKILL.md"),
    normalizeNativeAgentSkillMarkdown({
      description: skill.skill.DescZh || skill.skill.Desc || "",
      skillMd: skill.skillMd,
      slug: skill.slug,
    }),
    "utf8"
  )
}

export function prepareNativeAgentSkills({
  expertSkills,
  sessionId,
  skills,
}: {
  expertSkills: ExpertDeclaredSkill[]
  sessionId: string
  skills: ReturnType<typeof listStudioInstalledSkills>
}) {
  const projectionRoot = resolve(
    join(ensureAcpWorkspace(sessionId), NATIVE_AGENT_SKILLS_ROOT)
  )
  const skillsRoot = join(projectionRoot, ".agents", "skills")
  const projectedSlugs = new Set<string>()

  rmSync(skillsRoot, { recursive: true, force: true })
  mkdirSync(skillsRoot, { recursive: true })

  for (const skill of expertSkills) {
    const slug = nativeSkillSlug(skill.slug)

    if (projectedSlugs.has(slug)) {
      continue
    }

    const skillRoot = join(skillsRoot, slug)

    mkdirSync(skillRoot, { recursive: true })
    writeFileSync(
      join(skillRoot, "SKILL.md"),
      normalizeNativeAgentSkillMarkdown({
        description: skill.description,
        skillMd: skill.skillMd,
        slug,
      }),
      "utf8"
    )
    projectedSlugs.add(slug)
  }

  for (const skill of skills) {
    const slug = nativeSkillSlug(skill.slug)

    if (projectedSlugs.has(slug)) {
      continue
    }

    projectInstalledSkill(join(skillsRoot, slug), skill)
    projectedSlugs.add(slug)
  }

  return projectionRoot
}

function scriptPath(name: string) {
  const bundledNodeModules = process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim()
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

function toProcessEnv(env: Record<string, string>): AcpMcpKeyValue[] {
  return Object.entries(env).map(([name, value]) => ({ name, value }))
}

function serializeSkillFile(
  file: ReturnType<typeof readInstalledSkillFiles>[number]
) {
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
      ...expertSkills.map(buildExpertSkillEntry),
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
      ASTRAFLOW_SKILLS_MCP_REVISION: skillsRevision(skills, expertSkills),
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
    hostActionPolicy: "trusted_read_only",
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
          name: "ASTRAFLOW_SKILLS_MCP_REVISION",
          value: skillsRevision(skills, expertSkills),
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

function createHostSkillsMcpBridgeServer({
  environment,
  sessionId,
  skillSync,
}: {
  environment: "local" | "remote"
  sessionId: string
  skillSync?: StudioSkillSyncAdapter
}): AcpMcpBridgeServer | null {
  const workspace = getStudioSessionWorkspace(sessionId)
  const workspaceId = workspace?.id ?? null
  const runtime = createStudioSkillsRuntime({
    environment,
    sessionId,
    workspaceId,
    modelverseApiKey: isCompShareChannel()
      ? getStoredModelverseApiKey()
      : (getStudioModelverseApiKey()?.key ?? null),
    syncSkill: skillSync,
  })

  return runtime
    ? createAstraFlowToolMcpBridgeServer({
        name: SKILLS_MCP_SERVER_NAME,
        serverId: "astraflow:skills",
        tools: runtime.tools,
      })
    : null
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

function createStudioToolsMcpBridgeServer(
  sessionId: string,
  runtimeId: AgentRuntimeId
) {
  const session = getStudioSession(sessionId)
  const workspace = getStudioSessionWorkspace(sessionId)
  const selectedSession = getLatestStudioAcpSessionSelection(
    sessionId,
    runtimeId
  )
  const fallbackRoot = selectedSession?.cwd?.trim() || null

  if (!session) {
    throw new Error("AstraFlow host tools require an existing Studio session.")
  }

  if (!workspace && !fallbackRoot) {
    throw new Error("AstraFlow host tools require a bound Studio workspace.")
  }

  const toolWorkspace = workspace
    ? {
        id: workspace.id,
        rootPath: workspace.rootPath,
        type: workspace.type,
      }
    : {
        id: sessionId,
        rootPath: fallbackRoot as string,
        type: "local" as const,
      }
  const tools = createStudioAgentTools({
    sessionId,
    mobileChannelBound: Boolean(getMobileChannelBindingBySessionId(sessionId)),
    workspace: toolWorkspace,
    modelverseApiKey: isCompShareChannel()
      ? getStoredModelverseApiKey()
      : (getStudioModelverseApiKey()?.key ?? null),
    permissionMode: session.permissionMode,
    sandboxServiceFullAccessAvailable: () => {
      const liveSession = getStudioSession(sessionId)

      return (
        liveSession?.permissionMode === "full_access" &&
        liveSession.workspaceId === workspace?.id
      )
    },
  })

  return createAstraFlowToolMcpBridgeServer({ tools })
}

function createEnvironmentToolsMcpBridgeServer() {
  return createAstraFlowToolMcpBridgeServer({
    name: ENVIRONMENT_MCP_SERVER_NAME,
    serverId: ENVIRONMENT_MCP_SERVER_ID,
    tools: createEnvironmentRuntimeTools(),
  })
}

function listAcpMcpServers({
  environment,
  includeSkillsMcp,
  runtimeId,
  sessionId,
  skills,
  expertSkills,
  skillSync,
}: {
  environment: "local" | "remote"
  includeSkillsMcp: boolean
  runtimeId: AgentRuntimeId
  sessionId: string
  skills: ReturnType<typeof listStudioInstalledSkills>
  expertSkills: ExpertDeclaredSkill[]
  skillSync?: StudioSkillSyncAdapter
}) {
  const studioMcpServers = listStudioMcpServers({
    enabledOnly: true,
    includeSecrets: true,
  })
  const studioMcpBridgeServers = [
    ...(environment === "local"
      ? [createEnvironmentToolsMcpBridgeServer()]
      : []),
    createStudioToolsMcpBridgeServer(sessionId, runtimeId),
    ...studioMcpServers.map(createBridgeMcpServer),
  ]
  // A remote ACP agent cannot spawn Desktop's process.execPath or read its
  // manifest path. Remote sessions must use the ACP host bridge so the Skills
  // service executes on Desktop and only sandbox file sync crosses the remote
  // boundary.
  const skillsMcpServer =
    includeSkillsMcp && environment === "local"
      ? createSkillsMcpServer(sessionId, skills, expertSkills)
      : null
  const skillsMcpBridgeServer = includeSkillsMcp
    ? (createHostSkillsMcpBridgeServer({
        environment,
        sessionId,
        skillSync,
      }) ??
      (environment === "local"
        ? createSkillsMcpBridgeServer(sessionId, skills, expertSkills)
        : null))
    : null

  return {
    hasSkillsMcpServer: Boolean(skillsMcpServer || skillsMcpBridgeServer),
    mcpBridgeServers: skillsMcpBridgeServer
      ? [skillsMcpBridgeServer, ...studioMcpBridgeServers]
      : studioMcpBridgeServers,
    // User-installed MCP credentials and process environments remain owned by
    // Desktop. They are never serialized into ACP session parameters. Agents
    // that advertise the ACP MCP bridge use `mcpBridgeServers`; agents without
    // that capability fail closed and receive only this secret-free internal
    // Skills compatibility server when applicable.
    mcpServers: skillsMcpServer ? [skillsMcpServer] : [],
  }
}

export function createStudioAcpSessionPlugins({
  environment,
  runtimeId,
  sessionId,
  skillSync,
}: {
  environment: "local" | "remote"
  runtimeId: AgentRuntimeId
  sessionId: string
  skillSync?: StudioSkillSyncAdapter
}): AcpSessionPlugins {
  const skills = listStudioInstalledSkills({ enabledOnly: true })
  const expertSnapshot = getStudioSessionExpert(sessionId)?.snapshot ?? null
  const expertSkills = listExpertDeclaredSkillsFromSnapshot(expertSnapshot)
  const enabledMcpServers = listStudioMcpServers({ enabledOnly: true })
  const availableMcpServerNames = enabledMcpServers
    .flatMap((server) => [server.id, server.name, server.title])
    .filter((value): value is string => Boolean(value?.trim()))
  const useNativeAgentSkills =
    (runtimeId === "astraflow" || runtimeId === "codex") &&
    environment === "local" &&
    Boolean(skills.length || expertSkills.length)
  const nativeSkillsRoot = useNativeAgentSkills
    ? prepareNativeAgentSkills({ expertSkills, sessionId, skills })
    : null
  const { hasSkillsMcpServer, mcpBridgeServers, mcpServers } =
    listAcpMcpServers({
      environment,
      includeSkillsMcp: runtimeId !== "codex" || !useNativeAgentSkills,
      runtimeId,
      sessionId,
      skills,
      expertSkills,
      skillSync,
    })
  const codexSkillsFallback =
    runtimeId === "codex" && useNativeAgentSkills
      ? createSkillsMcpServer(sessionId, skills, expertSkills)
      : null
  const promptPreamble = [
    createAvailableSessionFilesManifest(sessionId) || null,
    runtimeId === "astraflow"
      ? createExpertRuntimeSystemPrompt(expertSnapshot, {
          availableMcpServers: availableMcpServerNames,
        })
      : null,
    useNativeAgentSkills
      ? [
          `AstraFlow Skills are registered through the ${runtimeId === "codex" ? "Codex" : "Pi coding-agent SDK"} native skill system. Activate the matching native skill and use the exact SKILL.md path supplied by the runtime for referenced scripts and files.`,
          "Do not import a Python module named `astraflow_skills`, guess a bundled-skill path, or search the filesystem for skill scripts. On an older runtime that cannot expose native skill roots, use the astraflow_skills compatibility tools instead.",
        ].join("\n")
      : null,
    hasSkillsMcpServer && !useNativeAgentSkills
      ? [
          summarizeInstalledSkillsForPrompt(skills, {
            sandboxPreparation: false,
          }),
          summarizeExpertDeclaredSkillsForPrompt(expertSkills),
          "AstraFlow Skills are exposed to Sandbox and external ACP Agents through the astraflow_skills MCP server. Use list_installed_skills to inspect the catalog, load_skill before following a skill, read_skill_file when the loaded skill references bundled files, and prepare_skill_sandbox before executing a bundled script.",
        ].join("\n\n")
      : null,
    AGENT_CONDUCT_RULES.join("\n"),
    environment === "local"
      ? "If python, pip, node, npm, or npx is unavailable, use the astraflow_environment MCP tools to inspect, install, and health-check the managed runtime. Do not ask the user to install a system runtime before trying the managed environment installer."
      : null,
    "The text immediately following this line is the active user request. Treat it as actionable user input:\n",
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    additionalDirectories: nativeSkillsRoot ? [nativeSkillsRoot] : [],
    fallbackMcpServers: codexSkillsFallback ? [codexSkillsFallback] : [],
    mcpBridgeServers,
    mcpServers,
    promptPreamble,
  }
}
