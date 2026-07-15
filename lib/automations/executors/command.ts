import "server-only"

import { createWriteStream, mkdirSync, statSync, truncateSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { finished } from "node:stream/promises"

import {
  spawnLocalSandboxedCommand,
  terminateLocalSandboxedCommand,
} from "@/lib/agent/sandbox/local-command"
import { resolveLocalSandboxWritePath } from "@/lib/agent/sandbox/local-policy"
import { getStudioWorkspace } from "@/lib/studio-db/workspaces"

import { automationLogDirectory } from "../paths"
import { attachAutomationRunLog } from "../store"
import type {
  AutomationExecutorOutcome,
  AutomationRun,
  AutomationTask,
} from "../types"

const OUTPUT_PREVIEW_LIMIT = 64 * 1024

function appendPreview(current: string, chunk: Buffer | string) {
  const combined = `${current}${chunk.toString()}`
  return combined.length > OUTPUT_PREVIEW_LIMIT
    ? combined.slice(-OUTPUT_PREVIEW_LIMIT)
    : combined
}

function resolveWorkingDirectory(workspaceRoot: string, requested: string) {
  if (isAbsolute(requested)) {
    throw new Error("The working directory must be relative to the workspace.")
  }

  const root = resolve(workspaceRoot)
  const workingDirectory = resolve(root, requested || ".")
  const relativePath = relative(root, workingDirectory)

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("The working directory must stay inside the workspace.")
  }

  return resolveLocalSandboxWritePath(root, requested || ".")
}

export async function executeCommandAutomation({
  task,
  run,
  registerCancel,
  attachLog = attachAutomationRunLog,
  spawnCommand = spawnLocalSandboxedCommand,
  terminateCommand = terminateLocalSandboxedCommand,
}: {
  task: Extract<AutomationTask, { kind: "command" }>
  run: AutomationRun
  registerCancel: (cancel: () => void) => void
  attachLog?: (runId: string, logPath: string) => boolean
  spawnCommand?: typeof spawnLocalSandboxedCommand
  terminateCommand?: typeof terminateLocalSandboxedCommand
}): Promise<AutomationExecutorOutcome> {
  const workspace = task.workspaceId
    ? getStudioWorkspace(task.workspaceId)
    : null

  if (!workspace || workspace.type !== "local") {
    return {
      ok: false,
      error: "The selected local workspace is no longer available.",
      result: {},
    }
  }

  let workingDirectory: string
  try {
    workingDirectory = resolveWorkingDirectory(
      workspace.rootPath,
      task.payload.workingDirectory
    )
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Working directory is invalid.",
      result: {},
    }
  }

  const logDirectory = automationLogDirectory()
  mkdirSync(logDirectory, { recursive: true })
  const logPath = join(logDirectory, `${run.id}.log`)
  if (!attachLog(run.id, logPath)) {
    return {
      ok: false,
      error: "Command was cancelled before execution started.",
      result: {},
    }
  }
  let existingLogBytes = 0
  let existingLogTruncated = false
  try {
    existingLogBytes = statSync(logPath).size
    if (existingLogBytes > task.payload.maxLogBytes) {
      truncateSync(logPath, task.payload.maxLogBytes)
      existingLogBytes = task.payload.maxLogBytes
      existingLogTruncated = true
    }
  } catch {
    // A missing log is expected on the first attempt.
  }
  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 })
  const logCompletion = finished(logStream).then(
    () => null,
    (error: unknown) =>
      error instanceof Error ? error : new Error("Failed to write command log.")
  )
  let child: ReturnType<typeof spawnCommand>

  try {
    child = spawnCommand({
      command: task.payload.command,
      rootDir: workingDirectory,
      sessionId: `automation-${run.id}`,
    })
  } catch (error) {
    logStream.end()
    await logCompletion
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to start command.",
      result: { logPath },
    }
  }
  let stdout = ""
  let stderr = ""
  let loggedBytes = existingLogBytes
  let logTruncated = existingLogTruncated
  let timedOut = false
  let cancelled = false

  const writeLogChunk = (chunk: Buffer) => {
    const remainingBytes = task.payload.maxLogBytes - loggedBytes
    if (remainingBytes <= 0) {
      logTruncated = true
      return
    }

    const toWrite =
      chunk.byteLength <= remainingBytes
        ? chunk
        : chunk.subarray(0, remainingBytes)
    logStream.write(toWrite)
    loggedBytes += toWrite.byteLength
    if (toWrite.byteLength < chunk.byteLength) {
      logTruncated = true
    }
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = appendPreview(stdout, chunk)
    writeLogChunk(chunk)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = appendPreview(stderr, chunk)
    writeLogChunk(chunk)
  })

  const resultPromise = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    error: Error | null
  }>((resolveResult) => {
    child.once("error", (error) =>
      resolveResult({ code: null, signal: null, error })
    )
    child.once("close", (code, signal) =>
      resolveResult({ code, signal, error: null })
    )
  })

  registerCancel(() => {
    cancelled = true
    terminateCommand(child)
  })

  const timeout = setTimeout(() => {
    timedOut = true
    terminateCommand(child)
  }, task.timeoutSeconds * 1000)
  timeout.unref?.()

  const result = await resultPromise
  clearTimeout(timeout)
  logStream.end()
  const logError = await logCompletion

  const outputPreview = [
    stdout.trim(),
    stderr.trim(),
    logTruncated
      ? `[Full log truncated at ${task.payload.maxLogBytes} bytes.]`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  const executionResult = {
    exitCode: result.code,
    logPath,
    outputPreview,
  }

  if (logError) {
    return {
      ok: false,
      error: `Failed to write command log: ${logError.message}`,
      result: executionResult,
    }
  }

  if (cancelled) {
    return {
      ok: false,
      error: "Command was cancelled.",
      result: executionResult,
    }
  }
  if (timedOut) {
    return {
      ok: false,
      error: `Command timed out after ${task.timeoutSeconds} seconds.`,
      result: executionResult,
    }
  }
  if (result.error) {
    return { ok: false, error: result.error.message, result: executionResult }
  }
  if (result.signal) {
    return {
      ok: false,
      error: `Command stopped with signal ${result.signal}.`,
      result: executionResult,
    }
  }
  if (result.code !== 0) {
    return {
      ok: false,
      error: `Command exited with code ${result.code ?? 1}.`,
      result: executionResult,
    }
  }

  return { ok: true, result: executionResult }
}
