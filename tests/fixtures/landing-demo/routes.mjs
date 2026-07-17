const FIXED_NOW = "2026-07-17T09:30:00.000Z"

const workspace = {
  id: "demo-workspace",
  type: "local",
  name: "AI 行业趋势调研",
  rootPath: "/Users/demo/Documents/AstraFlow/AI-Trends-2026",
  localProjectId: "demo-project",
  createdAt: "2026-07-10T02:00:00.000Z",
  updatedAt: FIXED_NOW,
  lastOpenedAt: FIXED_NOW,
}

const localProject = {
  id: "demo-project",
  name: "AI 行业趋势调研",
  path: "/Users/demo/Documents/AstraFlow/AI-Trends-2026",
  createdAt: "2026-07-10T02:00:00.000Z",
  updatedAt: FIXED_NOW,
  lastOpenedAt: FIXED_NOW,
  permissionRuleCount: 3,
  git: {
    gitAvailable: true,
    branch: "main",
    isDirty: true,
    changedFiles: 4,
    additions: 128,
    deletions: 16,
    remote: "origin",
    remoteUrl: "https://github.com/example/ai-trends-2026.git",
    branches: ["main", "report-layout"],
    ahead: 1,
    behind: 0,
  },
}

const session = {
  id: "demo-research",
  mode: "chat",
  title: "2026 AI 行业趋势报告",
  workspaceId: workspace.id,
  projectId: localProject.id,
  permissionMode: "auto",
  chatModel: "glm-5.2",
  chatRuntimeId: "astraflow",
  chatReasoningEffort: "max",
  latestRunUsage: {
    inputTokens: 18420,
    outputTokens: 5280,
    totalTokens: 23700,
    cachedInputTokens: 8600,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 2100,
    modelContextWindow: 1000000,
  },
  pinnedAt: FIXED_NOW,
  archivedAt: null,
  isRunning: false,
  workspace,
  agentWorkspaceRoot: workspace.rootPath,
  remoteWorkspace: null,
  createdAt: "2026-07-17T08:42:00.000Z",
  updatedAt: FIXED_NOW,
}

const messages = [
  {
    id: "demo-user-message",
    sessionId: session.id,
    role: "user",
    content:
      "调用深度研究和网页搜索技能，整理 2026 年 AI Agent 市场趋势，对比主流模型并生成一份中文报告。",
    mentions: [],
    model: null,
    environment: "local",
    versionGroupId: null,
    versionIndex: 1,
    versionCount: 1,
    isActiveVersion: true,
    rewindAvailable: false,
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-17T08:42:00.000Z",
  },
  {
    id: "demo-assistant-message",
    sessionId: session.id,
    role: "assistant",
    content:
      "调研已完成。我对 24 份公开资料进行了交叉验证，并将核心结论整理成报告和模型对比表。\n\n**关键发现**\n\n- Agent 产品正从单轮工具调用转向可持续的任务执行。\n- 企业选型更关注可观测性、权限边界和本地工作区。\n- 多模型路由已成为成本与质量平衡的标准做法。",
    mentions: [],
    model: "glm-5.2",
    environment: "local",
    versionGroupId: "demo-assistant-message",
    versionIndex: 1,
    versionCount: 1,
    isActiveVersion: true,
    rewindAvailable: false,
    activities: [],
    parts: [
      {
        id: "demo-plan",
        type: "plan",
        content: "收集资料、交叉验证、生成报告",
        todos: [
          { text: "检索行业报告与官方资料", status: "completed" },
          { text: "对比主流模型能力与成本", status: "completed" },
          { text: "输出 PDF 报告和 Excel 对比表", status: "completed" },
        ],
      },
      {
        id: "demo-search-tool",
        type: "tool",
        activity: {
          id: "demo-search",
          toolName: "web_search",
          status: "complete",
          input: "2026 AI Agent market enterprise adoption",
          output: "24 个可验证来源",
          error: null,
        },
      },
      {
        id: "demo-text",
        type: "text",
        content:
          "调研已完成。我对 24 份公开资料进行了交叉验证，并将核心结论整理成报告和模型对比表。\n\n**关键发现**\n\n- Agent 产品正从单轮工具调用转向可持续的任务执行。\n- 企业选型更关注可观测性、权限边界和本地工作区。\n- 多模型路由已成为成本与质量平衡的标准做法。",
      },
      {
        id: "demo-report-file",
        type: "file",
        path: "outputs/2026-AI-Agent-趋势报告.pdf",
        kind: "create",
        status: "complete",
        error: null,
        content: "",
        stats: null,
      },
      {
        id: "demo-sheet-file",
        type: "file",
        path: "outputs/主流模型对比.xlsx",
        kind: "create",
        status: "complete",
        error: null,
        content: "",
        stats: null,
      },
    ],
    reasoningContent: "",
    reasoningDurationMs: 18400,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-17T09:28:00.000Z",
  },
]

