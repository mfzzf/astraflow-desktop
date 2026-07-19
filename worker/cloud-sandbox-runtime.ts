import { randomBytes } from "node:crypto"
import { posix } from "node:path"

import { Sandbox } from "@e2b/code-interpreter"

import { getAstraFlowSandboxConnectionOptions } from "@/lib/astraflow-sandbox-runtime"
import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"

const DEFAULT_TEMPLATE = "yeyb5hbs2kweus6ku07l"
const TEMPLATE =
  process.env.ASTRAFLOW_CLOUD_SANDBOX_TEMPLATE?.trim() ||
  process.env.ASTRAFLOW_CODE_SANDBOX_TEMPLATE?.trim() ||
  DEFAULT_TEMPLATE
const WORKSPACE_PATH = "/workspace"
const GATEWAY_PORT = 8787
const GATEWAY_PROTOCOL = 1
const GATEWAY_ENTRYPOINT = "/opt/astraflow/workspace-gateway/src/server.mjs"
const NODE_BINARY = "/usr/local/bin/node"
const RUNTIME_PATH = "/usr/local/bin:/usr/bin:/bin"
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000
const MAX_OUTPUT_FILE_BYTES = 50 * 1024 * 1024
const MAX_OUTPUT_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_OUTPUT_FILES = 20

type WorkspaceRepository = Record<string, unknown> | undefined

type GatewayConnection = {
  sandbox: Sandbox
  token: string
  baseUrl: string
}

export type CloudArtifactInput = {
  id?: string
  fileName?: string
  sha256?: string
  downloadUrl?: string
}

export type CloudOutputFile = {
  path: string
  fileName: string
  bytes: Uint8Array
}

export async function provisionCloudSandbox(input: {
  accountId: string
  workspaceId: string
  workspaceName: string
  repository?: WorkspaceRepository
}) {
  const sandbox = await Sandbox.create(TEMPLATE, {
    ...sandboxConnectionOptions(),
    timeoutMs: SANDBOX_TIMEOUT_MS,
    allowInternetAccess: true,
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: true },
      autoResume: true,
    },
    metadata: {
      app: "astraflow-cloud-worker",
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName.slice(0, 200),
      workspacePath: WORKSPACE_PATH,
      workspaceGatewayPort: String(GATEWAY_PORT),
    },
  })
  try {
    await runChecked(
      sandbox,
      `mkdir -p ${shellQuote(WORKSPACE_PATH)}`,
      "prepare workspace",
      30_000
    )
    const repoURL = repositoryURL(input.repository)
    if (repoURL) await cloneRepository(sandbox, repoURL)
    return sandbox.sandboxId
  } catch (error) {
    await sandbox.kill().catch(() => undefined)
    throw error
  }
}

export async function connectCloudAgent(input: {
  sandboxId: string
  runtimeId: string
  artifacts?: CloudArtifactInput[]
}) {
  const sandbox = await Sandbox.connect(input.sandboxId, {
    ...sandboxConnectionOptions(),
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })
  await materializeArtifacts(sandbox, input.artifacts ?? [])
  const gateway = await startGateway(sandbox)
  const runtimeId = normalizeRuntimeId(input.runtimeId)
  const health = await gatewayFetch(gateway, "/v1/health")
  const healthPayload = (await health.json()) as {
    ok?: boolean
    data?: {
      protocolVersion?: number
      agentRuntimes?: Array<{ id?: string; available?: boolean }>
    }
    error?: { message?: string }
  }
  if (
    !health.ok ||
    !healthPayload.ok ||
    healthPayload.data?.protocolVersion !== GATEWAY_PROTOCOL
  ) {
    throw new Error(
      healthPayload.error?.message || "Workspace Gateway is incompatible."
    )
  }
  const runtime = healthPayload.data.agentRuntimes?.find(
    (candidate) => candidate.id === runtimeId
  )
  if (runtime && !runtime.available) {
    throw new Error(`${runtimeId} is unavailable in the Sandbox template.`)
  }
  const response = await gatewayFetch(gateway, "/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtimeId, env: runtimeEnvironment() }),
  })
  const payload = (await response.json()) as {
    ok?: boolean
    data?: { websocketPath?: string; runtimeVersion?: string }
    error?: { message?: string }
  }
  if (!response.ok || !payload.ok || !payload.data?.websocketPath) {
    throw new Error(
      payload.error?.message || "Workspace Agent connection failed."
    )
  }
  return {
    runtimeId,
    runtimeVersion: payload.data.runtimeVersion || null,
    websocketUrl: new URL(
      payload.data.websocketPath,
      `${gateway.baseUrl.replace(/^http/, "ws")}/`
    ).toString(),
    workspacePath: WORKSPACE_PATH,
  }
}

