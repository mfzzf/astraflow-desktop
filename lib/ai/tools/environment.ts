import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"

const runtimeSchema = z.enum(["python", "node"])

function installerCommand(
  action: "status" | "health" | "install",
  runtime?: string
) {
  const executable = process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim()
  const installer = process.env.ASTRAFLOW_ENVIRONMENT_INSTALLER_PATH?.trim()

  if (!executable || !installer || !existsSync(installer)) {
    throw new Error(
      "AstraFlow environment installation is available only in the desktop app."
    )
  }

  return {
    executable,
    installer,
    args: [installer, action, ...(runtime ? [runtime] : [])],
  }
}

function runInstaller(
  action: "status" | "health" | "install",
  runtime: string | undefined,
  signal?: AbortSignal
) {
  const { args, executable } = installerCommand(action, runtime)

  return new Promise<unknown>((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(executable, args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const abort = () => child.kill()

    signal?.addEventListener("abort", abort, { once: true })
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    child.once("error", reject)
    child.once("close", (code, closeSignal) => {
      signal?.removeEventListener("abort", abort)

      if (signal?.aborted) {
        reject(
          signal.reason ?? new Error("Environment installation cancelled.")
        )
        return
      }

      const output = Buffer.concat(stdout).toString("utf8").trim()
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim()

      if (code !== 0) {
        reject(
          new Error(
            errorOutput ||
              output ||
              `Environment installer exited with code ${code ?? "null"} and signal ${closeSignal ?? "null"}.`
          )
        )
        return
      }

      try {
        resolve(JSON.parse(output))
      } catch {
        reject(
          new Error(`Environment installer returned invalid output: ${output}`)
        )
      }
    })
  })
}

export function createEnvironmentRuntimeTools() {
  return [
    createAstraFlowTool(
      async (_input, { signal }) => runInstaller("status", undefined, signal),
      {
        name: "get_runtime_environment_status",
        description:
          "Check whether AstraFlow's managed Python and Node.js/npm runtimes are installed. Use this before assuming a missing python, node, npm, or npx command must be installed by the user.",
        schema: z.object({}).strict(),
      }
    ),
    createAstraFlowTool(
      async ({ runtime }, { signal }) =>
        runInstaller("health", runtime, signal),
      {
        name: "check_runtime_environment_health",
        description:
          "Execute AstraFlow's managed runtime commands and report whether Python/pip and Node.js/npm/npx are operational with the expected versions. Run this after installation or when a runtime command exists but fails.",
        schema: z
          .object({
            runtime: runtimeSchema
              .optional()
              .describe(
                "Optional runtime to check. Omit it to health-check both Python and Node.js/npm."
              ),
          })
          .strict(),
      }
    ),
    createAstraFlowTool(
      async ({ runtime }, { signal }) =>
        runInstaller("install", runtime, signal),
      {
        name: "install_runtime_environment",
        description:
          "Download and install a checksummed AstraFlow runtime from its managed object storage, then execute a post-install health check. Choose python for Python/pip or node for Node.js/npm/npx. This changes the shared local environment and can be used even when those commands are currently unavailable.",
        schema: z
          .object({
            runtime: runtimeSchema.describe(
              "Runtime to install: python provides Python and pip; node provides Node.js, npm, and npx."
            ),
          })
          .strict(),
      }
    ),
  ]
}
