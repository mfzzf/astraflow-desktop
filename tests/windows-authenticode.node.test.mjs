import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const {
  createPowerShellEnvironment,
  escapePowerShellSingleQuoted,
  preparePowerShellExec,
  resolveWindowsPowerShellExecutable,
} = require("../electron/windows-authenticode.cjs")

test("invokes the system Windows PowerShell directly without a command shell", () => {
  const environment = {
    Path: "C:\\Windows\\System32",
    PSModulePath: "C:\\untrusted-modules",
    SystemRoot: "C:\\Windows",
  }
  const [executable, args, options] = preparePowerShellExec(
    "Get-AuthenticodeSignature 'C:\\AstraFlow.exe'",
    12_345,
    environment
  )

  assert.equal(
    executable,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  )
  assert.equal(options.shell, false)
  assert.equal(options.timeout, 12_345)
  assert.equal(options.env.PSModulePath, undefined)
  assert.deepEqual(args.slice(-2), [
    "-Command",
    "Get-AuthenticodeSignature 'C:\\AstraFlow.exe'",
  ])
})

test("removes PSModulePath case-insensitively without mutating other variables", () => {
  assert.deepEqual(
    createPowerShellEnvironment({ Path: "bin", pSmOdUlEpAtH: "modules" }),
    { Path: "bin" }
  )
})

test("falls back to PATH when SystemRoot is unavailable", () => {
  assert.equal(resolveWindowsPowerShellExecutable({ Path: "bin" }), "powershell.exe")
})

test("escapes single quotes in literal PowerShell paths", () => {
  assert.equal(
    escapePowerShellSingleQuoted("C:\\Users\\O'Brien\\AstraFlow.exe"),
    "C:\\Users\\O''Brien\\AstraFlow.exe"
  )
})
