import assert from "node:assert/strict"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"

const testRoot = mkdtempSync(join(tmpdir(), "astraflow-capability-chain-"))
const skillsRoot = join(testRoot, "installed-skills")

process.env.ASTRAFLOW_SQLITE_PATH = join(testRoot, "studio.sqlite")
process.env.ASTRAFLOW_STUDIO_SKILLS_PATH = skillsRoot
process.env.ASTRAFLOW_ACP_WORKSPACES_PATH = join(testRoot, "agent-workspaces")
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(
  testRoot,
  "managed-workspaces"
)
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(
  testRoot,
  "sandbox-workspaces"
)

const studioDb = await import("../lib/studio-db.ts")
const { createStudioAcpSessionPlugins } =
  await import("../lib/agent/acp/studio-plugins.ts")
const { createPromptBlocks } = await import("../lib/agent/acp/acp-runtime.ts")
const { ensureStudioManagedWorkspace } =
  await import("../lib/studio-managed-workspace.ts")
const { ensureLocalSandboxWorkspace } =
  await import("../lib/agent/sandbox/local-policy.ts")

after(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

test("keeps runtime slash commands first while retaining expert preamble", async () => {
  const blocks = await createPromptBlocks(
    [{ role: "user", content: "/review connector loading" }],
    { embeddedContext: true, image: false, audio: false },
    false,
    "<expert_context>Keep the expert workflow active.</expert_context>",
    testRoot
  )

  assert.equal(blocks[0].text, "/review connector loading")
  assert.match(blocks[1].text, /Keep the expert workflow active/)

  const codexSkillBlocks = await createPromptBlocks(
    [{ role: "user", content: "/$anthropic-docs streaming" }],
    { embeddedContext: true, image: false, audio: false },
    false,
    "<expert_context>Keep the expert workflow active.</expert_context>",
    testRoot
  )

  assert.equal(codexSkillBlocks[0].text, "/$anthropic-docs streaming")
  assert.match(codexSkillBlocks[1].text, /Keep the expert workflow active/)
})

function textContent(result) {
  return result.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n")
}

async function listBridgeTools(server) {
  const connection = await server.createConnection({
    agent: {},
    hostContext: {
      emitEvent() {},
      getPermissionContext() {
        return {
          permissionMode: "default",
          projectId: null,
        }
      },
      sessionId: "capability-chain-test",
    },
  })
  const listed = await connection.request("tools/list", {}, {})

  return { connection, names: listed.tools.map((tool) => tool.name) }
}

test("loads expert prompt, MCP, and complete Skills tools in local and sandbox AstraFlow Agent", async () => {
  const slug = "docx-chain"
  const installPath = join(slug, "1.0.0")
  const installRoot = join(skillsRoot, installPath)
  const skillMd = [
    "---",
    `name: ${slug}`,
    "description: Validate the full DOCX workflow.",
    "---",
    "# DOCX chain",
    "Run scripts/verify.mjs from the prepared skill root.",
  ].join("\n")

  mkdirSync(join(installRoot, "scripts"), { recursive: true })
  writeFileSync(join(installRoot, "SKILL.md"), skillMd)
  writeFileSync(
    join(installRoot, "scripts", "verify.mjs"),
    "export default 'ok'\n"
  )
  studioDb.upsertStudioInstalledSkill({
    slug,
    version: "1.0.0",
    skill: {
      Slug: slug,
      Version: "1.0.0",
      Name: "DOCX chain",
      Desc: "Validate the full DOCX workflow.",
    },
    skillMd,
    enabled: true,
    installPath,
    installedFileCount: 2,
    installedSizeBytes: Buffer.byteLength(skillMd) + 20,
  })
  const installedMcp = studioDb.upsertStudioMcpServer({
    id: "expert-filesystem",
    name: "filesystem",
    title: "Expert filesystem",
    enabled: true,
    config: {
      type: "stdio",
      command: process.execPath,
      args: ["--version"],
      cwd: null,
      env: [
        {
          name: "MCP_DESKTOP_ONLY_SECRET",
          value: "must-never-reach-acp-session-params",
          isSecret: true,
        },
      ],
    },
  })
  const localSession = studioDb.createStudioSession({
    mode: "chat",
    title: "Local full chain",
    chatRuntimeId: "astraflow",
  })
  ensureStudioManagedWorkspace(localSession.id)
  const expertSnapshot = {
    expert: { id: "DocxExpert", type: "agent" },
    agents: [
      {
        agentName: "docx-expert",
        role: "primary",
        promptMarkdown: "Use the declared DOCX verification workflow.",
      },
    ],
    mcpServers: [
      {
        id: "filesystem.json",
        mcpJson: JSON.stringify({ mcpServers: { filesystem: {} } }),
      },
    ],
    skills: [
      {
        skillSlug: "expert-docx-review",
        title: "Expert DOCX review",
        skillMarkdown: "# Expert DOCX review\nCheck document semantics.",
      },
    ],
  }
  studioDb.upsertStudioSessionExpert({
    sessionId: localSession.id,
    expertId: "DocxExpert",
    expertType: "agent",
    runtimeHash: "sha256:docx-chain",
    snapshot: expertSnapshot,
  })

  const local = createStudioAcpSessionPlugins({
    environment: "local",
    runtimeId: "astraflow",
    sessionId: localSession.id,
  })
  const skillsBridge = local.mcpBridgeServers.find(
    (server) => server.serverId === "astraflow:skills"
  )

  assert.ok(skillsBridge?.createConnection)
  const environmentBridge = local.mcpBridgeServers.find(
    (server) => server.serverId === "astraflow:environment"
  )
  assert.ok(environmentBridge?.createConnection)
  assert.deepEqual((await listBridgeTools(environmentBridge)).names, [
    "get_runtime_environment_status",
    "check_runtime_environment_health",
    "install_runtime_environment",
  ])
  assert.match(local.promptPreamble, /astraflow_environment MCP tools/)
  for (const runtimeId of ["codex", "opencode", "claude-code"]) {
    const runtimePlugins = createStudioAcpSessionPlugins({
      environment: "local",
      runtimeId,
      sessionId: localSession.id,
    })
    assert.ok(
      runtimePlugins.mcpBridgeServers.some(
        (server) => server.serverId === "astraflow:environment"
      ),
      `${runtimeId} must receive the managed environment MCP server`
    )
  }
  assert.ok(
    local.mcpBridgeServers.some(
      (server) => server.serverId === `studio:${installedMcp.id}`
    )
  )
  assert.equal(
    JSON.stringify(local.mcpServers).includes(
      "must-never-reach-acp-session-params"
    ),
    false,
    "installed MCP secrets must remain behind the Desktop ACP bridge"
  )
  assert.equal(
    local.mcpServers.some((server) => server.name === "expert_filesystem"),
    false,
    "installed MCP process configs must not be serialized as a direct fallback"
  )
  assert.match(
    local.promptPreamble,
    /Use the declared DOCX verification workflow/
  )
  assert.match(local.promptPreamble, /attached_server_names: filesystem/)
  const { connection, names } = await listBridgeTools(skillsBridge)

  assert.deepEqual(names, [
    "list_installed_skills",
    "load_skill",
    "read_skill_file",
    "prepare_skill_sandbox",
  ])
  const loaded = await connection.request(
    "tools/call",
    { name: "load_skill", arguments: { slug } },
    {}
  )
  const source = await connection.request(
    "tools/call",
    {
      name: "read_skill_file",
      arguments: { slug, path: "scripts/verify.mjs" },
    },
    {}
  )
  const prepared = await connection.request(
    "tools/call",
    { name: "prepare_skill_sandbox", arguments: { slug } },
    {}
  )
  const expertSkill = await connection.request(
    "tools/call",
    {
      name: "load_skill",
      arguments: { slug: "expert-docx-review" },
    },
    {}
  )

  assert.match(textContent(loaded), /scripts\/verify\.mjs/)
  assert.match(textContent(source), /export default 'ok'/)
  assert.match(textContent(prepared), /Sync: 2\/2 files synced/)
  assert.match(textContent(expertSkill), /Check document semantics/)
  const preparedScript = join(
    ensureLocalSandboxWorkspace(localSession.id),
    "skills",
    slug,
    "scripts",
    "verify.mjs"
  )
  assert.equal(existsSync(preparedScript), true)
  assert.equal(readFileSync(preparedScript, "utf8"), "export default 'ok'\n")

  const remoteWorkspace = studioDb.createStudioSandboxWorkspace({
    name: "Remote E2E",
    rootPath: "/workspace",
    sandboxId: "sandbox-e2e",
  })
  studioDb.saveStudioModelverseApiKey({
    id: "test-key",
    name: "Test key",
    key: "test-secret",
    projectId: "project-e2e",
  })
  const remoteSession = studioDb.createStudioSession({
    mode: "chat",
    title: "Remote full chain",
    chatRuntimeId: "astraflow",
    workspaceId: remoteWorkspace.id,
  })
  studioDb.upsertStudioSessionExpert({
    sessionId: remoteSession.id,
    expertId: "DocxExpert",
    expertType: "agent",
    runtimeHash: "sha256:docx-chain",
    snapshot: expertSnapshot,
  })
  const remote = createStudioAcpSessionPlugins({
    environment: "remote",
    runtimeId: "astraflow",
    sessionId: remoteSession.id,
    skillSync: async ({ environment, files, sessionId, slug }) => {
      assert.equal(environment, "remote")
      assert.equal(sessionId, remoteSession.id)
      const sandboxPath = join(testRoot, "fake-remote", slug)

      for (const file of files) {
        const destination = join(sandboxPath, file.path)

        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, file.buffer)
      }

      return {
        sandboxPath,
        syncSummary: {
          attemptedFileCount: files.length,
          failed: [],
          skipped: [],
          syncedFileCount: files.length,
          totalFileCount: files.length,
        },
      }
    },
  })
  const remoteSkillsBridge = remote.mcpBridgeServers.find(
    (server) => server.serverId === "astraflow:skills"
  )
  assert.equal(
    remote.mcpBridgeServers.some(
      (server) => server.serverId === "astraflow:environment"
    ),
    false,
    "remote agents must not receive the Desktop-local environment installer"
  )
  const remoteTools = await listBridgeTools(remoteSkillsBridge)

  assert.deepEqual(remoteTools.names, names)
  assert.match(
    remote.promptPreamble,
    /Use the declared DOCX verification workflow/
  )
  assert.match(remote.promptPreamble, /attached_server_names: filesystem/)
  const remoteExpertSkill = await remoteTools.connection.request(
    "tools/call",
    {
      name: "load_skill",
      arguments: { slug: "expert-docx-review" },
    },
    {}
  )

  assert.match(textContent(remoteExpertSkill), /Check document semantics/)
  const remotePrepared = await remoteTools.connection.request(
    "tools/call",
    { name: "prepare_skill_sandbox", arguments: { slug } },
    {}
  )

  assert.match(textContent(remotePrepared), /Sync: 2\/2 files synced/)
  assert.equal(
    readFileSync(
      join(testRoot, "fake-remote", slug, "scripts", "verify.mjs"),
      "utf8"
    ),
    "export default 'ok'\n"
  )
  assert.ok(
    remote.mcpBridgeServers.some(
      (server) => server.serverId === `studio:${installedMcp.id}`
    )
  )

  const remoteCodex = createStudioAcpSessionPlugins({
    environment: "remote",
    runtimeId: "codex",
    sessionId: remoteSession.id,
  })
  const remoteCodexSkillsBridge = remoteCodex.mcpBridgeServers.find(
    (server) => server.serverId === "astraflow:skills"
  )

  assert.ok(remoteCodexSkillsBridge?.createConnection)
  assert.equal(
    remoteCodex.mcpServers.some((server) => server.name === "astraflow_skills"),
    false,
    "remote agents must not receive a Desktop-local stdio Skills server"
  )
  const remoteCodexTools = await listBridgeTools(remoteCodexSkillsBridge)

  assert.deepEqual(remoteCodexTools.names, names)
})
