import { accessSync, constants, lstatSync, realpathSync } from "node:fs"
import path from "node:path"

const DEFAULT_BWRAP_PATH = "/usr/bin/bwrap"
const DEFAULT_SOCAT_PATH = "/usr/bin/socat"
export const AGENT_WORKSPACE_CONFINEMENT_CAPABILITY =
  "agent.astraflow.workspace-confinement.v1"
const DEFAULT_PROTECTED_PATHS = Object.freeze([
  "/root",
  "/home",
  "/run",
  "/etc/ssh",
  "/etc/ssl/private",
  "/etc/shadow",
  "/etc/gshadow",
  "/etc/environment",
  "/etc/gitconfig",
  "/etc/docker",
  "/etc/kubernetes",
  "/etc/cloud",
  "/var/lib/astraflow",
  "/var/lib/cloud",
  "/var/lib/docker",
  "/var/lib/containerd",
  "/var/lib/kubelet",
  "/opt/astraflow/workspace-gateway",
])

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function statPath(value) {
  try {
    return lstatSync(value)
  } catch {
    return null
  }
}

function appendPrivateDirectory(args, target) {
  const info = statPath(target)

  if (!info) {
    return
  }

  if (info.isDirectory()) {
    args.push("--tmpfs", target)
    return
  }

  if (info.isFile()) {
    args.push("--ro-bind", "/dev/null", target)
  }
}

function appendWorkspaceMountpointDirectories(args, workspaceRoot) {
  if (!isInside("/tmp", workspaceRoot) || workspaceRoot === "/tmp") {
    return
  }

  let current = "/tmp"

  for (const segment of path.relative("/tmp", workspaceRoot).split(path.sep)) {
    if (!segment) {
      continue
    }

    current = path.join(current, segment)
    args.push("--dir", current)
  }
}

function appendTemporaryMountpointDirectories(args, target) {
  if (!isInside("/tmp", target) || target === "/tmp") {
    throw new Error("Agent bridge sockets must live below /tmp.")
  }

  let current = "/tmp"

  for (const segment of path.relative("/tmp", target).split(path.sep)) {
    if (!segment) {
      continue
    }

    current = path.join(current, segment)
    args.push("--dir", current)
  }
}

export function requiresWorkspaceConfinement(runtimeId, permissionMode) {
  return runtimeId === "astraflow" && permissionMode !== "full_access"
}

