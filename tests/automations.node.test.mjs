import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { after, before, describe, test } from "node:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { PassThrough } from "node:stream"

register("./helpers/automation-typescript-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-automations-"))
const workspaceRoot = join(testDirectory, "workspace")
const logDirectory = join(testDirectory, "logs")
const notificationDirectory = join(testDirectory, "notifications")

process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")
process.env.ASTRAFLOW_AUTOMATION_LOG_DIR = logDirectory
process.env.ASTRAFLOW_AUTOMATION_NOTIFICATIONS_PATH = notificationDirectory

const scheduleModule = await import("../lib/automations/schedule.ts")
const store = await import("../lib/automations/store.ts")
const notifications = await import("../lib/automations/notifications.ts")
const commandExecutor = await import("../lib/automations/executors/command.ts")
const aiExecutor = await import("../lib/automations/executors/ai.ts")
const agentRuntime = await import("../lib/agent/runtime.ts")
const studioDb = await import("../lib/studio-db.ts")

let workspace
let sandboxWorkspace

function commandInput({
  name,
  schedule = { kind: "daily", time: "00:01" },
  maxRetries = 0,
  retryDelaySeconds = 10,
  misfirePolicy = "run_once",
} = {}) {
  return {
    name: name ?? "Command automation",
    kind: "command",
    enabled: true,
    workspaceId: workspace.id,
    schedule,
    timeZone: "UTC",
    payload: {
      command: "printf ready",
      workingDirectory: ".",
      maxLogBytes: 10 * 1024 * 1024,
    },
    timeoutSeconds: 60,
    concurrencyPolicy: "skip",
    misfirePolicy,
    maxRetries,
    retryDelaySeconds,
  }
}

function aiInput(name = "AI automation", runtimeId = "astraflow") {
  return {
    name,
    kind: "ai",
    enabled: true,
    workspaceId: null,
    schedule: { kind: "daily", time: "12:00" },
    timeZone: "UTC",
    payload: {
      prompt: "Summarize the project.",
      runtimeId,
      model: "test-model",
      reasoningEffort: null,
      permissionMode: "default",
    },
    timeoutSeconds: 60,
    concurrencyPolicy: "skip",
    misfirePolicy: "run_once",
    maxRetries: 0,
    retryDelaySeconds: 10,
  }
}

function createFakeChild({ output = "", autoClose = true } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()

  if (autoClose) {
    setImmediate(() => {
      if (output) {
        child.stdout.write(output)
      }
      child.emit("close", 0, null)
    })
  }

  return child
}

function disableTask(taskId) {
  studioDb
    .getStudioDatabase()
    .prepare(
      "UPDATE studio_scheduled_tasks SET enabled = 0, next_run_at = NULL WHERE id = ?"
    )
    .run(taskId)
}

before(() => {
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(logDirectory, { recursive: true })
  const project = studioDb.createStudioLocalProject({
    name: "Automation test workspace",
    path: workspaceRoot,
  })
  workspace = studioDb.getStudioWorkspaceForLocalProject(project.id)
  assert.ok(workspace)
  sandboxWorkspace = studioDb.createStudioSandboxWorkspace({
    name: "Automation sandbox",
    rootPath: "/workspace",
    sandboxId: "automation-sandbox",
  })
})

