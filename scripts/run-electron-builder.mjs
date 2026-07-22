import { spawn } from "node:child_process"

const OPTIONAL_SIGNING_ENV = [
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "WIN_CSC_LINK",
]

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    })

    child.once("error", rejectRun)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} failed with code ${
            code ?? "null"
          } and signal ${signal ?? "null"}.`
        )
      )
    })
  })
}

for (const key of OPTIONAL_SIGNING_ENV) {
  if (process.env[key] === "") {
    delete process.env[key]
  }
}

const releaseRootUrl = "https://astraflow-desktop.cn-sh2.ufileos.com"
const releaseChannelSlug = (
  process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG || "compshare"
)
  .trim()
  .toLowerCase()
process.env.ASTRAFLOW_RELEASE_BASE_URL ||=
  releaseChannelSlug === "compshare"
    ? `${releaseRootUrl}/compshare`
    : releaseRootUrl

const builderArgs = process.argv.slice(2)
const hasExplicitArch = ["--arm64", "--ia32", "--universal", "--x64"].some(
  (argument) => builderArgs.includes(argument)
)

if (!hasExplicitArch) {
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(
      `Electron packaging does not support the current architecture: ${process.arch}`
    )
  }

  // Native document modules are prepared for the host architecture. Package
  // one matching architecture per invocation; downloadable developer runtimes
  // are published separately for every platform in their own workflow.
  builderArgs.push(`--${process.arch}`)
}

let builderError = null

try {
  await run("bunx", ["electron-builder", ...builderArgs])
} catch (error) {
  builderError = error
} finally {
  if (process.env.CI !== "true") {
    await run("bun", ["install", "--force", "--frozen-lockfile"])
  }
}

if (builderError) {
  throw builderError
}
