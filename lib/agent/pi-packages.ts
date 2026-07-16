import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"

export type AstraFlowPiPackageActivation =
  | "native-resource"
  | "astraflow-bridge"
  | "installed"

export type AstraFlowPiPackageSpec = {
  activation: AstraFlowPiPackageActivation
  name: string
  version: string
  reason: string
}

export const ASTRAFLOW_PI_PACKAGES = [
  {
    name: "@hypabolic/pi-hypa",
    version: "0.1.11",
    activation: "installed",
    reason:
      "Installed and bundled. Its bash rewrite hook stays opt-in until original-command permission checks can be preserved.",
  },
  {
    name: "pi-web-access",
    version: "0.13.0",
    activation: "installed",
    reason:
      "Installed and bundled. Its extension stays opt-in until fetch, clone, video, and local-file access all pass AstraFlow's permission gateway.",
  },
  {
    name: "pi-mcp-adapter",
    version: "2.11.0",
    activation: "installed",
    reason:
      "Installed and bundled. AstraFlow keeps its permission-aware MCP bridge to avoid duplicate unguarded tools.",
  },
  {
    name: "context-mode",
    version: "1.0.169",
    activation: "installed",
    reason:
      "Installed and bundled. Its MCP tools remain opt-in because the package skill requires the matching context-mode server.",
  },
  {
    name: "pi-subagents",
    version: "0.34.0",
    activation: "astraflow-bridge",
    reason:
      "AstraFlow exposes permission-aware subagents and loads the package's reusable prompt workflows.",
  },
  {
    name: "pi-workspace-history",
    version: "0.2.2",
    activation: "astraflow-bridge",
    reason:
      "AstraFlow uses a Studio-aware shadow-history bridge so file restoration and visible messages stay in sync.",
  },
] as const satisfies readonly AstraFlowPiPackageSpec[]

type AstraFlowPiPackageName =
  (typeof ASTRAFLOW_PI_PACKAGES)[number]["name"]

const PI_SUBAGENT_PROFILE_NAMES = new Set([
  "context-builder",
  "delegate",
  "oracle",
  "planner",
  "researcher",
  "reviewer",
  "scout",
  "worker",
])

export function getAstraFlowPiSubagentProfiles() {
  return [...PI_SUBAGENT_PROFILE_NAMES]
}

function getBundledNodeModulesRoot() {
  const configured = process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim()

  return configured
    ? resolve(configured)
    : join(/* turbopackIgnore: true */ process.cwd(), "node_modules")
}

function findPackageRoot(packageName: AstraFlowPiPackageName) {
  const root = join(
    /* turbopackIgnore: true */
    getBundledNodeModulesRoot(),
    packageName
  )
  const packageJsonPath = join(root, "package.json")

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Unable to resolve Pi package root: ${packageName}`)
  }

  return root
}

export function resolveAstraFlowPiPackageResources() {
  const subagentsRoot = findPackageRoot("pi-subagents")

  return {
    skillPaths: [resolve(subagentsRoot, "skills", "pi-subagents")],
    promptTemplatePaths: [resolve(subagentsRoot, "prompts")],
  }
}

export function getAstraFlowPiSubagentInstructions(agentName: string) {
  const normalizedName = agentName.trim().toLowerCase()
  if (!PI_SUBAGENT_PROFILE_NAMES.has(normalizedName)) {
    return null
  }

  const profilePath = join(
    findPackageRoot("pi-subagents"),
    "agents",
    `${normalizedName}.md`
  )
  const content = readFileSync(profilePath, "utf8")
  const frontmatterEnd = content.startsWith("---\n")
    ? content.indexOf("\n---\n", 4)
    : -1

  return (frontmatterEnd >= 0
    ? content.slice(frontmatterEnd + "\n---\n".length)
    : content
  ).trim()
}

export function inspectAstraFlowPiPackages() {
  return ASTRAFLOW_PI_PACKAGES.map((spec) => {
    const root = findPackageRoot(spec.name)
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8")
    ) as {
      name?: unknown
      version?: unknown
      pi?: {
        extensions?: unknown[]
        prompts?: unknown[]
        skills?: unknown[]
        themes?: unknown[]
      }
    }

    return {
      ...spec,
      installed:
        manifest.name === spec.name && manifest.version === spec.version,
      resources: {
        extensions: manifest.pi?.extensions?.length ?? 0,
        prompts: manifest.pi?.prompts?.length ?? 0,
        skills: manifest.pi?.skills?.length ?? 0,
        themes: manifest.pi?.themes?.length ?? 0,
      },
      root,
    }
  })
}

export const ASTRAFLOW_PI_PROMPT_COMMANDS = [
  {
    name: "parallel-review",
    description: "Run parallel Pi subagent reviewers, then synthesize findings.",
  },
  {
    name: "review-loop",
    description: "Run a bounded Pi subagent review and fix loop.",
  },
  {
    name: "parallel-research",
    description: "Research external evidence and local code in parallel.",
  },
  {
    name: "parallel-context-build",
    description: "Build implementation context with parallel subagents.",
  },
  {
    name: "parallel-handoff-plan",
    description: "Create a researched implementation handoff plan.",
  },
  {
    name: "gather-context-and-clarify",
    description: "Gather context before asking focused clarifying questions.",
  },
  {
    name: "parallel-cleanup",
    description: "Run parallel cleanup reviewers against the current work.",
  },
] as const

export const ASTRAFLOW_PI_SKILL_COMMANDS = [
  {
    name: "skill:pi-subagents",
    description:
      "Load Pi Subagents orchestration guidance for delegated workflows.",
  },
] as const

export function getAstraFlowPiRuntimeCommands(): SlashCommandDescriptor[] {
  return [
    ...ASTRAFLOW_PI_PROMPT_COMMANDS,
    ...ASTRAFLOW_PI_SKILL_COMMANDS,
  ].map((command) => ({
    ...command,
    source: "runtime",
    runtimeId: "astraflow",
  }))
}
