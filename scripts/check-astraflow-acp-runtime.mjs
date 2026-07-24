import { readdirSync, readFileSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = (path) => readFileSync(resolve(root, path), "utf8")
const readJson = (path) => JSON.parse(read(path))
const runtimePackage = readJson("runtime/astraflow-acp/package.json")
const runtimeLock = readJson("runtime/astraflow-acp/package-lock.json")
const hostToolsManifest = readJson(
  "runtime/astraflow-acp/host-tools-manifest.json"
)
const documentRuntimePackage = readJson("runtime/node-document-runtime/package.json")
const documentRuntimeLock = readJson("runtime/node-document-runtime/package-lock.json")
const rootPackage = readJson("package.json")
const electronPreparation = read("scripts/prepare-electron-app.mjs")
const electronPackageSmoke = read("scripts/smoke-electron-package.mjs")
const electronPackageWorkflow = read(".github/workflows/electron-package.yml")
const localRuntimeSmoke = read(
  "scripts/smoke-astraflow-acp-local-live.mjs"
)
const sandboxRuntimeSmoke = read("scripts/smoke-astraflow-acp-sandbox.mjs")
const runtimeVersion = runtimePackage.version
const piDependencies = {
  "@earendil-works/pi-agent-core": "0.80.7",
  "@earendil-works/pi-ai": "0.80.7",
  "@earendil-works/pi-coding-agent": "0.80.7",
}
const exactRuntimeDependencies = {
  ...piDependencies,
  "@modelcontextprotocol/sdk": "1.29.0",
  "pi-subagents": "0.34.0",
  undici: "8.5.0",
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
  'ASTRAFLOW_ACP_SOURCE / "host-tools-manifest.json"',
  `ASTRAFLOW_ACP_RUNTIME_VERSION !== '${runtimeVersion}'`,
  "import('undici')",
  "bubblewrap build-essential",
  "ripgrep socat",
  "bwrap --version",
  "socat -V",
]) {
  if (!template.includes(required)) {
    throw new Error(`Sandbox template is missing AstraFlow ACP marker: ${required}`)
  }
}

for (const required of [
  'const sourceRoot = join(root, "runtime", "astraflow-acp")',
  'const targetRoot = join(appDir, "runtime", "astraflow-acp")',
  '"package.json"',
  '"package-lock.json"',
  '"package-lock.runtime.json"',
  '"host-tools-manifest.json"',
  '"src"',
  '"astraflow-skills-mcp-server.mjs"',
  'undici: readDependencyVersion(join(appDir, "node_modules"), "undici")',
  "prepareAstraflowAcpRuntime()",
]) {
  if (!electronPreparation.includes(required)) {
    throw new Error(
      `Electron packaging must install the shared AstraFlow ACP runtime: ${required}`
    )
  }
}

if (
  electronPreparation.includes(
    '["ci", "--omit=dev", "--no-audit", "--no-fund"]'
  )
) {
  throw new Error(
    "Electron packaging must reuse the root production node_modules instead of duplicating AstraFlow ACP dependencies."
  )
}

for (const required of [
  'join(root, "runtime", "astraflow-acp")',
  "const packagedAstraflowAcpRoot = join(",
  "Packaged AstraFlow ACP source differs from the shared runtime",
  "Shared packaged AstraFlow ACP dependency is missing",
  "AstraFlow ACP dependencies must not be packaged twice",
  "Packaged AstraFlow ACP helper differs from the release source",
  "Packaged app must declare AstraFlow ACP dependency",
  "Packaged AstraFlow ACP dependency import smoke test",
  "import('undici')",
  "smokePackagedAstraflowAcp",
]) {
  if (!electronPackageSmoke.includes(required)) {
    throw new Error(
      `Electron package smoke must verify the shared AstraFlow ACP runtime: ${required}`
    )
  }
}

