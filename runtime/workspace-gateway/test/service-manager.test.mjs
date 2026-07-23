import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"

import {
  ServiceManager,
  ServiceManagerError,
  workspaceServiceLifecycleContract,
} from "../src/service-manager.mjs"

const OWNER_SESSION_ID = "session-service-test"

class TestServiceManager extends ServiceManager {
  normalizeSpec(input) {
    return super.normalizeSpec({
      ownerSessionId: OWNER_SESSION_ID,
      ...input,
    })
  }

  start(input, options) {
    return super.start(
      { ownerSessionId: OWNER_SESSION_ID, ...input },
      options
    )
  }

  list(ownerSessionId = OWNER_SESSION_ID) {
    return super.list(ownerSessionId)
  }

  get(serviceId, ownerSessionId = OWNER_SESSION_ID) {
    return super.get(serviceId, ownerSessionId)
  }

  logs(serviceId, ownerSessionId = OWNER_SESSION_ID) {
    return super.logs(serviceId, ownerSessionId)
  }

  stop(serviceId, options = {}) {
    return super.stop(serviceId, {
      ownerSessionId: OWNER_SESSION_ID,
      ...options,
    })
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function serverCommand(label, host = "0.0.0.0") {
  const source = [
    'const http = require("node:http")',
    `console.log(${JSON.stringify(label)})`,
    "const server = http.createServer((request, response) => {",
    '  response.writeHead(request.url === "/health" ? 200 : 404)',
    `  response.end(${JSON.stringify(label)})`,
    "})",
    `server.listen(Number(process.env.PORT), ${JSON.stringify(host)})`,
  ].join(";")

  return `${shellQuote(process.execPath)} -e ${shellQuote(source)}`
}

function failOnceThenServerCommand(label, markerName) {
  const source = [
    'const fs = require("node:fs")',
    'const http = require("node:http")',
    `const marker = ${JSON.stringify(markerName)}`,
    "if (!fs.existsSync(marker)) {",
    '  fs.writeFileSync(marker, "failed-once")',
    "  process.exit(1)",
    "}",
    `console.log(${JSON.stringify(label)})`,
    "const server = http.createServer((request, response) => {",
    '  response.writeHead(request.url === "/health" ? 200 : 404)',
    `  response.end(${JSON.stringify(label)})`,
    "})",
    'server.listen(Number(process.env.PORT), "0.0.0.0")',
  ].join(";")

  return `${shellQuote(process.execPath)} -e ${shellQuote(source)}`
}

async function fixture({
  startTimeoutMs = 5_000,
  stopTimeoutMs = 1_000,
} = {}) {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-service-workspace-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-service-state-")
  )
  await mkdir(path.join(workspaceRoot, "site"))
  await writeFile(path.join(workspaceRoot, "site", "index.html"), "ok")
  const manager = new TestServiceManager({
    workspaceId: "workspace-service-test",
    workspaceRoot,
    stateRoot,
    startTimeoutMs,
    stopTimeoutMs,
  })
  await manager.initialize()

  return {
    manager,
    workspaceRoot,
    stateRoot,
    async close() {
      await manager.closeAll()
      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(stateRoot, { recursive: true, force: true })
    },
  }
}

async function reportUnresolvedService(manager, serviceId) {
  const service = manager.services.get(serviceId)

  assert.ok(service)
  service.status = "failed"
  service.failure = "Managed process group could not be reaped."
  service.failureCode = "SERVICE_REAP_FAILED"
  manager.releaseIdempotency(service)
  await manager.persist(service)
  return manager.get(serviceId)
}

test("starts, probes, logs, and idempotently reuses a managed service", async () => {
  const context = await fixture()

  try {
    const input = {
      name: "preview",
      command: serverCommand("first-service"),
      cwd: "site",
      healthPath: "/health",
      entryPath: "site/index.html",
      idempotencyKey: "start-preview-0001",
    }
    const [first, concurrent] = await Promise.all([
      context.manager.start(input),
      context.manager.start(input),
    ])
    const repeated = await context.manager.start(input)

    assert.equal(first.status, "healthy")
    assert.equal(concurrent.serviceId, first.serviceId)
    assert.equal(repeated.serviceId, first.serviceId)
    assert.equal(typeof first.port, "number")
    assert.equal(first.entryPath, "site/index.html")
    assert.equal(first.artifactKey?.length, 64)
    assert.match(context.manager.logs(first.serviceId).text, /first-service/)
    assert.equal(context.manager.list().length, 1)
    await assert.rejects(
      context.manager.start({
        ...input,
        idempotencyKey: "start-preview-revision-0002",
        specRevision: "2",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SERVICE_REPLACE_REQUIRED"
    )

    const stopped = await context.manager.stop(first.serviceId)
    assert.equal(stopped.status, "stopped")
  } finally {
    await context.close()
  }
})

test("requires an owner and prevents cross-session service access", async () => {
  const context = await fixture()
  const otherOwnerSessionId = "session-service-other"

  try {
    await assert.rejects(
      context.manager.start({
        ownerSessionId: "",
        name: "missing-owner",
        command: serverCommand("missing-owner"),
        idempotencyKey: "missing-owner-preview-0001",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "INVALID_SERVICE_SPEC"
    )

    const first = await context.manager.start({
      name: "shared-name",
      command: serverCommand("owner-one"),
      healthPath: "/health",
      idempotencyKey: "shared-owner-key",
    })
    const second = await context.manager.start({
      ownerSessionId: otherOwnerSessionId,
      name: "shared-name",
      command: serverCommand("owner-two"),
      healthPath: "/health",
      idempotencyKey: "shared-owner-key",
    })

    assert.notEqual(second.serviceId, first.serviceId)
    assert.deepEqual(
      context.manager.list().map((service) => service.serviceId),
      [first.serviceId]
    )
    assert.deepEqual(
      context.manager
        .list(otherOwnerSessionId)
        .map((service) => service.serviceId),
      [second.serviceId]
    )

    for (const operation of [
      () => context.manager.get(first.serviceId, otherOwnerSessionId),
      () => context.manager.logs(first.serviceId, otherOwnerSessionId),
      () =>
        context.manager.stop(first.serviceId, {
          ownerSessionId: otherOwnerSessionId,
        }),
    ]) {
      await assert.rejects(
        async () => operation(),
        (error) =>
          error instanceof ServiceManagerError &&
          error.code === "SERVICE_NOT_FOUND"
      )
    }
  } finally {
    await context.close()
  }
})

test("does not load legacy service manifests without an owner", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-service-owner-workspace-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-service-owner-state-")
  )
  const serviceId = randomUUID()

  try {
    await writeFile(
      path.join(stateRoot, `${serviceId}.json`),
      JSON.stringify({
        serviceId,
        name: "legacy-ownerless",
        status: "healthy",
        startedAt: new Date().toISOString(),
      })
    )
    const manager = new TestServiceManager({
      workspaceId: "workspace-service-test",
      workspaceRoot,
      stateRoot,
    })

    await manager.initialize()
    assert.deepEqual(manager.list(), [])
    await manager.closeAll()
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("a failed service releases its idempotency key for a fresh retry", async () => {
  const context = await fixture({ startTimeoutMs: 2_000 })

  try {
    const input = {
      name: "retry-failed",
      command: failOnceThenServerCommand(
        "retry-failed",
        ".retry-failed-marker"
      ),
      cwd: "site",
      healthPath: "/health",
      idempotencyKey: "retry-failed-preview-0001",
    }
    const failed = await context.manager.start(input)

    assert.equal(failed.status, "failed")
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(context.stateRoot, `${failed.serviceId}.json`),
          "utf8"
        )
      ).idempotencyKey,
      null
    )

    const retried = await context.manager.start(input)

    assert.equal(retried.status, "healthy")
    assert.notEqual(retried.serviceId, failed.serviceId)
  } finally {
    await context.close()
  }
})

test("a stopped service releases its idempotency key for a fresh retry", async () => {
  const context = await fixture()

  try {
    const input = {
      name: "retry-stopped",
      command: serverCommand("retry-stopped"),
      healthPath: "/health",
      idempotencyKey: "retry-stopped-preview-0001",
    }
    const first = await context.manager.start(input)
    const stopped = await context.manager.stop(first.serviceId)

    assert.equal(stopped.status, "stopped")
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(context.stateRoot, `${first.serviceId}.json`),
          "utf8"
        )
      ).idempotencyKey,
      null
    )

    const retried = await context.manager.start(input)

    assert.equal(retried.status, "healthy")
    assert.notEqual(retried.serviceId, first.serviceId)
  } finally {
    await context.close()
  }
})

