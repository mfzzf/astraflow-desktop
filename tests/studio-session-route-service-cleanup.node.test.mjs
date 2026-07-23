import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, before, test } from "node:test"

import { Sandbox } from "@e2b/code-interpreter"

register("./helpers/server-route-loader.mjs", import.meta.url)

const testRoot = mkdtempSync(
  join(tmpdir(), "astraflow-session-route-service-cleanup-")
)
const previousEnvironment = {
  ASTRAFLOW_SQLITE_PATH: process.env.ASTRAFLOW_SQLITE_PATH,
}
const originalFetch = globalThis.fetch
const originalSandboxConnect = Sandbox.connect
const ownerEmail = "session-route-service-owner@example.com"
const projectId = "session-route-service-project"
const ownerKey = `${ownerEmail}:${projectId}`

process.env.ASTRAFLOW_SQLITE_PATH = join(testRoot, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")
const sessionRoute =
  await import("../app/api/studio/sessions/[sessionId]/route.ts")

function patchSession(sessionId, body) {
  return sessionRoute.PATCH(
    new Request(`http://127.0.0.1/api/studio/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  )
}

function createSandboxWorkspace(name) {
  const sandboxId = `sandbox-${randomUUID()}`
  const rootPath = `/workspace/${name}-${randomUUID()}`

  studioDb.upsertCodeBoxSandboxRecord({
    sandboxId,
    name,
    ownerKey,
    ownerEmail,
    companyId: ownerEmail,
    projectId,
    template: "template-test",
    status: "running",
    codeServerPort: 8080,
    workspacePath: "/workspace",
  })

  return studioDb.createStudioSandboxWorkspace({
    name,
    rootPath,
    sandboxId,
  })
}

function workspaceService({
  serviceId,
  ownerSessionId,
  status = "healthy",
  failure = null,
  failureCode = null,
}) {
  return {
    schemaVersion: 1,
    serviceId,
    ownerSessionId,
    name: serviceId,
    status,
    port: 4173,
    cwd: "",
    pid: 1234,
    healthPath: null,
    logPath: "",
    entryPath: null,
    artifactKey: null,
    specFingerprint: "fingerprint",
    specRevision: null,
    startedAt: new Date(0).toISOString(),
    stoppedAt: null,
    failure,
    failureCode,
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function withFakeWorkspaceGateway(
  {
    sessionId,
    workspace,
    failList = false,
    failStop = false,
    listedServiceStatus = "healthy",
    listedServiceFailure = null,
    listedServiceFailureCode = null,
    stopResultStatus = "stopped",
    stopResultFailureCode = null,
    onStop,
  },
  run
) {
  const calls = []
  const service = workspaceService({
    serviceId: `service-${randomUUID()}`,
    ownerSessionId: sessionId,
    status: listedServiceStatus,
    failure: listedServiceFailure,
    failureCode: listedServiceFailureCode,
  })
  const fakeSandbox = {
    sandboxId: workspace.sandboxId,
    getHost() {
      return "127.0.0.1:48787"
    },
  }
  const connections =
    (globalThis.astraflowCodeBoxWorkspaceGatewayConnections ??= new Map())
  const previousConnection = connections.get(workspace.sandboxId)

  connections.set(workspace.sandboxId, {
    sandbox: fakeSandbox,
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.rootPath,
    token: "test-gateway-token",
    host: fakeSandbox.getHost(),
    baseUrl: `http://${fakeSandbox.getHost()}`,
  })
  Sandbox.connect = async (sandboxId) => {
    assert.equal(sandboxId, workspace.sandboxId)
    return fakeSandbox
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input)
    )
    const method =
      init.method ?? (input instanceof Request ? input.method : "GET")

    calls.push({ method, url })

    if (url.pathname === "/v1/health") {
      return jsonResponse({
        ok: true,
        data: {
          status: "ok",
          protocolVersion: 1,
          gatewayVersion: "test",
          templateVersion: "test",
          workspaceId: workspace.sandboxId,
          sandboxId: workspace.sandboxId,
          capabilities: ["service.lifecycle.v2"],
        },
      })
    }

    if (url.pathname === "/v1/services" && method === "GET") {
      if (failList) {
        return jsonResponse(
          {
            ok: false,
            error: { message: "owner service list failed" },
          },
          502
        )
      }

      return jsonResponse({
        ok: true,
        data: { services: [service] },
      })
    }

    if (
      url.pathname === `/v1/services/${encodeURIComponent(service.serviceId)}` &&
      method === "DELETE"
    ) {
      onStop?.()

      if (failStop) {
        return jsonResponse(
          {
            ok: false,
            error: { message: "owner service stop failed" },
          },
          502
        )
      }

      return jsonResponse({
        ok: true,
        data: {
          ...service,
          status: stopResultStatus,
          stoppedAt:
            stopResultStatus === "stopped" ? new Date().toISOString() : null,
          failure:
            stopResultStatus === "failed"
              ? "Managed process group could not be reaped."
              : null,
          failureCode: stopResultFailureCode,
        },
      })
    }

    throw new Error(`Unexpected Gateway request: ${method} ${url}`)
  }

  try {
    return await run({ calls, service })
  } finally {
    globalThis.fetch = originalFetch
    Sandbox.connect = originalSandboxConnect

    if (previousConnection) {
      connections.set(workspace.sandboxId, previousConnection)
    } else {
      connections.delete(workspace.sandboxId)
    }
  }
}

