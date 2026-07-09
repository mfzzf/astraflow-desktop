import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { readFileSync, statSync } from "node:fs"
import { posix, relative, resolve, sep } from "node:path"

const MAX_SKILL_FILE_TEXT_BYTES = 256 * 1024

function loadManifest() {
  const manifestPath = process.env.ASTRAFLOW_SKILLS_MCP_MANIFEST

  if (!manifestPath) {
    throw new Error("ASTRAFLOW_SKILLS_MCP_MANIFEST is not configured.")
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"))

  return {
    listText:
      typeof parsed.listText === "string"
        ? parsed.listText
        : "No AstraFlow skills are currently enabled.",
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
  }
}

const manifest = loadManifest()
const server = new Server(
  {
    name: "astraflow-skills",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

function normalizeSkillFilePath(path) {
  if (
    typeof path !== "string" ||
    !path.trim() ||
    path.includes("\0")
  ) {
    return null
  }

  const unixPath = path.replaceAll("\\", "/")

  if (posix.isAbsolute(unixPath) || /^[A-Za-z]:/.test(unixPath)) {
    return null
  }

  const normalized = posix.normalize(unixPath).replace(/^(\.\/)+/, "")
  const parts = normalized.split("/")

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    parts.includes("..")
  ) {
    return null
  }

  return normalized
}

function resolveSkillFilePath(rootPath, path) {
  const normalizedPath = normalizeSkillFilePath(path)

  if (
    typeof rootPath !== "string" ||
    !rootPath.trim() ||
    !normalizedPath
  ) {
    return null
  }

  const root = resolve(rootPath)
  const target = resolve(root, normalizedPath)
  const relativePath = relative(root, target)

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.split(sep).includes("..")
  ) {
    return null
  }

  return target
}

function readSkillFileText(skill, file, path) {
  if (file?.binary) {
    return `Skill file "${skill.slug}/${path}" is binary or larger than the text limit (${file.size} bytes).`
  }

  if (typeof file?.text === "string") {
    return file.text
  }

  const target = resolveSkillFilePath(skill.rootPath, path)

  if (!target) {
    return `Skill file "${skill.slug}/${path}" is not available.`
  }

  const stat = statSync(target)

  if (!stat.isFile()) {
    return `Skill file "${skill.slug}/${path}" is not available.`
  }

  if (stat.size > MAX_SKILL_FILE_TEXT_BYTES) {
    return `Skill file "${skill.slug}/${path}" is larger than the text limit (${stat.size} bytes).`
  }

  const buffer = readFileSync(target)

  if (buffer.includes(0)) {
    return `Skill file "${skill.slug}/${path}" is binary or larger than the text limit (${stat.size} bytes).`
  }

  return buffer.toString("utf8")
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_installed_skills",
      description:
        "List AstraFlow Skills available in this chat, including globally enabled skills and selected expert skills. Use this when choosing which skill to load.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "load_skill",
      description:
        "Load a full AstraFlow Skill by slug. Returns the full SKILL.md and file list. Call this before using any available skill, then use read_skill_file for bundled supporting files.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The AstraFlow Skill slug to load.",
          },
        },
        required: ["slug"],
        additionalProperties: false,
      },
    },
    {
      name: "read_skill_file",
      description:
        "Read a bundled file from an installed AstraFlow Skill after loading it. Use this when SKILL.md references local supporting files.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The AstraFlow Skill slug.",
          },
          path: {
            type: "string",
            description: "The skill-relative file path.",
          },
        },
        required: ["slug", "path"],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name

  if (name === "list_installed_skills") {
    return {
      content: [{ type: "text", text: manifest.listText }],
    }
  }

  if (name === "load_skill") {
    const args = request.params.arguments ?? {}
    const slug =
      typeof args.slug === "string" ? args.slug.trim() : String(args.slug ?? "")
    const skill = manifest.skills.find((candidate) => candidate.slug === slug)

    return {
      content: [
        {
          type: "text",
          text:
            skill && typeof skill.content === "string"
              ? skill.content
              : `Skill "${slug}" is not installed or is disabled.`,
        },
      ],
    }
  }

  if (name === "read_skill_file") {
    const args = request.params.arguments ?? {}
    const slug =
      typeof args.slug === "string" ? args.slug.trim() : String(args.slug ?? "")
    const path =
      typeof args.path === "string" ? args.path.trim() : String(args.path ?? "")
    const skill = manifest.skills.find((candidate) => candidate.slug === slug)
    const normalizedPath = normalizeSkillFilePath(path) ?? path
    const file = skill?.files?.find(
      (candidate) => candidate.path === normalizedPath
    )

    let text = `Skill file "${slug}/${normalizedPath}" is not available.`

    if (skill && file) {
      try {
        text = readSkillFileText(skill, file, normalizedPath)
      } catch (error) {
        text = `Skill file "${slug}/${normalizedPath}" could not be read: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    }

    return {
      content: [{ type: "text", text }],
    }
  }

  throw new Error(`Unknown tool: ${name}`)
})

await server.connect(new StdioServerTransport())