after(() => {
  for (const run of globalThis.astraflowStudioChatRuns?.values() ?? []) {
    if (run.abortWatchdogTimer) {
      clearTimeout(run.abortWatchdogTimer)
    }
    if (run.cleanupTimer) {
      clearTimeout(run.cleanupTimer)
    }
    if (run.livePublishTimer) {
      clearTimeout(run.livePublishTimer)
    }
  }
  globalThis.astraflowStudioChatRuns?.clear()
  globalThis.astraflowStudioChatRunListeners?.clear()
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

describe("automation schedule calculation", () => {
  test("converts local one-time schedules with their IANA time zone", () => {
    assert.equal(
      scheduleModule.getNextAutomationRunAt({
        schedule: { kind: "once", localDateTime: "2026-07-15T09:00" },
        timeZone: "Asia/Shanghai",
        after: new Date("2026-07-15T00:00:00.000Z"),
      }),
      "2026-07-15T01:00:00.000Z"
    )
  })

  test("uses daylight-saving offsets for recurring schedules", () => {
    assert.equal(
      scheduleModule.getNextAutomationRunAt({
        schedule: { kind: "daily", time: "09:00" },
        timeZone: "America/New_York",
        after: new Date("2026-03-08T06:00:00.000Z"),
      }),
      "2026-03-08T13:00:00.000Z"
    )
  })

  test("rejects nonexistent local times and six-field cron expressions", () => {
    assert.throws(
      () =>
        scheduleModule.getNextAutomationRunAt({
          schedule: {
            kind: "once",
            localDateTime: "2026-03-08T02:30",
          },
          timeZone: "America/New_York",
          after: new Date("2026-03-01T00:00:00.000Z"),
        }),
      /does not exist/i
    )
    assert.throws(
      () =>
        scheduleModule.validateAutomationSchedule(
          { kind: "cron", expression: "0 0 9 * * 1" },
          "UTC"
        ),
      /exactly five fields/i
    )
  })

  test("advances intervals from a stable anchor without drift", () => {
    assert.equal(
      scheduleModule.getNextAutomationRunAt({
        schedule: {
          kind: "interval",
          every: 15,
          unit: "minutes",
          anchorAt: "2026-07-15T00:00:00.000Z",
        },
        timeZone: "UTC",
        after: new Date("2026-07-15T00:47:00.000Z"),
      }),
      "2026-07-15T01:00:00.000Z"
    )
  })

  test("finds the latest missed occurrence for catch-up runs", () => {
    assert.equal(
      scheduleModule.getLatestAutomationRunAt({
        schedule: { kind: "daily", time: "09:00" },
        timeZone: "Asia/Shanghai",
        atOrBefore: new Date("2026-07-18T12:00:00.000Z"),
      }),
      "2026-07-18T01:00:00.000Z"
    )
  })
})

describe("automation queue and leases", () => {
  test("allows Full Access only for an explicit live Sandbox workspace", async () => {
    const now = new Date("2026-07-15T00:00:00.000Z")
    const noWorkspace = aiInput("No workspace Full Access")
    noWorkspace.payload.permissionMode = "full_access"

    assert.throws(
      () => store.createAutomationTask(noWorkspace, now),
      /explicit Sandbox workspace/i
    )
    assert.throws(
      () =>
        store.createAutomationTask(
          {
            ...noWorkspace,
            name: "Local Full Access",
            workspaceId: workspace.id,
          },
          now
        ),
      /explicit Sandbox workspace/i
    )

    const task = store.createAutomationTask(
      {
        ...noWorkspace,
        name: "Sandbox Full Access",
        workspaceId: sandboxWorkspace.id,
      },
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)

    assert.equal(studioDb.deleteStudioWorkspace(sandboxWorkspace.id), true)
    const disabled = store.getAutomationTask(task.id)

    assert.equal(disabled.enabled, false)
    assert.equal(disabled.workspaceId, null)
    assert.equal(store.getAutomationRun(queued.id).status, "cancelled")

    const outcome = await aiExecutor.executeAiAutomation({
      task: disabled,
      run: { ...queued, status: "running" },
      registerCancel: () => {},
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /Sandbox workspace is unavailable/i)
  })

  test("enqueues a due run once and allows only one lease owner", () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Lease test" }),
      new Date("2026-07-15T00:00:00.000Z")
    )
    const dueAt = new Date("2026-07-15T00:01:05.000Z")

    assert.equal(store.enqueueDueAutomationRuns(dueAt), 1)
    assert.equal(store.enqueueDueAutomationRuns(dueAt), 0)

    const claimed = store.claimNextAutomationRun({
      owner: "owner-a",
      now: dueAt,
      leaseDurationMs: 60_000,
    })
    assert.equal(claimed?.task.id, task.id)
    assert.equal(
      store.claimNextAutomationRun({
        owner: "owner-b",
        now: dueAt,
        leaseDurationMs: 60_000,
      }),
      null
    )

    const completed = store.completeAutomationRun(
      claimed.run.id,
      { outputPreview: "done" },
      new Date("2026-07-15T00:01:10.000Z")
    )
    assert.equal(completed.status, "succeeded")
    assert.equal(store.listAutomationRuns({ taskId: task.id }).length, 1)
    disableTask(task.id)
  })

  test("skips stale schedules when the misfire policy says skip", () => {
    const task = store.createAutomationTask(
      commandInput({
        name: "Misfire test",
        misfirePolicy: "skip",
      }),
      new Date("2026-07-16T00:00:00.000Z")
    )

    assert.equal(
      store.enqueueDueAutomationRuns(new Date("2026-07-16T00:05:00.000Z")),
      0
    )
    const [run] = store.listAutomationRuns({ taskId: task.id })
    assert.equal(run.status, "skipped")
    assert.equal(run.trigger, "catch_up")
    disableTask(task.id)
  })

  test("queues only the latest occurrence when catching up", () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Latest catch-up test" }),
      new Date("2026-07-16T00:00:00.000Z")
    )
    const now = new Date("2026-07-18T12:00:00.000Z")

    assert.equal(store.enqueueDueAutomationRuns(now), 1)
    const [run] = store.listAutomationRuns({ taskId: task.id })
    assert.equal(run.trigger, "catch_up")
    assert.equal(run.scheduledFor, "2026-07-18T00:01:00.000Z")
    store.cancelAutomationRunRecord(run.id, now)
    disableTask(task.id)
  })

  test("requeues a failed attempt after its delay and then fails finally", () => {
    const now = new Date("2026-07-17T00:00:00.000Z")
    const task = store.createAutomationTask(
      commandInput({
        name: "Retry test",
        maxRetries: 1,
        retryDelaySeconds: 10,
      }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    const claimed = store.claimNextAutomationRun({
      owner: "retry-owner",
      now,
      leaseDurationMs: 60_000,
    })
    assert.equal(claimed.run.id, queued.id)

    const retried = store.failAutomationRun(queued.id, "first failure", {}, now)
    assert.equal(retried.status, "queued")
    assert.equal(retried.attempt, 1)
    assert.equal(
      store.claimNextAutomationRun({
        owner: "too-early",
        now: new Date("2026-07-17T00:00:09.000Z"),
        leaseDurationMs: 60_000,
      }),
      null
    )

    const retryClaim = store.claimNextAutomationRun({
      owner: "retry-owner",
      now: new Date("2026-07-17T00:00:10.000Z"),
      leaseDurationMs: 60_000,
    })
    assert.equal(retryClaim.run.id, queued.id)
    const failed = store.failAutomationRun(
      queued.id,
      "second failure",
      {},
      new Date("2026-07-17T00:00:11.000Z")
    )
    assert.equal(failed.status, "failed")
    assert.equal(failed.error, "second failure")
    disableTask(task.id)
  })

  test("recovers an expired lease into the retry policy", () => {
    const now = new Date("2026-07-18T00:00:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Recovery test", maxRetries: 1 }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "crashed-owner",
      now,
      leaseDurationMs: 1_000,
    })

    assert.equal(
      store.reconcileExpiredAutomationRuns(
        new Date("2026-07-18T00:00:02.000Z")
      ),
      1
    )
    const recovered = store.getAutomationRun(queued.id)
    assert.equal(recovered.status, "queued")
    assert.equal(recovered.trigger, "retry")
    store.cancelAutomationRunRecord(
      queued.id,
      new Date("2026-07-18T00:00:03.000Z")
    )
    disableTask(task.id)
  })

  test("does not retry a running task after it has been disabled", () => {
    const now = new Date("2026-07-18T00:30:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Disabled retry test", maxRetries: 2 }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "disabled-retry-owner",
      now,
      leaseDurationMs: 60_000,
    })
    store.setAutomationTaskEnabled(task.id, false, now)

    const failed = store.failAutomationRun(
      queued.id,
      "failure after pause",
      {},
      now
    )
    assert.equal(failed.status, "failed")
    assert.equal(failed.attempt, 0)
  })

  test("keeps a paused task's manual run queued during ordinary edits", () => {
    const now = new Date("2026-07-18T00:35:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Paused edit test" }),
      now
    )
    store.setAutomationTaskEnabled(task.id, false, now)
    const queued = store.enqueueAutomationRunNow(task.id, now)
    const input = commandInput({ name: "Paused edit renamed" })

    const updated = store.updateAutomationTask(
      task.id,
      { ...input, enabled: false },
      now
    )
    assert.equal(updated.name, "Paused edit renamed")
    assert.equal(store.getAutomationRun(queued.id).status, "queued")
    store.cancelAutomationRunRecord(queued.id, now)
  })

  test("blocks task type changes while a run is active", () => {
    const now = new Date("2026-07-18T00:40:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Active type change test" }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)

    assert.throws(
      () => store.updateAutomationTask(task.id, aiInput("Changed type"), now),
      /type cannot be changed.*queued or running/i
    )
    assert.equal(store.deleteAutomationTask(task.id), false)
    store.cancelAutomationRunRecord(queued.id, now)
    disableTask(task.id)
  })

  test("does not reclaim an expired lease owned by the active runtime", () => {
    const now = new Date("2026-07-18T00:45:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Active owner lease test", maxRetries: 1 }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "still-active-owner",
      now,
      leaseDurationMs: 1_000,
    })

    assert.equal(
      store.reconcileExpiredAutomationRuns(
        new Date("2026-07-18T00:45:02.000Z"),
        "still-active-owner"
      ),
      0
    )
    assert.equal(store.getAutomationRun(queued.id).status, "running")
    store.cancelAutomationRunRecord(queued.id, now)
    disableTask(task.id)
  })

  test("preserves an attached command log when an expired run is recovered", () => {
    const now = new Date("2026-07-18T00:50:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Recovered log test" }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "expired-log-owner",
      now,
      leaseDurationMs: 1_000,
    })
    const logPath = join(logDirectory, `${queued.id}.log`)
    assert.equal(store.attachAutomationRunLog(queued.id, logPath), true)

    assert.equal(
      store.reconcileExpiredAutomationRuns(
        new Date("2026-07-18T00:50:02.000Z")
      ),
      1
    )
    const recovered = store.getAutomationRun(queued.id)
    assert.equal(recovered.status, "failed")
    assert.equal(recovered.logPath, logPath)
    disableTask(task.id)
  })

  test("can disable a command task after its workspace becomes unavailable", () => {
    const now = new Date("2026-07-18T01:00:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Unavailable workspace test" }),
      now
    )
    const queued = store.enqueueAutomationRunNow(task.id, now)
    studioDb
      .getStudioDatabase()
      .prepare(
        "UPDATE studio_scheduled_tasks SET workspace_id = NULL WHERE id = ?"
      )
      .run(task.id)

    const disabled = store.setAutomationTaskEnabled(task.id, false, now)
    assert.equal(disabled.enabled, false)
    assert.equal(disabled.nextRunAt, null)
    assert.equal(store.getAutomationRun(queued.id).status, "cancelled")
    assert.throws(
      () => store.setAutomationTaskEnabled(task.id, true, now),
      /require a local workspace/i
    )
  })
})

