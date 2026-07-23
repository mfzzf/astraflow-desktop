import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { accessSync, constants, realpathSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import net from "node:net"
import path from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

import {
  AGENT_WORKSPACE_PROTECTED_PATHS,
  buildWorkspaceConfinementLaunch,
  requiresWorkspaceConfinement,
} from "../src/agent-workspace-confinement.mjs"
import { createAgentModelBridge } from "../src/agent-model-bridge.mjs"

const execFileAsync = promisify(execFile)
const BWRAP_PATH = "/usr/bin/bwrap"
const SOCAT_PATH = "/usr/bin/socat"

function executable(file) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

test("builds a fail-closed process-tree policy for Default but not Full Access", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "astraflow-agent-confinement-policy-")
  )
  const workspaceRoot = path.join(root, "workspace")
  const checkpointRoot = path.join(root, "gateway-checkpoints")
  const credentialFile = path.join(root, "gateway-credential")

  try {
    await mkdir(workspaceRoot)
    await mkdir(checkpointRoot)
    await writeFile(credentialFile, "gateway-owned-secret")

    const launch = buildWorkspaceConfinementLaunch({
      args: ["-e", "process.exit(0)"],
      bwrapPath: process.execPath,
      command: process.execPath,
      environment: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
      platform: "linux",
      protectedPaths: [checkpointRoot, credentialFile],
      workspaceRoot,
    })
    const joined = launch.args.join("\0")
    const canonicalWorkspace = realpathSync(workspaceRoot)

    assert.equal(requiresWorkspaceConfinement("astraflow", "workspace_auto"), true)
    assert.equal(requiresWorkspaceConfinement("astraflow", "readonly"), true)
    assert.equal(requiresWorkspaceConfinement("astraflow", "full_access"), false)
    assert.equal(requiresWorkspaceConfinement("codex", "workspace_auto"), false)
    assert.match(joined, /--unshare-user\0--unshare-pid/)
    assert.match(joined, /--unshare-net/)
    assert.match(joined, /--ro-bind\0\/\0\//)
    assert.match(joined, new RegExp(`--tmpfs\\0${checkpointRoot}`))
    assert.match(
      joined,
      new RegExp(`--ro-bind\\0/dev/null\\0${credentialFile}`)
    )
    assert.match(
      joined,
      new RegExp(
        `--bind\\0${canonicalWorkspace}\\0${canonicalWorkspace}`
      )
    )
    assert.equal(launch.environment.HOME, "/tmp/.astraflow-agent-home")
    assert.equal(
      AGENT_WORKSPACE_PROTECTED_PATHS.includes(
        "/opt/astraflow/workspace-gateway"
      ),
      true
    )
    assert.equal(AGENT_WORKSPACE_PROTECTED_PATHS.includes("/root"), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("Gateway model bridge exposes only its pinned loopback proxy over a Unix socket", async () => {
  const target = net.createServer((socket) => socket.pipe(socket))

  await new Promise((resolve, reject) => {
    target.once("error", reject)
    target.listen(0, "127.0.0.1", resolve)
  })
  const address = target.address()
  const bridge = await createAgentModelBridge({
    proxyUrl: `http://127.0.0.1:${address.port}`,
  })

  try {
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection(bridge.socketPath)

      socket.once("error", reject)
      socket.once("connect", () => socket.write("model-proxy-ok"))
      socket.once("data", (chunk) => {
        socket.destroy()
        resolve(chunk.toString("utf8"))
      })
    })

    assert.equal(response, "model-proxy-ok")
  } finally {
    await bridge.close()
    await new Promise((resolve) => target.close(resolve))
  }
})

test(
  "adversarial Bash cannot escape the workspace or inspect Gateway processes",
  {
    skip:
      process.platform !== "linux" ||
      !executable(BWRAP_PATH) ||
      !executable(SOCAT_PATH),
  },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "astraflow-agent-confinement-live-")
    )
    const workspaceRoot = path.join(root, "workspace")
    const outsideRoot = path.join(root, "gateway-private")
    const outsideFile = path.join(outsideRoot, "checkpoint.json")
    const workspaceLink = path.join(workspaceRoot, "checkpoint-link.json")
    const modelTarget = net.createServer((socket) => socket.pipe(socket))
    let modelBridge = null
    const gatewayProcess = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        env: {
          PATH: process.env.PATH,
          ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN:
            "gateway-parent-secret-must-stay-hidden",
        },
        stdio: "ignore",
      }
    )

    try {
      await mkdir(workspaceRoot)
      await mkdir(outsideRoot)
      await writeFile(path.join(workspaceRoot, "allowed.txt"), "workspace-ok\n")
      await writeFile(outsideFile, "plaintext-checkpoint-must-stay-hidden\n")
      await symlink(outsideFile, workspaceLink)
      await new Promise((resolve, reject) => {
        modelTarget.once("error", reject)
        modelTarget.listen(0, "127.0.0.1", resolve)
      })
      const modelAddress = modelTarget.address()
      modelBridge = await createAgentModelBridge({
        proxyUrl: `http://127.0.0.1:${modelAddress.port}`,
      })
      await delay(50)

      const script = [
        "set -eu",
        'test "$(cat allowed.txt)" = "workspace-ok"',
        "printf 'created-inside\\n' > created.txt",
        `if cat ${JSON.stringify(outsideFile)} >/dev/null 2>&1; then exit 21; fi`,
        "if cat checkpoint-link.json >/dev/null 2>&1; then exit 22; fi",
        `if printf hacked > ${JSON.stringify(outsideFile)} 2>/dev/null; then exit 23; fi`,
        "if grep -a -l 'ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN=' /proc/[0-9]*/environ >/dev/null 2>&1; then exit 24; fi",
        "connected=0",
        `for attempt in $(seq 1 50); do if exec 8<>/dev/tcp/127.0.0.1/${modelBridge.port}; then connected=1; break; fi; sleep 0.02; done`,
        'test "$connected" = 1',
        "printf ping >&8",
        "IFS= read -r -N 4 proxy_response <&8",
        'test "$proxy_response" = "ping"',
        "if exec 9<>/dev/tcp/1.1.1.1/53 2>/dev/null; then exit 25; fi",
      ].join("\n")
      const launch = buildWorkspaceConfinementLaunch({
        args: ["-lc", script],
        bwrapPath: BWRAP_PATH,
        command: "/bin/bash",
        environment: {
          LANG: "C",
          PATH: "/usr/local/bin:/usr/bin:/bin",
        },
        networkBridge: modelBridge,
        protectedPaths: [...AGENT_WORKSPACE_PROTECTED_PATHS, outsideRoot],
        socatPath: SOCAT_PATH,
        workspaceRoot,
      })

      await execFileAsync(launch.command, launch.args, {
        env: launch.environment,
      })

      assert.equal(
        await readFile(path.join(workspaceRoot, "created.txt"), "utf8"),
        "created-inside\n"
      )
      assert.equal(
        await readFile(outsideFile, "utf8"),
        "plaintext-checkpoint-must-stay-hidden\n"
      )
    } finally {
      gatewayProcess.kill("SIGKILL")
      await modelBridge?.close()
      if (modelTarget.listening) {
        await new Promise((resolve) => modelTarget.close(resolve))
      }
      await rm(root, { force: true, recursive: true })
    }
  }
)