function serviceCalls(calls) {
  return calls.filter((call) => call.url.pathname.startsWith("/v1/services"))
}

before(() => {
  studioDb.saveStudioModelverseApiKey({
    id: "session-route-service-key",
    name: "Session route service key",
    key: "session-route-service-secret",
    projectId,
  })
  studioDb.saveStudioAstraFlowApiKeySession()
  studioDb.saveStudioOAuthTokens({
    accessToken: "session-route-service-access-token",
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    email: ownerEmail,
  })
})

after(() => {
  globalThis.fetch = originalFetch
  Sandbox.connect = originalSandboxConnect
  globalThis.astraflowCodeBoxWorkspaceGatewayConnections?.clear()
  globalThis.astraflowCodeBoxWorkspaceGatewayConnectionPromises?.clear()
  studioDb.getStudioDatabase().close()

  if (previousEnvironment.ASTRAFLOW_SQLITE_PATH === undefined) {
    delete process.env.ASTRAFLOW_SQLITE_PATH
  } else {
    process.env.ASTRAFLOW_SQLITE_PATH =
      previousEnvironment.ASTRAFLOW_SQLITE_PATH
  }

  rmSync(testRoot, { force: true, recursive: true })
})

test("stops owner-scoped services before committing Full Access to Default", async () => {
  const workspace = createSandboxWorkspace("full-to-default")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Full to Default",
    workspaceId: workspace.id,
    permissionMode: "full_access",
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace,
      onStop() {
        assert.equal(
          studioDb.getStudioSession(session.id)?.permissionMode,
          "full_access"
        )
      },
    },
    async ({ calls, service }) => {
      const response = await patchSession(session.id, {
        permissionMode: "default",
      })

      assert.equal(response.status, 200)
      assert.equal(
        studioDb.getStudioSession(session.id)?.permissionMode,
        "default"
      )

      const ownerServiceCalls = serviceCalls(calls)

      assert.equal(ownerServiceCalls.length, 2)
      assert.equal(ownerServiceCalls[0].method, "GET")
      assert.equal(
        ownerServiceCalls[0].url.searchParams.get("ownerSessionId"),
        session.id
      )
      assert.equal(ownerServiceCalls[1].method, "DELETE")
      assert.equal(
        ownerServiceCalls[1].url.pathname,
        `/v1/services/${encodeURIComponent(service.serviceId)}`
      )
      assert.equal(
        ownerServiceCalls[1].url.searchParams.get("ownerSessionId"),
        session.id
      )
    }
  )
})

