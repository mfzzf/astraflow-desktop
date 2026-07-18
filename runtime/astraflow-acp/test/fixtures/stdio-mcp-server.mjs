import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({
  name: "astraflow-acp-stdio-test",
  version: "1.0.0",
})

server.registerTool(
  "stdio_echo",
  {
    description: "Echo a value through the stdio MCP transport.",
    inputSchema: { value: z.string() },
  },
  async ({ value }) => ({
    content: [{ type: "text", text: `stdio:${value}` }],
  })
)

await server.connect(new StdioServerTransport())
