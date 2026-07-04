# deepagents JS 迁移调研报告

> 来源：Codex 调研（2026-07-04）。所有结论标注来源 URL，无法验证部分标 **unverified**。

## 1. API surface、npm 包、版本与依赖关系

### 包名与版本

`deepagents` 的 JS/TypeScript 包名是 `deepagents`，官方 quickstart 的安装命令是 `npm install deepagents langchain @langchain/core @langchain/tavily`（https://docs.langchain.com/oss/javascript/deepagents/quickstart）。
本机 `npm view deepagents` 因 DNS `EAI_AGAIN` 失败，"npm 当前 published version"严格标记为 **unverified**（后续在运行时调研中经 npm view 核验为 1.10.5，license MIT）。
GitHub releases 页面当前列出 `deepagents@1.10.5` 为最新 release（https://github.com/langchain-ai/deepagentsjs/releases）。
GitHub 源码 `libs/deepagents/package.json` 声明 `"name": "deepagents"` 与 `"version": "1.10.5"`（https://raw.githubusercontent.com/langchain-ai/deepagentsjs/main/libs/deepagents/package.json）。

### 依赖 / peerDependencies

peer dependencies：`@langchain/core ^1.2.0`、`@langchain/langgraph ^1.4.4`、`@langchain/langgraph-checkpoint ^1.1.2`、`@langchain/langgraph-sdk ^1.9.23`、`langchain ^1.5.0`、`langsmith ^0.7.1`。
direct dependencies：`fast-glob ^3.3.3`、`micromatch ^4.0.8`、`yaml ^2.8.2`、`zod ^4.3.6`（同上 package.json）。

### `createDeepAgent` 参数

官方 customization 文档列出的配置项：`backend`、`checkpointer`、`contextSchema`、`interruptOn`、`memory`、`middleware`、`model`、`name`、`permissions`、`responseFormat`、`skills`、`store`、`streamTransformers`、`subagents`、`systemPrompt`、`tools`（https://docs.langchain.com/oss/javascript/deepagents/customization）。
源码另有 `stateSchema`，透传给底层 `createAgent`（https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/agent.ts）。
`model` 可以是 `provider:model` 字符串或初始化后的 LangChain model instance。`tools` 接受 LangChain `tool()` 工具。`middleware` 接受 `AgentMiddleware[]`，user middleware 追加到 built-in 之后。`backend` 可传 instance（factory 模式自 1.9.0 起 deprecated）。`checkpointer` 可选，但 HITL 场景必需。`interruptOn` 是 tool name → interrupt config 的映射。

## 2. 内置能力

### Planning / todo

内置 `write_todos` 工具，任务状态 `pending`/`in_progress`/`completed`，持久化在 agent state（https://docs.langchain.com/oss/javascript/deepagents/overview）。built-in middleware 首位是 `todoListMiddleware()`。

### Filesystem 工具

