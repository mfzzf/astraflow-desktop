// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
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
  let previousDeveloperNodeRoot: string | undefined
  let previousDeveloperNodeExecutable: string | undefined
  let previousNpmPrefix: string | undefined
  let previousNpmCache: string | undefined
  let previousStateKeyPath: string | undefined
  let previousUserDataPath: string | undefined
  let previousAttachmentsPath: string | undefined
  let previousSqlitePath: string | undefined
  let previousManagedWorkspacesPath: string | undefined
  let previousSrtWinPath: string | undefined

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
    previousDeveloperNodeRoot = process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT
    previousDeveloperNodeExecutable =
      process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE
    previousNpmPrefix = process.env.ASTRAFLOW_NPM_PREFIX
    previousNpmCache = process.env.ASTRAFLOW_NPM_CACHE
    previousStateKeyPath = process.env.ASTRAFLOW_ACP_STATE_KEY_PATH
    previousUserDataPath = process.env.ASTRAFLOW_USER_DATA_PATH
    previousAttachmentsPath = process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH
    previousSqlitePath = process.env.ASTRAFLOW_SQLITE_PATH
    previousManagedWorkspacesPath =
      process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH
    previousSrtWinPath = process.env.ASTRAFLOW_SRT_WIN_PATH
    delete process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT
    delete process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE
    delete process.env.ASTRAFLOW_NPM_PREFIX
    delete process.env.ASTRAFLOW_NPM_CACHE
    delete process.env.ASTRAFLOW_SRT_WIN_PATH
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(testRoot, "workspaces")
    process.env.ASTRAFLOW_ACP_STATE_KEY_PATH = join(
      testRoot,
      "private",
      "acp-state.key"
    )
    process.env.ASTRAFLOW_USER_DATA_PATH = join(testRoot, "user-data")
    process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(
      testRoot,
      "user-data",
      "acp-attachments"
    )
    process.env.ASTRAFLOW_SQLITE_PATH = join(
      testRoot,
      "user-data",
      "astraflow.sqlite"
    )
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(
      testRoot,
      "managed-workspaces"
    )
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

    for (const [name, value] of [
      ["ASTRAFLOW_DEVELOPER_NODE_ROOT", previousDeveloperNodeRoot],
      ["ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE", previousDeveloperNodeExecutable],
      ["ASTRAFLOW_NPM_PREFIX", previousNpmPrefix],
      ["ASTRAFLOW_NPM_CACHE", previousNpmCache],
      ["ASTRAFLOW_ACP_STATE_KEY_PATH", previousStateKeyPath],
      ["ASTRAFLOW_USER_DATA_PATH", previousUserDataPath],
      ["ASTRAFLOW_ACP_ATTACHMENTS_PATH", previousAttachmentsPath],
      ["ASTRAFLOW_SQLITE_PATH", previousSqlitePath],
      ["ASTRAFLOW_MANAGED_WORKSPACES_PATH", previousManagedWorkspacesPath],
      ["ASTRAFLOW_SRT_WIN_PATH", previousSrtWinPath],
    ] as const) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  test("canonicalizes host-selected reads but blocks environment secret files", () => {
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
    expect(policy.config.filesystem.denyRead).toContain(
      resolve(process.env.ASTRAFLOW_ACP_STATE_KEY_PATH!)
    )
    expect(policy.config.filesystem.denyRead).toContain(
      realpathSync.native(homedir())
    )
    expect(policy.config.filesystem.denyRead).toContain(
      resolve(process.env.ASTRAFLOW_USER_DATA_PATH!)
    )
    expect(policy.config.filesystem.denyRead).toContain(
      resolve(process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH!)
    )
    expect(policy.config.filesystem.denyRead).toContain(
      resolve(process.env.ASTRAFLOW_SQLITE_PATH!)
    )
    expect(policy.config.filesystem.denyRead).toContain(
      `${resolve(process.env.ASTRAFLOW_SQLITE_PATH!)}-journal`
    )
    expect(policy.config.filesystem.denyRead).toContain(
      `${resolve(process.env.ASTRAFLOW_SQLITE_PATH!)}-shm`
    )
    expect(policy.config.filesystem.denyRead).toContain(
      `${resolve(process.env.ASTRAFLOW_SQLITE_PATH!)}-wal`
    )
    expect(policy.config.filesystem.allowRead).not.toContain(
      realpathSync.native(homedir())
    )
    expect(policy.config.filesystem.allowRead).not.toContain(resolve("."))
    expect(policy.config.filesystem.denyWrite).not.toContain(
      realpathSync.native(homedir())
    )
    expect(policy.config.filesystem.denyWrite).not.toContain(
      resolve(process.env.ASTRAFLOW_USER_DATA_PATH!)
    )
    expect(policy.commandEnv.OPENAI_API_KEY).toBeUndefined()
    expect(policy.commandEnv.ASTRAFLOW_NODE_EXECUTABLE).toBeTruthy()
    expect(policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE).toBeTruthy()
    expect(policy.commandEnv.NODE_PATH).toContain("node_modules")
    expect(policy.config.credentials?.envVars).toContainEqual({
      mode: "deny",
      name: "OPENAI_API_KEY",
    })
  })

  test("uses the explicitly unpacked srt-win helper on Windows", () => {
    const srtWinPath = join(testRoot, "runtime", "sandbox", "srt-win.exe")
    mkdirSync(join(testRoot, "runtime", "sandbox"), { recursive: true })
    writeFileSync(srtWinPath, "srt-win placeholder")
    process.env.ASTRAFLOW_SRT_WIN_PATH = srtWinPath

    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "windows-srt-session",
    })

    expect(policy.config.windows?.srtWin?.path).toBe(
      realpathSync.native(srtWinPath)
    )
  })

  test("fails closed without recreating a missing workspace root", () => {
    rmSync(projectRoot, { recursive: true })

    expect(() =>
      createLocalSandboxPolicy({
        rootDir: projectRoot,
        sessionId: "missing-workspace-session",
      })
    ).toThrow("The selected workspace is unavailable")
    expect(existsSync(projectRoot)).toBe(false)
  })

  test("rejects non-directory and symbolic-link workspace roots", () => {
    rmSync(projectRoot, { recursive: true })
    writeFileSync(projectRoot, "not a directory")

    expect(() =>
      createLocalSandboxPolicy({
        rootDir: projectRoot,
        sessionId: "file-workspace-session",
      })
    ).toThrow("The selected workspace is not a directory")

    if (process.platform === "win32") {
      return
    }

    rmSync(projectRoot)
    symlinkSync(outsideRoot, projectRoot, "dir")

    expect(() =>
      createLocalSandboxPolicy({
        rootDir: projectRoot,
        sessionId: "symlink-workspace-session",
      })
    ).toThrow("The selected workspace cannot be a symbolic link")
  })

  test("carves back only the current attachment and sandbox session roots", () => {
    const attachmentParent = resolve(
      process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH!
    )
    const currentAttachmentRoot = join(attachmentParent, "current-session")
    const siblingAttachmentRoot = join(attachmentParent, "sibling-session")
    const siblingSandboxRoot = ensureLocalSandboxWorkspace("sibling-session")
    const managedWorkspaceParent = resolve(
      process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH!
    )
    const currentManagedWorkspace = join(
      managedWorkspaceParent,
      "current-workspace"
    )
    const siblingManagedWorkspace = join(
      managedWorkspaceParent,
      "sibling-workspace"
    )

    mkdirSync(currentAttachmentRoot, { recursive: true })
    mkdirSync(siblingAttachmentRoot, { recursive: true })
    mkdirSync(currentManagedWorkspace, { recursive: true })
    mkdirSync(siblingManagedWorkspace, { recursive: true })

    const policy = createLocalSandboxPolicy({
      additionalReadRoots: [currentAttachmentRoot],
      rootDir: currentManagedWorkspace,
      sessionId: "current-session",
    })

    expect(policy.config.filesystem.denyRead).toContain(attachmentParent)
    expect(policy.config.filesystem.denyRead).toContain(managedWorkspaceParent)
    expect(policy.config.filesystem.allowRead).toContain(
      realpathSync.native(currentAttachmentRoot)
    )
    expect(policy.config.filesystem.allowRead).not.toContain(
      realpathSync.native(siblingAttachmentRoot)
    )
    expect(policy.config.filesystem.allowRead).toContain(
      realpathSync.native(currentManagedWorkspace)
    )
    expect(policy.config.filesystem.allowRead).not.toContain(
      realpathSync.native(siblingManagedWorkspace)
    )
    expect(policy.config.filesystem.allowRead).not.toContain(siblingSandboxRoot)
    expect(policy.config.filesystem.allowRead).toContain(policy.workspaceDir)
  })

  test("keeps loopback provider access exact-port and out of the host allowlist", () => {
    const policy = createLocalSandboxPolicy({
      additionalAllowedNetworkEndpoints: [{ host: "127.0.0.1", port: 3456 }],
      rootDir: projectRoot,
      sessionId: "provider-endpoint-session",
    })

    expect(policy.config.network.allowedDomains).not.toContain("127.0.0.1")
    expect(policy.config.network.deniedDomains).toEqual([])
    expect(policy.config.network.strictAllowlist).toBe(false)
    expect(policy.allowedNetworkEndpoints).toEqual([
      { host: "127.0.0.1", port: 3456 },
    ])

    expect(() =>
      createLocalSandboxPolicy({
        additionalAllowedNetworkEndpoints: [
          { host: "127.0.0.1", port: 65_536 },
        ],
        rootDir: projectRoot,
        sessionId: "invalid-provider-endpoint-session",
      })
    ).toThrow("Invalid AstraFlow sandbox network endpoint")
  })

  test("adds ACP process roots and masks provider credentials to one host", () => {
    const stateRoot = join(testRoot, "private-state")
    const runtimeStateRoot = join(testRoot, "runtime-state")
    const skillsRoot = join(testRoot, "native-skills")
    const previousStateKey = process.env.ASTRAFLOW_ACP_STATE_KEY

    mkdirSync(stateRoot, { recursive: true })
    mkdirSync(runtimeStateRoot, { recursive: true })
    mkdirSync(skillsRoot, { recursive: true })
    process.env.ASTRAFLOW_ACP_STATE_KEY = "state-key-must-be-consumed-by-acp"

    try {
      const policy = createLocalSandboxPolicy({
        additionalAllowedDomains: ["API.ModelVerse.CN"],
        additionalReadRoots: [skillsRoot],
        additionalWriteRoots: [stateRoot, runtimeStateRoot],
        maskedEnvironmentVariables: [
          {
            injectHosts: ["api.modelverse.cn"],
            name: "ASTRAFLOW_MODELVERSE_API_KEY",
          },
        ],
        passthroughEnvironmentVariables: ["ASTRAFLOW_ACP_STATE_KEY"],
        rootDir: projectRoot,
        sessionId: "acp-process-session",
      })

      expect(policy.config.network.allowedDomains).toContain(
        "api.modelverse.cn"
      )
      expect(policy.config.network.strictAllowlist).toBe(true)
      expect(policy.config.network.tlsTerminate).toEqual({})
      expect(policy.config.filesystem.allowRead).toContain(
        realpathSync.native(skillsRoot)
      )
      expect(policy.config.filesystem.allowWrite).toContain(
        realpathSync.native(stateRoot)
      )
      expect(policy.config.filesystem.allowWrite).toContain(
        realpathSync.native(runtimeStateRoot)
      )
      expect(policy.config.credentials?.envVars).toContainEqual({
        injectHosts: ["api.modelverse.cn"],
        mode: "mask",
        name: "ASTRAFLOW_MODELVERSE_API_KEY",
      })
      expect(policy.config.credentials?.envVars).not.toContainEqual({
        mode: "deny",
        name: "ASTRAFLOW_ACP_STATE_KEY",
      })
    } finally {
      if (previousStateKey === undefined) {
        delete process.env.ASTRAFLOW_ACP_STATE_KEY
      } else {
        process.env.ASTRAFLOW_ACP_STATE_KEY = previousStateKey
      }
    }
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
    expect(policy.config.network.allowedDomains).toEqual([])
    expect(policy.allowedNetworkEndpoints).toEqual([
      { host: "pypi.org", port: 443 },
      { host: "files.pythonhosted.org", port: 443 },
    ])
    expect(policy.config.network.deniedDomains).toEqual([])
  })

  test("exposes managed npm with isolated writable cache and registry access", () => {
    const nodeRoot = join(testRoot, "developer-runtimes", "node")
    const nodeBin =
      process.platform === "win32" ? nodeRoot : join(nodeRoot, "bin")
    const nodeExecutable = join(
      nodeBin,
      process.platform === "win32" ? "node.exe" : "node"
    )
    const npmPrefix = join(testRoot, "npm-global")
    const npmCache = join(testRoot, "npm-cache")

    mkdirSync(nodeBin, { recursive: true })
    writeFileSync(nodeExecutable, "managed node placeholder")
    chmodSync(nodeExecutable, 0o755)
    process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT = nodeRoot
    process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE = nodeExecutable
    process.env.ASTRAFLOW_NPM_PREFIX = npmPrefix
    process.env.ASTRAFLOW_NPM_CACHE = npmCache

    const policy = createLocalSandboxPolicy({
      rootDir: projectRoot,
      sessionId: "managed-node-session",
    })

    expect(policy.commandEnv.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE).toBe(
      realpathSync.native(nodeExecutable)
    )
    expect(policy.commandEnv.NPM_CONFIG_PREFIX).toBe(npmPrefix)
    expect(policy.commandEnv.NPM_CONFIG_CACHE).toBe(npmCache)
    expect(policy.config.filesystem.allowWrite).toContain(resolve(npmPrefix))
    expect(policy.config.filesystem.allowWrite).toContain(resolve(npmCache))
    expect(policy.config.network.allowedDomains).toEqual([])
    expect(policy.allowedNetworkEndpoints).toEqual([
      { host: "registry.npmjs.org", port: 443 },
    ])
  })
})
