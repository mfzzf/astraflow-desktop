/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require("node:child_process")
const { win32: windowsPath } = require("node:path")

function readEnvironmentValue(environment, name) {
  const entry = Object.entries(environment).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  )

  return entry?.[1]
}

function createPowerShellEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => key.toLowerCase() !== "psmodulepath"
    )
  )
}

function resolveWindowsPowerShellExecutable(environment = process.env) {
  const systemRoot = readEnvironmentValue(environment, "SystemRoot")

  return systemRoot
    ? windowsPath.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"
      )
    : "powershell.exe"
}

function preparePowerShellExec(command, timeout = 20_000, environment) {
  return [
    resolveWindowsPowerShellExecutable(environment),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-InputFormat",
      "None",
      "-Command",
      command,
    ],
    {
      encoding: "utf8",
      env: createPowerShellEnvironment(environment),
      maxBuffer: 1024 * 1024 * 4,
      shell: false,
      timeout,
      windowsHide: true,
    },
  ]
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''")
}

function readAuthenticodeSignature(filePath) {
  const escapedPath = escapePowerShellSingleQuoted(filePath)
  const command = [
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    `Get-AuthenticodeSignature -LiteralPath '${escapedPath}' | ConvertTo-Json -Depth 6 -Compress`,
  ].join("; ")

  return new Promise((resolveSignature, rejectSignature) => {
    execFile(...preparePowerShellExec(command), (error, stdout, stderr) => {
      if (error) {
        rejectSignature(error)
        return
      }

      if (stderr) {
        rejectSignature(
          new Error(`Cannot inspect Authenticode signature: ${stderr}`)
        )
        return
      }

      try {
        const trimmed = stdout.trim()

        if (!trimmed) {
          throw new Error("Empty Authenticode signature output.")
        }

        resolveSignature(JSON.parse(trimmed))
      } catch (parseError) {
        rejectSignature(parseError)
      }
    })
  })
}

module.exports = {
  createPowerShellEnvironment,
  escapePowerShellSingleQuoted,
  preparePowerShellExec,
  readAuthenticodeSignature,
  resolveWindowsPowerShellExecutable,
}
