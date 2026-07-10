import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"

const require = createRequire(import.meta.url)
const codexPackageJson = require("@openai/codex/package.json")
const codexScript = require.resolve("@openai/codex/bin/codex.js")
const codexHome = mkdtempSync(join(tmpdir(), "astraflow-codex-smoke-"))
const child = spawn(process.execPath, [codexScript, "app-server", "--stdio"], {
  cwd: process.cwd(),
  env: { ...process.env, CODEX_HOME: codexHome },
  stdio: ["pipe", "pipe", "pipe"],
})
const lines = createInterface({ input: child.stdout })
let stderr = ""

child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000)
})

await new Promise((resolve, reject) => {
  let settled = false
  const timer = setTimeout(() => {
    finish(
      new Error(
        `Timed out waiting for Codex app-server initialize response.${stderr ? `\n${stderr}` : ""}`
      )
    )
  }, 15_000)

  function cleanup() {
    clearTimeout(timer)
    lines.close()
    child.removeAllListeners()
  }

  function finish(error) {
    if (settled) {
      return
    }

    settled = true
    cleanup()
    child.kill()
    rmSync(codexHome, { recursive: true, force: true })

    if (error) {
      reject(error)
    } else {
      resolve()
    }
  }

  child.once("error", finish)
  child.once("exit", (code, signal) => {
    finish(
      new Error(
        `Codex app-server exited before initialization: code=${code ?? "null"} signal=${signal ?? "null"}.${stderr ? `\n${stderr}` : ""}`
      )
    )
  })
  lines.on("line", (line) => {
    let message

    try {
      message = JSON.parse(line)
    } catch {
      return
    }

    if (message.id !== 1) {
      return
    }

    if (message.error) {
      finish(
        new Error(
          `Codex app-server initialize failed: ${JSON.stringify(message.error)}`
        )
      )
      return
    }

    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
    console.log(
      `Codex app-server ${codexPackageJson.version} initialized successfully.`
    )
    finish()
  })

  child.stdin.write(
    `${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        capabilities: null,
        clientInfo: {
          name: "astraflow-desktop-smoke",
          title: "AstraFlow Desktop Smoke Test",
          version: "0.0.0",
        },
      },
    })}\n`
  )
})
