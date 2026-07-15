// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"

import {
  createLocalSandboxPolicy,
  ensureLocalSandboxWorkspace,
  resolveLocalSandboxReadPath,
  resolveLocalSandboxWritePath,
} from "@/lib/agent/sandbox/local-policy"

describe("local sandbox policy", () => {
  let testRoot = ""
  let projectRoot = ""
  let outsideRoot = ""
  let previousWorkspaceRoot: string | undefined
  let previousOpenAiKey: string | undefined
  let previousPythonRoot: string | undefined
  let previousPythonStatePath: string | undefined

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "astraflow-sandbox-policy-"))
    projectRoot = join(testRoot, "project")
    outsideRoot = join(testRoot, "outside")
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(outsideRoot, { recursive: true })
    previousWorkspaceRoot = process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    previousOpenAiKey = process.env.OPENAI_API_KEY
    previousPythonRoot = process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT
    previousPythonStatePath = process.env.ASTRAFLOW_PYTHON_STATE_PATH
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(testRoot, "workspaces")
    process.env.OPENAI_API_KEY = "must-not-reach-the-command"
  })

  afterEach(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    } else {
      process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = previousWorkspaceRoot
    }

    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey
    }

    if (previousPythonRoot === undefined) {
      delete process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT
    } else {
      process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = previousPythonRoot
    }

    if (previousPythonStatePath === undefined) {
      delete process.env.ASTRAFLOW_PYTHON_STATE_PATH
    } else {
      process.env.ASTRAFLOW_PYTHON_STATE_PATH = previousPythonStatePath
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  test("allows ordinary local reads but blocks environment secret files", () => {
    const ordinaryFile = join(outsideRoot, "notes.txt")
    const envFile = join(projectRoot, ".env.local")
    writeFileSync(ordinaryFile, "hello")
    writeFileSync(envFile, "SECRET=value")

    expect(resolveLocalSandboxReadPath(projectRoot, ordinaryFile)).toBe(
      realpathSync.native(ordinaryFile)
    )
    expect(() => resolveLocalSandboxReadPath(projectRoot, envFile)).toThrow(
      "environment secret files"
    )
  })

  test("limits writes to the project and explicit session workspace", () => {
    const workspace = ensureLocalSandboxWorkspace("session/../one")
    const projectOutput = join(projectRoot, "output", "result.xlsx")
    const workspaceOutput = join(workspace, "generated", "result.pptx")

    expect(resolveLocalSandboxWritePath(projectRoot, projectOutput)).toBe(
      join(realpathSync.native(projectRoot), "output", "result.xlsx")
    )
    expect(
      resolveLocalSandboxWritePath(projectRoot, workspaceOutput, [workspace])
    ).toBe(workspaceOutput)
    mkdirSync(join(workspace, "skills", "xlsx"), { recursive: true })
    expect(() =>
      resolveLocalSandboxWritePath(
        projectRoot,
        join(workspace, "skills", "xlsx", "SKILL.md"),
        [workspace]
      )
    ).toThrow("managed read-only path")
    expect(() =>
      resolveLocalSandboxWritePath(
        projectRoot,
        join(outsideRoot, "escaped.txt")
      )
    ).toThrow("outside the selected project")
    expect(() =>
      resolveLocalSandboxWritePath(
        resolve("."),
        resolve("bundled-skills", "pptx", "SKILL.md")
      )
    ).toThrow("managed read-only path")
  })

  test("resolves parent symlinks before checking the write boundary", () => {
    if (process.platform === "win32") {
      return
    }

    const linkPath = join(projectRoot, "escaped-link")
    symlinkSync(outsideRoot, linkPath, "dir")

    expect(() =>
      resolveLocalSandboxWritePath(projectRoot, join(linkPath, "result.txt"))
    ).toThrow("outside the selected project")
  })

  test("builds a fail-closed command policy without inherited secrets", () => {
    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "policy-session",
    })

    expect(policy.config.network.allowedDomains).toEqual([])
    expect(policy.config.network.deniedDomains).toEqual(["*"])
    expect(policy.config.allowAppleEvents).toBe(false)
    expect(policy.config.filesystem.allowWrite).toContain(
      realpathSync.native(projectRoot)
    )
    expect(policy.config.filesystem.allowWrite).toContain(policy.workspaceDir)
    expect(policy.commandEnv.OPENAI_API_KEY).toBeUndefined()
    expect(policy.commandEnv.ASTRAFLOW_NODE_EXECUTABLE).toBeTruthy()
    expect(policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE).toBeTruthy()
    expect(policy.commandEnv.NODE_PATH).toContain("node_modules")
    expect(policy.config.credentials?.envVars).toContainEqual({
      mode: "deny",
      name: "OPENAI_API_KEY",
    })
  })

  test("allows the trusted runner to prompt for unmatched network hosts", () => {
    const policy = createLocalSandboxPolicy({
      allowNetworkPrompt: true,
      rootDir: projectRoot,
      sessionId: "network-prompt-session",
    })

    expect(policy.config.network.deniedDomains).toEqual([])
    expect(policy.config.network.strictAllowlist).toBe(false)
    expect(policy.config.network.allowLocalBinding).toBe(false)
    expect(policy.config.network.allowAllUnixSockets).toBe(false)
  })

  test("blocks commands instead of falling back to a system Python", () => {
    process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = join(testRoot, "missing-python")

    expect(() =>
      createLocalSandboxPolicy({
        rootDir: projectRoot,
        sessionId: "missing-python-session",
      })
    ).toThrow("instead of falling back to a system Python")
  })

  test("puts the configured bundled Python first on PATH", () => {
    const pythonRoot = join(testRoot, "python-runtime")
    const binDirectory =
      process.platform === "win32" ? pythonRoot : join(pythonRoot, "bin")
    const executable =
      process.platform === "win32"
        ? join(pythonRoot, "python.exe")
        : join(binDirectory, "python3")

    mkdirSync(binDirectory, { recursive: true })
    writeFileSync(executable, "bundled python placeholder")
    chmodSync(executable, 0o755)
    process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = pythonRoot

    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "bundled-python-session",
    })

    expect(policy.commandEnv.PATH.split(delimiter)[0]).toBe(
      realpathSync.native(binDirectory)
    )
    expect(policy.commandEnv.PYTHONHOME).toBe(realpathSync.native(pythonRoot))
    expect(policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE).toBe(
      realpathSync.native(executable)
    )
  })

  test("uses the configured shared Python without exposing it to writes", () => {
    const bundledRoot = join(testRoot, "python-bootstrap")
    const bundledBin =
      process.platform === "win32" ? bundledRoot : join(bundledRoot, "bin")
    const bundledExecutable =
      process.platform === "win32"
        ? join(bundledRoot, "python.exe")
        : join(bundledBin, "python3")
    const customRoot = join(testRoot, "custom-python")
    const customBin =
      process.platform === "win32" ? customRoot : join(customRoot, "bin")
    const customExecutable =
      process.platform === "win32"
        ? join(customRoot, "python.exe")
        : join(customBin, "python3")
    const statePath = join(testRoot, "python-environment-state.json")

    mkdirSync(bundledBin, { recursive: true })
    mkdirSync(customBin, { recursive: true })
    writeFileSync(bundledExecutable, "bootstrap python placeholder")
    writeFileSync(customExecutable, "custom python placeholder")
    chmodSync(bundledExecutable, 0o755)
    chmodSync(customExecutable, 0o755)
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "custom",
        ready: true,
        executable: customExecutable,
        roots: [customRoot],
        isolated: false,
        pythonUserBase: customRoot,
      })
    )
    process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = bundledRoot
    process.env.ASTRAFLOW_PYTHON_STATE_PATH = statePath

    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "custom-python-session",
    })

    expect(policy.commandEnv.PATH.split(delimiter)[0]).toBe(
      realpathSync.native(customBin)
    )
    expect(policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE).toBe(
      realpathSync.native(customExecutable)
    )
    expect(policy.commandEnv.PYTHONHOME).toBeUndefined()
    expect(policy.commandEnv.PYTHONUSERBASE).toBe(customRoot)
    expect(policy.config.filesystem.allowRead).toContain(
      realpathSync.native(customRoot)
    )
    expect(policy.config.filesystem.denyWrite).toContain(
      realpathSync.native(customRoot)
    )
  })

  test("lets the managed Python environment install packages only from PyPI", () => {
    const bundledRoot = join(testRoot, "python-bootstrap")
    const bundledBin =
      process.platform === "win32" ? bundledRoot : join(bundledRoot, "bin")
    const bundledExecutable =
      process.platform === "win32"
        ? join(bundledRoot, "python.exe")
        : join(bundledBin, "python3")
    const managedRoot = join(testRoot, "python-environments", "managed-test")
    const managedBin =
      process.platform === "win32"
        ? join(managedRoot, "Scripts")
        : join(managedRoot, "bin")
    const managedExecutable =
      process.platform === "win32"
        ? join(managedBin, "python.exe")
        : join(managedBin, "python3")
    const statePath = join(testRoot, "python-environment-state.json")

    mkdirSync(bundledBin, { recursive: true })
    mkdirSync(managedBin, { recursive: true })
    writeFileSync(bundledExecutable, "bootstrap python placeholder")
    writeFileSync(managedExecutable, "managed python placeholder")
    chmodSync(bundledExecutable, 0o755)
    chmodSync(managedExecutable, 0o755)
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "managed",
        ready: true,
        executable: managedExecutable,
        roots: [managedRoot, bundledRoot],
        packageWriteRoots: [managedRoot],
        isolated: true,
        pythonUserBase: null,
      })
    )
    process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = bundledRoot
    process.env.ASTRAFLOW_PYTHON_STATE_PATH = statePath

    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "managed-python-session",
    })
    const canonicalManagedRoot = realpathSync.native(managedRoot)

    expect(policy.commandEnv.PATH.split(delimiter)[0]).toBe(
      realpathSync.native(managedBin)
    )
    expect(policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE).toBe(
      realpathSync.native(managedExecutable)
    )
    expect(policy.commandEnv.PIP_NO_INPUT).toBe("1")
    expect(policy.config.filesystem.allowWrite).toContain(canonicalManagedRoot)
    expect(policy.config.filesystem.denyWrite).not.toContain(
      canonicalManagedRoot
    )
    expect(policy.config.network.allowedDomains).toEqual([
      "pypi.org",
      "files.pythonhosted.org",
    ])
    expect(policy.config.network.deniedDomains).toEqual([])
  })
})
