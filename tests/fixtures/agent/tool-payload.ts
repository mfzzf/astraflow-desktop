import { strict as assert } from "node:assert"

import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import {
  normalizeCommandToolResult,
  normalizeToolPayload,
  stringifyToolPayload,
} from "@/lib/agent/tool-payload"

assert.equal(normalizeAgentToolName("Bash"), "execute")
assert.equal(normalizeAgentToolName("Read"), "read_file")
assert.equal(normalizeAgentToolName("TodoWrite"), "update_plan")
assert.equal(normalizeAgentToolName("Task"), "spawn_agent")
assert.equal(normalizeAgentToolName("spawnAgent"), "spawn_agent")
assert.equal(normalizeAgentToolName("mcp__linear__get_issue"), "mcp__linear__get_issue")

assert.deepEqual(
  normalizeCommandToolResult(
    JSON.stringify({ stdout: "done\n", stderr: "warning\n", interrupted: false })
  ),
  {
    output: "done\nwarning",
    stdout: "done\n",
    stderr: "warning\n",
    exitCode: null,
    interrupted: false,
    failed: false,
    isProcessResult: true,
  }
)

assert.deepEqual(
  normalizeCommandToolResult(
    JSON.stringify({ formatted_output: "failed", exit_code: 2 })
  ),
  {
    output: "failed",
    stdout: "",
    stderr: "",
    exitCode: 2,
    interrupted: false,
    failed: true,
    isProcessResult: true,
  }
)

const contentBlocks = normalizeToolPayload(
  JSON.stringify({
    content: [{ type: "text", text: "Two matches found." }],
    count: 2,
    matches: [{ path: "a.ts" }, { path: "b.ts" }],
  })
)

assert.equal(contentBlocks.primaryText, "Two matches found.")
assert.deepEqual(contentBlocks.scalars, [
  { key: "count", label: "Count", value: "2" },
])
assert.deepEqual(contentBlocks.collections, [
  { key: "matches", label: "Matches", kind: "array", count: 2 },
])
assert.deepEqual(contentBlocks.previewItems, [
  { key: "0:path:a.ts", title: "a.ts", subtitle: "" },
  { key: "1:path:b.ts", title: "b.ts", subtitle: "" },
])
assert.deepEqual(contentBlocks.summary, { count: 3, kind: "fields" })
assert.ok(contentBlocks.json?.includes('"matches"'))

const doubleEncoded = normalizeToolPayload(
  JSON.stringify(JSON.stringify({ data: { id: "task-1", status: "done" } }))
)

assert.deepEqual(doubleEncoded.summary, {
  count: 2,
  kind: "fields",
  label: "Data",
})
assert.equal(doubleEncoded.collections[0]?.label, "Data")

const bounded = stringifyToolPayload({ content: "x".repeat(50_000) }, 1_000)
assert.ok(bounded.length < 1_100)
assert.equal(JSON.parse(bounded).content.endsWith("… (truncated)"), true)

console.log("tool payload fixture passed")
