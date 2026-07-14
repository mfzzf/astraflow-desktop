import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, "..")
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
)
const workspaceGatewayPackageJson = JSON.parse(
  readFileSync(
    resolve(root, "runtime", "workspace-gateway", "package.json"),
    "utf8"
  )
)
const runtimePackages = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "@agentclientprotocol/sdk",
  "@anthropic-ai/claude-agent-sdk",
  "@openai/codex",
  "opencode-ai",
]
const claudeSdkVersion =
  packageJson.dependencies?.["@anthropic-ai/claude-agent-sdk"]
const claudeSdkOverrides = [
  {
    label: "Desktop",
    version: packageJson.overrides?.["@anthropic-ai/claude-agent-sdk"],
  },
  {
    label: "Sandbox template",
    version:
      workspaceGatewayPackageJson.overrides?.[
        "@anthropic-ai/claude-agent-sdk"
      ],
  },
]

for (const override of claudeSdkOverrides) {
  if (!claudeSdkVersion || override.version !== claudeSdkVersion) {
    throw new Error(
      `${override.label} must override @anthropic-ai/claude-agent-sdk to the direct SDK version ${claudeSdkVersion ?? "missing"}; received ${override.version ?? "missing"}.`
    )
  }
}

async function readLatestVersion(packageName) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    { signal: AbortSignal.timeout(15_000) }
  )

  if (!response.ok) {
    throw new Error(
      `npm registry returned HTTP ${response.status} for ${packageName}.`
    )
  }

  const metadata = await response.json()

  if (typeof metadata.version !== "string" || !metadata.version) {
    throw new Error(`npm registry returned no version for ${packageName}.`)
  }

  return metadata.version
}

const installedVersions = Object.fromEntries(
  runtimePackages.map((packageName) => [
    packageName,
    packageJson.dependencies?.[packageName],
  ])
)
const templateVersionMismatches = runtimePackages.flatMap((packageName) => {
  const desktopVersion = installedVersions[packageName]
  const templateVersion =
    workspaceGatewayPackageJson.dependencies?.[packageName]

  return desktopVersion === templateVersion
    ? []
    : [{ packageName, desktopVersion, templateVersion }]
})

if (templateVersionMismatches.length > 0) {
  for (const mismatch of templateVersionMismatches) {
    console.error(
      `mismatch ${mismatch.packageName}: Desktop ${mismatch.desktopVersion ?? "missing"}, Sandbox template ${mismatch.templateVersion ?? "missing"}`
    )
  }

  throw new Error(
    "Sandbox template Agent runtime packages must match the Desktop package versions."
  )
}

const latestVersions = await Promise.all(runtimePackages.map(readLatestVersion))
const outdated = []

for (const [index, packageName] of runtimePackages.entries()) {
  const installed = installedVersions[packageName]
  const latest = latestVersions[index]
  const current = installed === latest

  console.log(
    `${current ? "current" : "outdated"} ${packageName}: ${installed ?? "missing"} (latest ${latest})`
  )

  if (!current) {
    outdated.push({ packageName, installed, latest })
  }
}

if (outdated.length > 0) {
  console.error(
    "Agent runtime updates are available. Upgrade the pinned packages, regenerate the Codex app-server types, and run validation."
  )
  process.exitCode = 1
}
