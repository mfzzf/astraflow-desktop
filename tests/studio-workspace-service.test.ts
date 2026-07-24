// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getStudioWorkspaceServiceResult,
  isStudioWorkspaceServiceResultForContext,
} from "@/lib/studio-workspace-service-result"

function result(overrides: Record<string, unknown> = {}) {
  return {
    structuredContent: {
      astraflow: {
        service: {
          schemaVersion: 1,
          serviceId: "service-1",
          name: "demo",
          status: "healthy",
          port: 4173,
          cwd: "/workspace",
          healthPath: "/",
          logPath: "/var/lib/astraflow/services/service-1.log",
          entryPath: "demo.html",
          artifactKey: "demo-html",
          specFingerprint: "fingerprint-1",
          specRevision: "revision-1",
          publicUrl: "https://4173-sandbox.example.test/",
          failure: null,
          ...overrides,
        },
      },
    },
    _meta: {
      "astraflow/resultSchema": "service.v1",
    },
  }
}

describe("Studio workspace service results", () => {
  test("parses the authoritative structured result without reading display text", () => {
    expect(getStudioWorkspaceServiceResult(result())).toEqual({
      schemaVersion: 1,
      sessionId: null,
      workspaceId: null,
      sandboxId: null,
      serviceId: "service-1",
      name: "demo",
      status: "healthy",
      port: 4173,
      cwd: "/workspace",
      healthPath: "/",
      logPath: "/var/lib/astraflow/services/service-1.log",
      entryPath: "demo.html",
      artifactKey: "demo-html",
      specFingerprint: "fingerprint-1",
      specRevision: "revision-1",
      publicUrl: "https://4173-sandbox.example.test/",
      failure: null,
    })
  })

  test("accepts the ACP activity metadata envelope", () => {
    expect(
      getStudioWorkspaceServiceResult({
        astraflow: {
          toolResult: result(),
        },
      })?.serviceId
    ).toBe("service-1")
  })

  test("rejects loopback, credentialed, and non-http preview URLs", () => {
    for (const publicUrl of [
      "http://127.0.0.1:4173/",
      "http://localhost:4173/",
      "https://user:password@example.test/",
      "file:///workspace/demo.html",
    ]) {
      expect(
        getStudioWorkspaceServiceResult(result({ publicUrl }))?.publicUrl
      ).toBeNull()
    }
  })

  test("does not expose a URL before the Gateway reports healthy", () => {
    expect(
      getStudioWorkspaceServiceResult(
        result({ status: "starting" })
      )?.publicUrl
    ).toBeNull()
  })

  test("preserves a structured startup failure without inventing an identity", () => {
    expect(
      getStudioWorkspaceServiceResult(
        result({
          serviceId: null,
          status: "failed",
          port: null,
          publicUrl: null,
          failure: "Gateway unavailable",
        })
      )
    ).toMatchObject({
      serviceId: null,
      status: "failed",
      port: null,
      publicUrl: null,
      failure: "Gateway unavailable",
    })
  })

  test("rejects incomplete or malformed service payloads", () => {
    expect(
      getStudioWorkspaceServiceResult({
        content: [
          {
            type: "text",
            text: "Service URL: https://untrusted.example.test/",
          },
        ],
      })
    ).toBeNull()
    expect(
      getStudioWorkspaceServiceResult(result({ port: 80_000 }))
    ).toBeNull()
    expect(
      getStudioWorkspaceServiceResult(result({ serviceId: "" }))
    ).toBeNull()
  })

  test("binds service actions to the exact session, workspace, and sandbox", () => {
    const service = getStudioWorkspaceServiceResult(
      result({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        sandboxId: "sandbox-1",
      })
    )

    expect(
      isStudioWorkspaceServiceResultForContext(service, {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        sandboxId: "sandbox-1",
      })
    ).toBe(true)
    expect(
      isStudioWorkspaceServiceResultForContext(service, {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        sandboxId: "sandbox-2",
      })
    ).toBe(false)
    expect(
      isStudioWorkspaceServiceResultForContext(service, {
        sessionId: "other-session",
        workspaceId: "workspace-1",
        sandboxId: "sandbox-1",
      })
    ).toBe(false)
  })
})