test("stops old sandbox owner services before committing a workspace rebind", async () => {
  const oldWorkspace = createSandboxWorkspace("old-rebind")
  const nextWorkspace = createSandboxWorkspace("next-rebind")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Sandbox rebind",
    workspaceId: oldWorkspace.id,
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace: oldWorkspace,
      onStop() {
        assert.equal(
          studioDb.getStudioSession(session.id)?.workspaceId,
          oldWorkspace.id
        )
      },
    },
    async ({ calls }) => {
      const response = await patchSession(session.id, {
        workspaceId: nextWorkspace.id,
      })

      assert.equal(response.status, 200)
      assert.equal(
        studioDb.getStudioSession(session.id)?.workspaceId,
        nextWorkspace.id
      )
      assert.deepEqual(
        serviceCalls(calls).map(({ method, url }) => ({
          method,
          ownerSessionId: url.searchParams.get("ownerSessionId"),
        })),
        [
          { method: "GET", ownerSessionId: session.id },
          { method: "DELETE", ownerSessionId: session.id },
        ]
      )
    }
  )
})

test("fails closed when Full Access cleanup cannot enumerate owner services", async () => {
  const workspace = createSandboxWorkspace("full-cleanup-failure")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Full cleanup failure",
    workspaceId: workspace.id,
    permissionMode: "full_access",
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace,
      failList: true,
    },
    async ({ calls }) => {
      const response = await patchSession(session.id, {
        permissionMode: "default",
      })

      assert.equal(response.status, 502)
      assert.equal(
        studioDb.getStudioSession(session.id)?.permissionMode,
        "full_access"
      )
      assert.deepEqual(
        serviceCalls(calls).map(({ method, url }) => ({
          method,
          ownerSessionId: url.searchParams.get("ownerSessionId"),
        })),
        [{ method: "GET", ownerSessionId: session.id }]
      )
    }
  )
})

test("fails closed when an old sandbox owner service cannot stop before rebind", async () => {
  const oldWorkspace = createSandboxWorkspace("rebind-cleanup-failure")
  const nextWorkspace = createSandboxWorkspace("rebind-cleanup-target")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Rebind cleanup failure",
    workspaceId: oldWorkspace.id,
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace: oldWorkspace,
      failStop: true,
    },
    async ({ calls }) => {
      const response = await patchSession(session.id, {
        workspaceId: nextWorkspace.id,
      })

      assert.equal(response.status, 502)
      assert.equal(
        studioDb.getStudioSession(session.id)?.workspaceId,
        oldWorkspace.id
      )
      assert.deepEqual(
        serviceCalls(calls).map(({ method, url }) => ({
          method,
          ownerSessionId: url.searchParams.get("ownerSessionId"),
        })),
        [
          { method: "GET", ownerSessionId: session.id },
          { method: "DELETE", ownerSessionId: session.id },
        ]
      )
    }
  )
})

test("fails closed when Gateway reports an unresolved failed service after DELETE", async () => {
  const workspace = createSandboxWorkspace("unresolved-delete-result")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Unresolved service after delete",
    workspaceId: workspace.id,
    permissionMode: "full_access",
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace,
      stopResultStatus: "failed",
      stopResultFailureCode: "SERVICE_REAP_FAILED",
    },
    async ({ calls }) => {
      const response = await patchSession(session.id, {
        permissionMode: "default",
      })

      assert.equal(response.status, 502)
      assert.equal(
        studioDb.getStudioSession(session.id)?.permissionMode,
        "full_access"
      )
      assert.deepEqual(
        serviceCalls(calls).map(({ method, url }) => ({
          method,
          ownerSessionId: url.searchParams.get("ownerSessionId"),
        })),
        [
          { method: "GET", ownerSessionId: session.id },
          { method: "DELETE", ownerSessionId: session.id },
        ]
      )
    }
  )
})

