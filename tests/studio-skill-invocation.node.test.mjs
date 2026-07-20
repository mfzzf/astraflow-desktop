import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-skill-invocation-"))
const skillsRoot = join(testDirectory, "skills")

process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")
process.env.ASTRAFLOW_STUDIO_SKILLS_PATH = skillsRoot

const studioDb = await import("../lib/studio-db.ts")
const { applyStudioRuntimeContextToLatestUserMessage } =
  await import("../lib/studio-chat-runner.ts")

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test("repairs session titles polluted by the native Skill preamble", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title:
      "AstraFlow Skills are registered through the Pi coding-agent SDK. Activate the matching native skill.",
    chatRuntimeId: "astraflow",
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "/frontend-design 修复会话记录标题",
    environment: "local",
  })

  const repairedSession = studioDb
    .listStudioSessions()
    .find((candidate) => candidate.id === session.id)

  assert.equal(repairedSession?.title, "修复会话记录标题")

  const remoteSession = studioDb.createStudioSession({
    mode: "chat",
    title:
      "Installed AstraFlow Skills are globally enabled for this chat. Do not assume a skill's full instructions from the catalog alone.",
    chatRuntimeId: "codex",
  })
  studioDb.createStudioMessage({
    sessionId: remoteSession.id,
    role: "user",
    content: "/$frontend-design 修复远程沙箱标题",
    environment: "remote",
  })

  assert.equal(
    studioDb.getStudioSession(remoteSession.id)?.title,
    "修复远程沙箱标题"
  )
})

test("keeps slash text visible while sending a resolved Skill prompt to the runtime", () => {
  const slug = "xiaohongshu-account-booster"
  const installPath = join(slug, "1.0.3")
  const installRoot = join(skillsRoot, installPath)
  const skillMd = [
    "---",
    `name: ${slug}`,
    "description: [Python技能] 小红书起号助手",
    "---",
    "# 小红书起号助手",
    "",
    "Use scripts/tool.py.",
  ].join("\n")

  mkdirSync(join(installRoot, "scripts"), { recursive: true })
  writeFileSync(join(installRoot, "SKILL.md"), skillMd, "utf8")
  writeFileSync(join(installRoot, "scripts", "tool.py"), "print('ok')\n")
  studioDb.upsertStudioInstalledSkill({
    slug,
    version: "1.0.3",
    skill: {
      Slug: slug,
      Version: "1.0.3",
      Name: "小红书起号助手",
      Desc: "[Python技能] 小红书起号助手",
    },
    skillMd,
    enabled: true,
    installPath,
    installedFileCount: 2,
    installedSizeBytes: Buffer.byteLength(skillMd) + 12,
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Skill invocation",
    chatRuntimeId: "astraflow",
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: `/${slug} 分析下这个`,
    environment: "local",
  })
  const visibleHistory = studioDb.listStudioMessages(session.id)
  const runtimeHistory = applyStudioRuntimeContextToLatestUserMessage({
    environment: "local",
    history: visibleHistory,
    sessionId: session.id,
  })

  assert.equal(visibleHistory.at(-1)?.content, `/${slug} 分析下这个`)
  assert.equal(
    studioDb.listStudioMessages(session.id).at(-1)?.content,
    `/${slug} 分析下这个`
  )
  assert.equal(runtimeHistory.at(-1)?.content.startsWith("/"), false)
  assert.match(
    runtimeHistory.at(-1)?.content ?? "",
    /Skill command, not a filesystem path/
  )
  assert.match(runtimeHistory.at(-1)?.content ?? "", /# 小红书起号助手/)
  assert.match(runtimeHistory.at(-1)?.content ?? "", /分析下这个/)

  studioDb.setStudioSessionAvailableCommands(session.id, [
    {
      name: slug,
      description: "Agent-owned command",
      source: "runtime",
      runtimeId: "astraflow",
    },
  ])
  const agentOwnedHistory = applyStudioRuntimeContextToLatestUserMessage({
    environment: "local",
    history: visibleHistory,
    sessionId: session.id,
  })

  assert.equal(agentOwnedHistory, visibleHistory)
  assert.equal(agentOwnedHistory.at(-1)?.content, `/${slug} 分析下这个`)
})

test("loads multiple installed Skills for one Studio request", () => {
  const slugs = ["multi-alpha", "multi-beta"]

  for (const slug of slugs) {
    const installPath = join(slug, "1.0.0")
    const installRoot = join(skillsRoot, installPath)
    const skillMd = `# ${slug.toUpperCase()} Skill\n\nUse the ${slug} workflow.`

    mkdirSync(installRoot, { recursive: true })
    writeFileSync(join(installRoot, "SKILL.md"), skillMd, "utf8")
    studioDb.upsertStudioInstalledSkill({
      slug,
      version: "1.0.0",
      skill: { Slug: slug, Version: "1.0.0", Name: slug.toUpperCase() },
      skillMd,
      enabled: true,
      installPath,
      installedFileCount: 1,
      installedSizeBytes: Buffer.byteLength(skillMd),
    })
  }

  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Multiple Skill invocation",
    chatRuntimeId: "astraflow",
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "/multi-alpha /multi-beta 整理后导出",
    environment: "local",
  })
  const runtimeHistory = applyStudioRuntimeContextToLatestUserMessage({
    environment: "local",
    history: studioDb.listStudioMessages(session.id),
    sessionId: session.id,
  })
  const prompt = runtimeHistory.at(-1)?.content ?? ""

  assert.match(prompt, /# MULTI-ALPHA Skill/)
  assert.match(prompt, /# MULTI-BETA Skill/)
  assert.match(prompt, /整理后导出/)
})

test("leaves a real runtime slash command untouched", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Runtime command",
    chatRuntimeId: "astraflow",
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "/compact preserve API decisions",
    environment: "local",
  })
  const history = studioDb.listStudioMessages(session.id)
  const runtimeHistory = applyStudioRuntimeContextToLatestUserMessage({
    environment: "local",
    history,
    sessionId: session.id,
  })

  assert.equal(runtimeHistory, history)
  assert.equal(
    runtimeHistory.at(-1)?.content,
    "/compact preserve API decisions"
  )
})

test("injects the selected expert for every runtime without rewriting visible history", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Expert invocation",
    chatRuntimeId: "opencode",
  })
  studioDb.upsertStudioSessionExpert({
    sessionId: session.id,
    expertId: "AccessibilityAuditor",
    expertType: "agent",
    runtimeHash: "sha256:test",
    snapshot: {
      expert: {
        id: "AccessibilityAuditor",
        type: "agent",
        runtimeHash: "sha256:test",
        displayName: { zh: "无障碍审计专家" },
      },
      agents: [
        {
          agentName: "accessibility-auditor",
          role: "primary",
          promptMarkdown:
            "Audit the product against WCAG with concrete evidence.",
        },
      ],
    },
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "审查这个页面",
    environment: "local",
  })
  const visibleHistory = studioDb.listStudioMessages(session.id)
  const runtimeHistory = applyStudioRuntimeContextToLatestUserMessage({
    environment: "local",
    history: visibleHistory,
    sessionId: session.id,
  })

  assert.equal(visibleHistory.at(-1)?.content, "审查这个页面")
  assert.equal(
    studioDb.listStudioMessages(session.id).at(-1)?.content,
    "审查这个页面"
  )
  assert.match(runtimeHistory.at(-1)?.content ?? "", /<expert_context>/)
  assert.match(
    runtimeHistory.at(-1)?.content ?? "",
    /Audit the product against WCAG with concrete evidence\./
  )
  assert.match(runtimeHistory.at(-1)?.content ?? "", /审查这个页面/)
})
