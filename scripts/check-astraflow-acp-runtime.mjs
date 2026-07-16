import { readdirSync, readFileSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = (path) => readFileSync(resolve(root, path), "utf8")
const readJson = (path) => JSON.parse(read(path))
const runtimePackage = readJson("runtime/astraflow-acp/package.json")
const runtimeLock = readJson("runtime/astraflow-acp/package-lock.json")
const documentRuntimePackage = readJson("runtime/node-document-runtime/package.json")
const documentRuntimeLock = readJson("runtime/node-document-runtime/package-lock.json")
const rootPackage = readJson("package.json")
const runtimeVersion = runtimePackage.version
const piDependencies = {
  "@earendil-works/pi-agent-core": "0.80.7",
  "@earendil-works/pi-ai": "0.80.7",
  "@earendil-works/pi-coding-agent": "0.80.7",
}
const versionFiles = [
  ["runtime/astraflow-acp/src/constants.mjs", /ASTRAFLOW_ACP_RUNTIME_VERSION\s*=\s*"([^"]+)"/],
  ["lib/agent/astraflow-acp-config.ts", /ASTRAFLOW_ACP_RUNTIME_VERSION\s*=\s*"([^"]+)"/],
  ["runtime/workspace-gateway/src/agent-manager.mjs", /astraflow:\s*\{[\s\S]*?version:\s*"([^"]+)"/],
]

for (const [path, pattern] of versionFiles) {
  const match = read(path).match(pattern)

  if (match?.[1] !== runtimeVersion) {
    throw new Error(
      `${path} AstraFlow ACP version ${match?.[1] || "missing"} does not match package version ${runtimeVersion}.`
    )
  }
}

if (runtimeLock.packages?.[""]?.version !== runtimeVersion) {
  throw new Error("AstraFlow ACP package-lock version is stale.")
}

const template = read("sandbox_template/code/template.py")

for (const required of [
  'Path("runtime") / "astraflow-acp"',
  'Path("runtime") / "node-document-runtime"',
  "/opt/astraflow/astraflow-acp",
  "/opt/astraflow/node-document-runtime",
  `ASTRAFLOW_ACP_RUNTIME_VERSION !== '${runtimeVersion}'`,
]) {
  if (!template.includes(required)) {
    throw new Error(`Sandbox template is missing AstraFlow ACP marker: ${required}`)
  }
}

function readTree(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = `${path}/${entry.name}`
      return entry.isDirectory() ? readTree(entryPath) : [read(entryPath)]
    })
    .join("\n")
}

const bundledRuntime = [
  JSON.stringify(runtimePackage),
  JSON.stringify(runtimeLock),
  readTree("runtime/astraflow-acp/src"),
  template,
].join("\n")

const forbiddenRuntimeFragments = [
  ["deep", "agents"],
  ["lang", "chain"],
  ["lang", "graph"],
  ["lang", "smith"],
].map((parts) => parts.join(""))

for (const forbidden of forbiddenRuntimeFragments) {
  if (bundledRuntime.toLowerCase().includes(forbidden)) {
    throw new Error(
      `AstraFlow ACP and its Sandbox template must not bundle ${forbidden}.`
    )
  }
}

const ignoredRepositoryDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "agents",
  "coverage",
  "dist",
  "node_modules",
])
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mdx",
  ".mjs",
  ".patch",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
])
const textFileNames = new Set(["Dockerfile", "Makefile", "bun.lock"])

function assertNoRetiredRuntimeReferences(path = root) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredRepositoryDirectories.has(entry.name)) {
      continue
    }

    const entryPath = resolve(path, entry.name)
    const repositoryPath = relative(root, entryPath)
    const normalizedPath = repositoryPath.toLowerCase()

    if (
      entry.isDirectory() &&
      normalizedPath === ".claude/worktrees"
    ) {
      continue
    }

    for (const forbidden of forbiddenRuntimeFragments) {
      if (normalizedPath.includes(forbidden)) {
        throw new Error(`Retired Agent runtime reference remains in path: ${repositoryPath}`)
      }
    }

    if (entry.isDirectory()) {
      assertNoRetiredRuntimeReferences(entryPath)
      continue
    }

    if (
      !textExtensions.has(extname(entry.name).toLowerCase()) &&
      !textFileNames.has(entry.name) &&
      !entry.name.endsWith(".example")
    ) {
      continue
    }

    const contents = readFileSync(entryPath, "utf8").toLowerCase()
    for (const forbidden of forbiddenRuntimeFragments) {
      if (contents.includes(forbidden)) {
        throw new Error(`Retired Agent runtime reference remains in: ${repositoryPath}`)
      }
    }
  }
}

