import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { z } from "zod"

import { getConfiguredPythonProcessEnvironment } from "@/lib/agent/python-process-environment"
import { getCompShareCliConfigPath } from "@/lib/compshare/cli-credentials"
import { isCompShareChannel } from "@/lib/compshare/config"
import { createAstraFlowTool } from "@/lib/ai/tools/tool"

const MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_SECONDS = 300

const queryToolDescription = [
  "Run a server-enforced read-only CompShare CLI query through Desktop. Credentials stay outside the Agent sandbox.",
  "Plan the complete argument list before calling; do not probe one missing flag at a time and do not invent a Region or Zone.",
  "For a generic GPU inventory question: first call `instance zones` with [], then call `instance search` for the relevant location with [`--region`, REGION, `--zone`, ZONE, `--gpu`, GPU]. This lists legal specifications. To verify real stock, first choose an image using `image list`, then add [`--image`, IMAGE_ID, `--available`] to `instance search`.",
  "For a new-instance quote, `instance price` requires all of [`--gpu`, GPU, `--cpu`, CPU, `--memory`, MEMORY_WITH_UNIT, `--region`, REGION, `--zone`, ZONE]. Example: [`--gpu`, `4090`, `--cpu`, `16`, `--memory`, `64GiB`, `--region`, `cn-sh2`, `--zone`, `cn-sh2-02`]. Use `--memory`, never `--mem`.",
  "For the user's current instances, use `instance list` with [`--all`] and optional filters such as [`--gpu`, `4090`] without guessing a Region.",
].join("\n\n")

const actionToolDescription = [
  "Run a CompShare CLI operation that creates, changes, executes, transfers, sends, or deletes something.",
  "Desktop always asks the user for one-time approval before execution, including in Full Access mode. Use the query tool first to inspect current state.",
  "For `instance create` in Agent JSON mode, use either [`--template`, TEMPLATE] or provide every required option: `--gpu`, `--count`, `--cpu`, `--memory` (for example `64GiB`), `--image`, `--region`, and `--zone`. Query zones, images, legal specifications, inventory, and price first. Start with `--dry-run`; after the user approves the reviewed plan, make a new action call without `--dry-run` and with `--yes`.",
].join("\n\n")

const readOnlyCommands = [
  "ask",
  "doctor",
  "image list",
  "image progress",
  "image shares",
  "image show",
  "image tags",
  "instance billing",
  "instance families",
  "instance job list",
  "instance job logs",
  "instance job show",
  "instance job wait",
  "instance list",
  "instance models",
  "instance network",
  "instance ports list",
  "instance price",
  "instance refund",
  "instance resize-price",
  "instance schedule show",
  "instance search",
  "instance show",
  "instance software list",
  "instance template list",
  "instance template path",
  "instance template show",
  "instance wait",
  "instance zones",
  "storage disk list",
  "storage disk price",
  "team audit",
  "team billing list",
  "team billing products",
  "team billing summary",
  "team billing unpaid",
  "team invite list",
  "team joined",
  "team list",
  "team member list",
  "team show",
] as const

const actionCommands = [
  "feedback",
  "image create",
  "image delete",
  "image favorite",
  "image publish",
  "image share",
  "image unfavorite",
  "image unshare",
  "image update",
  "instance charge",
  "instance cp",
  "instance create",
  "instance delete",
  "instance job cancel",
  "instance job prune",
  "instance job submit",
  "instance password",
  "instance ports update",
  "instance reboot",
  "instance reinstall",
  "instance rename",
  "instance resize",
  "instance schedule cancel",
  "instance schedule extend",
  "instance schedule set",
  "instance scp",
  "instance ssh",
  "instance start",
  "instance stop",
  "instance template create",
  "instance template delete",
  "storage disk attach",
  "storage disk create",
  "storage disk delete",
  "storage disk detach",
  "storage disk resize",
  "storage us3 attach",
  "team create",
  "team billing export",
  "team delete",
  "team invite accept",
  "team invite cancel",
  "team invite reject",
  "team invite send",
  "team member rename",
  "team quota grant",
  "team quota reclaim",
  "team update",
] as const

