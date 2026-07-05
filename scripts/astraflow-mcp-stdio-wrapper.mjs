import { spawn } from "node:child_process"

function loadConfig() {
  const raw = process.env.ASTRAFLOW_MCP_STDIO_CONFIG

  if (!raw) {
    throw new Error("ASTRAFLOW_MCP_STDIO_CONFIG is not configured.")
  }

  const config = JSON.parse(raw)

  if (!config || typeof config.command !== "string" || !config.command.trim()) {
    throw new Error("ASTRAFLOW_MCP_STDIO_CONFIG.command is required.")
  }

  return {
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    command: config.command,
    cwd: typeof config.cwd === "string" && config.cwd.trim() ? config.cwd : undefined,
    env:
      config.env && typeof config.env === "object" && !Array.isArray(config.env)
        ? Object.fromEntries(
            Object.entries(config.env).map(([name, value]) => [
              name,
              String(value),
            ])
          )
        : {},
  }
}

const config = loadConfig()
const child = spawn(config.command, config.args, {
  cwd: config.cwd,
  env: {
    ...process.env,
    ...config.env,
  },
  stdio: ["inherit", "inherit", "inherit"],
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

child.once("exit", (code, signal) => {
  if (signal === "SIGINT") {
    process.exit(130)
  }

  if (signal) {
    process.exit(143)
  }

  process.exit(code ?? 0)
})
