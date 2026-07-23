# AstraFlow Agent Runtime 平台架构

> 状态：ACP-first Pi Agent、进程沙箱与工具展示 V2 已落地。
> 更新日期：2026-07-23

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

本地不再维护直连 Pi 的第二套 harness。`astraflow` runtime 与远程模式
共用 `runtime/astraflow-acp/`，由 `AcpRuntime` 通过长连接 stdio 启动。
ACP 进程内的 `AgentSession` 组装 Pi 原生 read/write/edit/search/bash、
plan、task、request_user_input 和 Desktop MCP 产品工具。

Default 模式在启动 ACP 之前解析统一策略，并把整个 ACP/Pi 进程树放入
OS sandbox。文件工具的 canonical path 校验是 defense in depth，而不是
替代进程隔离。Full Access 是唯一关闭本地隔离的公开模式。
进程内使用独立的 `workspace_auto` 策略表示“工作区内无需逐工具确认”；
它仍保留 workspace/read-only-root 路径约束，不能与 `full_access` 混用。

未绑定项目的任务使用 `~/AstraFlow/<task>`；Desktop state broker 持有
加密 checkpoint，运行时 HOME/cache/tmp 和只读附件保留在 Electron
`userData`。checkpoint 路径与密钥不进入本地 ACP 子进程。产品工具继续在
`lib/ai/tools/tool.ts` 使用 Zod schema 描述，再通过 in-process ACP MCP
bridge 注入 Pi。

### 3.3 远程 workspace

`runtime/astraflow-acp/` 是可打包的 ACP agent 进程。主 Agent 和 task 子 Agent 都由 Pi coding-agent 的 `AgentSession` 管理；底层仍使用定制的 Pi Agent Core `Agent` 注入 ModelVerse stream、上下文变换、AstraFlow 工具和递归限制。共享的 `pi-session.mjs` 负责内存认证、settings、resources、自动重试和取消生命周期，再把 Pi session 事件投影成 ACP `session/update`。

ACP 是 Desktop 与 agent 进程之间的协议边界，`AgentSession` 是进程内的 agent 生命周期边界。AstraFlow ACP runtime 仍管理 checkpoint schema、history 和预请求 compaction，但本地持久化通过 ACP custom request 交给 Desktop-owned state broker 加密、限额并原子写入；因此 AgentSession 的 auto-compaction 关闭，避免双重压缩或双重持久化。

远程 AstraFlow 也通过同一 ACP WebSocket 把 checkpoint 交给 Desktop state
broker；远端不再持有 checkpoint 目录或密钥。Default/旧只读模式由
Workspace Gateway 用 Bubblewrap 包住完整 Pi 进程树：`/workspace` 是唯一
可写宿主路径，Gateway/state/credential roots 与宿主 `/proc` 被遮蔽；
网络 namespace 只通过 per-run Unix socket bridge 连接 Gateway model
proxy，真实 ModelVerse key 留在 proxy。Bubblewrap/socat 缺失或启动失败时
fail closed。Remote Full Access 明确选择 VM 内 direct spawn；它不会获得
Desktop 宿主权限。
Gateway 仅在该边界可用时通过 `/v1/health` 宣告
`agent.astraflow.workspace-confinement.v1`；Desktop 对远程 Default/旧只读
强制要求该 capability，因此旧模板不能静默以 direct spawn 运行。Remote
Full Access 不依赖它。

远程 runtime 必须：

- 把所有文件路径规范化并限定在 workspace 内；
- 将权限请求、计划、工具状态和用户输入映射为 ACP 事件；
- 通过 Desktop broker 持久化加密的 Pi 历史与 runtime session reference；
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

`AgentEvent` 是 UI 和持久化的稳定边界，包括文本/reasoning delta、tool
call/result、plan update、subagent lifecycle、file change、permission
request、usage 和 error。工具事件同时保留 provider name、canonical
name、kind、结构化 input/result 和 authoritative file mutation metadata。

公开权限只包含 `Default` 与 `Full Access`。Default 在边界内自动执行，
越界与敏感访问硬拒绝；Full Access 需要一次显式确认。旧
`ask/auto/readonly` 只作为数据库兼容输入存在。外部连接器和代表用户的
共享系统写操作仍由其自己的重要操作确认控制。