assertNoRetiredRuntimeReferences()

for (const [dependency, version] of Object.entries(piDependencies)) {
  const desktop = rootPackage.dependencies?.[dependency]
  const sandbox = runtimePackage.dependencies?.[dependency]
  const locked = runtimeLock.packages?.[`node_modules/${dependency}`]?.version

  if (desktop !== version || sandbox !== version || locked !== version) {
    throw new Error(
      `${dependency} must be pinned to ${version} in Desktop and astraflow-acp (Desktop: ${desktop || "missing"}; astraflow-acp: ${sandbox || "missing"}; lock: ${locked || "missing"}).`
    )
  }
}

if (runtimePackage.engines?.node !== ">=22.19.0") {
  throw new Error("AstraFlow ACP must require Node.js >=22.19.0 for Pi Agent.")
}

const codeboxRuntime = read("lib/codebox-runtime.ts")
const remoteWorkspaceRuntime = read("lib/studio-remote-workspace.ts")
const astraflowRuntimeAdapter = read(
  "lib/agent/adapters/astraflow-runtime.ts"
)
const astraflowRuntimeConfig = read("lib/agent/astraflow-acp-config.ts")

for (const required of [
  "envs.MODELVERSE_API_KEY",
  "envs.OPENAI_API_KEY",
  "envs.ANTHROPIC_AUTH_TOKEN",
  '"/root/.claude/settings.json"',
  '"/root/.codex/auth.json"',
  '"/root/.codex/config.toml"',
  '"/root/.config/opencode/opencode.json"',
]) {
  if (!codeboxRuntime.includes(required)) {
    throw new Error(
      `CodeBox must persist Modelverse credentials in the Sandbox: ${required}`
    )
  }
}

for (const [path, contents] of [
  ["lib/codebox-runtime.ts", codeboxRuntime],
  ["lib/studio-remote-workspace.ts", remoteWorkspaceRuntime],
  ["lib/agent/adapters/astraflow-runtime.ts", astraflowRuntimeAdapter],
  ["lib/agent/astraflow-acp-config.ts", astraflowRuntimeConfig],
]) {
  for (const forbidden of [
    "expectedRuntimeVersion",
    "Desktop requires",
    "runtime.version !==",
  ]) {
    if (contents.includes(forbidden)) {
      throw new Error(
        `${path} must use protocol and capability compatibility instead of exact AstraFlow runtime version checks: ${forbidden}`
      )
    }
  }
}

if (documentRuntimeLock.packages?.[""]?.version !== documentRuntimePackage.version) {
  throw new Error("Node document runtime package-lock version is stale.")
}

for (const dependency of ["pptxgenjs", "react", "react-dom", "react-icons", "sharp"]) {
  const desktop = rootPackage.dependencies?.[dependency]
  const sandbox = documentRuntimePackage.dependencies?.[dependency]

  if (desktop !== sandbox) {
    throw new Error(
      `${dependency} must match between Desktop (${desktop || "missing"}) and the Node document runtime (${sandbox || "missing"}).`
    )
  }
}

const pinnedDependencies = [
  "@agentclientprotocol/sdk",
  ...Object.keys(piDependencies),
]

for (const dependency of pinnedDependencies) {
  const desktop = rootPackage.dependencies?.[dependency]
  const sandbox = runtimePackage.dependencies?.[dependency]

  if (desktop !== sandbox) {
    throw new Error(
      `${dependency} must match between Desktop (${desktop || "missing"}) and astraflow-acp (${sandbox || "missing"}).`
    )
  }
}

console.log(`astraflow-acp ${runtimeVersion} manifest and template are aligned`)