const commandArgumentsSchema = z
  .array(z.string().max(16_384))
  .max(256)
  .default([])
  .refine(
    (values) => !values.includes("--show-sensitive"),
    "--show-sensitive is unavailable to Agent tools."
  )

const commandUsage = {
  "instance create":
    '["--gpu","4090","--count","1","--cpu","16","--memory","64GiB","--image",IMAGE_ID,"--region","cn-sh2","--zone","cn-sh2-02","--dry-run"]',
  "instance price":
    '["--gpu","4090","--cpu","16","--memory","64GiB","--region","cn-sh2","--zone","cn-sh2-02"]',
  "instance search":
    '["--region","cn-sh2","--zone","cn-sh2-02","--gpu","4090"]',
} as const

const requiredCommandOptions = {
  "instance price": ["--gpu", "--cpu", "--memory", "--region", "--zone"],
  "instance search": ["--region", "--zone"],
} as const

function hasOption(args: string[], option: string) {
  return args.some(
    (argument) => argument === option || argument.startsWith(`${option}=`)
  )
}

function assertCompleteCommandArguments(command: string, args: string[]) {
  const requiredOptions =
    requiredCommandOptions[command as keyof typeof requiredCommandOptions]
  const createUsesTemplate =
    command === "instance create" && hasOption(args, "--template")
  const createRequiredOptions = [
    "--gpu",
    "--count",
    "--cpu",
    "--memory",
    "--image",
    "--region",
    "--zone",
  ] as const
  const expectedOptions =
    command === "instance create" && !createUsesTemplate
      ? createRequiredOptions
      : requiredOptions

  if (!expectedOptions) {
    return
  }

  const missingOptions = expectedOptions.filter(
    (option) => !hasOption(args, option)
  )
  if (missingOptions.length === 0) {
    return
  }

  const usage = commandUsage[command as keyof typeof commandUsage]
  throw new Error(
    [
      `Incomplete arguments for \`${command}\`.`,
      `Missing required options: ${missingOptions.join(", ")}.`,
      usage ? `Use this complete form: ${usage}.` : "",
      "Do not retry by adding only one missing option.",
    ]
      .filter(Boolean)
      .join(" ")
  )
}

type CompShareCliRunner = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutSeconds: number }
) => Promise<unknown>

function cliRuntime() {
  const configPath = getCompShareCliConfigPath()
  const env = getConfiguredPythonProcessEnvironment()
  const pythonExecutable = env.ASTRAFLOW_PYTHON_EXECUTABLE?.trim()

  if (
    !configPath ||
    !existsSync(configPath) ||
    !pythonExecutable ||
    !existsSync(pythonExecutable)
  ) {
    return null
  }

  return {
    configPath,
    env,
    pythonExecutable,
  }
}

function appendOutput(
  chunks: Buffer[],
  chunk: Buffer | string,
  currentBytes: number
) {
  const buffer = Buffer.from(chunk)
  const remaining = MAX_OUTPUT_BYTES - currentBytes

  if (remaining <= 0) {
    return { bytes: currentBytes, truncated: buffer.byteLength > 0 }
  }

  chunks.push(buffer.subarray(0, remaining))
  return {
    bytes: currentBytes + Math.min(buffer.byteLength, remaining),
    truncated: buffer.byteLength > remaining,
  }
}

