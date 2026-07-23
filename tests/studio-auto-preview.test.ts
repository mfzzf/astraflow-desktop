// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { getTerminalStudioAutoPreviewCandidate } from "@/components/studio-chat/auto-preview"
import type {
  StudioChatRunSnapshot,
  StudioMessage,
  StudioWorkspace,
} from "@/lib/studio-types"

const revisionA = "a".repeat(64)
const revisionB = "b".repeat(64)

const workspace: StudioWorkspace = {
  id: "workspace-1",
  name: "Workspace",
  type: "sandbox",
  origin: "remote_sandbox",
  rootPath: "/workspace",
  sandboxId: "sandbox-1",
  allocationKey: null,
  createdBySessionId: null,
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
  lastOpenedAt: null,
}

const run: StudioChatRunSnapshot = {
  runId: "run-1",
  sessionId: "session-1",
  assistantMessageId: "assistant-1",
  status: "complete",
  error: null,
  usage: null,
  startedAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:01.000Z",
}

function message(
  overrides: Partial<StudioMessage> = {}
): StudioMessage {
  return {
    id: "assistant-1",
    sessionId: "session-1",
    role: "assistant",
    content: "",
    model: null,
    environment: "remote",
    workspace: {
      id: workspace.id,
      type: workspace.type,
      rootPath: workspace.rootPath,
    },
    versionGroupId: null,
    versionIndex: 1,
    versionCount: 1,
    isActiveVersion: true,
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-23T00:00:00.000Z",
    completedAt: "2026-07-23T00:00:01.000Z",
    ...overrides,
  }
}

function serviceOutput(overrides: Record<string, unknown> = {}) {
  return {
    structuredContent: {
      astraflow: {
        service: {
          schemaVersion: 1,
          sessionId: "session-1",
          workspaceId: "workspace-1",
          sandboxId: "sandbox-1",
          serviceId: "service-1",
          name: "Demo",
          status: "healthy",
          port: 4173,
          cwd: "/workspace",
          healthPath: "/",
          logPath: "/tmp/service.log",
          entryPath: "index.html",
          artifactKey: "artifact-1",
          specFingerprint: "fingerprint-1",
          specRevision: "service-revision-1",
          publicUrl: "https://preview.example.test/",
          failure: null,
          ...overrides,
        },
      },
    },
  }
}

describe("terminal run auto preview arbitration", () => {
  test("waits for the exact run and assistant message to complete", () => {
    const htmlMessage = message({
      parts: [
        {
          id: "file-1",
          type: "file",
          path: "index.html",
          kind: "create",
          status: "complete",
          error: null,
          content: "",
          revision: revisionA,
        },
      ],
    })

    expect(
      getTerminalStudioAutoPreviewCandidate({
        run: { ...run, status: "running" },
        message: htmlMessage,
        panelWorkspace: workspace,
      })
    ).toBeNull()
    expect(
      getTerminalStudioAutoPreviewCandidate({
        run,
        message: { ...htmlMessage, id: "historical-assistant" },
        panelWorkspace: workspace,
      })
    ).toBeNull()
  })

  test("prefers an identity-bound healthy service over HTML files", () => {
    const candidate = getTerminalStudioAutoPreviewCandidate({
      run,
      message: message({
        activities: [
          {
            id: "activity-1",
            toolName: "sandbox_start_service",
            status: "complete",
            input: "",
            output: "",
            error: null,
            rawOutput: serviceOutput(),
          },
        ],
        parts: [
          {
            id: "file-1",
            type: "file",
            path: "index.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "",
            revision: revisionA,
          },
        ],
      }),
      panelWorkspace: workspace,
    })

    expect(candidate).toMatchObject({
      kind: "service",
      href: "https://preview.example.test/",
      serviceId: "service-1",
    })
  })

  test("rejects a service with mismatched context and chooses index.html", () => {
    const candidate = getTerminalStudioAutoPreviewCandidate({
      run,
      message: message({
        activities: [
          {
            id: "activity-1",
            toolName: "sandbox_start_service",
            status: "complete",
            input: "",
            output: "",
            error: null,
            rawOutput: serviceOutput({ sandboxId: "other-sandbox" }),
          },
        ],
        parts: [
          {
            id: "file-1",
            type: "file",
            path: "other.html",
            kind: "edit",
            status: "complete",
            error: null,
            content: "",
            revision: revisionA,
          },
          {
            id: "file-2",
            type: "file",
            path: "site/index.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "",
            revision: revisionB,
          },
        ],
      }),
      panelWorkspace: workspace,
    })

    expect(candidate).toMatchObject({
      kind: "file",
      href: "site/index.html",
      revision: revisionB,
    })
  })

  test("fails closed for deletes, external paths, and untrusted revisions", () => {
    const candidate = getTerminalStudioAutoPreviewCandidate({
      run,
      message: message({
        parts: [
          {
            id: "delete",
            type: "file",
            path: "index.html",
            kind: "delete",
            status: "complete",
            error: null,
            content: "",
            revision: revisionA,
          },
          {
            id: "external",
            type: "file",
            path: "/tmp/index.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "",
            revision: revisionA,
          },
          {
            id: "untrusted",
            type: "file",
            path: "demo.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "",
            revision: "activity-fallback",
          },
        ],
      }),
      panelWorkspace: workspace,
    })

    expect(candidate).toBeNull()
  })
})