test("rejects an explicitly requested port already owned by another process", async () => {
  const context = await fixture()
  const listener = net.createServer()

  try {
    await new Promise((resolve, reject) => {
      listener.once("error", reject)
      listener.listen(0, "127.0.0.1", resolve)
    })
    const address = listener.address()
    const port =
      typeof address === "object" && address ? Number(address.port) : 0

    await assert.rejects(
      context.manager.start({
        name: "occupied",
        command: serverCommand("must-not-start"),
        port,
        idempotencyKey: "occupied-port-preview-0001",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SERVICE_PORT_IN_USE"
    )
  } finally {
    await new Promise((resolve) => listener.close(resolve))
    await context.close()
  }
})

test("force-kills a service process that ignores graceful shutdown", async () => {
  const context = await fixture({
    startTimeoutMs: 250,
    stopTimeoutMs: 100,
  })
  const source = [
    'process.on("SIGTERM", () => {})',
    "setInterval(() => {}, 1000)",
  ].join(";")

  try {
    const service = await context.manager.start({
      name: "stubborn",
      command: `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
      idempotencyKey: "stubborn-preview-0001",
    })

    assert.equal(service.status, "failed")
    assert.equal(context.manager.get(service.serviceId).pid, service.pid)
    if (service.pid && process.platform !== "win32") {
      assert.throws(() => process.kill(service.pid, 0), /ESRCH/)
    }
  } finally {
    await context.close()
  }
})

test("requires explicit replacement when a named service spec changes", async () => {
  const context = await fixture()

  try {
    const first = await context.manager.start({
      name: "replaceable",
      command: serverCommand("first"),
      healthPath: "/health",
      idempotencyKey: "replace-preview-0001",
    })

    await assert.rejects(
      context.manager.start({
        name: "replaceable",
        command: serverCommand("second"),
        healthPath: "/health",
        idempotencyKey: "replace-preview-0002",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SERVICE_REPLACE_REQUIRED"
    )

    const second = await context.manager.start({
      name: "replaceable",
      command: serverCommand("second"),
      healthPath: "/health",
      idempotencyKey: "replace-preview-0003",
      replaceServiceId: first.serviceId,
      specRevision: "2",
    })

    assert.equal(second.status, "healthy")
    assert.notEqual(second.serviceId, first.serviceId)
    assert.equal(context.manager.get(first.serviceId).status, "stopped")
  } finally {
    await context.close()
  }
})

test("rolls back a healthy replacement when the previous service cannot be reaped", async () => {
  const context = await fixture()
  const inheritedStop = context.manager.stop
  const originalStop = inheritedStop.bind(context.manager)
  let first = null

  try {
    first = await context.manager.start({
      name: "replace-reap-failure",
      command: serverCommand("replace-reap-first"),
      healthPath: "/health",
      idempotencyKey: "replace-reap-preview-0001",
    })
    context.manager.stop = async (serviceId, options = {}) =>
      serviceId === first.serviceId
        ? reportUnresolvedService(context.manager, serviceId)
        : originalStop(serviceId, options)

    await assert.rejects(
      context.manager.start({
        name: "replace-reap-failure",
        command: serverCommand("replace-reap-second"),
        healthPath: "/health",
        idempotencyKey: "replace-reap-preview-0002",
        replaceServiceId: first.serviceId,
        specRevision: "2",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.status === 502 &&
        error.code === "SERVICE_REPLACE_FAILED" &&
        /healthy replacement was rolled back/.test(error.message)
    )

    const services = context.manager.list()
    const replacement = services.find(
      (service) => service.serviceId !== first.serviceId
    )

    assert.equal(context.manager.get(first.serviceId).status, "failed")
    assert.equal(
      context.manager.get(first.serviceId).failureCode,
      "SERVICE_REAP_FAILED"
    )
    assert.equal(replacement?.status, "stopped")
    if (replacement?.pid && process.platform !== "win32") {
      assert.throws(() => process.kill(replacement.pid, 0), /ESRCH/)
    }
  } finally {
    context.manager.stop = inheritedStop
    if (first) {
      await context.manager.stop(first.serviceId).catch(() => undefined)
    }
    await context.close()
  }
})

test("reports both service groups as unresolved when replacement rollback also fails", async () => {
  const context = await fixture()
  const inheritedStop = context.manager.stop
  let first = null

  try {
    first = await context.manager.start({
      name: "replace-double-reap-failure",
      command: serverCommand("replace-double-first"),
      healthPath: "/health",
      idempotencyKey: "replace-double-preview-0001",
    })
    context.manager.stop = (serviceId) =>
      reportUnresolvedService(context.manager, serviceId)

    await assert.rejects(
      context.manager.start({
        name: "replace-double-reap-failure",
        command: serverCommand("replace-double-second"),
        healthPath: "/health",
        idempotencyKey: "replace-double-preview-0002",
        replaceServiceId: first.serviceId,
        specRevision: "2",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.status === 502 &&
        error.code === "SERVICE_REPLACE_FAILED" &&
        /replacement also remains unresolved/.test(error.message)
    )

    const services = context.manager.list()
    const unresolved = services.filter(
      (service) => service.failureCode === "SERVICE_REAP_FAILED"
    )

    assert.equal(unresolved.length, 2)
    assert.ok(
      unresolved.every((service) => service.status === "failed")
    )
    assert.ok(
      unresolved.some((service) => service.serviceId === first.serviceId)
    )
  } finally {
    context.manager.stop = inheritedStop
    await Promise.allSettled(
      context.manager
        .list()
        .map((service) => context.manager.stop(service.serviceId))
    )
    await context.close()
  }
})

test("rejects sensitive env and paths outside the workspace", async () => {
  const context = await fixture()

  try {
    await assert.rejects(
      context.manager.start({
        name: "secret-env",
        command: serverCommand("secret"),
        env: { API_KEY: "must-not-pass" },
        idempotencyKey: "secret-preview-0001",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SENSITIVE_SERVICE_ENV"
    )

    const normalized = await context.manager.normalizeSpec({
      name: "public-env",
      command: serverCommand("public-env"),
      env: {
        NODE_ENV: "development",
        VITE_PUBLIC_LABEL: "preview",
      },
      idempotencyKey: "public-env-preview-0001",
    })
    assert.deepEqual(normalized.env, {
      NODE_ENV: "development",
      VITE_PUBLIC_LABEL: "preview",
    })

    for (const name of ["UNLISTED_ENV", "NODE_OPTIONS"]) {
      await assert.rejects(
        context.manager.normalizeSpec({
          name: "unsafe-env",
          command: serverCommand("unsafe-env"),
          env: { [name]: "value" },
          idempotencyKey: `unsafe-env-${name}`,
        }),
        (error) =>
          error instanceof ServiceManagerError &&
          error.code === "SERVICE_ENV_NOT_ALLOWED"
      )
    }

    await assert.rejects(
      context.manager.start({
        name: "outside",
        command: serverCommand("outside"),
        cwd: "../outside",
        idempotencyKey: "outside-preview-0001",
      }),
      /outside the workspace|parent traversal/i
    )

    for (const command of [
      "nohup node server.js",
      "tmux new-session node server.js",
      "node server.js &",
    ]) {
      await assert.rejects(
        context.manager.start({
          name: "background",
          command,
          idempotencyKey: `background-${command.length}-0001`,
        }),
        (error) =>
          error instanceof ServiceManagerError &&
          error.code === "BACKGROUND_SERVICE_FORBIDDEN"
      )
    }
  } finally {
    await context.close()
  }
})

test("fails health when the owned listener is not publicly bound", async () => {
  const context = await fixture({ startTimeoutMs: 1_000 })

  try {
    const service = await context.manager.start({
      name: "loopback-only",
      command: serverCommand("loopback-only", "127.0.0.1"),
      healthPath: "/health",
      idempotencyKey: "loopback-only-preview-0001",
    })

    assert.equal(service.status, "failed")
    assert.equal(service.failureCode, "SERVICE_NOT_PUBLICLY_BOUND")
    assert.match(service.failure, /0\.0\.0\.0/)
    assert.equal(service.lifecycle.ownership, "process_group")
    assert.equal(service.lifecycle.detachedDescendants, "not_contained")
    if (service.pid) {
      assert.throws(() => process.kill(service.pid, 0), /ESRCH/)
    }
  } finally {
    await context.close()
  }
})

test("cancellation is terminal and reaps the one in-flight process group", async () => {
  const context = await fixture({
    startTimeoutMs: 5_000,
    stopTimeoutMs: 100,
  })
  const controller = new AbortController()
  const source = "setInterval(() => {}, 1000)"

  try {
    const operation = context.manager.start(
      {
        name: "cancelled",
        command: `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
        idempotencyKey: "cancelled-preview-0001",
      },
      { signal: controller.signal }
    )
    setTimeout(() => controller.abort(), 50)
    const service = await operation

    assert.equal(service.status, "failed")
    assert.equal(service.failureCode, "SERVICE_START_CANCELLED")
    assert.equal(context.manager.list().length, 1)
    if (service.pid) {
      assert.throws(() => process.kill(service.pid, 0), /ESRCH/)
    }

    const alreadyCancelled = new AbortController()
    alreadyCancelled.abort()
    await assert.rejects(
      context.manager.start(
        {
          name: "never-spawned",
          command: serverCommand("never"),
          idempotencyKey: "cancelled-before-spawn-0001",
        },
        { signal: alreadyCancelled.signal }
      ),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SERVICE_START_CANCELLED"
    )
    assert.equal(context.manager.list().length, 1)
  } finally {
    await context.close()
  }
})

test("explicit stop wins a race with an in-flight health check", async () => {
  const context = await fixture({
    startTimeoutMs: 5_000,
    stopTimeoutMs: 100,
  })
  const source = "setInterval(() => {}, 1000)"

  try {
    const starting = context.manager.start({
      name: "stop-during-start",
      command: `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
      idempotencyKey: "stop-during-start-preview-0001",
    })
    let listed = []

    for (let attempt = 0; attempt < 50 && listed.length === 0; attempt += 1) {
      await delay(10)
      listed = context.manager.list()
    }

    assert.equal(listed.length, 1)
    const stopped = await context.manager.stop(listed[0].serviceId)
    const completedStart = await starting

    assert.equal(stopped.status, "stopped")
    assert.equal(completedStart.status, "stopped")
    assert.equal(
      context.manager.get(listed[0].serviceId).status,
      "stopped"
    )
  } finally {
    await context.close()
  }
})

test("gateway shutdown cancels active starts and rejects later work", async () => {
  const context = await fixture({
    startTimeoutMs: 5_000,
    stopTimeoutMs: 100,
  })
  const source = "setInterval(() => {}, 1000)"

  try {
    const starting = context.manager.start({
      name: "shutdown-during-start",
      command: `${shellQuote(process.execPath)} -e ${shellQuote(source)}`,
      idempotencyKey: "shutdown-during-start-preview-0001",
    })

    for (
      let attempt = 0;
      attempt < 50 && context.manager.list().length === 0;
      attempt += 1
    ) {
      await delay(10)
    }

    await context.manager.closeAll()
    assert.equal((await starting).status, "stopped")
    await assert.rejects(
      context.manager.start({
        name: "after-shutdown",
        command: serverCommand("after-shutdown"),
        idempotencyKey: "after-shutdown-preview-0001",
      }),
      (error) =>
        error instanceof ServiceManagerError &&
        error.code === "SERVICE_MANAGER_CLOSING"
    )
  } finally {
    await context.close()
  }
})

test("root exit fails the service and reaps same-group descendants", async () => {
  const context = await fixture({
    startTimeoutMs: 2_000,
    stopTimeoutMs: 100,
  })
  const descendantSource = [
    'const http = require("node:http")',
    "http.createServer((request, response) => response.end('ok'))",
    '.listen(Number(process.env.PORT), "0.0.0.0")',
  ].join(";")
  const rootSource = [
    'const { spawn } = require("node:child_process")',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], { stdio: "ignore" })`,
    'console.log(`descendant:${child.pid}`)',
    "child.unref()",
  ].join(";")
  let descendantPid = null

  try {
    const service = await context.manager.start({
      name: "root-exit",
      command: `${shellQuote(process.execPath)} -e ${shellQuote(rootSource)}`,
      idempotencyKey: "root-exit-preview-0001",
    })
    const pidMatch = service.recentLog?.match(/descendant:(\d+)/)
    descendantPid = pidMatch ? Number(pidMatch[1]) : null

    assert.equal(service.status, "failed")
    assert.equal(service.failureCode, "SERVICE_ROOT_EXITED")
    assert.equal(Number.isInteger(descendantPid), true)
    if (descendantPid) {
      assert.throws(() => process.kill(descendantPid, 0), /ESRCH/)
    }
  } finally {
    if (descendantPid) {
      try {
        process.kill(descendantPid, "SIGKILL")
      } catch {
        // Expected after successful process-group reaping.
      }
    }
    await context.close()
  }
})

test("restart reconciliation releases idempotency for a fresh retry without killing the stale PID", async () => {
  const context = await fixture()
  let replacement = null

  try {
    const input = {
      name: "restart-stale",
      command: serverCommand("restart-stale"),
      healthPath: "/health",
      idempotencyKey: "restart-stale-preview-0001",
    }
    const service = await context.manager.start(input)
    replacement = new TestServiceManager({
      workspaceId: "workspace-service-test",
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    })
    await replacement.initialize()
    const reconciled = replacement.get(service.serviceId)

    assert.equal(reconciled.status, "failed")
    assert.equal(reconciled.failureCode, "GATEWAY_RESTART_UNVERIFIED")
    assert.equal(typeof reconciled.reconciledAt, "string")
    assert.doesNotThrow(() => process.kill(service.pid, 0))

    const manifest = JSON.parse(
      await readFile(
        path.join(context.stateRoot, `${service.serviceId}.json`),
        "utf8"
      )
    )
    assert.equal(manifest.status, "failed")
    assert.equal(manifest.failureCode, "GATEWAY_RESTART_UNVERIFIED")
    assert.equal(manifest.idempotencyKey, null)

    const retried = await replacement.start(input)

    assert.equal(retried.status, "healthy")
    assert.notEqual(retried.serviceId, service.serviceId)

    const unownedStop = await replacement.stop(service.serviceId)
    assert.equal(unownedStop.status, "failed")
    assert.equal(unownedStop.failureCode, "GATEWAY_RESTART_UNVERIFIED")
    await replacement.closeAll()
    assert.doesNotThrow(() => process.kill(service.pid, 0))
  } finally {
    await replacement?.closeAll()
    await context.close()
  }
})

test("does not report stopped when an owned process cannot be reaped", async () => {
  const context = await fixture({
    stopTimeoutMs: 10,
  })
  const serviceId = randomUUID()
  const logPath = path.join(context.stateRoot, `${serviceId}.log`)
  const unkillableChild = {
    exitCode: null,
    signalCode: null,
    kill() {},
    once() {},
  }
  await writeFile(logPath, "")
  context.manager.services.set(serviceId, {
    serviceId,
    ownerSessionId: OWNER_SESSION_ID,
    name: "unkillable",
    status: "healthy",
    port: 4173,
    cwd: "",
    child: unkillableChild,
    pid: null,
    healthPath: null,
    logPath,
    entryPath: null,
    artifactKey: null,
    specFingerprint: "fingerprint",
    specRevision: null,
    idempotencyKey: "unkillable-preview-0001",
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    failure: null,
    failureCode: null,
    exit: null,
    log: "",
    maxLogBytes: 1024,
    lifecycle: context.manager.capability(),
    reconciledAt: null,
    stopRequested: false,
    startAbortController: null,
    ownedByInstance: true,
  })

  try {
    const result = await context.manager.stop(serviceId)

    assert.equal(result.status, "failed")
    assert.equal(result.failureCode, "SERVICE_REAP_FAILED")
    assert.equal(result.stoppedAt, null)
  } finally {
    unkillableChild.exitCode = 0
    await context.close()
  }
})

test("publishes a truthful cross-platform lifecycle capability contract", () => {
  assert.deepEqual(workspaceServiceLifecycleContract("win32"), {
    supported: false,
    ownership: "unsupported",
    detachedDescendants: "unsupported",
    restartRecovery: "mark_failed_unowned",
    reason:
      "Workspace service lifecycle requires a Job Object supervisor on Windows.",
  })
  assert.equal(
    workspaceServiceLifecycleContract("linux").ownership,
    "process_group"
  )
  assert.equal(
    workspaceServiceLifecycleContract("darwin").detachedDescendants,
    "not_contained"
  )
})
