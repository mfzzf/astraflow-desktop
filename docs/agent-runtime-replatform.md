# AstraFlow Agent Runtime 平台架构

> 状态：Pi Agent 迁移已落地。
> 更新日期：2026-07-16

## 1. 目标

AstraFlow 把不同 agent provider 的执行细节隔离在 runtime adapter 内，上层只处理统一消息、事件、权限和持久化。内置 `astraflow` runtime 以 Pi Agent 为核心，同时保留 Claude、Codex、OpenCode 和 ACP runtime 适配器。

主要设计目标：

- 一套 `AgentRuntime` / `AgentEvent` 协议支持所有 runtime。
- 规划、子任务、工具、MCP、skills、用户输入和权限审批使用一致的 UI 与持久化语义。
- 本地和远程 workspace 都使用 Pi Agent，但保留各自合适的进程、文件系统和会话边界。
- 产品工具属于 AstraFlow，通过中立的 `AstraFlowTool` 接口提供，再由 runtime adapter 转换。

## 2. 请求流程

```text
Studio UI
  -> POST /api/studio/chat
  -> startStudioChatRun()
  -> Run Orchestrator
  -> AgentRuntime.startRun()
  -> AgentEvent stream
  -> SnapshotAccumulator / SQLite / SSE
  -> StudioMessagePart UI
```

`lib/studio-chat-runner.ts` 从 SQLite 重组统一 `AgentMessage[]`。`lib/agent/run-orchestrator.ts` 管理 run 生命周期、快照、节流持久化和 live listener。Runtime adapter 只负责把 provider 输入/事件与 AstraFlow 协议互相转换。

## 3. 内置 Pi Agent runtime

### 3.1 包与版本

项目把以下三个包锁定为相同的精确版本：

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`

版本号由根 `package.json` 和 `runtime/astraflow-acp/package.json` 共同约束。升级时必须一起更新，并同时验证本地和 ACP runtime。

### 3.2 本地 workspace

`lib/agent/adapters/astraflow-runtime.ts` 通过 Pi coding-agent 的 `createAgentSession()` 创建会话，并由 `SessionManager`、`SettingsManager` 和 `DefaultResourceLoader` 提供会话、配置和系统提示词资源。

`lib/agent/pi-tools.ts` 组装 Pi 原生 read/write/edit/search/shell 工具、计划工具和 AstraFlow 产品工具。文件与 shell 操作在调用前通过：

1. workspace 路径策略；
2. 敏感文件策略；
3. 权限网关；
4. 本地 OS sandbox runner。

产品工具在 `lib/ai/tools/tool.ts` 中使用 Zod schema 描述，再由 `adaptAstraFlowToolsToPi()` 转为 Pi tool definition。这些工具包括媒体生成、Web、MCP、skills、移动端发送和用户输入。

### 3.3 远程 workspace

`runtime/astraflow-acp/` 是可打包的 ACP agent 进程。主 Agent 和 task 子 Agent 都由 Pi coding-agent 的 `AgentSession` 管理；底层仍使用定制的 Pi Agent Core `Agent` 注入 ModelVerse stream、上下文变换、AstraFlow 工具和递归限制。共享的 `pi-session.mjs` 负责内存认证、settings、resources、自动重试和取消生命周期，再把 Pi session 事件投影成 ACP `session/update`。

ACP 是 Desktop 与 agent 进程之间的协议边界，`AgentSession` 是进程内的 agent 生命周期边界。AstraFlow 的持久化 checkpoint 与预请求 compaction 仍由 ACP runtime 管理，因此 AgentSession 的 auto-compaction 关闭，避免双重压缩或双重持久化。

远程 runtime 必须：

- 把所有文件路径规范化并限定在 workspace 内；
- 将权限请求、计划、工具状态和用户输入映射为 ACP 事件；
- 持久化 Pi 历史与 runtime session reference；
- 按模型的 context window 限制历史，为输出 token 预留空间；
- 由 AgentSession 统一处理主 Agent 和 task 子 Agent 的瞬时 provider 重试；
- 将 retry attempt 的开始/结束与 message id 映射到 ACP，重试时移除失败 attempt 已流出的残缺内容；
- 在 cancel 时中止模型流、工具和待决权限/输入。

## 4. ModelVerse 适配

`lib/modelverse-pi.ts` 负责：

- 把 AstraFlow 模型配置转换为 Pi `Model` descriptor；
- 根据 OpenAI-compatible 或 Anthropic-compatible 端点选择 Pi provider API；
- 映射 reasoning/thinking effort；
- 对特定 ModelVerse provider 进行 payload 变换；
- 保留 context window、输出上限和使用量信息。

不要在 runtime 内直接手写第二套 provider client。本地和远程模型配置应使用同一语义。

## 5. 统一事件与权限

`AgentEvent` 是 UI 和持久化的稳定边界，包括文本/reasoning delta、tool call/result、plan update、subagent lifecycle、file change、permission request、usage 和 error。Provider 的原生事件不应泄漏到 UI。

权限由 `lib/agent/permission-gateway.ts`、broker 和 policy 共同管理。Pi 工具不得绕过网关。`readonly`、`ask`、`auto` 的差异属于 AstraFlow 产品语义，不依赖 provider 是否自带审批协议。

## 6. 外部 runtime

- ACP adapter 通过标准 session/prompt/update/cancel 语义接入外部 agent。
- Claude native adapter 使用 Claude Agent SDK。
- Codex direct adapter 使用生成的 app-server 协议类型。
- OpenCode native adapter 预留端口并主动探测 server，不依赖 stdout 打印 URL。

所有外部 runtime 都必须产生同一 `AgentEvent` 并遵守统一 permission broker。

## 7. 验证

内置 runtime 改动至少运行：

```bash
bun run test:astraflow-agent
bun run smoke:pi-agent
bun run typecheck
bun run lint
git diff --check
```

如果改动 `runtime/astraflow-acp/`，还必须运行该 workspace 的 Node test suite。测试需要覆盖工具循环、事件映射、路径越界、reasoning 关闭、取消、权限拒绝和上下文上限。

## 8. 官方资料

- Pi monorepo：https://github.com/earendil-works/pi
- Pi coding-agent SDK：https://github.com/earendil-works/pi/blob/v0.80.7/packages/coding-agent/docs/sdk.md
- Pi model configuration：https://github.com/earendil-works/pi/blob/v0.80.7/packages/coding-agent/docs/models.md
- Pi AI API：https://github.com/earendil-works/pi/blob/v0.80.7/packages/ai/README.md
- Pi Agent Core：https://github.com/earendil-works/pi/blob/v0.80.7/packages/agent/README.md
