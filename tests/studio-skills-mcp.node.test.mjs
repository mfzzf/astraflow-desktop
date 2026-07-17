import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { after, test } from "node:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-skills-mcp-"))
const skillRoot = join(testDirectory, "xiaohongshu-account-booster")
const manifestPath = join(testDirectory, "skills.json")

mkdirSync(join(skillRoot, "scripts"), { recursive: true })
writeFileSync(join(skillRoot, "SKILL.md"), "# 小红书起号助手\n", "utf8")
writeFileSync(
  join(skillRoot, "scripts", "tool.py"),
  "def analyze_engagement(posts):\n    return posts\n",
  "utf8"
)
writeFileSync(
  manifestPath,
  JSON.stringify({
    listText: "Globally enabled skills:\n- xiaohongshu-account-booster",
    skills: [
      {
        slug: "xiaohongshu-account-booster",
        content:
          "Skill loaded: 小红书起号助手\nSlug: xiaohongshu-account-booster\nSKILL.md:\n# 小红书起号助手",
        rootPath: skillRoot,
        files: [
          { binary: false, path: "SKILL.md", size: 27 },
          { binary: false, path: "scripts/tool.py", size: 49 },
        ],
      },
    ],
  }),
  "utf8"
)

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test("calls the real Skills MCP list, load, and file-read interfaces", async () => {
  const client = new Client({ name: "AstraFlow Skills test", version: "1.0.0" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/astraflow-skills-mcp-server.mjs")],
    env: {
      ...process.env,
      ASTRAFLOW_SKILLS_MCP_MANIFEST: manifestPath,
    },
    stderr: "pipe",
  })

  try {
    await client.connect(transport)
    const listed = await client.listTools()
    const loaded = await client.callTool({
      name: "load_skill",
      arguments: { slug: "xiaohongshu-account-booster" },
    })
    const source = await client.callTool({
      name: "read_skill_file",
      arguments: {
        slug: "xiaohongshu-account-booster",
        path: "scripts/tool.py",
      },
    })
    const loadedText = loaded.content
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n")
    const sourceText = source.content
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n")

    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ["list_installed_skills", "load_skill", "read_skill_file"]
    )
    assert.match(loadedText, /小红书起号助手/)
    assert.match(sourceText, /def analyze_engagement/)
  } finally {
    await client.close()
  }
})
