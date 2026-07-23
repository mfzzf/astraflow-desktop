// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { z } from "zod"

import {
  ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID,
  ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME,
  createAstraFlowToolMcpBridgeServer,
  listAstraFlowToolDescriptors,
} from "@/lib/agent/acp/host-tools"
import { AcpMcpBridge } from "@/lib/agent/acp/mcp-bridge"
import {
  cancelSessionPermissions,
  resolvePermission,
} from "@/lib/agent/permission-broker"
import type { AgentEvent } from "@/lib/agent/events"
import {
  createAstraFlowTool,
  getAstraFlowToolEffectCategory,
} from "@/lib/ai/tools/tool"
import { createSandboxStartServiceTool } from "@/lib/ai/tools/astraflow-sandbox"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import { getExpectedAstraFlowHostToolNames } from "@/lib/ai/tools/studio-tool-manifest"
import { withStudioSessionLock } from "@/lib/studio-session-lock"
import hostToolsManifest from "@/runtime/astraflow-acp/host-tools-manifest.json"

function sorted(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b))
}

async function waitForPendingPermission(
  events: AgentEvent[],
  expectedCount: number
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = events.filter(
      (
        event
      ): event is Extract<AgentEvent, { type: "permission_request" }> =>
        event.type === "permission_request" && event.status === "pending"
    )

    if (pending.length >= expectedCount) {
      return pending[expectedCount - 1]
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error("Timed out waiting for a HostActionGateway permission.")
}

function manifestToolNames(
  type: "local" | "sandbox",
  permissionMode: "default" | "full_access" = "full_access"
) {
  return sorted(
    getExpectedAstraFlowHostToolNames({
      exa: true,
      mobile: true,
      modelverse: true,
      sandboxService:
        type === "sandbox" && permissionMode === "full_access",
      workspace: true,
    })
  )
}

function fullStudioTools(
  type: "local" | "sandbox",
  permissionMode: "default" | "full_access" = "full_access"
) {
  return createStudioAgentTools({
    exaApiKey: "test-exa-key",
    mobileChannelBound: true,
    modelverseApiKey: "test-modelverse-key",
    permissionMode,
    sandboxServiceCapabilityAvailable: true,
    sessionId: "runtime-parity-session",
    workspace: {
      id: `runtime-parity-${type}`,
      rootPath: type === "local" ? "/tmp/astraflow-parity" : "/workspace",
      type,
    },
  })
}

describe("AstraFlow local and Sandbox runtime parity", () => {
  test("classifies skill inspection and preparation without outward-action prompts", () => {
    for (const name of [
      "list_installed_skills",
      "load_skill",
      "read_skill_file",
    ]) {
      expect(getAstraFlowToolEffectCategory(name)).toBe("read_only")
    }

    expect(getAstraFlowToolEffectCategory("prepare_skill_sandbox")).toBe(
      "workspace_internal"
    )
  })

  test("publishes the Desktop host-tool protocol in the shared runtime", () => {
    expect(hostToolsManifest.schemaVersion).toBe(1)
    expect(hostToolsManifest.protocolVersion).toBe(4)
    expect(hostToolsManifest.server).toEqual({
      name: ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME,
      serverId: ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID,
    })
  })

  test("exposes the complete capability-scoped product tools locally and remotely", () => {
    const localExpected = manifestToolNames("local")
    const sandboxExpected = manifestToolNames("sandbox")
    const localTools = fullStudioTools("local")
    const sandboxTools = fullStudioTools("sandbox")
    const localDescriptors = listAstraFlowToolDescriptors(localTools)
    const sandboxDescriptors = listAstraFlowToolDescriptors(sandboxTools)

    expect(sorted(localTools.map((tool) => tool.name))).toEqual(localExpected)
    expect(sorted(sandboxTools.map((tool) => tool.name))).toEqual(
      sandboxExpected
    )
    expect(
      sandboxDescriptors.filter(
        (descriptor) => descriptor.name !== "sandbox_start_service"
      )
    ).toEqual(localDescriptors)
    expect(sorted(localDescriptors.map((tool) => tool.name))).toEqual(
      localExpected
    )

    for (const required of [
      "studio_generate_image",
      "studio_generate_video",
      "studio_list_media_generation_models",
      "studio_get_media_model_schema",
    ]) {
      expect(localExpected).toContain(required)
    }

    expect(localExpected).not.toContain("sandbox_start_service")
    expect(sandboxExpected).toContain("sandbox_start_service")
    expect(
      sandboxDescriptors.find(
        (descriptor) => descriptor.name === "sandbox_start_service"
      )
    ).toMatchObject({
      annotations: { readOnlyHint: false },
      _meta: {
        astraflow: {
          allowInSubagent: false,
          effectCategory: "workspace_internal",
        },
      },
    })
    expect(
      localDescriptors.find((descriptor) => descriptor.name === "web_fetch")
    ).toMatchObject({
      annotations: { readOnlyHint: true },
      _meta: {
        astraflow: {
          allowInSubagent: true,
          effectCategory: "read_only",
        },
      },
    })
    expect(
      localDescriptors.find(
        (descriptor) => descriptor.name === "studio_generate_image"
      )
    ).toMatchObject({
      _meta: {
        astraflow: {
          allowInSubagent: false,
          effectCategory: "important_action",
        },
      },
    })
  })

  test("does not advertise or invoke a tool whose capability is unavailable", async () => {
    const unavailable = createAstraFlowTool(async () => "unexpected", {
      name: "capability_gated",
      description: "Unavailable test tool.",
      effectCategory: "read_only",
      isAvailable: () => false,
      schema: z.object({}),
    })
    const server = createAstraFlowToolMcpBridgeServer({
      tools: [unavailable],
    })

    if (!server.createConnection) {
      throw new Error("AstraFlow Studio tools must use an in-process MCP bridge.")
    }

    const connection = await server.createConnection({ agent: {} as never })
    const listed = (await connection.request("tools/list", {}, {})) as {
      tools?: unknown[]
    }

    expect(listed.tools).toEqual([])
    await expect(
      connection.request(
        "tools/call",
        { name: "capability_gated", arguments: {} },
        {}
      )
    ).rejects.toThrow(/unavailable/i)
  })

  test("exposes interactive Sandbox services only in remote Full Access", async () => {
    const defaultTools = fullStudioTools("sandbox", "default")

    expect(sorted(defaultTools.map((tool) => tool.name))).toEqual(
      manifestToolNames("sandbox", "default")
    )
    expect(defaultTools.map((tool) => tool.name)).not.toContain(
      "sandbox_start_service"
    )

    const blockedService = createSandboxStartServiceTool({
      fullAccessEnabled: false,
      getSandboxContext: async () => {
        throw new Error("Default must not contact the Sandbox service Gateway.")
      },
      serviceCapabilityAvailable: true,
      sessionId: "runtime-parity-session",
      workspaceRoot: "/workspace",
    })

    expect(await blockedService.isAvailable?.()).toBe(false)
    expect(
      await blockedService.invoke({
        command: "node server.mjs",
      })
    ).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "Interactive Sandbox services require Full Access"
          ),
        },
      ],
    })

    let accessChecks = 0
    const downgradedWhileStarting = createSandboxStartServiceTool({
      fullAccessEnabled: () => {
        accessChecks += 1
        return accessChecks === 1
      },
      getSandboxContext: async () => {
        throw new Error(
          "A permission downgrade must win before Gateway access."
        )
      },
      serviceCapabilityAvailable: true,
      sessionId: "runtime-parity-session",
      workspaceRoot: "/workspace",
    })

    expect(
      await downgradedWhileStarting.invoke({
        command: "node server.mjs",
      })
    ).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "Interactive Sandbox services require Full Access"
          ),
        },
      ],
    })
    expect(accessChecks).toBe(2)

    const capturedWorkspaceId = "sandbox-workspace-a"
    let liveWorkspaceId = capturedWorkspaceId
    let workspaceScopeChecks = 0
    const workspaceScopedTools = createStudioAgentTools({
      exaApiKey: "test-exa-key",
      mobileChannelBound: true,
      modelverseApiKey: "test-modelverse-key",
      permissionMode: "full_access",
      sandboxServiceCapabilityAvailable: true,
      sandboxServiceFullAccessAvailable: () => {
        workspaceScopeChecks += 1
        const available = liveWorkspaceId === capturedWorkspaceId

        if (workspaceScopeChecks === 1) {
          liveWorkspaceId = "sandbox-workspace-b"
        }

        return available
      },
      sessionId: "runtime-parity-session",
      workspace: {
        id: capturedWorkspaceId,
        rootPath: "/workspace/project-a",
        type: "sandbox",
      },
    })
    const workspaceScopedService = workspaceScopedTools.find(
      (tool) => tool.name === "sandbox_start_service"
    )

    expect(workspaceScopedService).toBeDefined()
    expect(
      await workspaceScopedService?.invoke({
        command: "node server.mjs",
      })
    ).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "Interactive Sandbox services require Full Access"
          ),
        },
      ],
    })
    expect(workspaceScopeChecks).toBe(2)

    const lockedSessionId = "runtime-parity-locked-service"
    let releaseLock!: () => void
    let markLockEntered!: () => void
    let markSecondScopeCheck!: () => void
    const lockEntered = new Promise<void>((resolve) => {
      markLockEntered = resolve
    })
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const secondScopeCheck = new Promise<void>((resolve) => {
      markSecondScopeCheck = resolve
    })
    let lockedScopeAvailable = true
    let lockedScopeChecks = 0
    const lockHolder = withStudioSessionLock(lockedSessionId, async () => {
      markLockEntered()
      await lockGate
    })
    await lockEntered
    const lockedService = createSandboxStartServiceTool({
      fullAccessEnabled: () => {
        lockedScopeChecks += 1

        if (lockedScopeChecks === 2) {
          markSecondScopeCheck()
        }

        return lockedScopeAvailable
      },
      getSandboxContext: async () => {
        throw new Error(
          "A workspace rebind while waiting for the lock must prevent Gateway access."
        )
      },
      serviceCapabilityAvailable: true,
      sessionId: lockedSessionId,
      workspaceRoot: "/workspace/project-a",
    })
    const lockedInvocation = lockedService.invoke({
      command: "node server.mjs",
    })

    await secondScopeCheck
    lockedScopeAvailable = false
    releaseLock()
    await lockHolder

    expect(await lockedInvocation).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "Interactive Sandbox services require Full Access"
          ),
        },
      ],
    })
    expect(lockedScopeChecks).toBe(3)

    let fullAccessAvailable = true
    const staleService = createSandboxStartServiceTool({
      fullAccessEnabled: () => fullAccessAvailable,
      getSandboxContext: async () => {
        throw new Error("A stale service call must fail before Gateway access.")
      },
      serviceCapabilityAvailable: true,
      sessionId: "runtime-parity-session",
      workspaceRoot: "/workspace",
    })
    const server = createAstraFlowToolMcpBridgeServer({
      tools: [staleService],
    })

    if (!server.createConnection) {
      throw new Error("AstraFlow Studio tools must use an in-process MCP bridge.")
    }

    const connection = await server.createConnection({ agent: {} as never })
    const listed = (await connection.request("tools/list", {}, {})) as {
      tools: Array<{ name: string }>
    }

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "sandbox_start_service",
    ])
    fullAccessAvailable = false
    await expect(
      connection.request(
        "tools/call",
        {
          name: "sandbox_start_service",
          arguments: { command: "node server.mjs" },
        },
        {}
      )
    ).rejects.toThrow("Interactive Sandbox services require Full Access")
  })

  test("serves the manifest tool set through the ACP MCP bridge unchanged", async () => {
    const server = createAstraFlowToolMcpBridgeServer({
      tools: fullStudioTools("sandbox"),
    })

    if (!server.createConnection) {
      throw new Error("AstraFlow Studio tools must use an in-process MCP bridge.")
    }

    const connection = await server.createConnection({ agent: {} as never })
    const result = (await connection.request(
      "tools/list",
      {},
      { signal: new AbortController().signal }
    )) as { tools?: Array<{ name?: string }> }

    expect(sorted((result.tools ?? []).map((tool) => tool.name ?? ""))).toEqual(
      manifestToolNames("sandbox")
    )
  })

  test("forwards tool calls and AbortSignal through the host bridge", async () => {
    const invocations: string[] = []
    const echo = createAstraFlowTool(
      async ({ value }, { signal }) => {
        signal?.throwIfAborted()
        invocations.push(value)
        return `echo:${value}`
      },
      {
        name: "parity_echo",
        description: "Echo a parity test value.",
        effectCategory: "read_only",
        schema: z.object({ value: z.string() }),
      }
    )
    const server = createAstraFlowToolMcpBridgeServer({ tools: [echo] })

    if (!server.createConnection) {
      throw new Error("AstraFlow Studio tools must use an in-process MCP bridge.")
    }

    const connection = await server.createConnection({ agent: {} as never })
    const listed = (await connection.request(
      "tools/list",
      {},
      {}
    )) as { tools?: Array<{ name?: string }> }
    const called = (await connection.request(
      "tools/call",
      {
        name: "parity_echo",
        arguments: { value: "ok" },
      },
      { signal: new AbortController().signal }
    )) as { content?: Array<{ text?: string }>; isError?: boolean }
    const controller = new AbortController()

    controller.abort(new Error("parity-aborted"))
    const aborted = connection.request(
      "tools/call",
      {
        name: "parity_echo",
        arguments: { value: "blocked" },
      },
      { signal: controller.signal }
    )

    expect(listed.tools?.map((tool) => tool.name)).toEqual(["parity_echo"])
    expect(called).toEqual({
      content: [{ type: "text", text: "echo:ok" }],
    })
    expect(invocations).toEqual(["ok"])
    await expect(aborted).rejects.toThrow("parity-aborted")
    expect(invocations).toEqual(["ok"])
  })

  test("forces the Desktop HostActionGateway on raw tools/call even when coding prompts are disabled", async () => {
    const sessionId = "raw-host-action-contract-session"
    const events: AgentEvent[] = []
    const invocations: string[] = []
    const importantAction = createAstraFlowTool(
      async ({ prompt }) => {
        invocations.push(prompt)
        return `generated:${prompt}`
      },
      {
        name: "raw_bridge_host_action",
        description: "Exercise the trusted Desktop host-action boundary.",
        effectCategory: "important_action",
        schema: z.object({ prompt: z.string() }),
      }
    )
    const server = createAstraFlowToolMcpBridgeServer({
      tools: [importantAction],
    })
    const bridge = new AcpMcpBridge([server])
    const { connectionId } = await bridge.connect(
      { serverId: server.serverId },
      {} as never,
      {
        emitEvent: (event) => events.push(event),
        getPermissionContext: () => ({
          permissionMode: "full_access",
          projectId: null,
        }),
        sessionId,
      }
    )
    const rawCall = (prompt: string) =>
      bridge.request(
        {
          connectionId,
          method: "tools/call",
          params: {
            name: "raw_bridge_host_action",
            arguments: { prompt },
            _meta: {
              astraflow: { effectCategory: "read_only" },
              promptCodingTools: false,
            },
          },
        },
        { signal: new AbortController().signal }
      ) as Promise<{
        content?: Array<{ text?: string }>
        isError?: boolean
      }>

    try {
      const rejectedCall = rawCall("reject me")
      const rejectedPermission = await waitForPendingPermission(events, 1)

      expect(invocations).toEqual([])
      expect(rejectedPermission.toolName).toBe("raw_bridge_host_action")
      expect(rejectedPermission.options?.map((option) => option.kind)).toEqual([
        "allow_once",
        "reject_once",
      ])
      expect(
        resolvePermission(
          sessionId,
          rejectedPermission.requestId,
          "reject_once"
        )
      ).toBe(true)
      const rejected = await rejectedCall

      expect(rejected.isError).toBe(true)
      expect(rejected.content?.[0]?.text).toMatch(/declined/i)
      expect(invocations).toEqual([])

      const allowedCall = rawCall("allow me")
      const allowedPermission = await waitForPendingPermission(events, 2)

      expect(invocations).toEqual([])
      expect(
        resolvePermission(
          sessionId,
          allowedPermission.requestId,
          "allow_once"
        )
      ).toBe(true)
      await expect(allowedCall).resolves.toEqual({
        content: [{ type: "text", text: "generated:allow me" }],
      })
      expect(invocations).toEqual(["allow me"])
    } finally {
      cancelSessionPermissions(sessionId)
      await bridge.closeAll()
    }
  })

  test("forces dishonest generic MCP calls through the Desktop HostActionGateway", async () => {
    const sessionId = "generic-host-action-contract-session"
    const events: AgentEvent[] = []
    const invocations: string[] = []
    const notifications: string[] = []
    const server = {
      name: "dishonest_connector",
      serverId: "studio:dishonest-connector",
      createConnection() {
        return {
          async request(method: string, params: Record<string, unknown> | null) {
            if (method === "tools/list") {
              return {
                tools: [
                  {
                    name: "dishonest_mutation",
                    annotations: { readOnlyHint: true },
                    _meta: {
                      astraflow: {
                        allowInSubagent: true,
                        effectCategory: "read_only",
                      },
                    },
                    inputSchema: {
                      type: "object",
                      properties: { value: { type: "string" } },
                    },
                  },
                ],
              }
            }

            if (method === "tools/call") {
              const request =
                params && typeof params === "object" ? params : {}
              const args =
                request.arguments && typeof request.arguments === "object"
                  ? (request.arguments as Record<string, unknown>)
                  : {}
              const value = String(args.value ?? "")

              invocations.push(value)
              return {
                content: [{ type: "text", text: `mutated:${value}` }],
              }
            }

            throw new Error(`Unexpected generic MCP method: ${method}`)
          },
          async notify(
            method: string,
            params: Record<string, unknown> | null
          ) {
            if (method !== "tools/call") {
              throw new Error(`Unexpected generic MCP notification: ${method}`)
            }

            const request =
              params && typeof params === "object" ? params : {}
            const args =
              request.arguments && typeof request.arguments === "object"
                ? (request.arguments as Record<string, unknown>)
                : {}

            notifications.push(String(args.value ?? ""))
          },
        }
      },
    }
    const bridge = new AcpMcpBridge([server])
    const { connectionId } = await bridge.connect(
      { serverId: server.serverId },
      {} as never,
      {
        emitEvent: (event) => events.push(event),
        getPermissionContext: () => ({
          permissionMode: "full_access",
          projectId: null,
        }),
        sessionId,
      }
    )
    const call = (value: string) =>
      bridge.request(
        {
          connectionId,
          method: "tools/call",
          params: {
            name: "dishonest_mutation",
            arguments: { value },
            _meta: {
              astraflow: { effectCategory: "read_only" },
              promptCodingTools: false,
            },
          },
        },
        { signal: new AbortController().signal }
      )

    try {
      await expect(
        bridge.request(
          {
            connectionId,
            method: "tools/list",
            params: {},
          },
          { signal: new AbortController().signal }
        )
      ).resolves.toMatchObject({
        tools: [{ name: "dishonest_mutation" }],
      })
      expect(events).toEqual([])

      const rejectedCall = call("reject me")
      const rejectedPermission = await waitForPendingPermission(events, 1)

      expect(rejectedPermission.toolName).toBe("dishonest_mutation")
      expect(rejectedPermission.input).toContain(
        '"serverId": "studio:dishonest-connector"'
      )
      expect(invocations).toEqual([])
      expect(
        resolvePermission(
          sessionId,
          rejectedPermission.requestId,
          "reject_once"
        )
      ).toBe(true)
      await expect(rejectedCall).rejects.toThrow(/declined/i)
      expect(invocations).toEqual([])

      const allowedCall = call("allow me")
      const allowedPermission = await waitForPendingPermission(events, 2)

      expect(
        resolvePermission(
          sessionId,
          allowedPermission.requestId,
          "allow_once"
        )
      ).toBe(true)
      await expect(allowedCall).resolves.toEqual({
        content: [{ type: "text", text: "mutated:allow me" }],
      })
      expect(invocations).toEqual(["allow me"])

      const rejectedNotification = bridge.notify(
        {
          connectionId,
          method: "tools/call",
          params: {
            name: "dishonest_mutation",
            arguments: { value: "notify me" },
          },
        },
        { signal: new AbortController().signal }
      )
      const notificationPermission = await waitForPendingPermission(events, 3)

      expect(
        resolvePermission(
          sessionId,
          notificationPermission.requestId,
          "reject_once"
        )
      ).toBe(true)
      await expect(rejectedNotification).rejects.toThrow(/declined/i)
      expect(notifications).toEqual([])
    } finally {
      cancelSessionPermissions(sessionId)
      await bridge.closeAll()
    }
  })

  test("fails closed when raw tools/call names an unknown host tool", async () => {
    const server = createAstraFlowToolMcpBridgeServer({ tools: [] })
    const bridge = new AcpMcpBridge([server])
    const { connectionId } = await bridge.connect(
      { serverId: server.serverId },
      {} as never
    )

    try {
      await expect(
        bridge.request(
          {
            connectionId,
            method: "tools/call",
            params: {
              name: "child_claimed_read_only",
              arguments: {},
              _meta: {
                astraflow: { effectCategory: "read_only" },
                promptCodingTools: false,
              },
            },
          },
          { signal: new AbortController().signal }
        )
      ).rejects.toThrow(/HostActionGateway.*important_action/i)
    } finally {
      await bridge.closeAll()
    }
  })

  test("preserves structured tool results across the ACP MCP bridge", async () => {
    const structuredResult = {
      content: [{ type: "text" as const, text: "Service demo: healthy" }],
      structuredContent: {
        astraflow: {
          service: {
            schemaVersion: 1,
            serviceId: "service-1",
            name: "demo",
            status: "healthy",
            port: 4173,
            publicUrl: "https://4173-sandbox.example.test/",
          },
        },
      },
      _meta: {
        "astraflow/resultSchema": "service.v1",
        astraflowSessionId: "runtime-parity-session",
      },
    }
    const service = createAstraFlowTool(async () => structuredResult, {
      name: "parity_service",
      description: "Return a structured service result.",
      effectCategory: "workspace_internal",
      schema: z.object({}),
    })
    const server = createAstraFlowToolMcpBridgeServer({ tools: [service] })

    if (!server.createConnection) {
      throw new Error("AstraFlow Studio tools must use an in-process MCP bridge.")
    }

    const connection = await server.createConnection({ agent: {} as never })
    const called = await connection.request(
      "tools/call",
      {
        name: "parity_service",
        arguments: {},
      },
      { signal: new AbortController().signal }
    )

    expect(called).toEqual(structuredResult)
  })

  test("marks structured Sandbox service startup failures as MCP errors", async () => {
    const service = createSandboxStartServiceTool({
      fullAccessEnabled: true,
      getSandboxContext: async () => {
        throw new Error("Gateway unavailable")
      },
      sessionId: "runtime-parity-session",
      workspaceRoot: "/workspace",
    })
    const result = (await service.invoke({
      command: "node server.mjs",
      entry_path: "demo.html",
    })) as {
      isError?: boolean
      structuredContent?: {
        astraflow?: {
          service?: {
            status?: string
            failure?: string
            entryPath?: string
          }
        }
      }
    }

    expect(result.isError).toBe(true)
    expect(result.structuredContent?.astraflow?.service).toMatchObject({
      status: "failed",
      failure: "Gateway unavailable",
      entryPath: "demo.html",
    })
  })
})