const models = [
  {
    Id: "glm-5.2",
    Name: "glm-5.2",
    ChineseName: "GLM 5.2",
    Manufacturer: "Z.ai",
    SimpleDescribe: "面向复杂推理、代码与长链路 Agent 任务的旗舰模型。",
    MaxModelLen: 1000000,
    InputModalities: ["text", "image"],
    OutputModalities: ["text"],
    SupportedCapabilities: ["Function Calling", "Reasoning", "Vision"],
    HfUpdateTime: 1784250000,
  },
  {
    Id: "claude-opus-4.1",
    Name: "claude-opus-4.1",
    ChineseName: "Claude Opus 4.1",
    Manufacturer: "Anthropic",
    SimpleDescribe: "适合深度研究、长文写作与多步工具协作。",
    MaxModelLen: 200000,
    InputModalities: ["text", "image"],
    OutputModalities: ["text"],
    SupportedCapabilities: ["Tool Use", "Reasoning", "Computer Use"],
    HfUpdateTime: 1784163600,
  },
  {
    Id: "gemini-2.5-pro",
    Name: "gemini-2.5-pro",
    ChineseName: "Gemini 2.5 Pro",
    Manufacturer: "Google",
    SimpleDescribe: "超长上下文多模态模型，适合大型文档和代码库分析。",
    MaxModelLen: 1000000,
    InputModalities: ["text", "image", "video", "audio"],
    OutputModalities: ["text"],
    SupportedCapabilities: ["Long Context", "Vision", "Audio"],
    HfUpdateTime: 1784077200,
  },
  {
    Id: "deepseek-v3.1",
    Name: "deepseek-v3.1",
    ChineseName: "DeepSeek V3.1",
    Manufacturer: "DeepSeek",
    SimpleDescribe: "兼顾通用对话、代码生成与高性价比批量任务。",
    MaxModelLen: 128000,
    InputModalities: ["text"],
    OutputModalities: ["text"],
    SupportedCapabilities: ["Function Calling", "Code"],
    HfUpdateTime: 1783990800,
  },
]

const skills = [
  {
    Slug: "deep-research",
    Version: "2.4.0",
    Name: "深度研究助手",
    Author: "AstraFlow",
    DescZh: "从多个来源检索、验证并组织可追溯的研究结论。",
    Category: "研究",
    Downloads: 28640,
    FileCount: 12,
    SizeBytes: 84200,
    UpStreamUpdatedAt: 1784250000,
    Latest: true,
  },
  {
    Slug: "spreadsheet-analyst",
    Version: "1.9.2",
    Name: "Excel 数据分析",
    Author: "AstraFlow",
    DescZh: "创建、分析并校验专业表格，自动生成图表与摘要。",
    Category: "数据",
    Downloads: 19420,
    FileCount: 9,
    SizeBytes: 61500,
    UpStreamUpdatedAt: 1784163600,
    Latest: true,
  },
  {
    Slug: "presentation-studio",
    Version: "3.1.0",
    Name: "演示文稿工作室",
    Author: "AstraFlow",
    DescZh: "将研究材料转换为结构清晰、可直接演示的 PPT。",
    Category: "办公",
    Downloads: 16780,
    FileCount: 16,
    SizeBytes: 128400,
    UpStreamUpdatedAt: 1784077200,
    Latest: true,
  },
  {
    Slug: "code-review",
    Version: "1.7.4",
    Name: "代码审查",
    Author: "Community",
    DescZh: "检查安全、性能与可维护性问题，输出可执行的修复建议。",
    Category: "开发",
    Downloads: 12360,
    FileCount: 8,
    SizeBytes: 49200,
    UpStreamUpdatedAt: 1783990800,
    Latest: true,
  },
]

