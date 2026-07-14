import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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

const codeboxRuntime = read("lib/codebox-runtime.ts")

for (const forbidden of [
  "envs.MODELVERSE_API_KEY",
  "envs.OPENAI_API_KEY",
  "envs.ANTHROPIC_AUTH_TOKEN",
  "JSON.stringify({ OPENAI_API_KEY:",
]) {
  if (codeboxRuntime.includes(forbidden)) {
    throw new Error(
      `CodeBox must not persist Modelverse credentials in the Sandbox: ${forbidden}`
    )
  }
}

if (!codeboxRuntime.includes("remove persisted Agent model credentials")) {
  throw new Error("CodeBox must purge credentials written by older releases.")
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
  "deepagents",
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