远程 Sandbox 的 `sandbox_start_service` 当前只在显式 Full Access 会话中
且 Gateway 实时宣告 `service.lifecycle.v2` 时，经 Desktop MCP bridge
调用 Workspace Gateway。Gateway 管理前台进程、端口、健康检查、日志、
按 Desktop session owner 隔离的 idempotency、replacement 和停止；
Default/旧只读不注册也不能调用该工具，仍可使用 scripts-off 静态 HTML
预览。只有专用 service 进程沙箱落地后才能把交互服务开放给 Default。UI
只信任 `service.v1` 结构化结果，不从工具文本中正则提取 URL。

从 Full Access 降级或离开当前 Sandbox workspace 前，Desktop 使用和
service startup 相同的 session lock 停止该 owner 的全部 active service；
list、stop 或 reap 无法确认时阻止配置切换。删除 session 时仍采用
best-effort cleanup，且一个 owner 的失败不能影响其他 session。

## 6. 外部 runtime

- ACP adapter 通过标准 session/prompt/update/cancel 语义接入外部 agent。
- Claude native adapter 使用 Claude Agent SDK。
- Codex direct adapter 使用生成的 app-server 协议类型。
- OpenCode native adapter 预留端口并主动探测 server，不依赖 stdout 打印 URL。

所有外部 runtime 都必须产生同一 `AgentEvent` 并遵守统一 permission broker。

本地 Claude Code ACP 与 OpenCode ACP 的 Default/旧只读模式使用和 Pi
相同的长生命周期进程 sandbox，并且只允许连接 Desktop provider proxy
的精确 loopback host + port。OpenCode native 没有已验证的完整进程边界，
因此只允许显式 Full Access；Claude native Default 使用 fail-closed SDK
sandbox；Codex Direct Default 使用 workspace-write + auto reviewer。所有
Desktop 管理的 ModelVerse 路径只把短期 scoped token 放进子进程，真实 key
留在 provider proxy。OpenCode 更进一步通过匿名 fd 3 读取 scoped token，
inline config 只保存 `{file:/dev/fd/3}`，因此 bash 子进程环境拿不到 bearer。
Linux Bubblewrap 会关闭继承 fd，因此可信 runner 改在 session-private
`TMPDIR` 的随机 `0700` 目录创建 `0600` FIFO，bootstrap shell 打开为 fd 3
后先 unlink 再 `exec` OpenCode；用户 `~/AstraFlow` workspace 不出现瞬时凭据
节点。Default 的未知网络目标静态拒绝，不再通过 runner IPC 询问用户；
Claude Code 使用 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 剥离 Bash、hook 与
stdio MCP 子进程凭证。Windows 本地 managed OpenCode 在等价匿名传输落地前
fail closed，远程 Sandbox 不受影响。任何 runtime 无法建立其声明的
Default 边界时都必须失败，不能静默降级为 host 执行。

远程 Gateway 会先把 AstraFlow、Codex、Claude Code 和 OpenCode 的真实
ModelVerse key 收敛到 per-run loopback proxy，再启动 runtime；真实 key
不会进入 Agent 子进程。CodeBox create/resume 也不再把 ModelVerse/GitHub
凭证写到 shell profile、agent auth/config、`gh` config 或
`/etc/git-credentials`。GitHub device token 只在启动 Agent 前用于一次
`github.com` HTTPS clone 的内存 `GIT_ASKPASS`，旧版本遗留文件会被清理。

用户安装的 MCP 连接器也属于 Desktop control plane：HTTP/SSE 的 header、
stdio 的 command/env 都只在 Desktop 侧创建 transport。ACP runtime 必须
声明 `mcpCapabilities.acp` 才能使用；否则连接器显示为不可用并 fail
closed，不把秘密改写成 direct ACP server 参数。

## 7. 验证

内置 runtime 改动至少运行：

```bash
bun run test:astraflow-agent
bun run smoke:pi-agent
node --test runtime/workspace-gateway/test/*.test.mjs
bun test tests/studio-session-service-transition.test.ts \
  tests/studio-workspace-service-cleanup.test.ts
bun run test:studio-workspaces
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
