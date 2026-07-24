// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { createServer as createUnixServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  spawnLocalSandboxedAcpProcess,
  spawnLocalSandboxedCommand,
  terminateLocalSandboxedCommand,
} from "@/lib/agent/sandbox/local-command"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"

const integrationTest =
  process.env.ASTRAFLOW_RUN_SANDBOX_INTEGRATION === "1" ? test : test.skip

function runSandboxCommand({
  command,
  rootDir,
  sessionId = "integration-session",
}: {
  command: string
  rootDir: string
  sessionId?: string
}) {
  return new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stderr: string
    stdout: string
  }>((resolveResult, rejectResult) => {
    const child = spawnLocalSandboxedCommand({
      command,
      rootDir,
      sessionId,
    })
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", rejectResult)
    child.once("close", (code, signal) => {
      resolveResult({ code, signal, stderr, stdout })
    })
  })
}

describe("local OS sandbox integration", () => {
  let testRoot = ""
  let projectRoot = ""
  let outsidePath = ""
  let previousWorkspaceRoot: string | undefined
  let previousUserDataPath: string | undefined
  let previousAttachmentsPath: string | undefined
  let previousSqlitePath: string | undefined
  let previousManagedWorkspacesPath: string | undefined

  beforeAll(() => {
    const shortTempRoot = process.platform === "win32" ? tmpdir() : "/tmp"

    testRoot = mkdtempSync(join(shortTempRoot, "af-sandbox-"))
    projectRoot = join(testRoot, "project")
    outsidePath = join(testRoot, "outside.txt")
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(projectRoot, ".env"), "TOP_SECRET=hidden\n")
    previousWorkspaceRoot = process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    previousUserDataPath = process.env.ASTRAFLOW_USER_DATA_PATH
    previousAttachmentsPath = process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH
    previousSqlitePath = process.env.ASTRAFLOW_SQLITE_PATH
    previousManagedWorkspacesPath =
      process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(testRoot, "workspaces")
    process.env.ASTRAFLOW_USER_DATA_PATH = join(testRoot, "user-data")
    process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(
      testRoot,
      "user-data",
      "acp-attachments"
    )
    process.env.ASTRAFLOW_SQLITE_PATH = join(
      testRoot,
      "user-data",
      "astraflow.sqlite"
    )
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(
      testRoot,
      "managed-workspaces"
    )
  })

  afterAll(() => {
    for (const [name, value] of [
      ["ASTRAFLOW_SANDBOX_WORKSPACES_PATH", previousWorkspaceRoot],
      ["ASTRAFLOW_USER_DATA_PATH", previousUserDataPath],
      ["ASTRAFLOW_ACP_ATTACHMENTS_PATH", previousAttachmentsPath],
      ["ASTRAFLOW_SQLITE_PATH", previousSqlitePath],
      ["ASTRAFLOW_MANAGED_WORKSPACES_PATH", previousManagedWorkspacesPath],
    ] as const) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  integrationTest(
    "keeps ACP stdio open while masking its provider credential",
    async () => {
      const userDataRoot = process.env.ASTRAFLOW_USER_DATA_PATH!
      const attachmentParent = process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH!
      const currentAttachmentRoot = join(
        attachmentParent,
        "long-lived-acp-session"
      )
      const siblingAttachmentRoot = join(attachmentParent, "sibling-session")
      const currentAttachmentFile = join(currentAttachmentRoot, "current.txt")
      const siblingAttachmentFile = join(siblingAttachmentRoot, "sibling.txt")
      const siblingWorkspaceFile = join(
        ensureLocalSandboxWorkspace("sibling-session"),
        "private.txt"
      )
      const managedWorkspaceParent =
        process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH!
      const currentManagedWorkspace = join(
        managedWorkspaceParent,
        "current-workspace"
      )
      const siblingManagedWorkspace = join(
        managedWorkspaceParent,
        "sibling-workspace"
      )
      const currentManagedWorkspaceFile = join(
        currentManagedWorkspace,
        "current.txt"
      )
      const siblingManagedWorkspaceFile = join(
        siblingManagedWorkspace,
        "sibling.txt"
      )
      const privateUserDataFile = join(userDataRoot, "private.txt")
      const stateRoot = join(userDataRoot, "acp-state", "current-session")
      const stateOutputFile = join(stateRoot, "state-output.txt")
      const runtimeStateRoot = join(
        ensureLocalSandboxWorkspace("long-lived-acp-session"),
        ".astraflow-acp-runtime"
      )
      const runtimeStateOutputFile = join(
        runtimeStateRoot,
        "runtime-output.txt"
      )
      const workspaceOutputFile = join(
        currentManagedWorkspace,
        "workspace-output.txt"
      )
      const scopedApiKey = "s".repeat(43)
      const nodeExecutable = execFileSync("which", ["node"], {
        encoding: "utf8",
      }).trim()
      const previousNodeExecutable = process.env.ASTRAFLOW_NODE_EXECUTABLE

      mkdirSync(currentAttachmentRoot, { recursive: true })
      mkdirSync(siblingAttachmentRoot, { recursive: true })
      mkdirSync(userDataRoot, { recursive: true })
      mkdirSync(currentManagedWorkspace, { recursive: true })
      mkdirSync(siblingManagedWorkspace, { recursive: true })
      writeFileSync(currentAttachmentFile, "current-attachment")
      writeFileSync(siblingAttachmentFile, "sibling-attachment")
      writeFileSync(siblingWorkspaceFile, "sibling-workspace")
      writeFileSync(currentManagedWorkspaceFile, "current-workspace")
      writeFileSync(siblingManagedWorkspaceFile, "sibling-workspace")
      writeFileSync(privateUserDataFile, "private-user-data")
      process.env.ASTRAFLOW_NODE_EXECUTABLE = nodeExecutable
      let child: ReturnType<typeof spawnLocalSandboxedAcpProcess>

      try {
        child = spawnLocalSandboxedAcpProcess({
          allowedNetworkDomains: ["example.com"],
          args: [
            "-e",
            [
              "const fs = require('node:fs')",
              "const canRead = path => { try { fs.readFileSync(path); return true } catch { return false } }",
              "const readline = require('node:readline')",
              "const credential = process.env.ASTRAFLOW_MODELVERSE_API_KEY",
              "const rl = readline.createInterface({ input: process.stdin })",
              "rl.on('line', line => {",
              `  const currentAttachment = fs.readFileSync(${JSON.stringify(
                currentAttachmentFile
              )}, 'utf8')`,
              `  const siblingAttachmentReadable = canRead(${JSON.stringify(
                siblingAttachmentFile
              )})`,
              `  const siblingWorkspaceReadable = canRead(${JSON.stringify(
                siblingWorkspaceFile
              )})`,
              `  const currentManagedWorkspace = fs.readFileSync(${JSON.stringify(
                currentManagedWorkspaceFile
              )}, 'utf8')`,
              `  const siblingManagedWorkspaceReadable = canRead(${JSON.stringify(
                siblingManagedWorkspaceFile
              )})`,
              `  const privateUserDataReadable = canRead(${JSON.stringify(
                privateUserDataFile
              )})`,
              `  fs.writeFileSync(${JSON.stringify(
                stateOutputFile
              )}, 'state-output')`,
              `  fs.writeFileSync(${JSON.stringify(
                runtimeStateOutputFile
              )}, 'runtime-output')`,
              `  fs.writeFileSync(${JSON.stringify(
                workspaceOutputFile
              )}, 'workspace-output')`,
              "  process.stdout.write(JSON.stringify({ credential, currentAttachment, currentManagedWorkspace, line, privateUserDataReadable, siblingAttachmentReadable, siblingManagedWorkspaceReadable, siblingWorkspaceReadable }) + '\\n')",
              "  if (line === 'quit') process.exit(0)",
              "})",
            ].join(";"),
          ],
          command: nodeExecutable,
          env: {
            ASTRAFLOW_ACP_STATE_KEY: "22".repeat(32),
            ASTRAFLOW_MODELVERSE_API_KEY: scopedApiKey,
          },
          rootDir: currentManagedWorkspace,
          additionalReadRoots: [currentAttachmentRoot],
          runtimeStateRoot,
          sessionId: "long-lived-acp-session",
          stateRoot,
          providerProxyToken: scopedApiKey,
        })
      } finally {
        if (previousNodeExecutable === undefined) {
          delete process.env.ASTRAFLOW_NODE_EXECUTABLE
        } else {
          process.env.ASTRAFLOW_NODE_EXECUTABLE = previousNodeExecutable
        }
      }

      const response = new Promise<{
        credential: string
        currentAttachment: string
        currentManagedWorkspace: string
        line: string
        privateUserDataReadable: boolean
        siblingAttachmentReadable: boolean
        siblingManagedWorkspaceReadable: boolean
        siblingWorkspaceReadable: boolean
      }>((resolveResponse, rejectResponse) => {
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString()
          const line = stdout.split("\n")[0]

          if (line) {
            resolveResponse(JSON.parse(line))
          }
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString()
        })
        child.once("error", rejectResponse)
        child.once("close", (code) => {
          if (!stdout) {
            rejectResponse(
              new Error(
                `Long-lived sandbox exited before replying: ${code}\n${stderr}`
              )
            )
          }
        })
      })

      child.stdin.write("quit\n")
      const result = await response

      expect(result.line).toBe("quit")
      expect(result.credential).toBe(scopedApiKey)
      expect(result.currentAttachment).toBe("current-attachment")
      expect(result.currentManagedWorkspace).toBe("current-workspace")
      expect(result.privateUserDataReadable).toBe(false)
      expect(result.siblingAttachmentReadable).toBe(false)
      expect(result.siblingManagedWorkspaceReadable).toBe(false)
      expect(result.siblingWorkspaceReadable).toBe(false)
      expect(readFileSync(stateOutputFile, "utf8")).toBe("state-output")
      expect(readFileSync(runtimeStateOutputFile, "utf8")).toBe(
        "runtime-output"
      )
      expect(readFileSync(workspaceOutputFile, "utf8")).toBe("workspace-output")
    },
    30_000
  )

  integrationTest(
    "confines files, blocks network and sockets, and exposes managed runtimes",
    async () => {
      const success = await runSandboxCommand({
        command:
          "python3 -c \"import pip, venv; print('python-runtime-ok')\" && node -e \"require('docx'); require('pdf-lib'); require('pptxgenjs'); require('react-icons'); require('sharp'); console.log('node-docs-ok')\" && printf sandboxed > result.txt",
        rootDir: projectRoot,
      })

      if (success.code !== 0) {
        throw new Error(
          [
            `Sandbox runtime smoke failed with exit code ${success.code}.`,
            `stdout:\n${success.stdout}`,
            `stderr:\n${success.stderr}`,
          ].join("\n")
        )
      }
      expect(success.code).toBe(0)
      expect(success.stdout).toContain("python-runtime-ok")
      expect(success.stdout).toContain("node-docs-ok")
      expect(readFileSync(join(projectRoot, "result.txt"), "utf8")).toBe(
        "sandboxed"
      )

      const outsideWrite = await runSandboxCommand({
        command: `printf escaped > ${JSON.stringify(outsidePath)}`,
        rootDir: projectRoot,
      })

      expect(outsideWrite.code).not.toBe(0)
      expect(existsSync(outsidePath)).toBe(false)

      const secretRead = await runSandboxCommand({
        command: "cat .env >/dev/null",
        rootDir: projectRoot,
      })

      expect(secretRead.code).not.toBe(0)

      const localSkillFile = join(
        ensureLocalSandboxWorkspace("integration-session"),
        "skills",
        "xlsx",
        "SKILL.md"
      )
      mkdirSync(join(localSkillFile, ".."), { recursive: true })
      writeFileSync(localSkillFile, "read only")
      const skillWrite = await runSandboxCommand({
        command: `printf modified > ${JSON.stringify(localSkillFile)}`,
        rootDir: projectRoot,
      })

      expect(skillWrite.code).not.toBe(0)
      expect(readFileSync(localSkillFile, "utf8")).toBe("read only")

      const network = await runSandboxCommand({
        command:
          "python3 -c \"import socket; s=socket.socket(); s.settimeout(.2); s.connect(('1.1.1.1', 80))\"",
        rootDir: projectRoot,
      })

      expect(network.code).not.toBe(0)

      const unixSocketPath = join(projectRoot, "blocked.sock")
      const unixServer = createUnixServer()
      await new Promise<void>((resolveListen, rejectListen) => {
        unixServer.once("error", rejectListen)
        unixServer.listen(unixSocketPath, () => {
          unixServer.removeListener("error", rejectListen)
          resolveListen()
        })
      })

      try {
        const python = [
          "import socket",
          "s = socket.socket(socket.AF_UNIX)",
          `s.connect(${JSON.stringify(unixSocketPath)})`,
        ].join("; ")
        const unixSocket = await runSandboxCommand({
          command: `python3 -c ${JSON.stringify(python)}`,
          rootDir: projectRoot,
        })

        expect(unixSocket.code).not.toBe(0)
      } finally {
        await new Promise<void>((resolveClose) => {
          unixServer.close(() => resolveClose())
        })
      }
    },
    30_000
  )

  integrationTest(
    "keeps concurrent session write grants isolated",
    async () => {
      const projectA = join(testRoot, "project-a")
      const projectB = join(testRoot, "project-b")
      mkdirSync(projectA, { recursive: true })
      mkdirSync(projectB, { recursive: true })

      const [resultA, resultB] = await Promise.all([
        runSandboxCommand({
          command: `printf a > own.txt; printf escaped > ${JSON.stringify(
            join(projectB, "from-a.txt")
          )}`,
          rootDir: projectA,
          sessionId: "concurrent-a",
        }),
        runSandboxCommand({
          command: `printf b > own.txt; printf escaped > ${JSON.stringify(
            join(projectA, "from-b.txt")
          )}`,
          rootDir: projectB,
          sessionId: "concurrent-b",
        }),
      ])

      expect(resultA.code).not.toBe(0)
      expect(resultB.code).not.toBe(0)
      expect(readFileSync(join(projectA, "own.txt"), "utf8")).toBe("a")
      expect(readFileSync(join(projectB, "own.txt"), "utf8")).toBe("b")
      expect(existsSync(join(projectA, "from-b.txt"))).toBe(false)
      expect(existsSync(join(projectB, "from-a.txt"))).toBe(false)
    },
    30_000
  )

  integrationTest(
    "cancels the runner and its sandboxed process through the cleanup channel",
    async () => {
      const child = spawnLocalSandboxedCommand({
        command:
          "python3 -c \"import time; print('ready', flush=True); time.sleep(30)\"",
        rootDir: projectRoot,
        sessionId: "cancel-session",
      })
      const startedAt = Date.now()
      let requestedTermination = false

      const result = await new Promise<{
        code: number | null
        signal: NodeJS.Signals | null
      }>((resolveResult, rejectResult) => {
        const timeout = setTimeout(() => {
          terminateLocalSandboxedCommand(child)
          rejectResult(new Error("Sandbox cancellation did not finish."))
        }, 12_000)

        child.stdout?.on("data", (chunk) => {
          if (!requestedTermination && chunk.toString().includes("ready")) {
            requestedTermination = true
            terminateLocalSandboxedCommand(child)
          }
        })
        child.once("error", rejectResult)
        child.once("close", (code, signal) => {
          clearTimeout(timeout)
          resolveResult({ code, signal })
        })
      })

      expect(requestedTermination).toBe(true)
      expect(result.code === 143 || result.signal !== null).toBe(true)
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    },
    15_000
  )
})
