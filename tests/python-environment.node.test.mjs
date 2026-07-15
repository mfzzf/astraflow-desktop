import assert from "node:assert/strict"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import pythonEnvironment from "../electron/python-environment.cjs"

const { createPythonEnvironmentManager } = pythonEnvironment

let testRoot = ""
let appRoot = ""
let userDataPath = ""
let bootstrapExecutable = ""

function writeFakePython(executable) {
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs")
const { dirname, join } = require("node:path")
const args = process.argv.slice(2)
const executable = process.argv[1]
const prefix = dirname(dirname(executable))
const packagesPath = join(prefix, "fake-packages.json")
const readPackages = () => existsSync(packagesPath)
  ? JSON.parse(readFileSync(packagesPath, "utf8"))
  : [{ name: "pip", version: "26.1-test" }]
const writePackages = (packages) => writeFileSync(packagesPath, JSON.stringify(packages))

if (args[0] === "-c") {
  console.log(JSON.stringify({
    executable,
    version: "3.12.13-test",
    prefix,
    basePrefix: prefix,
    roots: [prefix, dirname(executable)],
  }))
} else if (args[0] === "-m" && args[1] === "venv") {
  const target = args.at(-1)
  const targetExecutable = join(target, "bin", "python3")
  mkdirSync(dirname(targetExecutable), { recursive: true })
  copyFileSync(executable, targetExecutable)
  chmodSync(targetExecutable, 0o755)
  writeFileSync(
    join(target, "fake-packages.json"),
    JSON.stringify([{ name: "pip", version: "26.1-test" }])
  )
} else if (
  args[0] === "-m" &&
  args[1] === "pip" &&
  args.includes("list")
) {
  console.log(JSON.stringify(readPackages()))
} else if (
  args[0] === "-m" &&
  args[1] === "pip" &&
  args[2] === "index" &&
  args[3] === "versions"
) {
  const name = args[4]
  if (args.includes("--json")) {
    console.error("Usage: " + executable + " -m pip index versions <package>")
    console.error("no such option: --json")
    process.exitCode = 2
  } else {
    const installedVersion = readPackages().find((entry) => entry.name === name)?.version
    console.log(name + " (2.0.0)")
    console.log("Available versions: 2.0.0, 1.5.0, 1.0.0")
    if (installedVersion) {
      console.log("  INSTALLED: " + installedVersion)
      console.log("  LATEST: 2.0.0")
    }
  }
} else if (args[0] === "-m" && args[1] === "pip") {
  if (args[2] === "install" && !args.includes("--requirement")) {
    const packages = readPackages()

    for (const specifier of args.filter((value) => /^[A-Za-z0-9._-]+==[A-Za-z0-9.!+_-]+$/.test(value))) {
      const [name, version] = specifier.split("==")
      const next = packages.filter((entry) => entry.name !== name)
      next.push({ name, version })
      packages.splice(0, packages.length, ...next)
    }

    writePackages(packages)
  }
  console.log("fake pip command complete")
} else {
  console.error("Unsupported fake Python arguments", args)
  process.exitCode = 2
}
`
  )
  chmodSync(executable, 0o755)
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "astraflow-python-environment-"))
  appRoot = join(testRoot, "app")
  userDataPath = join(testRoot, "user-data")
  bootstrapExecutable = join(
    appRoot,
    "runtime",
    "python",
    `${process.platform}-${process.arch}`,
    "bin",
    "python3"
  )

  writeFakePython(bootstrapExecutable)
  writeFileSync(
    join(appRoot, "runtime", "python", "requirements.lock"),
    "# fake requirements lock\n"
  )
  writeFileSync(
    join(appRoot, "runtime", "python", "runtime-manifest.json"),
    '{"pythonVersion":"3.12.13-test"}\n'
  )
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

test("installs and activates one managed environment outside the app bundle", async (context) => {
  if (process.platform === "win32") {
    context.skip("The fake interpreter uses a POSIX executable script.")
    return
  }

  const manager = createPythonEnvironmentManager({ appRoot, userDataPath })
  const pending = await manager.getStatus()

  assert.equal(pending.mode, "managed")
  assert.equal(pending.ready, true)
  assert.equal(pending.needsInstall, true)
  assert.equal(pending.executable, bootstrapExecutable)
  assert.equal(
    manager.getActiveProcessEnvironment().PYTHONHOME,
    dirname(dirname(bootstrapExecutable))
  )

  const installed = await manager.install()
  const state = JSON.parse(readFileSync(manager.statePath, "utf8"))
  const activeEnvironment = manager.getActiveProcessEnvironment()

  assert.equal(installed.ready, true)
  assert.equal(installed.needsInstall, false)
  assert.equal(installed.stage, "ready")
  assert.match(installed.executable, /python-environments\/managed-/)
  assert.deepEqual(installed.packages, [
    {
      name: "pip",
      version: "26.1-test",
      required: false,
      userInstalled: false,
    },
  ])
  assert.equal(state.source, "managed")
  assert.ok(
    state.packageWriteRoots.includes(dirname(dirname(installed.executable)))
  )
  assert.equal(activeEnvironment.PYTHONHOME, undefined)
  assert.equal(activeEnvironment.ASTRAFLOW_PYTHON_EXECUTABLE, state.executable)

  manager.dispose()
})

test("searches, installs, and restores a custom package in the managed environment", async (context) => {
  if (process.platform === "win32") {
    context.skip("The fake interpreter uses a POSIX executable script.")
    return
  }

  const manager = createPythonEnvironmentManager({ appRoot, userDataPath })
  const search = await manager.searchPackage({ query: "demo-package" })

  assert.deepEqual(search, {
    name: "demo-package",
    versions: ["2.0.0", "1.5.0", "1.0.0"],
    latest: "2.0.0",
    installedVersion: null,
    managedByAstraFlow: false,
  })

  const installed = await manager.installPackage({
    name: "demo-package",
    version: "1.5.0",
  })
  const customPackage = installed.packages.find(
    (entry) => entry.name === "demo-package"
  )
  const savedPackages = JSON.parse(
    readFileSync(manager.userPackagesPath, "utf8")
  )

  assert.deepEqual(customPackage, {
    name: "demo-package",
    version: "1.5.0",
    required: false,
    userInstalled: true,
  })
  assert.deepEqual(savedPackages.packages, [
    { name: "demo-package", version: "1.5.0" },
  ])
  assert.equal(
    (await manager.searchPackage({ query: "demo-package" })).installedVersion,
    "1.5.0"
  )

  const rebuilt = await manager.install({ force: true })

  assert.equal(
    rebuilt.packages.find((entry) => entry.name === "demo-package")?.version,
    "1.5.0"
  )

  manager.dispose()
})

test("validates and activates a custom interpreter without mutating it", async (context) => {
  if (process.platform === "win32") {
    context.skip("The fake interpreter uses a POSIX executable script.")
    return
  }

  const customExecutable = join(testRoot, "custom", "bin", "python3")
  writeFakePython(customExecutable)
  const manager = createPythonEnvironmentManager({ appRoot, userDataPath })
  const status = await manager.configure({
    mode: "custom",
    customExecutable,
  })
  const state = JSON.parse(readFileSync(manager.statePath, "utf8"))

  assert.equal(status.mode, "custom")
  assert.equal(status.ready, true)
  assert.equal(status.needsInstall, false)
  assert.equal(status.executable, customExecutable)
  assert.equal(state.source, "custom")
  assert.equal(state.executable, customExecutable)
  assert.equal(manager.getActiveProcessEnvironment().PYTHONHOME, undefined)

  await assert.rejects(
    manager.configure({
      mode: "custom",
      customExecutable: join(testRoot, "missing", "python3"),
    }),
    /unavailable/
  )

  manager.dispose()
})

test("keeps AstraFlow requirement versions protected", async (context) => {
  if (process.platform === "win32") {
    context.skip("The fake interpreter uses a POSIX executable script.")
    return
  }

  writeFileSync(
    join(appRoot, "runtime", "python", "requirements.lock"),
    "managed-package==1.0.0\n"
  )
  const manager = createPythonEnvironmentManager({ appRoot, userDataPath })
  const search = await manager.searchPackage({ query: "managed-package" })

  assert.equal(search.managedByAstraFlow, true)
  await assert.rejects(
    manager.installPackage({ name: "managed-package", version: "2.0.0" }),
    /managed by AstraFlow/
  )

  manager.dispose()
})
