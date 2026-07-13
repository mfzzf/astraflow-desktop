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
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
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

  beforeAll(() => {
    testRoot = mkdtempSync(join(tmpdir(), "astraflow-sandbox-integration-"))
    projectRoot = join(testRoot, "project")
    outsidePath = join(testRoot, "outside.txt")
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(projectRoot, ".env"), "TOP_SECRET=hidden\n")
    previousWorkspaceRoot = process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(testRoot, "workspaces")
  })

  afterAll(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    } else {
      process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = previousWorkspaceRoot
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  integrationTest(
    "confines files, blocks network and sockets, and exposes bundled Python",
    async () => {
      const success = await runSandboxCommand({
        command:
          'python3 -m markitdown --help >/dev/null && python3 -c "import docx, markitdown, pandas, openpyxl, pdf2image, pdfplumber, PIL, pptx, pypdf, pypdfium2, pytesseract, reportlab; print(pandas.__version__)" && node -e "require(\'docx\'); require(\'pdf-lib\'); require(\'pptxgenjs\'); require(\'react-icons\'); require(\'sharp\'); console.log(\'node-docs-ok\')" && printf sandboxed > result.txt',
        rootDir: projectRoot,
      })

      expect(success.code).toBe(0)
      expect(success.stdout).toContain("3.0.3")
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
          'python3 -c "import socket; s=socket.socket(); s.settimeout(.2); s.connect((\'1.1.1.1\', 80))"',
        rootDir: projectRoot,
      })

      expect(network.code).not.toBe(0)

      const unixSocket = await runSandboxCommand({
        command: 'python3 -c "import socket; socket.socket(socket.AF_UNIX)"',
        rootDir: projectRoot,
      })

      expect(unixSocket.code).not.toBe(0)
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
          'python3 -c "import time; print(\'ready\', flush=True); time.sleep(30)"',
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
