import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"

import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"

import {
  ASTRAFLOW_PI_PACKAGES,
  ASTRAFLOW_PI_PROMPT_COMMANDS,
  getAstraFlowPiRuntimeCommands,
  getAstraFlowPiSubagentInstructions,
  inspectAstraFlowPiPackages,
  resolveAstraFlowPiPackageResources,
} from "@/lib/agent/pi-packages"

const expectedPackages = new Map([
  ["pi-subagents", "0.34.0"],
])

describe("AstraFlow Pi packages", () => {
  test("pins and resolves all requested packages at their exact versions", () => {
    assert.deepEqual(
      new Map(ASTRAFLOW_PI_PACKAGES.map(({ name, version }) => [name, version])),
      expectedPackages
    )

    for (const pkg of inspectAstraFlowPiPackages()) {
      assert.equal(pkg.installed, true, `${pkg.name} ${pkg.version} is missing`)
      assert.equal(pkg.version, expectedPackages.get(pkg.name))
    }
  })

  test("resolves package resources without dynamic module imports", async () => {
    const source = await readFile(
      join(process.cwd(), "lib", "agent", "pi-packages.ts"),
      "utf8"
    )

    assert.doesNotMatch(source, /require\.resolve|createRequire/)
    assert.match(source, /ASTRAFLOW_BUNDLED_NODE_MODULES/)
    assert.match(source, /process\.cwd\(\), "node_modules"/)
  })

  test("keeps the Pi SDK outside Turbopack server bundles", async () => {
    const nextConfig = await readFile(
      join(process.cwd(), "next.config.ts"),
      "utf8"
    )

    for (const packageName of [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ]) {
      assert.match(
        nextConfig,
        new RegExp(`serverExternalPackages:[\\s\\S]*"${packageName}"`)
      )
    }
  })

  test("loads only the selected native Pi skills and prompt templates", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "astraflow-pi-packages-"))
    const resources = resolveAstraFlowPiPackageResources()
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, "agent"),
      settingsManager: SettingsManager.inMemory(
        {},
        { projectTrusted: true }
      ),
      additionalSkillPaths: resources.skillPaths,
      additionalPromptTemplatePaths: resources.promptTemplatePaths,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    })

    try {
      await loader.reload()

      assert.deepEqual(
        loader
          .getSkills()
          .skills.map(({ name }) => name)
          .sort(),
        ["pi-subagents"]
      )
      assert.deepEqual(
        loader
          .getPrompts()
          .prompts.map(({ name }) => name)
          .sort(),
        ASTRAFLOW_PI_PROMPT_COMMANDS.map(({ name }) => name).sort()
      )
      assert.deepEqual(
        getAstraFlowPiRuntimeCommands().map(({ name }) => name),
        [
          ...ASTRAFLOW_PI_PROMPT_COMMANDS.map(({ name }) => name),
          "skill:pi-subagents",
        ]
      )
      assert.match(
        getAstraFlowPiSubagentInstructions("reviewer") ?? "",
        /disciplined review subagent/
      )
      assert.equal(getAstraFlowPiSubagentInstructions("unknown"), null)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test("copies every activated Pi package into Electron", async () => {
    const packagingScript = await readFile(
      join(process.cwd(), "scripts", "prepare-electron-app.mjs"),
      "utf8"
    )

    for (const packageName of expectedPackages.keys()) {
      assert.match(
        packagingScript,
        new RegExp(`["']${packageName.replace("/", "\\/")}["']`)
      )
    }
    assert.doesNotMatch(packagingScript, /@hypabolic\/pi-hypa/)
    assert.doesNotMatch(packagingScript, /pi-web-access/)
    assert.doesNotMatch(packagingScript, /pi-mcp-adapter/)
    assert.doesNotMatch(packagingScript, /context-mode/)
  })
})
