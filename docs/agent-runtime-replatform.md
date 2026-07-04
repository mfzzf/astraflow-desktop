# AstraFlow Agent Runtime 平台重构方案（调研稿）

> 状态：调研完成。deepagents 与外部运行时（Claude Agent SDK / Codex / ACP）两份原始调研报告见 `docs/research/`；包版本均经 `npm view` 核验（2026-07-04）。
> 日期：2026-07-04

## 1. 背景与目标

当前 `studio` 聊天的 agent 能力完全由 LangChain v1 `createAgent` 提供（`lib/studio-chat-runner.ts`），能力不足：没有 planning、subagent、虚拟文件系统、长上下文压缩，工具审批（HITL）也没有。目标：

1. **内置运行时升级**：`createAgent` → `deepagents`（LangChain Deep Agents JS），获得 todo/planning、filesystem+sandbox backend、subagents、context compression、HITL。
2. **多运行时平台化**：抽象出统一的 Agent Runtime 接口，使 Claude Code（Claude Agent SDK）、Codex（Codex SDK / app-server）等外部 agent 可以作为可选运行时接入，共享同一套消息模型、持久化、前端渲染。

## 2. 现状分析（as-is）

```
app/api/studio/chat/route.ts ──► lib/studio-chat-runner.ts (1339 行, 唯一执行器)
                                   ├─ createAgent({ model, tools, middleware, systemPrompt })
                                   │    ├─ model: lib/modelverse-langchain.ts (ChatOpenAI/ChatAnthropic → ModelVerse 端点)
                                   │    ├─ tools: lib/ai/tools/{studio,web,astraflow-sandbox}.ts (E2B run_code/run_command/文件工具)
                                   │    ├─ MCP:  lib/ai/tools/mcp.ts (MultiServerMCPClient, 前缀命名)
                                   │    └─ skills: lib/ai/skills/studio-skills.ts (createMiddleware: prompt 注入 + 2 工具)
                                   ├─ streamEvents(v3) 原始事件手工解析 → ChatStreamEvent(content/reasoning/tool_call/tool_result)
                                   ├─ SnapshotAccumulator → StudioMessagePart[text|reasoning|tool] + activities
                                   └─ 150ms 节流 live listener + 350ms 节流持久化 sqlite (studio-db)
```

关键耦合点（重构要拆开的）：

- **执行器与运行时耦合**：runner 里既有"跑 LangChain agent"的逻辑，又有"run 生命周期管理 + snapshot 累积 + 持久化 + live 推送"的通用逻辑，后者其实是运行时无关的。
- **事件解析脆弱**：`getRawEventData`/`isVisibleToolName` 等 400+ 行防御式解析针对 LangChain raw event 形状硬编码。
- **消息模型已经统一**：`StudioMessagePart`(text/reasoning/tool) + `StudioMessageActivity` 是很好的归一化基础，但缺少 plan/todo、subagent、file_change、permission_request 等 part 类型。
- **无状态每轮重建**：每 turn 从 sqlite 重建 messages，无 checkpointer——deepagents 的 HITL 和文件 offload 会打破这个假设。

## 3. 目标架构（to-be）

### 3.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│ UI (studio chat workbench)                                   │
│   渲染 AgentEvent 归一化后的 StudioMessagePart（扩展类型）        │
├─────────────────────────────────────────────────────────────┤
│ Run Orchestrator（lib/agent/run-orchestrator.ts）              │
│   run 生命周期 / SnapshotAccumulator / 节流持久化 / live 推送     │
│   ── 从 studio-chat-runner.ts 中抽出，运行时无关 ──               │
├─────────────────────────────────────────────────────────────┤
│ AgentRuntime 统一接口（lib/agent/runtime.ts）                   │
│   startRun(input) → AsyncIterable<AgentEvent> + control 面     │
├───────────────┬───────────────────┬─────────────────────────┤
│ DeepAgentsRuntime │ ClaudeAgentRuntime │ CodexRuntime / AcpRuntime │
│ (内置, in-process) │ (@anthropic-ai/    │ (@openai/codex-sdk 或     │
│ createDeepAgent   │  claude-agent-sdk) │  ACP 子进程 JSON-RPC)     │
└───────────────┴───────────────────┴─────────────────────────┘
```

### 3.2 统一事件模型 `AgentEvent`

所有 runtime adapter 把各自的原生事件归一化为：

```ts
type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: string; parentTaskId?: string }
  | { type: "tool_result"; id: string; name: string; status: "complete" | "error"; output?: string; error?: string }
  | { type: "plan_update"; todos: { text: string; status: "pending" | "in_progress" | "completed" }[] }
  | { type: "subagent_start" | "subagent_end"; taskId: string; name: string; summary?: string }
  | { type: "file_change"; path: string; kind: "create" | "edit" | "delete" }
  | { type: "permission_request"; requestId: string; toolName: string; input: string; decisions: string[] }
  | { type: "run_meta"; sessionRef?: string; usage?: unknown }   // 会话恢复句柄、token 用量
  | { type: "error"; message: string }