export async function readCloudOutputFiles(
  sandboxId: string,
  paths: string[]
): Promise<CloudOutputFile[]> {
  const sandbox = await Sandbox.connect(sandboxId, {
    ...sandboxConnectionOptions(),
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })
  const files: CloudOutputFile[] = []
  let totalBytes = 0
  const uniquePaths = Array.from(new Set(paths)).slice(0, MAX_OUTPUT_FILES)
  for (const candidate of uniquePaths) {
    if (
      !candidate ||
      candidate.includes("\u0000") ||
      candidate.includes("\n")
    ) {
      continue
    }
    if (isSensitiveCloudArtifactPath(candidate)) continue
    const absolute = posix.resolve(WORKSPACE_PATH, candidate)
    if (!absolute.startsWith(`${WORKSPACE_PATH}/`)) continue
    const resolved = await runChecked(
      sandbox,
      `realpath -e -- ${shellQuote(absolute)}`,
      "resolve output artifact",
      10_000
    )
    const canonical = resolved.stdout.trim()
    if (!canonical.startsWith(`${WORKSPACE_PATH}/`)) {
      throw new Error("Cloud output artifact escaped the workspace root.")
    }
    if (isSensitiveCloudArtifactPath(canonical)) continue
    const info = await sandbox.files.getInfo(canonical)
    if (info.type !== "file" || info.symlinkTarget) continue
    if (
      info.size < 0 ||
      info.size > MAX_OUTPUT_FILE_BYTES ||
      totalBytes + info.size > MAX_OUTPUT_TOTAL_BYTES
    ) {
      continue
    }
    const bytes = await sandbox.files.read(canonical, { format: "bytes" })
    if (bytes.byteLength !== info.size) {
      throw new Error(
        `Cloud output artifact changed while reading: ${candidate}`
      )
    }
    totalBytes += bytes.byteLength
    files.push({ path: canonical, fileName: posix.basename(canonical), bytes })
  }
  return files
}

export function isSensitiveCloudArtifactPath(path: string) {
  const segments = path.toLowerCase().split("/").filter(Boolean)
  const name = segments.at(-1) ?? ""
  return (
    segments.some((segment) =>
      [".git", ".ssh", ".gnupg", ".aws", ".kube"].includes(segment)
    ) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.(pem|key|p12|pfx|kdbx)$/.test(name) ||
    /^(id_rsa|id_ed25519|credentials)$/.test(name)
  )
}

function sandboxConnectionOptions() {
  const key =
    process.env.ASTRAFLOW_CLOUD_SANDBOX_API_KEY?.trim() ||
    process.env.E2B_API_KEY?.trim()
  if (!key) throw new Error("ASTRAFLOW_CLOUD_SANDBOX_API_KEY is required.")
  return getAstraFlowSandboxConnectionOptions(key)
}

function runtimeEnvironment() {
  const key = process.env.ASTRAFLOW_CLOUD_MODELVERSE_API_KEY?.trim()
  if (!key) throw new Error("ASTRAFLOW_CLOUD_MODELVERSE_API_KEY is required.")
  return {
    MODELVERSE_API_KEY: key,
    OPENAI_API_KEY: key,
    OPENAI_BASE_URL: `${MODELVERSE_BASE_URL}/v1`,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_BASE_URL: MODELVERSE_BASE_URL,
    PATH: RUNTIME_PATH,
  }
}

async function startGateway(sandbox: Sandbox): Promise<GatewayConnection> {
  const token = randomBytes(32).toString("base64url")
  await runChecked(
    sandbox,
    [
      `test -f ${shellQuote(GATEWAY_ENTRYPOINT)}`,
      `pkill -f ${shellQuote(`[n]ode ${GATEWAY_ENTRYPOINT}`)} >/dev/null 2>&1 || true`,
    ].join("\n"),
    "prepare Workspace Gateway",
    20_000
  )
  const handle = await sandbox.commands.run(
    `${NODE_BINARY} ${shellQuote(GATEWAY_ENTRYPOINT)}`,
    {
      background: true,
      envs: {
        ASTRAFLOW_WORKSPACE_GATEWAY_HOST: "0.0.0.0",
        ASTRAFLOW_WORKSPACE_GATEWAY_PORT: String(GATEWAY_PORT),
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: token,
        ASTRAFLOW_WORKSPACE_ROOT: WORKSPACE_PATH,
        ASTRAFLOW_WORKSPACE_ID: sandbox.sandboxId,
        ASTRAFLOW_SANDBOX_ID: sandbox.sandboxId,
        ASTRAFLOW_TEMPLATE_VERSION: TEMPLATE,
        PATH: RUNTIME_PATH,
      },
      timeoutMs: 0,
      requestTimeoutMs: 20_000,
    }
  )
  await handle.disconnect()
  await runChecked(
    sandbox,
    `for attempt in $(seq 1 80); do curl -fsS http://127.0.0.1:${GATEWAY_PORT}/healthz >/dev/null && exit 0; sleep 0.25; done; exit 1`,
    "start Workspace Gateway",
    30_000
  )
  const host = sandbox.getHost(GATEWAY_PORT)
  const scheme = isLocalHost(host) ? "http" : "https"
  return { sandbox, token, baseUrl: `${scheme}://${host}` }
}

