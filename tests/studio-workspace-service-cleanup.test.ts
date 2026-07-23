// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import type { CodeBoxWorkspaceService } from "@/lib/codebox-runtime"
import { stopActiveWorkspaceServicesBestEffort } from "@/lib/studio-workspace-service-cleanup"

function service(
  serviceId: string,
  status: CodeBoxWorkspaceService["status"]
): CodeBoxWorkspaceService {
  return {
    schemaVersion: 1,
    serviceId,
    ownerSessionId: "session-owner",
    name: serviceId,
    status,
    port: 4173,
    cwd: "",
    pid: null,
    healthPath: null,
    logPath: "",
    entryPath: null,
    artifactKey: null,
    specFingerprint: "fingerprint",
    specRevision: null,
    startedAt: new Date(0).toISOString(),
    stoppedAt: null,
    failure: null,
    failureCode: null,
  }
}

describe("Studio workspace service cleanup", () => {
  test("stops every active owner service best-effort without touching terminal rows", async () => {
    const stopped: string[] = []
    const result = await stopActiveWorkspaceServicesBestEffort({
      services: [
        service("starting", "starting"),
        service("healthy", "healthy"),
        service("unhealthy", "unhealthy"),
        service("stopped", "stopped"),
        service("failed", "failed"),
      ],
      async stopService(candidate) {
        stopped.push(candidate.serviceId)

        if (candidate.serviceId === "healthy") {
          throw new Error("stop failed")
        }
      },
    })

    expect(stopped).toEqual(["starting", "healthy", "unhealthy"])
    expect(result).toEqual({
      attempted: 3,
      stopped: 2,
      failures: [{ serviceId: "healthy", message: "stop failed" }],
    })
  })

  test("blocks cleanup on failed services with unresolved process ownership", async () => {
    const stopped: string[] = []
    const result = await stopActiveWorkspaceServicesBestEffort({
      services: [
        {
          ...service("reap-failed", "failed"),
          failure: "Managed process group could not be reaped.",
          failureCode: "SERVICE_REAP_FAILED",
        },
        {
          ...service("restart-unverified", "failed"),
          failureCode: "GATEWAY_RESTART_UNVERIFIED",
        },
        {
          ...service("reaped-failure", "failed"),
          failureCode: "SERVICE_HEALTH_TIMEOUT",
        },
      ],
      async stopService(candidate) {
        stopped.push(candidate.serviceId)
      },
    })

    expect(stopped).toEqual([])
    expect(result).toEqual({
      attempted: 2,
      stopped: 0,
      failures: [
        {
          serviceId: "reap-failed",
          message: "Managed process group could not be reaped.",
        },
        {
          serviceId: "restart-unverified",
          message:
            "Workspace service has unresolved failure GATEWAY_RESTART_UNVERIFIED.",
        },
      ],
    })
  })
})