for (const runStatus of ["queued", "running"]) {
  test(`fails closed when a ${runStatus} run starts while owner services are stopping`, async () => {
    const workspace = createSandboxWorkspace(
      `run-race-${runStatus}`
    )
    const session = studioDb.createStudioSession({
      mode: "chat",
      title: `${runStatus} run cleanup race`,
      workspaceId: workspace.id,
      permissionMode: "full_access",
    })
    const runs = (globalThis.astraflowStudioChatRuns ??= new Map())

    try {
      await withFakeWorkspaceGateway(
        {
          sessionId: session.id,
          workspace,
          onStop() {
            const now = new Date().toISOString()

            runs.set(session.id, {
              runId: `${runStatus}-cleanup-race`,
              sessionId: session.id,
              assistantMessageId: `${runStatus}-cleanup-race-assistant`,
              status: runStatus,
              error: null,
              usage: null,
              startedAt: now,
              updatedAt: now,
            })
          },
        },
        async ({ calls }) => {
          const response = await patchSession(session.id, {
            permissionMode: "default",
          })

          assert.equal(response.status, 409)
          assert.equal(
            studioDb.getStudioSession(session.id)?.permissionMode,
            "full_access"
          )
          assert.deepEqual(
            serviceCalls(calls).map(({ method, url }) => ({
              method,
              ownerSessionId: url.searchParams.get("ownerSessionId"),
            })),
            [
              { method: "GET", ownerSessionId: session.id },
              { method: "DELETE", ownerSessionId: session.id },
            ]
          )
        }
      )
    } finally {
      runs.delete(session.id)
    }
  })
}

test("fails closed on a listed Gateway restart failure without issuing DELETE", async () => {
  const workspace = createSandboxWorkspace("gateway-restart-unverified")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Gateway restart unverified",
    workspaceId: workspace.id,
    permissionMode: "full_access",
  })

  await withFakeWorkspaceGateway(
    {
      sessionId: session.id,
      workspace,
      listedServiceStatus: "failed",
      listedServiceFailure:
        "Gateway restart could not verify the previous process exit.",
      listedServiceFailureCode: "GATEWAY_RESTART_UNVERIFIED",
    },
    async ({ calls }) => {
      const response = await patchSession(session.id, {
        permissionMode: "default",
      })

      assert.equal(response.status, 502)
      assert.equal(
        studioDb.getStudioSession(session.id)?.permissionMode,
        "full_access"
      )
      assert.deepEqual(
        serviceCalls(calls).map(({ method, url }) => ({
          method,
          ownerSessionId: url.searchParams.get("ownerSessionId"),
        })),
        [{ method: "GET", ownerSessionId: session.id }]
      )
    }
  )
})

test("does not clean up services for title, model, or runtime-only updates", async () => {
  const workspace = createSandboxWorkspace("metadata-only")
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Metadata only",
    workspaceId: workspace.id,
    chatRuntimeId: "astraflow",
  })
  let connectAttempts = 0
  let fetchAttempts = 0

  Sandbox.connect = async () => {
    connectAttempts += 1
    throw new Error("metadata updates must not connect to the Gateway")
  }
  globalThis.fetch = async () => {
    fetchAttempts += 1
    throw new Error("metadata updates must not call the Gateway")
  }

  try {
    const titleResponse = await patchSession(session.id, {
      title: "Renamed metadata only",
    })
    const modelResponse = await patchSession(session.id, {
      chatModel: "gpt-5.6-sol",
    })
    const runtimeResponse = await patchSession(session.id, {
      chatRuntimeId: "codex",
    })

    assert.equal(titleResponse.status, 200)
    assert.equal(modelResponse.status, 200)
    assert.equal(runtimeResponse.status, 200)
    assert.equal(connectAttempts, 0)
    assert.equal(fetchAttempts, 0)
    assert.equal(
      studioDb.getStudioSession(session.id)?.title,
      "Renamed metadata only"
    )
    assert.equal(
      studioDb.getStudioSession(session.id)?.chatModel,
      "gpt-5.6-sol"
    )
    assert.equal(
      studioDb.getStudioSession(session.id)?.chatRuntimeId,
      "codex"
    )
  } finally {
    globalThis.fetch = originalFetch
    Sandbox.connect = originalSandboxConnect
  }
})
