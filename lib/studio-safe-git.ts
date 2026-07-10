import { execFile } from "node:child_process"

const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
]

const SAFE_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
}

export function runSafeGit(
  path: string,
  args: string[],
  options: {
    timeout: number
    maxBuffer: number
    input?: string
    env?: Record<string, string | undefined>
  }
) {
  return new Promise<string>((resolve, reject) => {
    const { env, input, ...execOptions } = options
    const child = execFile(
      "git",
      [...SAFE_GIT_CONFIG_ARGS, "-C", path, ...args],
      {
        ...execOptions,
        env: {
          ...process.env,
          ...SAFE_GIT_ENV,
          ...env,
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(stdout.toString())
      }
    )

    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
}
