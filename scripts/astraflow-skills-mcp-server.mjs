import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { readFileSync } from "node:fs"

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
        "Load a full AstraFlow Skill by slug. Returns the full SKILL.md and file list. Call this before using any available skill.",
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
    const file = skill?.files?.find((candidate) => candidate.path === path)

    let text = `Skill file "${slug}/${path}" is not available.`

    if (file?.binary) {
      text = `Skill file "${slug}/${path}" is binary or larger than the text limit (${file.size} bytes).`
    } else if (typeof file?.text === "string") {
      text = file.text
    }

    return {
      content: [{ type: "text", text }],
    }
  }

  throw new Error(`Unknown tool: ${name}`)
})

await server.connect(new StdioServerTransport())