describe("automation artifacts", () => {
  test("does not expose an orphan AI session when a run is cancelled early", async () => {
    const now = new Date("2026-07-18T11:00:00.000Z")
    const task = store.createAutomationTask(aiInput("Early cancellation"), now)
    const queued = store.enqueueAutomationRunNow(task.id, now)
    const claimed = store.claimNextAutomationRun({
      owner: "early-cancel-owner",
      now,
      leaseDurationMs: 60_000,
    })
    store.cancelAutomationRunRecord(queued.id, now)
    const sessionCount = studioDb.listStudioSessions().length

    const outcome = await aiExecutor.executeAiAutomation({
      task,
      run: claimed.run,
      registerCancel: () => {},
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /cancelled before execution/i)
    assert.equal(studioDb.listStudioSessions().length, sessionCount)
    disableTask(task.id)
  })

  test("creates an isolated Studio session for every AI execution", async () => {
    const runtimeId = "automation-test-runtime"
    agentRuntime.registerAgentRuntime({
      info: {
        id: runtimeId,
        label: "Automation test runtime",
        description: "In-memory runtime for automation tests.",
        capabilities: {
          hitl: false,
          resume: false,
          subagents: false,
          plan: false,
          sandbox: false,
          mcp: false,
          skills: false,
          compact: false,
        },
      },
      async *startRun() {
        yield { type: "text_delta", delta: "isolated result" }
      },
    })

    const now = new Date("2026-07-18T12:00:00.000Z")
    const task = store.createAutomationTask(
      aiInput("AI executor isolation", runtimeId),
      now
    )
    const sessionIds = []

    for (let index = 0; index < 2; index += 1) {
      const runAt = new Date(now.getTime() + index)
      const queued = store.enqueueAutomationRunNow(task.id, runAt)
      const claimed = store.claimNextAutomationRun({
        owner: `ai-executor-${index}`,
        now: runAt,
        leaseDurationMs: 60_000,
      })
      assert.equal(claimed.run.id, queued.id)
      const outcome = await aiExecutor.executeAiAutomation({
        task,
        run: claimed.run,
        registerCancel: () => {},
      })
      assert.equal(outcome.ok, true)
      assert.equal(outcome.result.outputPreview, "isolated result")
      assert.ok(outcome.result.sessionId)
      sessionIds.push(outcome.result.sessionId)
      store.completeAutomationRun(queued.id, outcome.result, runAt)
    }

    assert.notEqual(sessionIds[0], sessionIds[1])
    const visibleIds = studioDb
      .listStudioSessions()
      .map((session) => session.id)
    assert.ok(!visibleIds.includes(sessionIds[0]))
    assert.ok(!visibleIds.includes(sessionIds[1]))
    disableTask(task.id)
  })

  test("keeps automation AI sessions out of the normal chat sidebar", () => {
    const now = new Date("2026-07-19T00:00:00.000Z")
    const task = store.createAutomationTask(aiInput("Session isolation"), now)
    const run = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "ai-owner",
      now,
      leaseDurationMs: 60_000,
    })
    const normalSession = studioDb.createStudioSession({
      mode: "chat",
      title: "Normal chat",
    })
    const automationSession = studioDb.createStudioSession({
      mode: "chat",
      title: "Automation chat",
    })
    store.attachAutomationRunSession(run.id, automationSession.id)

    const visibleIds = studioDb
      .listStudioSessions()
      .map((session) => session.id)
    assert.ok(visibleIds.includes(normalSession.id))
    assert.ok(!visibleIds.includes(automationSession.id))

    store.cancelAutomationRunRecord(run.id, now)
    assert.equal(store.deleteAutomationTask(task.id), true)
    assert.equal(studioDb.getStudioSession(automationSession.id), null)
    assert.ok(studioDb.getStudioSession(normalSession.id))
  })

  test("writes atomic desktop notification records for terminal runs", () => {
    const now = new Date("2026-07-20T00:00:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Notification test" }),
      now
    )
    const run = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "notification-owner",
      now,
      leaseDurationMs: 60_000,
    })
    const completed = store.completeAutomationRun(run.id, {}, now)

    assert.equal(
      notifications.queueAutomationDesktopNotification({
        task,
        run: completed,
      }),
      true
    )
    const files = readdirSync(notificationDirectory)
    assert.equal(files.length, 1)
    const payload = JSON.parse(
      readFileSync(join(notificationDirectory, files[0]), "utf8")
    )
    assert.equal(payload.taskId, task.id)
    assert.equal(payload.status, "succeeded")
  })

  test("prunes old run records and their command logs", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const task = store.createAutomationTask(
      commandInput({ name: "Retention test" }),
      now
    )
    const run = store.enqueueAutomationRunNow(task.id, now)
    store.claimNextAutomationRun({
      owner: "retention-owner",
      now,
      leaseDurationMs: 60_000,
    })
    const logPath = join(logDirectory, `${run.id}.log`)
    writeFileSync(logPath, "old output")
    store.completeAutomationRun(run.id, { logPath }, now)

    assert.equal(
      store.pruneAutomationRunHistory({
        now: new Date("2026-02-15T00:00:00.000Z"),
        retentionDays: 30,
      }),
      1
    )
    assert.equal(store.getAutomationRun(run.id), null)
    assert.equal(existsSync(logPath), false)
  })
})