```

对应地，`StudioMessagePart` 增加 `plan`、`subagent`、`file`、`permission` part 类型；`SnapshotAccumulator` 保持现有累积/节流逻辑，只是消费 `AgentEvent` 而不是 raw LangChain 事件。

### 3.3 AgentRuntime 接口

```ts
interface AgentRuntime {
  readonly id: string                      // "deepagents" | "claude-code" | "codex" | ...
  capabilities(): RuntimeCapabilities      // { hitl, resume, subagents, plan, sandbox, mcp, skills }
  startRun(input: {
    sessionId: string
    messages: UnifiedMessage[]             // 或 sessionRef（支持原生 resume 的运行时）
    model?: string
    signal: AbortSignal
  }): AsyncIterable<AgentEvent>
  resolvePermission?(requestId: string, decision: PermissionDecision): void
}
```

## 4. Phase 1：迁移到 deepagents（内置运行时）

依据 deepagents 调研报告（deepagents@1.10.5，peer: langchain ^1.5.0 / @langchain/core ^1.2.0 / @langchain/langgraph ^1.4.4，与现有版本兼容）：

### 4.1 改动清单

1. **依赖**：新增 `deepagents` + `@langchain/langgraph`（含 checkpoint 包）。
2. **agent 创建**：`createAgent` → `createDeepAgent({ model, tools, middleware, systemPrompt, backend, subagents, interruptOn, checkpointer })`；model 继续传 `createModelverseChatModel()` 实例（默认是 `anthropic:claude-sonnet-4-6`，必须显式覆盖）。
3. **E2B Sandbox Backend**（核心工程量）：实现 `SandboxBackendProtocol`（`execute` + `ls/read/readRaw/write/edit/glob/grep`，可选 `uploadFiles/downloadFiles`），内部复用 `lib/astraflow-session-sandbox.ts` 的 per-session E2B sandbox。这替代现有 run_code/run_command/文件工具形态——deepagents 会自动暴露内置 filesystem 工具 + `execute`。
   - ⚠️ 工具名冲突：现有自定义 `read_file/write_file/list_files` 等与 deepagents 内置工具重名会抛 `TOOL_NAME_COLLISION`，迁移时移除自定义版本，由 backend 承接。保留 `web_search/web_fetch/sandbox_get_host/download_file(改名)` 等非重名工具。
4. **Skills**：现有 `createStudioSkillsMiddleware` 可直接传入 `middleware`，但需评估与 deepagents 自带 `skills` 参数/`createSkillsMiddleware` 的取舍（避免 prompt/工具重复）。建议 Phase 1 保留自有 middleware，Phase 2 评估迁到原生 `skills`。
5. **MCP**：`MultiServerMCPClient.getTools()` 结果直接传 `tools`（官方文档演示的正是这个用法），注意重名检查。
6. **流式解析重写**：`streamEvents(v3)` 返回 typed projection（`run.messages` 的 `.text/.reasoning` 流、`run.toolCalls` 的 `.input/.output/.status`、`run.subagents` 独立 handle）——用它实现 `DeepAgentsRuntime`，把 projection 映射为 `AgentEvent`，删除现有 400 行 raw event 解析。需过滤 `metadata.lcSource === "summarization"` 的 token。
7. **持久化策略**：
   - Phase 1（无 HITL）：可继续无状态每轮重建 messages；但 large tool result offload（>20k token 写入 `/large_tool_results/`）跨轮引用会失效 → 把 backend 指向 E2B sandbox 后文件天然跨轮持久（sandbox 生命周期内），规避该问题。
   - Phase 1.5（启用 HITL/`interruptOn`）：**必须** checkpointer。用 `@langchain/langgraph-checkpoint-sqlite`（或基于 better-sqlite3 自写）+ `thread_id = sessionId`，interrupt 后以 `Command({ resume: { decisions } })` 恢复。
8. **system prompt**：`systemPrompt` 只是前置，不替换内置 BASE prompt；如需完全接管用 HarnessProfile `base_system_prompt`。Phase 1 接受"前置"语义即可。
9. **护栏**：deepagents recursion limit 为 10000，需保留 abortController + 应用层步数/预算护栏。

### 4.2 UI 增量

- `write_todos` → `plan_update` part（todo 列表渲染）。
- `task`（subagent）→ 可折叠 subagent 区块，内部消费 subagent handle 的事件流。
- 内置 filesystem 工具调用 → 现有 tool activity 渲染即可（`isVisibleToolName` 白名单改为按 runtime capability 生成）。

## 5. Phase 2：外部 Agent Runtime 接入

已核验版本（`npm view`）：`@anthropic-ai/claude-agent-sdk` 0.3.201（license "SEE LICENSE IN README"）、`@openai/codex-sdk` / `@openai/codex` 0.142.5（Apache-2.0）、ACP 官方 SDK `@agentclientprotocol/sdk` 1.1.0（Apache-2.0，`@zed-industries/agent-client-protocol` 0.4.5 为早期并存包）、`@agentclientprotocol/claude-agent-acp` 0.55.0、`@agentclientprotocol/codex-acp` 1.1.0、`@zed-industries/codex-acp` 0.16.0、`@google/gemini-cli` 0.49.0（ACP first-class）。

### 5.1 接入策略（推荐：ACP 为主，SDK 直连为辅）

- **统一走 ACP**（`AcpRuntime`：子进程 spawn + JSON-RPC over stdio）。ACP 会话模型与我们的 `AgentEvent` 几乎一一对应：`session/new`、`session/prompt`、`session/cancel`，事件经 `session/update` notification 推送，`update` 按 `sessionUpdate` discriminator 区分 `agent_message_chunk` / `tool_call`（toolCallId/title/kind/status）/ `tool_call_update` / `plan`（entries[{content,status}]）。一个 adapter 即可同时支持 claude-agent-acp、codex-acp、gemini-cli。风险：协议演进快（包名已经历 zed → agentclientprotocol 迁移），需 pin 版本；审批回写（allow/deny）语义需逐 adapter POC。
- **Claude Code 直连**（`ClaudeAgentRuntime`，premium adapter）：`@anthropic-ai/claude-agent-sdk` 内嵌 Claude Code binary，无需用户另装 CLI。`query()` 返回 `AsyncGenerator<SDKMessage>`（`assistant`/`user`/`result`/`system:init`/`stream_event`），开 `includePartialMessages` 可拿逐 token 流；`prompt` 接受 `AsyncIterable<SDKUserMessage>`（streaming input）；`resume`/`continue` + 消息内 `session_id` 做会话恢复；`canUseTool` 回调 → `permission_request` 事件；hooks（PreToolUse/PostToolUse/Stop/SubagentStop…）；`mcpServers` 直接透传我们的 MCP 配置；`systemPrompt` 支持 `claude_code` preset + append。**模型端点**：可通过 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 环境变量把底层 Claude Code 指向 ModelVerse 的 Anthropic 兼容端点（我们现有 `ChatAnthropic` 已在走 `MODELVERSE_ANTHROPIC_BASE_URL`，key 体系可复用）——即 Claude runtime 也能吃 ModelVerse 供给，无需强制用户自带 Anthropic API key；spike 时验证 tool-use/thinking 流在该端点上的完整性。分发注意：license 受 Anthropic Commercial Terms 约束，订阅登录分发需特批（走自配端点 + token 则不涉及订阅登录路径）。
- **Codex 直连**：首选 `codex app-server`（JSON-RPC 2.0 over stdio/unix/ws，thread/turn/item 生命周期 + approvals + resume，`generate-ts`/`generate-json-schema` 可按 pin 的 CLI 版本生成协议类型，勿手写 schema；标注 experimental）。轻量路径 `@openai/codex-sdk`（spawn CLI，`thread.runStreamed()` 产出 `item.completed`/`turn.completed` 事件）；`codex exec --json` 仅作一次性任务 fallback。**模型端点**：`config.toml` 的 `model_providers` 支持自定义 `base_url` + `wire_api: "chat"` 的 OpenAI 兼容端点——ModelVerse 接入 Codex 理论可行，需端到端 POC（tool-calling/patch 语义兼容性）。Apache-2.0，可随应用分发 CLI 或要求用户自装；认证支持 ChatGPT 登录或 API key 两条路径。

### 5.2 归一化要点

- 权限审批：统一 `PermissionBroker`（request → UI 审批卡片 → decision）。映射：Claude SDK 在 `canUseTool` 回调中 await broker，返回 `{behavior:"allow"|"deny"}`；Codex 走 app-server approvals（`exec` 模式只能预设 approval/sandbox policy，不适合细粒度审批）；ACP 的审批回写语义需逐 adapter POC。pending 状态持久化，重启后可恢复。
- 会话恢复：`studio_sessions` 加 `runtime_id` + `runtime_session_ref`（Claude `session_id` / Codex `thread_id` / ACP `sessionId`）；内置 deepagents 用 checkpointer `thread_id`。恢复顺序：先恢复本地 snapshot，再调 provider resume，新事件继续 append。
- 双轨持久化：归一化 snapshot（现有 sqlite 结构）+ provider 原始事件 append-only log（replay / debug / 迁移），每条 `AgentEvent` 保留 `providerEvent?: unknown` 引用。
- 外部 agent 工作目录：Claude Code/Codex 操作本地文件系统，需要给每个 session 一个受控 workspace 目录（区别于内置运行时的 E2B 远程沙箱）；Codex 默认 `--sandbox read-only`/`workspace-write`，绝不默认 `danger-full-access`。`file_change` 事件驱动文件面板。
- 分层落地：`lib/agent/`（或 `packages/agent-runtime`）下 `core/`（AgentRuntime / AgentEvent / PermissionBroker / SnapshotReducer，零 vendor 依赖）+ `adapters/{deepagents,acp,claude,codex}/`，UI 与持久化只认统一事件。

## 6. 实施路线

| 阶段 | 内容 | 交付 |
|---|---|---|
| P0 | 抽出 Run Orchestrator + AgentEvent + SnapshotAccumulator 改造（纯重构，行为不变） | studio-chat-runner 瘦身为编排器 + LangChainRuntime adapter |
| P1 | DeepAgentsRuntime spike：E2B SandboxBackend + v3 projection 流 + ModelVerse tool-calling smoke test | 可切换的 deepagents 内置运行时（无 HITL） |
| P1.5 | sqlite checkpointer + interruptOn 工具审批 + plan/subagent UI | HITL 完整体验 |
| P2 | AcpRuntime（子进程 JSON-RPC）+ claude-code / codex adapter 接入 + runtime 选择器 UI | 多运行时平台 |

## 7. 风险与开放问题

1. ModelVerse OpenAI 兼容端点上各模型的 tool-calling / reasoning delta 与 deepagents 兼容性 **未验证**——P1 spike 首要验证项。
2. deepagents 内置 prompt + 中间件会显著增大 token 消耗（todo/filesystem/subagent prompt + summarization 调用）。
3. skills middleware 与 deepagents 原生 skills 的重叠需实测决策。
4. **Claude Agent SDK 分发与端点**：license 非 MIT/Apache（受 Anthropic Commercial Terms 约束），bundled Claude Code binary 随商业桌面应用分发需 legal 评估；订阅登录（Pro/Max）分发需特批。模型端点可经 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 指向 ModelVerse 的 Anthropic 兼容端点（复用现有 key 体系），但该端点上 SDK 全量能力（tool-use 流、thinking、prompt caching、subagent）的兼容性需 spike 验证。
5. **Codex app-server 为 experimental**，协议可能变动；须 pin CLI 版本并用 `generate-ts`/`generate-json-schema` 生成协议类型。`exec --json` 的 item 字段级 union、`model_providers` 对 ModelVerse 的完整兼容性（tool-calling/patch 语义）均需 POC。
6. **ACP 生态仍在快速演进**（`@zed-industries/*` → `@agentclientprotocol/*` 包迁移刚发生），审批回写、resume、diff 等能力各 adapter 参差，接入需版本 pinning + 逐 adapter 验证。
7. E2B backend 每次 `execute/read/write` 有网络延迟，deepagents 内置工具调用频率高于现在，需评估体感。

## 8. 调研来源

- deepagents：docs.langchain.com/oss/javascript/deepagents/*（overview/quickstart/customization/backends/sandboxes/subagents/context-engineering/human-in-the-loop/streaming/event-streaming/tools）、github.com/langchain-ai/deepagentsjs（agent.ts/types.ts/package.json@1.10.5）
- Claude Agent SDK：docs.claude.com/en/docs/claude-code/sdk/sdk-overview、sdk-typescript；github.com/anthropics/claude-agent-sdk-typescript（LICENSE.md）
- Codex：github.com/openai/codex（README、sdk/typescript）、developers.openai.com/codex/{app-server,config,permissions}；本机 `codex exec --help` / `codex app-server --help`（codex-cli 0.142.5）
- ACP：agentclientprotocol.com（官网/agents）、github.com/agentclientprotocol/{typescript-sdk,codex-acp,claude-agent-acp}、schema/v1/schema.json
- 包版本均经 `npm view` 核验（2026-07-04）；标注"未验证"处见上文。