export function buildWorkspaceConfinementLaunch({
  args = [],
  bwrapPath = DEFAULT_BWRAP_PATH,
  command,
  environment,
  networkBridge,
  platform = process.platform,
  protectedPaths = DEFAULT_PROTECTED_PATHS,
  socatPath = DEFAULT_SOCAT_PATH,
  workspaceRoot,
}) {
  if (platform !== "linux") {
    throw new Error(
      "Remote AstraFlow Default mode requires Linux bubblewrap confinement."
    )
  }
  if (!path.isAbsolute(command) || !isExecutable(command)) {
    throw new Error("The confined Agent executable is unavailable.")
  }
  if (!path.isAbsolute(bwrapPath) || !isExecutable(bwrapPath)) {
    throw new Error(
      "Remote AstraFlow Default mode requires executable /usr/bin/bwrap."
    )
  }

  const canonicalWorkspace = realpathSync(workspaceRoot)

  for (const protectedPath of protectedPaths) {
    const canonicalProtected = path.resolve(protectedPath)

    if (
      isInside(canonicalProtected, canonicalWorkspace) &&
      canonicalProtected !== canonicalWorkspace
    ) {
      throw new Error(
        `Remote AstraFlow workspace cannot be nested under protected path ${canonicalProtected}.`
      )
    }
  }

  const sandboxArgs = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ]

  for (const protectedPath of protectedPaths) {
    const canonicalProtected = path.resolve(protectedPath)

    if (
      canonicalProtected === canonicalWorkspace ||
      isInside(canonicalWorkspace, canonicalProtected)
    ) {
      continue
    }

    appendPrivateDirectory(sandboxArgs, canonicalProtected)
  }

  appendWorkspaceMountpointDirectories(sandboxArgs, canonicalWorkspace)
  if (networkBridge) {
    const bridgeSocket = path.resolve(networkBridge.socketPath)
    const bridgeInfo = statPath(bridgeSocket)

    if (
      !Number.isInteger(networkBridge.port) ||
      networkBridge.port < 1 ||
      networkBridge.port > 65_535 ||
      !bridgeInfo?.isSocket() ||
      !isExecutable(socatPath)
    ) {
      throw new Error("Remote AstraFlow model bridge is unavailable.")
    }

    appendTemporaryMountpointDirectories(
      sandboxArgs,
      path.dirname(bridgeSocket)
    )
    sandboxArgs.push("--bind", bridgeSocket, bridgeSocket)
  }

  const commandArgs = networkBridge
    ? [
        "/bin/bash",
        "-c",
        [
          'socat_path="$1"',
          'proxy_port="$2"',
          'proxy_socket="$3"',
          "shift 3",
          '"$socat_path" "TCP-LISTEN:${proxy_port},bind=127.0.0.1,fork,reuseaddr" "UNIX-CONNECT:${proxy_socket}" >/dev/null 2>&1 &',
          'exec "$@"',
        ].join("\n"),
        "astraflow-agent-network-bridge",
        socatPath,
        String(networkBridge.port),
        path.resolve(networkBridge.socketPath),
        command,
        ...args,
      ]
    : [command, ...args]

  sandboxArgs.push(
    "--bind",
    canonicalWorkspace,
    canonicalWorkspace,
    "--chdir",
    canonicalWorkspace,
    "--dir",
    "/tmp/.astraflow-agent-home",
    "--setenv",
    "HOME",
    "/tmp/.astraflow-agent-home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "XDG_CACHE_HOME",
    "/tmp/.astraflow-agent-cache",
    "--setenv",
    "XDG_CONFIG_HOME",
    "/tmp/.astraflow-agent-config",
    "--setenv",
    "XDG_DATA_HOME",
    "/tmp/.astraflow-agent-data",
    "--setenv",
    "NO_PROXY",
    "127.0.0.1,localhost,::1",
    "--setenv",
    "no_proxy",
    "127.0.0.1,localhost,::1",
    "--",
    ...commandArgs
  )

  const launchEnvironment = {
    ...environment,
    HOME: "/tmp/.astraflow-agent-home",
    TMPDIR: "/tmp",
    XDG_CACHE_HOME: "/tmp/.astraflow-agent-cache",
    XDG_CONFIG_HOME: "/tmp/.astraflow-agent-config",
    XDG_DATA_HOME: "/tmp/.astraflow-agent-data",
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  }

  delete launchEnvironment.HTTP_PROXY
  delete launchEnvironment.HTTPS_PROXY
  delete launchEnvironment.http_proxy
  delete launchEnvironment.https_proxy

  return {
    command: bwrapPath,
    args: sandboxArgs,
    environment: launchEnvironment,
  }
}

export class AgentWorkspaceConfinement {
  constructor({
    bwrapPath =
      process.env.ASTRAFLOW_WORKSPACE_GATEWAY_BWRAP_PATH || DEFAULT_BWRAP_PATH,
    protectedPaths = DEFAULT_PROTECTED_PATHS,
    socatPath =
      process.env.ASTRAFLOW_WORKSPACE_GATEWAY_SOCAT_PATH || DEFAULT_SOCAT_PATH,
    workspaceRoot,
  } = {}) {
    this.bwrapPath = bwrapPath
    this.protectedPaths = protectedPaths
    this.socatPath = socatPath
    this.workspaceRoot = workspaceRoot
  }

  isAvailable() {
    return (
      process.platform === "linux" &&
      isExecutable(this.bwrapPath) &&
      isExecutable(this.socatPath)
    )
  }

  wrap({ args, command, environment, networkBridge }) {
    return buildWorkspaceConfinementLaunch({
      args,
      bwrapPath: this.bwrapPath,
      command,
      environment,
      networkBridge,
      protectedPaths: this.protectedPaths,
      socatPath: this.socatPath,
      workspaceRoot: this.workspaceRoot,
    })
  }
}

export const AGENT_WORKSPACE_PROTECTED_PATHS = DEFAULT_PROTECTED_PATHS