describe("command automation executor", () => {
  test("does not spawn a command after its run was cancelled early", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor early cancellation" }),
      new Date("2026-07-20T11:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-20T11:00:00.000Z")
      ),
      status: "running",
    }
    let spawned = false
    const outcome = await commandExecutor.executeCommandAutomation({
      task,
      run,
      registerCancel: () => {},
      attachLog: () => false,
      spawnCommand: () => {
        spawned = true
        return createFakeChild()
      },
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /cancelled before execution/i)
    assert.equal(spawned, false)
    assert.equal(existsSync(join(logDirectory, `${run.id}.log`)), false)
  })

  test("rejects working directories that escape the selected workspace", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor path guard" }),
      new Date("2026-07-20T12:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-20T12:00:00.000Z")
      ),
      status: "running",
    }
    let spawned = false
    const outcome = await commandExecutor.executeCommandAutomation({
      task: {
        ...task,
        payload: { ...task.payload, workingDirectory: "../outside" },
      },
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: () => {
        spawned = true
        return createFakeChild()
      },
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /inside the workspace/i)
    assert.equal(spawned, false)
  })

  test("rejects working-directory symlinks that escape the workspace", async () => {
    const outsideDirectory = join(testDirectory, "outside-workspace")
    const symlinkPath = join(workspaceRoot, "outside-link")
    mkdirSync(outsideDirectory, { recursive: true })
    symlinkSync(
      outsideDirectory,
      symlinkPath,
      process.platform === "win32" ? "junction" : "dir"
    )
    const task = store.createAutomationTask(
      commandInput({ name: "Executor symlink guard" }),
      new Date("2026-07-20T13:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-20T13:00:00.000Z")
      ),
      status: "running",
    }
    let spawned = false
    const outcome = await commandExecutor.executeCommandAutomation({
      task: {
        ...task,
        payload: { ...task.payload, workingDirectory: "outside-link" },
      },
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: () => {
        spawned = true
        return createFakeChild()
      },
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /outside the selected project/i)
    assert.equal(spawned, false)
  })

  test("captures successful output without bypassing the sandbox launcher", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor success" }),
      new Date("2026-07-21T00:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-21T00:00:00.000Z")
      ),
      status: "running",
    }
    let spawnOptions
    const outcome = await commandExecutor.executeCommandAutomation({
      task,
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: (options) => {
        spawnOptions = options
        return createFakeChild({ output: "sandbox output" })
      },
      terminateCommand: () => {},
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.result.outputPreview, "sandbox output")
    assert.equal(spawnOptions.rootDir, realpathSync(workspaceRoot))
  })

  test("caps the full command log while retaining an output preview", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor log cap" }),
      new Date("2026-07-21T12:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-21T12:00:00.000Z")
      ),
      status: "running",
    }
    const outcome = await commandExecutor.executeCommandAutomation({
      task: {
        ...task,
        payload: { ...task.payload, maxLogBytes: 5 },
      },
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: () => createFakeChild({ output: "1234567890" }),
      terminateCommand: () => {},
    })

    assert.equal(outcome.ok, true)
    assert.match(outcome.result.outputPreview, /1234567890/)
    assert.match(outcome.result.outputPreview, /truncated at 5 bytes/i)
    assert.equal(readFileSync(outcome.result.logPath, "utf8"), "12345")

    const retryOutcome = await commandExecutor.executeCommandAutomation({
      task: {
        ...task,
        payload: { ...task.payload, maxLogBytes: 5 },
      },
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: () => createFakeChild({ output: "retry output" }),
      terminateCommand: () => {},
    })
    assert.equal(retryOutcome.ok, true)
    assert.match(retryOutcome.result.outputPreview, /truncated at 5 bytes/i)
    assert.equal(readFileSync(retryOutcome.result.logPath, "utf8"), "12345")
  })

  test("terminates and reports command timeouts", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor timeout" }),
      new Date("2026-07-22T00:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-22T00:00:00.000Z")
      ),
      status: "running",
    }
    const child = createFakeChild({ autoClose: false })
    const outcome = await commandExecutor.executeCommandAutomation({
      task: { ...task, timeoutSeconds: 0.01 },
      run,
      registerCancel: () => {},
      attachLog: () => true,
      spawnCommand: () => child,
      terminateCommand: (target) => {
        target.emit("close", null, "SIGTERM")
      },
    })

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /timed out/i)
  })

  test("uses the registered cancellation hook", async () => {
    const task = store.createAutomationTask(
      commandInput({ name: "Executor cancellation" }),
      new Date("2026-07-23T00:00:00.000Z")
    )
    const run = {
      ...store.enqueueAutomationRunNow(
        task.id,
        new Date("2026-07-23T00:00:00.000Z")
      ),
      status: "running",
    }
    const child = createFakeChild({ autoClose: false })
    let cancel
    const execution = commandExecutor.executeCommandAutomation({
      task,
      run,
      registerCancel: (callback) => {
        cancel = callback
      },
      attachLog: () => true,
      spawnCommand: () => child,
      terminateCommand: (target) => {
        target.emit("close", null, "SIGTERM")
      },
    })
    assert.equal(typeof cancel, "function")
    cancel()
    const outcome = await execution

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /cancelled/i)
  })
})
