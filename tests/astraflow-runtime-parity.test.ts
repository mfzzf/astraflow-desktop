// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { z } from "zod"

import {
  ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID,
  ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME,
  createAstraFlowToolMcpBridgeServer,
  listAstraFlowToolDescriptors,
} from "@/lib/agent/acp/host-tools"
import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import hostToolsManifest from "@/runtime/astraflow-acp/host-tools-manifest.json"

function sorted(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function manifestToolNames() {
  return sorted(Object.values(hostToolsManifest.toolGroups).flat())
}

function fullStudioTools(type: "local" | "sandbox") {
  return createStudioAgentTools({
    exaApiKey: "test-exa-key",
    mobileChannelBound: true,
    modelverseApiKey: "test-modelverse-key",
    sessionId: "runtime-parity-session",
    workspace: {
      id: `runtime-parity-${type}`,
      rootPath: type === "local" ? "/tmp/astraflow-parity" : "/workspace",
      type,
    },
  })
}

describe("AstraFlow local and Sandbox runtime parity", () => {
  test("publishes the Desktop host-tool protocol in the shared runtime", () => {
    expect(hostToolsManifest.schemaVersion).toBe(1)
    expect(hostToolsManifest.protocolVersion).toBe(1)
    expect(hostToolsManifest.server).toEqual({
      name: ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME,
      serverId: ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID,
    })
  })

  test("exposes the exact same complete product-tool names locally and remotely", () => {
    const expected = manifestToolNames()
    const localTools = fullStudioTools("local")
    const sandboxTools = fullStudioTools("sandbox")
    const localDescriptors = listAstraFlowToolDescriptors(localTools)
    const sandboxDescriptors = listAstraFlowToolDescriptors(sandboxTools)

    expect(sorted(localTools.map((tool) => tool.name))).toEqual(expected)
    expect(sorted(sandboxTools.map((tool) => tool.name))).toEqual(expected)
    expect(localDescriptors).toEqual(sandboxDescriptors)
    expect(sorted(localDescriptors.map((tool) => tool.name))).toEqual(expected)

    for (const required of [
      "studio_generate_image",
      "studio_generate_video",
      "studio_list_media_generation_models",
      "studio_get_media_model_schema",
    ]) {
      expect(expected).toContain(required)
    }
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
      manifestToolNames()
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
})