内置 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`；sandbox backend 额外暴露 `execute`（https://docs.langchain.com/oss/javascript/deepagents/tools）。`read_file` 支持分页与 multimodal/binary（取决于 backend V2）。内置工具名冲突会抛 `TOOL_NAME_COLLISION`。

### Backend 抽象

- 默认 `StateBackend`：文件存 LangGraph state，跨 turn 持久化依赖 checkpointer。
- `FilesystemBackend`：本地磁盘，生产不建议直接用。
- `StoreBackend`：LangGraph `BaseStore`，跨 thread durable storage。
- `CompositeBackend`：按路径前缀路由（如 `/memories/` → StoreBackend）。
- 自定义 backend 实现 `BackendProtocolV2`：`ls/read/readRaw/write/edit/glob/grep`；要 `execute` 则实现 `SandboxBackendProtocol`（https://docs.langchain.com/oss/javascript/deepagents/backends）。

### E2B / remote sandbox 可行性

自定义 sandbox backend 接远程 E2B 可行：`BaseSandbox` 只要求实现 `execute()`，其余 filesystem 操作可基于 execute 构建（https://docs.langchain.com/oss/javascript/deepagents/sandboxes）。官方 JS 包是否内置 E2B provider **unverified**（可见列表仅 LangSmith、Deno、Daytona、Modal、Node VFS）。推荐路径：实现 `SandboxBackendProtocol` adapter，把 `execute()` 映射到现有 E2B run_command/run_code，`uploadFiles/downloadFiles` 映射到现有文件传输。

### Subagents

默认添加同步 `general-purpose` subagent（可经 harness profile 禁用）。自定义 subagent 字段：`name/description/systemPrompt/tools/model/middleware/interruptOn/skills/responseFormat/permissions`。subagent 用于 context quarantine：主 agent 只收最终结果。custom subagent 的 skills 不继承 main agent。subagent 可有独立 `interruptOn`（https://docs.langchain.com/oss/javascript/deepagents/subagents）。

### 长上下文管理

context compression 默认启用。large tool result 超过 20,000 tokens offload 到 filesystem（路径引用 + 预览替代）。summarization 触发点：model profile `max_input_tokens` 的 85%，保留 10% recent context；无 profile 时 fallback 170,000-token / 保留 6 条消息。summarization token 会出现在流中，需按 `metadata.lcSource === "summarization"` 过滤（https://docs.langchain.com/oss/javascript/deepagents/context-engineering）。

## 3. 兼容性

- **LangChain `tool()`**：直接传入 `createDeepAgent({ tools })`，注意与内置工具名冲突（`ls/read_file/write_file/edit_file/glob/grep/task/write_todos` 等）。
- **`createMiddleware`**：直接传 `middleware` 参数；built-ins 先运行（todo、skills、filesystem、subagent、summarization、patch tool calls），user middleware 之后。现有 skills middleware 与 deepagents 自带 `skills`/`createSkillsMiddleware` 的取舍需实测（prompt 注入可能叠加，"无行为差异兼容" **unverified**）。
- **MCP**：官方文档演示 `MultiServerMCPClient.getTools()` 结果直接传 `tools`（https://docs.langchain.com/oss/javascript/deepagents/tools）。
- **Streaming**：推荐 typed projection——`agent.streamEvents(input, {version:"v3"})` 返回 `DeepAgentRunStream`，提供 `run.messages`（`.text`/`.reasoning` 流）、`run.toolCalls`（`.input/.output/.status`）、`run.subagents`（每个 task 独立 handle：`.messages/.toolCalls/.values/.subagents/.output/.taskInput`）、`run.middleware/.values/.output/.subgraphs/.extensions`（https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/types.ts，https://docs.langchain.com/oss/javascript/deepagents/event-streaming）。也可用 `agent.stream(..., {streamMode:"messages"|"updates", subgraphs:true})` 拿 LangGraph namespace/chunk 流。raw legacy streamEvents 形状与 createAgent 完全一致 **unverified**。

## 4. HITL / checkpointer / 持久化

- `interruptOn` 配置工具审批；值为 `true`/`false`/`InterruptOnConfig`，`allowedDecisions` 支持 `approve/edit/reject/respond`。
- HITL 文档明确 "Checkpointer is REQUIRED"；interrupt 后结果含 `__interrupt__`，用 `new Command({resume:{decisions}})` + 同一 `thread_id` 恢复（https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop）。
- 无 HITL 时可继续无状态每轮重建 messages（工程推断）；但 StateBackend 的文件状态、offloaded large results 跨 turn 需要 checkpointer 或 durable/自定义 backend，否则 `/large_tool_results/...` 引用下一轮失效。

## 5. 迁移评估

改动清单：①依赖新增 deepagents（+langgraph 系）；②createAgent → createDeepAgent，显式传 model 实例（默认 `anthropic:claude-sonnet-4-6`）；③工具名冲突处理；④skills middleware 取舍；⑤E2B custom sandbox backend；⑥流式解析重写为 v3 projection；⑦持久化策略（HITL 必须 checkpointer）；⑧custom subagents 定义。

坑点：ModelVerse 端点 tool-calling/reasoning 兼容性 **unverified** 需 smoke test；模型必须支持 tool calling；内置工具+middleware 增大 prompt/token 消耗；recursion limit 10000 需应用层护栏；summarization token 过滤；offload 路径生命周期管理（`/large_tool_results/`、`/conversation_history/`）；FilesystemBackend/LocalShellBackend 安全风险；sandbox 网络延迟；subagent 不适合简单单步任务。

## 6. 默认 system prompt

内置 `BASE_AGENT_PROMPT`（身份 "Deep Agent"、concise/direct、understand-act-verify 等）。`systemPrompt` 参数只前置，不替换 BASE；完全替换需 HarnessProfile 的 `base_system_prompt`/CUSTOM 机制（prompt assembly：USER → BASE|CUSTOM → SUFFIX）。各 middleware 还会追加 tool-specific prompt（planning/filesystem/subagent/HITL/skills/memory）（https://docs.langchain.com/oss/javascript/deepagents/customization）。

## 结论

迁移技术上可行：现有 `tool()` 工具、MCP tools、middleware、OpenAI 兼容 model 实例的结构都与 `createDeepAgent` 接口对齐。主要工程量：E2B backend adapter、streaming adapter 重写、persistence/HITL 策略。建议先做无 HITL + custom E2B sandbox backend + typed projection streaming 的 spike，再决定 checkpointer / durable backend。