const automationTasks = [
  {
    id: "daily-brief",
    name: "每日 AI 行业简报",
    kind: "ai",
    enabled: true,
    workspaceId: workspace.id,
    schedule: { kind: "daily", time: "09:00" },
    timeZone: "Asia/Shanghai",
    payload: {
      prompt: "搜索过去 24 小时 AI 行业新闻，生成带来源的中文简报。",
      runtimeId: "astraflow",
      model: "glm-5.2",
      reasoningEffort: "max",
      permissionMode: "readonly",
    },
    timeoutSeconds: 1800,
    concurrencyPolicy: "skip",
    misfirePolicy: "run_once",
    maxRetries: 2,
    retryDelaySeconds: 120,
    nextRunAt: "2026-07-18T01:00:00.000Z",
    lastRunAt: "2026-07-17T01:00:00.000Z",
    lastRunStatus: "succeeded",
    createdAt: "2026-07-01T02:00:00.000Z",
    updatedAt: FIXED_NOW,
  },
  {
    id: "weekly-model-report",
    name: "每周模型价格与能力对比",
    kind: "ai",
    enabled: true,
    workspaceId: workspace.id,
    schedule: { kind: "weekly", weekdays: [1], time: "10:30" },
    timeZone: "Asia/Shanghai",
    payload: {
      prompt: "更新主流模型价格、上下文和 Agent 能力对比表。",
      runtimeId: "astraflow",
      model: "claude-opus-4.1",
      reasoningEffort: "high",
      permissionMode: "readonly",
    },
    timeoutSeconds: 2400,
    concurrencyPolicy: "queue",
    misfirePolicy: "run_once",
    maxRetries: 1,
    retryDelaySeconds: 300,
    nextRunAt: "2026-07-20T02:30:00.000Z",
    lastRunAt: "2026-07-13T02:30:00.000Z",
    lastRunStatus: "succeeded",
    createdAt: "2026-06-20T02:00:00.000Z",
    updatedAt: FIXED_NOW,
  },
  {
    id: "archive-assets",
    name: "研究素材自动归档",
    kind: "command",
    enabled: false,
    workspaceId: workspace.id,
    schedule: { kind: "daily", time: "18:30" },
    timeZone: "Asia/Shanghai",
    payload: {
      command: "bun scripts/archive-research-assets.ts",
      workingDirectory: workspace.rootPath,
      maxLogBytes: 65536,
    },
    timeoutSeconds: 600,
    concurrencyPolicy: "skip",
    misfirePolicy: "skip",
    maxRetries: 0,
    retryDelaySeconds: 60,
    nextRunAt: null,
    lastRunAt: "2026-07-15T10:30:00.000Z",
    lastRunStatus: "succeeded",
    createdAt: "2026-06-20T02:00:00.000Z",
    updatedAt: FIXED_NOW,
  },
]

const runtime = {
  id: "astraflow",
  label: "AstraFlow Agent",
  description: "AstraFlow agent with remote sandbox and local execution",
  capabilities: {
    hitl: true,
    resume: true,
    subagents: true,
    plan: true,
    sandbox: true,
    mcp: true,
    skills: true,
    compact: true,
  },
}