async function runCompShareCli(
  command: string,
  args: string[],
  { signal, timeoutSeconds }: { signal?: AbortSignal; timeoutSeconds: number }
) {
  const runtime = cliRuntime()
  if (!runtime) {
    throw new Error(
      "CompShare CLI is unavailable. Install AstraFlow's managed Python runtime and sign in to CompShare."
    )
  }

  const commandParts = command.split(" ")
  const child = spawn(
    runtime.pythonExecutable,
    ["-m", "compshare_cli", "--json", ...commandParts, ...args],
    {
      env: {
        ...runtime.env,
        COMPSHARE_CONFIG_FILE: runtime.configPath,
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        PIP_NO_INPUT: "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  )
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let outputLimitExceeded = false
  let timedOut = false
  const abort = () => child.kill()
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutSeconds * 1000)

  signal?.addEventListener("abort", abort, { once: true })
  child.stdout.on("data", (chunk) => {
    const appended = appendOutput(stdout, chunk, stdoutBytes)
    stdoutBytes = appended.bytes
    outputLimitExceeded ||= appended.truncated
  })
  child.stderr.on("data", (chunk) => {
    const appended = appendOutput(stderr, chunk, stderrBytes)
    stderrBytes = appended.bytes
    outputLimitExceeded ||= appended.truncated
  })

  return new Promise<unknown>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, closeSignal) => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)

      if (signal?.aborted) {
        reject(signal.reason ?? new Error("CompShare CLI call cancelled."))
        return
      }

      if (timedOut) {
        reject(
          new Error(
            `CompShare CLI timed out after ${timeoutSeconds} seconds. Inspect the resource before retrying.`
          )
        )
        return
      }

      if (outputLimitExceeded) {
        reject(new Error("CompShare CLI output exceeded the 1 MiB limit."))
        return
      }

      const output = Buffer.concat(stdout).toString("utf8").trim()
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim()

      if (code !== 0) {
        reject(
          new Error(
            errorOutput ||
              output ||
              `CompShare CLI exited with code ${code ?? "null"} and signal ${closeSignal ?? "null"}.`
          )
        )
        return
      }

      try {
        resolve(JSON.parse(output))
      } catch {
        reject(new Error("CompShare CLI returned invalid JSON."))
      }
    })
  })
}

export function createCompShareCliTools({
  isAvailable = () => isCompShareChannel(),
  run = runCompShareCli,
}: {
  isAvailable?: () => boolean | Promise<boolean>
  run?: CompShareCliRunner
} = {}) {
  const sharedSchema = (argumentDescription: string) => ({
    arguments: commandArgumentsSchema.describe(argumentDescription),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(1800)
      .default(DEFAULT_TIMEOUT_SECONDS)
      .describe(
        "Host-side timeout in seconds. Keep the default for ordinary queries; use a longer timeout for lifecycle waits and remote jobs."
      ),
  })

  return [
    createAstraFlowTool(
      ({ arguments: args, command, timeout_seconds }, { signal }) => {
        assertCompleteCommandArguments(command, args)
        return run(command, args, {
          signal,
          timeoutSeconds: timeout_seconds,
        })
      },
      {
        name: "compshare_cli_query",
        description: queryToolDescription,
        effectCategory: "read_only",
        schema: z
          .object({
            command: z
              .enum(readOnlyCommands)
              .describe(
                "Exact read-only command path. Select one enumerated command; never put positional values in this field."
              ),
            ...sharedSchema(
              "Complete argv after the selected command. Every option and value is a separate string. Do not include compshare, --json, or --show-sensitive. Before invoking, include every required option shown in the tool description; use --memory (for example 64GiB), never --mem."
            ),
          })
          .strict(),
        isAvailable,
        unavailableMessage:
          "CompShare CLI requires the managed Python runtime and an active CompShare OAuth login.",
      }
    ),
    createAstraFlowTool(
      ({ arguments: args, command, timeout_seconds }, { signal }) => {
        assertCompleteCommandArguments(command, args)
        return run(command, args, {
          signal,
          timeoutSeconds: timeout_seconds,
        })
      },
      {
        name: "compshare_cli_action",
        description: actionToolDescription,
        effectCategory: "important_action",
        schema: z
          .object({
            command: z
              .enum(actionCommands)
              .describe(
                "Exact state-changing command path. Select one enumerated command; never put positional values in this field."
              ),
            ...sharedSchema(
              "Complete argv after the selected command. Every option and value is a separate string. Do not include compshare, --json, or --show-sensitive. Include all required options in one call. For create, use --memory with a unit such as 64GiB and begin with --dry-run."
            ),
          })
          .strict(),
        isAvailable,
        unavailableMessage:
          "CompShare CLI requires the managed Python runtime and an active CompShare OAuth login.",
      }
    ),
  ]
}
