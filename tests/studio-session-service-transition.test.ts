// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  cleanStudioSessionServiceScopeBeforeTransition,
  requiresStudioSessionServiceScopeCleanup,
  StudioSessionServiceTransitionError,
} from "@/lib/studio-session-service-transition"

const sandboxWorkspace = {
  id: "sandbox-workspace",
  type: "sandbox" as const,
}
const localWorkspace = {
  id: "local-workspace",
  type: "local" as const,
}

describe("Studio session service-scope transitions", () => {
  test("cleans the old sandbox when Full Access is revoked or the workspace changes", () => {
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: sandboxWorkspace,
        currentPermissionMode: "full_access",
        nextWorkspaceId: sandboxWorkspace.id,
        nextPermissionMode: "default",
      })
    ).toBe(true)
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: sandboxWorkspace,
        currentPermissionMode: "full_access",
        nextWorkspaceId: "another-sandbox-workspace",
        nextPermissionMode: "full_access",
      })
    ).toBe(true)
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: sandboxWorkspace,
        currentPermissionMode: "default",
        nextWorkspaceId: localWorkspace.id,
        nextPermissionMode: "default",
      })
    ).toBe(true)
  })

  test("does not clean for metadata, model, runtime, or other same-scope updates", () => {
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: sandboxWorkspace,
        currentPermissionMode: "full_access",
        nextWorkspaceId: sandboxWorkspace.id,
        nextPermissionMode: "full_access",
      })
    ).toBe(false)
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: localWorkspace,
        currentPermissionMode: "full_access",
        nextWorkspaceId: localWorkspace.id,
        nextPermissionMode: "default",
      })
    ).toBe(false)
    expect(
      requiresStudioSessionServiceScopeCleanup({
        currentWorkspace: null,
        currentPermissionMode: "full_access",
        nextWorkspaceId: null,
        nextPermissionMode: "default",
      })
    ).toBe(false)
  })

  test("fails closed when cleanup throws or cannot stop every service", async () => {
    expect(
      cleanStudioSessionServiceScopeBeforeTransition({
        required: true,
        cleanup: async () => {
          throw new Error("Gateway unavailable")
        },
      })
    ).rejects.toBeInstanceOf(StudioSessionServiceTransitionError)
    expect(
      cleanStudioSessionServiceScopeBeforeTransition({
        required: true,
        cleanup: async () => ({
          attempted: 1,
          stopped: 0,
          failures: [
            {
              serviceId: "service-1",
              message: "Managed process group could not be reaped.",
            },
          ],
        }),
      })
    ).rejects.toMatchObject({
      status: 502,
      failures: [
        {
          serviceId: "service-1",
          message: "Managed process group could not be reaped.",
        },
      ],
    })
  })

  test("skips the callback when cleanup is not required", async () => {
    let calls = 0
    const result = await cleanStudioSessionServiceScopeBeforeTransition({
      required: false,
      cleanup: async () => {
        calls += 1
        return { attempted: 0, stopped: 0, failures: [] }
      },
    })

    expect(result).toBeNull()
    expect(calls).toBe(0)
  })
})