const modelSettings = {
  runtimes: {},
  customModels: [],
  models: [
    {
      id: "glm-5.2",
      label: "GLM 5.2",
      providerModel: "glm-5.2",
      protocol: "openai-chat",
      baseUrl: null,
      supportedRuntimeIds: ["astraflow", "opencode"],
      reasoningEfforts: ["none", "high", "max"],
      defaultReasoningEffort: "max",
      builtin: true,
      enabled: true,
    },
  ],
  hasModelverseApiKey: true,
  updatedAt: FIXED_NOW,
}

function json(body, status = 200) {
  return { body, status }
}

export function resolveLandingDemoResponse(requestUrl, method = "GET") {
  const url = new URL(requestUrl)
  const path = url.pathname

  if (method !== "GET") {
    return json({ ok: false, message: "Screenshot demo is read-only." }, 405)
  }

  if (path === "/api/studio/oauth/status") {
    return json({
      ok: true,
      data: {
        auth: { configured: true, email: "demo@astraflow.local", expiresAt: null },
        oauthConfigured: false,
        flow: null,
      },
    })
  }
  if (path === "/api/studio/sessions") return json({ ok: true, data: [session] })
  if (path === `/api/studio/sessions/${session.id}`) return json({ ok: true, data: session })
  if (path === `/api/studio/sessions/${session.id}/messages`) return json({ ok: true, data: messages })
  if (path === `/api/studio/sessions/${session.id}/commands`) return json({ ok: true, data: [] })
  if (path === "/api/studio/local-projects") return json({ ok: true, data: [localProject] })
  if (path === "/api/studio/workspaces") return json({ ok: true, data: [workspace] })
  if (path === `/api/studio/workspaces/${workspace.id}`) return json({ ok: true, data: workspace })
  if (path === "/api/studio/projects") {
    return json({
      ok: true,
      data: {
        user: {
          userName: "demo",
          displayName: "AstraFlow Demo",
          companyName: "AstraFlow",
          userEmail: "demo@astraflow.local",
          companyId: null,
        },
      },
    })
  }
  if (path === "/api/studio/agent-runtimes") return json({ ok: true, data: [runtime] })
  if (path === "/api/studio/agent-model-settings") return json({ ok: true, data: modelSettings })
  if (path === "/api/studio/experts/recent") return json({ ok: true, data: [] })
  if (path === "/api/skills/installed") return json({ ok: true, data: [] })
  if (path === "/api/mcp/installed") return json({ ok: true, data: [] })

  if (path === "/api/model-square") {
    return json({
      ok: true,
      data: models,
      totalCount: models.length,
      vendors: [
        { name: "OpenAI", count: 1 },
        { name: "Anthropic", count: 1 },
        { name: "Google", count: 1 },
        { name: "DeepSeek", count: 1 },
      ],
    })
  }
  if (path === "/api/model-square/prices") return json({ ok: true, data: [], totalCount: 0 })
  if (/^\/api\/studio\/(image|video|audio)\/models$/.test(path)) {
    return json({ ok: true, data: { supported: [], disabled: [] } })
  }

  if (path === "/api/skills") {
    return json({
      ok: true,
      data: skills,
      totalCount: skills.length,
      allCategories: ["研究", "数据", "办公", "开发"],
    })
  }
  if (path === "/api/mcp/market") {
    return json({ ok: true, data: [], totalCount: 0, nextCursor: null })
  }
  if (path === "/api/experts") {
    return json({
      ok: true,
      data: {
        experts: [],
        categories: [],
        totalSize: 0,
        nextPageToken: "",
      },
    })
  }

  if (path === "/api/automations") {
    return json({
      ok: true,
      data: {
        tasks: automationTasks,
        activeCount: automationTasks.filter((task) => task.enabled).length,
        totalCount: automationTasks.length,
      },
    })
  }

  if (/^\/api\/automations\/[^/]+\/runs$/.test(path)) {
    return json({ ok: true, data: [] })
  }

  return json(
    { ok: false, message: `No screenshot fixture for ${path}.` },
    501
  )
}

export { FIXED_NOW }