async function gatewayFetch(
  connection: GatewayConnection,
  path: string,
  init?: RequestInit
) {
  const target = new URL(path, `${connection.baseUrl}/`)
  if (
    target.origin !== connection.baseUrl ||
    !target.pathname.startsWith("/v1/")
  ) {
    throw new Error("Workspace Gateway path is not allowed.")
  }
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Bearer ${connection.token}`)
  return fetch(target, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  })
}

async function cloneRepository(sandbox: Sandbox, repoURL: string) {
  await runChecked(
    sandbox,
    [
      "set -euo pipefail",
      'workspace="${ASTRAFLOW_WORKSPACE_PATH}"',
      'mkdir -p "$workspace"',
      'if [ -d "$workspace/.git" ]; then exit 0; fi',
      "tmp_dir=$(mktemp -d /tmp/astraflow-cloud-clone.XXXXXX)",
      "trap 'rm -rf \"$tmp_dir\"' EXIT",
      'GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$ASTRAFLOW_REPO_URL" "$tmp_dir/repo"',
      'if [ -n "$(find "$workspace" -mindepth 1 -maxdepth 1 -print -quit)" ]; then',
      '  cp -a "$tmp_dir/repo/." "$workspace/"',
      "else",
      '  rmdir "$workspace"',
      '  mv "$tmp_dir/repo" "$workspace"',
      "fi",
    ].join("\n"),
    "clone repository",
    5 * 60_000,
    {
      ASTRAFLOW_REPO_URL: repoURL,
      ASTRAFLOW_WORKSPACE_PATH: WORKSPACE_PATH,
    }
  )
}

async function materializeArtifacts(
  sandbox: Sandbox,
  artifacts: CloudArtifactInput[]
) {
  const downloadable = artifacts.filter(
    (artifact) => artifact.downloadUrl && artifact.sha256
  )
  if (!downloadable.length) return
  await runChecked(
    sandbox,
    `mkdir -p ${shellQuote(`${WORKSPACE_PATH}/.astraflow/attachments`)}`,
    "prepare attachments",
    20_000
  )
  for (const [index, artifact] of downloadable.entries()) {
    const fileName = safeFileName(
      artifact.fileName || artifact.id || `attachment-${index + 1}`
    )
    await runChecked(
      sandbox,
      [
        "set -euo pipefail",
        'curl -fsSL --retry 3 "$ASTRAFLOW_ATTACHMENT_URL" -o "$ASTRAFLOW_ATTACHMENT_PATH"',
        'printf "%s  %s\\n" "$ASTRAFLOW_ATTACHMENT_SHA256" "$ASTRAFLOW_ATTACHMENT_PATH" | sha256sum -c -',
      ].join("\n"),
      `download attachment ${index + 1}`,
      5 * 60_000,
      {
        ASTRAFLOW_ATTACHMENT_URL: artifact.downloadUrl!,
        ASTRAFLOW_ATTACHMENT_SHA256: artifact.sha256!,
        ASTRAFLOW_ATTACHMENT_PATH: `${WORKSPACE_PATH}/.astraflow/attachments/${fileName}`,
      }
    )
  }
}

async function runChecked(
  sandbox: Sandbox,
  command: string,
  label: string,
  timeoutMs: number,
  envs?: Record<string, string>
) {
  const result = await sandbox.commands.run(command, {
    envs,
    timeoutMs,
    requestTimeoutMs: Math.min(timeoutMs, 30_000),
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`
    )
  }
  return result
}

function repositoryURL(repository: WorkspaceRepository) {
  if (!repository) return null
  for (const key of ["clone_url", "cloneUrl", "repo_url", "repoUrl", "url"]) {
    const value = repository[key]
    if (typeof value !== "string" || !value.trim()) continue
    const parsed = new URL(value.trim())
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        "Repository URL must be HTTP(S) without embedded credentials."
      )
    }
    return parsed.toString()
  }
  return null
}

function normalizeRuntimeId(value: string) {
  if (value === "claude") return "claude-code"
  if (["astraflow", "codex", "claude-code", "opencode"].includes(value)) {
    return value
  }
  return "astraflow"
}

function safeFileName(value: string) {
  return value.replace(/[\\/\u0000\r\n]/g, "-").slice(0, 180)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function isLocalHost(host: string) {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  )
}
