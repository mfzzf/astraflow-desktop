import { existsSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

export const AGENT_RUNTIME_DOWNLOAD_BASE_URL =
  "https://astraflow-desktop.cn-sh2.ufileos.com/agent-runtimes/v1"

const nativePackageLayouts = {
  "darwin-arm64": {
    codexPackage: "@openai/codex-darwin-arm64",
    codexExecutable: "vendor/aarch64-apple-darwin/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    claudeExecutable: "claude",
  },
  "darwin-x64": {
    codexPackage: "@openai/codex-darwin-x64",
    codexExecutable: "vendor/x86_64-apple-darwin/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-darwin-x64",
    claudeExecutable: "claude",
  },
  "linux-arm64": {
    codexPackage: "@openai/codex-linux-arm64",
    codexExecutable: "vendor/aarch64-unknown-linux-musl/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-linux-arm64",
    claudeExecutable: "claude",
  },
  "linux-x64": {
    codexPackage: "@openai/codex-linux-x64",
    codexExecutable: "vendor/x86_64-unknown-linux-musl/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-linux-x64",
    claudeExecutable: "claude",
  },
  "win32-arm64": {
    codexPackage: "@openai/codex-win32-arm64",
    codexExecutable: "vendor/aarch64-pc-windows-msvc/bin/codex.exe",
    claudePackage: "@anthropic-ai/claude-agent-sdk-win32-arm64",
    claudeExecutable: "claude.exe",
  },
  "win32-x64": {
    codexPackage: "@openai/codex-win32-x64",
    codexExecutable: "vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    claudePackage: "@anthropic-ai/claude-agent-sdk-win32-x64",
    claudeExecutable: "claude.exe",
  },
}

function packagePath(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

function readPackageVersion(nodeModulesDir, packageName) {
  const packageJsonPath = join(
    packagePath(nodeModulesDir, packageName),
    "package.json"
  )
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error(`Package ${packageName} does not declare a version.`)
  }

  return packageJson.version.trim()
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/")
}

export function getAgentRuntimePackageSpecs({
  appRoot,
  nodeModulesDir,
  runtimeTarget,
}) {
  const layout = nativePackageLayouts[runtimeTarget]

  if (!layout) {
    throw new Error(
      `No downloadable agent runtime layout is defined for ${runtimeTarget}.`
    )
  }

  const definitions = [
    {
      id: "codex",
      label: "Codex",
      versionPackage: "@openai/codex",
      packageName: layout.codexPackage,
      executable: layout.codexExecutable,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      versionPackage: "@anthropic-ai/claude-agent-sdk",
      packageName: layout.claudePackage,
      executable: layout.claudeExecutable,
    },
    {
      id: "opencode",
      label: "OpenCode",
      versionPackage: "opencode-ai",
      packageName: "opencode-ai",
      executable: "bin/opencode.exe",
    },
  ]

  return definitions.map((definition) => {
    const runtimePackagePath = packagePath(
      nodeModulesDir,
      definition.packageName
    )
    const executablePath = join(runtimePackagePath, definition.executable)

    if (!existsSync(executablePath)) {
      throw new Error(
        `Missing ${definition.label} runtime executable: ${executablePath}`
      )
    }

    return {
      id: definition.id,
      label: definition.label,
      version: readPackageVersion(nodeModulesDir, definition.versionPackage),
      packageName: definition.packageName,
      packagePath: runtimePackagePath,
      packageRelativePath: portableRelative(appRoot, runtimePackagePath),
      executablePath,
      executableRelativePath: portableRelative(appRoot, executablePath),
    }
  })
}

export function createAgentRuntimeCatalog(options) {
  const specs = getAgentRuntimePackageSpecs(options)

  return {
    schemaVersion: 1,
    target: options.runtimeTarget,
    downloadBaseUrl: options.downloadBaseUrl ?? AGENT_RUNTIME_DOWNLOAD_BASE_URL,
    runtimes: Object.fromEntries(
      specs.map((spec) => [
        spec.id,
        {
          id: spec.id,
          label: spec.label,
          version: spec.version,
          executableRelativePath: spec.executableRelativePath,
        },
      ])
    ),
  }
}
