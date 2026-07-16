import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js"

import {
  keyValuesToRecord,
  type McpServerCapabilities,
  type McpServerPromptSummary,
  type McpServerResourceSummary,
  type McpServerToolSummary,
  type McpTransportConfig,
} from "@/lib/mcp"

const MCP_CLIENT_NAME = "astraflow-desktop"
const MCP_CLIENT_VERSION = "1.0.0"
const MCP_CONNECTION_TIMEOUT_MS = 15_000
const MCP_LIST_TIMEOUT_MS = 15_000

type DiscoverMcpServerResult = {
  capabilities: McpServerCapabilities
  tools: McpServerToolSummary[]
  resources: McpServerResourceSummary[]
  prompts: McpServerPromptSummary[]
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })
}

export function createMcpTransport(config: McpTransportConfig): Transport {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: {
        ...getDefaultEnvironment(),
        ...keyValuesToRecord(config.env),
      },
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
    })
  }

  const headers = keyValuesToRecord(config.headers)
  const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined

  if (config.type === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      ...(requestInit ? { requestInit } : {}),
      ...(requestInit
        ? {
            eventSourceInit: {
              fetch: (url, init) =>
                fetch(url, {
                  ...init,
                  headers: {
                    ...headers,
                    ...(init?.headers as Record<string, string> | undefined),
                  },
                }),
            },
          }
        : {}),
    })
  }

  return new StreamableHTTPClientTransport(new URL(config.url), {
    ...(requestInit ? { requestInit } : {}),
  })
}

function mapCapabilities(
  capabilities: ServerCapabilities | undefined
): McpServerCapabilities {
  const raw = capabilities
    ? (capabilities as unknown as Record<string, unknown>)
    : {}

  return {
    tools: Boolean(capabilities?.tools),
    resources: Boolean(capabilities?.resources),
    prompts: Boolean(capabilities?.prompts),
    roots: Boolean(raw.roots),
    sampling: Boolean(raw.sampling),
    elicitation: Boolean(raw.elicitation),
    raw,
  }
}

async function listToolsSafely(client: Client) {
  try {
    const response = await withTimeout(
      client.listTools(undefined, { timeout: MCP_LIST_TIMEOUT_MS }),
      MCP_LIST_TIMEOUT_MS,
      "MCP tools discovery"
    )

    return response.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    }))
  } catch {
    return []
  }
}

async function listResourcesSafely(client: Client) {
  try {
    const response = await withTimeout(
      client.listResources(undefined, { timeout: MCP_LIST_TIMEOUT_MS }),
      MCP_LIST_TIMEOUT_MS,
      "MCP resources discovery"
    )

    return response.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    }))
  } catch {
    return []
  }
}

async function listPromptsSafely(client: Client) {
  try {
    const response = await withTimeout(
      client.listPrompts(undefined, { timeout: MCP_LIST_TIMEOUT_MS }),
      MCP_LIST_TIMEOUT_MS,
      "MCP prompts discovery"
    )

    return response.prompts.map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
    }))
  } catch {
    return []
  }
}

export async function discoverMcpServer(
  config: McpTransportConfig
): Promise<DiscoverMcpServerResult> {
  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    },
    {
      capabilities: {},
    }
  )
  const transport = createMcpTransport(config)

  try {
    await withTimeout(
      client.connect(transport, { timeout: MCP_CONNECTION_TIMEOUT_MS }),
      MCP_CONNECTION_TIMEOUT_MS,
      "MCP connection"
    )

    const capabilities = mapCapabilities(client.getServerCapabilities())
    const [tools, resources, prompts] = await Promise.all([
      capabilities.tools ? listToolsSafely(client) : Promise.resolve([]),
      capabilities.resources ? listResourcesSafely(client) : Promise.resolve([]),
      capabilities.prompts ? listPromptsSafely(client) : Promise.resolve([]),
    ])

    return {
      capabilities,
      tools,
      resources,
      prompts,
    }
  } catch (error) {
    throw new Error(toErrorMessage(error))
  } finally {
    await client.close().catch(() => undefined)
  }
}