for (const required of [
  "sandbox-template:",
  "Build ${{ matrix.name }} Sandbox template",
  "CompShare Basic 2C4G",
  "template_name: astraflow-desktop-compshare-2c4g",
  'cpu_count: "2"',
  'memory_mb: "4096"',
  "CompShare Pro+ 8C8G",
  "template_name: astraflow-code-compshare-pro-8c8g",
  'cpu_count: "8"',
  'memory_mb: "8192"',
  "working-directory: sandbox_template/code",
  "python build_template.py",
  "UCLOUD_SANDBOX_API_KEY: ${{ secrets.UCLOUD_SANDBOX_API_KEY }}",
  "UCLOUD_SANDBOX_TEMPLATE_NAME: ${{ matrix.template_name }}",
  "UCLOUD_SANDBOX_TEMPLATE_CPU_COUNT: ${{ matrix.cpu_count }}",
  "UCLOUD_SANDBOX_TEMPLATE_MEMORY_MB: ${{ matrix.memory_mb }}",
  "      - sandbox-template",
]) {
  if (!electronPackageWorkflow.includes(required)) {
    throw new Error(
      `Electron release workflow must atomically build the shared Sandbox template: ${required}`
    )
  }
}

for (const required of [
  "host-tools-manifest.json",
  "HOST_TOOL_NAMES",
  "Call studio_generate_image exactly once",
  'callbacks.includes("mcp/tool:studio_generate_image")',
]) {
  if (!sandboxRuntimeSmoke.includes(required)) {
    throw new Error(
      `Sandbox smoke must verify the shared AstraFlow host tools: ${required}`
    )
  }
}

if (
  rootPackage.scripts?.["smoke:astraflow-acp-local-live"] !==
  "node scripts/smoke-astraflow-acp-local-live.mjs"
) {
  throw new Error(
    "package.json must expose the repeatable local AstraFlow ACP live smoke test."
  )
}

for (const required of [
  "../runtime/astraflow-acp/src/index.mjs",
  "ASTRAFLOW_MODELVERSE_API_KEY",
  "studio_generate_image",
  "tool_call_update",
  "assertCompletedToolRun",
  "before local task subagent",
  "methods.agent.session.resume",
  "ASTRAFLOW_LOCAL_RESUME_OK",
  "await rm(workspace",
  "await rm(stateRoot",
]) {
  if (!localRuntimeSmoke.includes(required)) {
    throw new Error(
      `Local AstraFlow ACP live smoke is missing coverage: ${required}`
    )
  }
}

if (
  hostToolsManifest.schemaVersion !== 1 ||
  hostToolsManifest.protocolVersion !== 4 ||
  hostToolsManifest.server?.name !== "astraflow_studio" ||
  hostToolsManifest.server?.serverId !== "astraflow:studio-tools"
) {
  throw new Error("AstraFlow host tool manifest metadata is invalid.")
}

const hostToolGroups = Object.values(hostToolsManifest.toolGroups ?? {})

if (
  hostToolGroups.length === 0 ||
  hostToolGroups.some(
    (group) =>
      !Array.isArray(group) ||
      group.some((name) => typeof name !== "string" || !name.trim())
  )
) {
  throw new Error("AstraFlow host tool manifest groups are invalid.")
}

const hostToolNames = hostToolGroups.flat()
const uniqueHostToolNames = new Set(hostToolNames)

if (uniqueHostToolNames.size !== hostToolNames.length) {
  throw new Error("AstraFlow host tool manifest contains duplicate tool names.")
}

for (const required of [
  "studio_generate_image",
  "studio_generate_video",
  "studio_list_media_generation_models",
  "studio_get_media_model_schema",
  "web_fetch",
]) {
  if (!uniqueHostToolNames.has(required)) {
    throw new Error(
      `AstraFlow host tool manifest is missing required tool: ${required}`
    )
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
  JSON.stringify(hostToolsManifest),
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
  ".cache",
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

for (const [dependency, version] of Object.entries(
  exactRuntimeDependencies
)) {
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
const studioAcpPlugins = read("lib/agent/acp/studio-plugins.ts")

if ((astraflowRuntimeAdapter.match(/new AcpRuntime\(/g) ?? []).length !== 1) {
  throw new Error(
    "AstraFlow local and remote execution must share exactly one AcpRuntime instance."
  )
}

for (const forbidden of [
  "streamPiRun",
  "astraflowRemoteAcpRuntime",
  ": streamPiRun(input)",
  "createNativeTools",
  "createPiSubagentTool",
  "mapPiAgentSessionEvent",
  "mapPiFileToolResult",
  "createPiSystemPrompt",
]) {
  if (astraflowRuntimeAdapter.includes(forbidden)) {
    throw new Error(
      `AstraFlow Desktop must not retain a second local Agent runtime: ${forbidden}`
    )
  }
}

if (
  (astraflowRuntimeAdapter.match(/createAgentSession\(/g) ?? []).length > 1
) {
  throw new Error(
    "AstraFlow Desktop must not add a second createAgentSession execution path."
  )
}

for (const required of [
  "resolveAstraflowAcpLocalCommand(input)",
  "return astraflowAcpRuntime.startRun(input)",
  "resolveSessionPlugins(input)",
  "createStudioAcpSessionPlugins({",
]) {
  if (!astraflowRuntimeAdapter.includes(required)) {
    throw new Error(
      `AstraFlow local and remote execution must share the ACP runtime path: ${required}`
    )
  }
}

if (
  !/sandbox-template:[\s\S]*?needs:\s*package[\s\S]*?\n  release:/.test(
    electronPackageWorkflow
  )
) {
  throw new Error(
    "The Sandbox template must build only after every Desktop package and smoke job succeeds."
  )
}

for (const required of [
  'join("src", "index.mjs")',
  'join(process.cwd(), "runtime", "astraflow-acp")',
  "new AcpStateBroker({",
  'ELECTRON_RUN_AS_NODE: "1"',
]) {
  if (!astraflowRuntimeConfig.includes(required)) {
    throw new Error(
      `Local AstraFlow ACP must launch the shared runtime artifact: ${required}`
    )
  }
}

for (const forbidden of [
  "ASTRAFLOW_ACP_STATE_ROOT",
  "ASTRAFLOW_ACP_STATE_KEY",
]) {
  if (astraflowRuntimeConfig.includes(forbidden)) {
    throw new Error(
      `Local AstraFlow ACP state must remain Desktop-owned: ${forbidden}`
    )
  }
}

for (const required of [
  "createStudioToolsMcpBridgeServer(sessionId, runtimeId)",
  "createAstraFlowToolMcpBridgeServer({ tools })",
  "createStudioAgentTools({",
]) {
  if (!studioAcpPlugins.includes(required)) {
    throw new Error(
      `AstraFlow ACP sessions must share the Desktop host-tool bridge: ${required}`
    )
  }
}

for (const forbidden of [
  "envs.MODELVERSE_API_KEY",
  "envs.OPENAI_API_KEY",
  "envs.ANTHROPIC_AUTH_TOKEN",
  "envs.GH_TOKEN",
  "envs.GITHUB_TOKEN",
  "stringifyProfileExports",
  "oauth_token:",
]) {
  if (codeboxRuntime.includes(forbidden)) {
    throw new Error(
      `CodeBox must not persist reusable credentials in the Sandbox: ${forbidden}`
    )
  }
}

for (const required of [
  "removeLegacyCodeBoxCredentialMaterial",
  '"/etc/profile.d/astraflow-codebox.sh"',
  '"/root/.codex/auth.json"',
  "ASTRAFLOW_GITHUB_TOKEN",
  "GIT_ASKPASS",
]) {
  if (!codeboxRuntime.includes(required)) {
    throw new Error(
      `CodeBox credential isolation is missing: ${required}`
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
  ...Object.keys(exactRuntimeDependencies),
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
