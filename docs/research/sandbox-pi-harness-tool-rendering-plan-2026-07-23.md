# AstraFlow 沙箱目录、Pi Harness 与工具渲染重构方案

日期：2026-07-23

审计基线：`main@3e028b3c`

文档性质：实施基线 + 完成态验收记录

实施状态（2026-07-23）：Phase 1–6 的核心实现已合入当前工作树。公开权限
已收敛为 Default / Full Access；未绑定任务使用 `~/AstraFlow`；本地
Pi/ACP 采用进程级 fail-closed sandbox；Sandbox service 已通过 Workspace
Gateway 和 Pi MCP 工具链恢复；文件工具使用结构化展示与 revision 刷新。
已验证范围和仍需平台 CI 覆盖的边界见第 19 节；第 15 节中未勾选的项目
仍是 release gate，不因“核心实现完成”而自动视为通过。

安全收敛说明：静态 HTML 预览采用 scripts-off 的 sanitizer + CSP。需要
JavaScript、网络、模块或后端的页面，仅在 remote Full Access 下通过
`sandbox_start_service` 启动，并在右侧 Electron webview guest process
中打开；Default 只提供静态预览/source，并提示交互服务需要 Full Access。
该实现替代本文早期提出的额外 `StudioArtifactSandboxView`，避免维护第二
套本地脚本执行边界。

阅读说明：第 3–5 节保留的是实施前审计快照，用来解释迁移动机；其中“当前”
均指 `main@3e028b3c`，不是本文顶部记录的完成态。完成后的真实契约以第
6–14 节、配套协议文档和第 19 节实施验收记录为准。

## 1. 结论

产品方向是正确的，但不能只改目录和权限下拉框。当前 Pi 迁移存在一条会影响安全和体验的断链：

1. 本地和远程 AstraFlow Agent 已统一走 ACP + Pi；
2. 原来的 `sandbox_start_service`、`sandbox_get_host` 等 Sandbox 工具没有迁入当前工具集合；
3. 旧 `lib/agent/pi-tools.ts` 已没有生产调用方；
4. 当前本地 Pi `bash` 直接使用 `child_process.spawn`，没有经过原来的本地 OS sandbox runner；
5. Pi 的 `write/edit` 虽然能执行，但工具名称、真实 diff、专用渲染和 Artifact 预览在 Pi → ACP → React 的过程中发生了丢失或降级。

因此，这不是“补一个工具调用入口”或“加一个 HTML iframe”能完整解决的问题。建议按以下顺序落地：

1. 统一未绑定项目任务的用户工作目录为 `~/AstraFlow/<任务目录>`，但继续把运行时私有状态放在 Electron `userData`；
2. 先把整个本地 Pi/ACP 子进程放进 OS sandbox，再取消 Default 模式下的 coding tool 权限询问；
3. 对外只保留 `Default` 和 `Full Access` 两个权限选项；
4. 把 `sandbox_start_service` 重建为 Pi 可调用的 Workspace Gateway 服务能力；
5. 建立结构化 Tool Presentation / Artifact 事件，恢复 `write/edit` 专用渲染，并在 HTML 完成后自动唤出右侧预览；
6. 最后删除旧 Sandbox 工具、死的 Pi 直连代码、重复权限策略和失真的文档。

必须设置一个上线阻塞条件：

> 在整个本地 Pi/ACP 子进程（包括 `read/write/edit/search/bash`）真正进入 OS sandbox 之前，不得把 Default 模式改成无条件无询问。只隔离 `bash` 而让文件工具继续在宿主 ACP 进程里运行，同样不是有效的安全边界。

## 2. 建议直接确定的产品行为

### 2.1 工作目录

- 没有绑定现有项目的新本地任务，默认工作目录为：

  ```text
  ~/AstraFlow/2026-07-23-14-36-45-a1b2/
  ```

- 目录名在创建时确定，使用时间戳加短 ID；会话标题变化不触发目录重命名。
- 未绑定现有项目的 Studio Agent 在第一次 run 启动前创建目录并固定 cwd。当前 ACP 启动契约要求先有真实 cwd，因此不承诺“模型先运行、第一次文件工具再惰性建目录”；不启动 Agent 的独立媒体能力不会创建目录。
- 用户明确选择的现有本地项目继续使用原路径，不强制搬入 `~/AstraFlow`。
- 远程 Sandbox 继续使用远端 `/workspace` 或已选择的 Workspace 子目录，不映射成本机 `~/AstraFlow`。
- 删除聊天不自动删除用户文件。归档或删除任务目录必须是单独、明确、可确认的操作。
- 旧会话只在 cwd 精确等于 AstraFlow 旧的按 session 分配目录时采用
  `legacy_local`；任意历史 cwd、整个 home、磁盘根和 symlink 逃逸路径都
  不自动采用。不能证明来源的任务在下一次 Agent run 分配新的 managed
  Workspace，并清除与旧 cwd 绑定的 provider continuation。

### 2.2 权限

用户可见权限只保留：

- `Default`
- `Full Access`

Default 的核心含义是“受边界保护但不逐次打扰”，不是“每个工具都弹卡片”：

- 远程 AstraFlow Sandbox：Gateway 用 Bubblewrap 把完整 Pi 进程树限制在
  Workspace mount/PID/user boundary 内；工作区内读写与命令不再询问，
  越界读写和任意 egress 硬拒绝。其他远程 runtime 只声明各自已经验证的
  边界，不从 AstraFlow Pi 的实现外推；
- 本地 managed/selected workspace：经过 OS sandbox 后，Workspace 内 coding tools 不再询问；
- 越界路径、symlink 逃逸、敏感凭证目录、基础设施元数据地址和网络出口采用静态允许或硬拒绝，不转换成频繁权限弹窗；
- 外部连接器写操作、对共享系统的修改、代表用户发消息等不属于“Sandbox 内执行”，继续使用各自的重要操作确认机制；
- `request_user_input` 是任务澄清，不是权限审批。

Full Access 的环境语义必须写清楚：

| 执行环境 | Default | Full Access |
| --- | --- | --- |
| 本地 | OS sandbox 内执行，Workspace 内 coding tools 无询问 | 明确关闭本地隔离，可访问宿主机；切换模式时做一次强提示 |
| 远程 AstraFlow Sandbox | Gateway Bubblewrap 内无询问；`/workspace` 是唯一可写宿主路径，同时隔离 PID/user/mount 并只桥接 Gateway model proxy | 明确关闭 VM 内 Bubblewrap，改为 direct spawn；仍只在单租户 VM 内，不获得 Desktop 权限 |

两种远程模式都不是 Desktop 主机访问能力或通用内容 DLP；外部 Codex、
Claude Code 与 OpenCode runtime 只按各自 adapter 已验证的边界描述。

### 2.3 文件和 HTML 体验

- `write` 运行中：立即显示“正在写入文件”，展示最多 10 行流式内容，默认自动换行；
- `write/edit` 完成：展示文件名、创建/编辑语义、`+/-` 统计和内联 diff；
- 完整 diff 仍可进入现有 Review 面板；
- `.html/.htm` 成功写入后自动打开右侧静态隔离预览；`script`、事件处理器、
  frame、刷新跳转、外链和表单提交属性均被移除，CSS 网络源被内联或清除；
  保留的表单控件由空 iframe sandbox 与 CSP `form-action 'none'` 保持不可
  提交；
- 同一路径后续编辑只刷新原预览 tab，不重复创建 tab；
- 用户手动关闭预览或正在使用 Terminal/Review 时不反复抢焦点；
- 需要 JavaScript、模块、网络或后端的页面只在 remote Full Access 下通过
  Sandbox service URL 在右侧 Browser 打开，不用 `file://` 或 renderer 内
  `allow-scripts` 复刻截图。

## 3. 当前真实调用链

当前 AstraFlow Agent 的生产路径是：

```text
Studio chat request
  -> lib/studio-chat-runner.ts
  -> lib/agent/run-orchestrator.ts
  -> lib/agent/adapters/astraflow-runtime.ts
  -> AcpRuntime
       local: 运行 runtime/astraflow-acp 子进程
       remote: 连接 Workspace Gateway WebSocket
  -> runtime/astraflow-acp/src/agent.mjs
  -> Pi AgentSession
  -> Pi builtin tools + plan/task/request_user_input + Desktop MCP tools
  -> runtime/astraflow-acp/src/stream.mjs
  -> lib/agent/acp/acp-runtime.ts
  -> AgentEvent / Studio snapshot
  -> components/studio-message-parts/*
```

证据：

- 本地和远程都由 `astraflowAcpRuntime` 处理：`lib/agent/adapters/astraflow-runtime.ts:469-523`；
- Pi 内置工具由 `createCodingTools()`、`createReadOnlyTools()` 创建：`runtime/astraflow-acp/src/backend.mjs:556-607`；
- 当前主 Agent 工具集合只有 builtin、plan、task、可选 user input 和 MCP：`runtime/astraflow-acp/src/agent.mjs:1907-1944`；
- Desktop 产品工具通过 MCP bridge 注入：`lib/agent/acp/studio-plugins.ts:561-588,620-657`；
- Pi 事件先变成 ACP update，再变成 `AgentEvent`：`runtime/astraflow-acp/src/stream.mjs:305-462`、`lib/agent/acp/acp-runtime.ts:4879-5108`。

这意味着当前应以“ACP-first Pi runtime”为唯一生产架构继续收敛，不应重新恢复一条本地直连 Pi 的平行路径。

## 4. 已确认的实现问题

### 4.1 `sandbox_start_service` 不是 UI 隐藏，而是不可达

旧定义仍存在于 `lib/ai/tools/astraflow-sandbox.ts`：

| 工具 | 定义位置 | 当前生产调用方 |
| --- | --- | --- |
| `run_code` | `:258-309` | 无 |
| `run_command` | `:311-386` | 无 |
| `sandbox_get_host` | `:388-436` | 无 |
| `sandbox_start_service` | `:438-538` | 无 |
| `list_files` | `:610-674` | 无 |
| `read_file` | `:676-765` | 无 |
| `write_file` | `:767-842` | 无 |

当前 `createStudioAgentTools()` 明确把文件和终端交给 Agent runtime，只保留 Web、媒体、上传、下载等产品工具：`lib/ai/tools/studio.ts:245-402`。Host tool manifest 的 Workspace 组也只有 `download_file`、`upload_file`：`runtime/astraflow-acp/host-tools-manifest.json:23-26`。

外围代码却仍引用不存在的工具：

- 长服务提示要求调用 `sandbox_start_service`：`lib/astraflow-sandbox-runtime.ts:183-199`；
- 超时提示要求调用 `sandbox_get_host`：`lib/astraflow-sandbox-runtime.ts:318-327`；
- i18n、权限分类和 `tool-output.tsx` 仍保留旧名称与输出解析。

所以模型目前既看不到服务工具，也无法通过普通 Pi `bash` 稳定替代它。`bash` 会等待前台进程退出，直接让模型使用 `nohup`、`tmux` 或 shell `&` 只会把生命周期、日志、端口冲突和恢复问题继续留给模型。

### 4.2 本地 Pi 命令绕过了原来的 OS sandbox

当前 active backend 的 `bash` 最终执行：

```text
runtime/astraflow-acp/src/backend.mjs
  -> executeTerminalCommand()
  -> child_process.spawn(shell, ...)
```

位置为 `runtime/astraflow-acp/src/backend.mjs:144-225,556-576`。

真正使用 `spawnLocalSandboxedCommand()` 的代码在 `lib/agent/pi-tools.ts:310-425`，但 `createPiLocalTools()` 和 `adaptAstraFlowToolsToPi()` 已没有生产调用点。底层 runner 本身仍存在于：

- `lib/agent/sandbox/local-command.ts:119-194`
- `electron/sandbox-command-runner.mjs:222-307`

因此 `docs/local-agent-sandbox.md` 中“所有内置 Pi shell 命令都经过 sandbox runtime”的描述已经过期。当前底层 runner 测试通过也不能证明真实 AstraFlow Pi 调用链受到隔离。

问题不止是 shell。Pi builtin 的 `read/write/edit/search` 也在同一个未包装 ACP 子进程中调用宿主文件 API；当前 backend path check 属于进程内策略，不是能抵抗恶意/竞态绕过的安全边界。因此修复目标必须是整个 ACP/Pi 进程，而不是把 `executeTerminalCommand()` 单点换回旧 runner。

### 4.3 用户工作目录和私有运行目录混在一起

当前 Electron 在 `userData` 下创建：

```text
data/
studio-files/
studio-skills/
sandbox-workspaces/
automation-notifications/
```

见 `electron/main.cjs:1313-1354`。

同时 ACP 又单独推导：

```text
<userData>/acp-workspaces/<sessionId>
```

见 `lib/agent/acp/workspace.ts:6-46`。Electron 只设置了 `ASTRAFLOW_SANDBOX_WORKSPACES_PATH`，没有设置 `ASTRAFLOW_ACP_WORKSPACES_PATH`：`electron/main.cjs:1385-1421`。

目前至少有三类不同性质的内容被“workspace”这个词混在一起：

1. 用户可见的任务文件；
2. ACP state、skills manifest 等 Agent 私有状态；
3. OS sandbox 的 HOME、cache、tmp 和网络代理状态。

如果只把现有 `sandbox-workspaces` 或 `acp-workspaces` 整体改成 `~/AstraFlow`，会把 `.astraflow-acp-state`、skills manifest、临时 HOME、cache 等内部文件暴露给用户。正确做法是分离，而不是整体搬家。

当前还有四个会直接把私有实现写进 Workspace 的入口，迁移时必须一起处理，不能只改默认 cwd：

| 当前写入 | 位置 | 目标 |
| --- | --- | --- |
| `.astraflow/pi` | `runtime/astraflow-acp/src/pi-session.mjs:33-42` | resource loader 改为只读/in-memory；持久 checkpoint 走 Desktop state broker |
| `.astraflow-agent` | `runtime/astraflow-acp/src/agent.mjs:338-351` | 改为 packaged 只读 resource-loader 目录，不落到任务根 |
| `.astraflow/attachments` | `lib/ai/tools/studio.ts:146-162` | 保存在 `userData/studio-files`，本地以只读允许根提供；远端同步到 Gateway 私有 cache |
| `.astraflow/file-cache` | `runtime/workspace-gateway/src/server.mjs:29` | 移到 Gateway 的 `XDG_STATE_HOME`/显式 runtime state root |

`stateOwnerId` 不能简单使用当前 `sessionId`。现有 continuation/branch 通过 `stateOwnerStudioSessionId` 复用状态；新的 key 应保持：

```text
workspaceId       决定用户文件根
stateOwnerId      决定可续接的 AstraFlow/Pi 私有状态
providerSessionId 记录 provider 自身会话标识
```

三者独立持久化，删除或 rebind 一个 Studio session 时不得错误删除仍被 continuation 使用的 state。`created_by_session_id` 使用 `ON DELETE SET NULL` 或只存审计 ID，绝不能级联删除 managed Workspace。

未绑定 Workspace 时，UI 还存在退回整个用户 home 的路径：

- Electron 暴露 `app.getPath("home")`；
- Workbench 按“已绑定 Workspace → Agent workspace → home”选择；
- `createStudioDefaultHomeWorkspace()` 把整个 `~` 建模为默认本地 Workspace。

相关位置：`components/studio-chat-workbench.tsx:347-357`、`lib/studio-default-workspace.ts:3-50`。

### 4.4 权限有两套策略，且当前 Auto 仍会问每个 Bash

公开类型目前有四种：

```ts
"ask" | "auto" | "full_access" | "readonly"
```

见 `lib/studio-types.ts:17-24`，数据库默认值仍为 `ask`：`lib/studio-db/connection.ts:136-137`、`lib/studio-db/sessions.ts:327-339`。

当前至少存在两套不同判断：

1. Desktop：`permission-policy.ts` + `permission-gateway.ts` + `permission-broker.ts`；
2. Pi ACP：`runtime/astraflow-acp/src/backend.mjs`。

Pi backend 的实际逻辑是：

- `ask`：几乎所有工具都询问；
- `auto`：secret 访问和所有 `bash` 都询问；
- `readonly`：直接阻止写和执行；
- `full_access`：不询问。

见 `runtime/astraflow-acp/src/backend.mjs:264-292,461-553`。

工具类别、风险模式、展示名称和权限说明还分别维护在 backend、stream、Desktop policy、React registry、i18n 中，已经出现语义漂移。

### 4.5 Pi `write` 被错误归一化成 `edit`

`runtime/astraflow-acp/src/stream.mjs:6-27` 把 Pi `write` 和 `edit` 的 ACP `kind` 都设为 `edit`。这是合理的 ACP 图标类别，但 `lib/agent/acp/acp-runtime.ts:3025-3070` 又优先使用 `kind` 作为工具名。

结果是：

```text
provider title: write
ACP kind:       edit
AgentEvent name: edit
```

现有 fixture 已固定记录了这个错误：`tests/fixtures/agent/acp/mapper-fixture.ts:383-426,872-903`。

工具名和工具类别必须分开：

```ts
providerToolName: "write"
canonicalToolName: "write_file"
kind: "edit"
```

`kind` 只决定图标/大类，不能再决定 renderer identity。

### 4.6 真实 diff 被丢失或重新猜测

Pi 0.80.7 的行为：

- `write` 默认结果没有 diff；
- `edit` 会返回 `details.diff`、`details.patch`、`firstChangedLine`；
- Pi TUI 完成后用真实 result details 校准预览。

本地源码位置：

- `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js:131-190`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js:158-278`

当前 AstraFlow 的问题：

- 迁移前 `lib/agent/pi-tools.ts:196-255` 有 `wrapWriteWithFileDiff()`，现在已不可达；
- `stream.mjs:146-192` 没有透传真实 `result.details`，而是根据输入重新构造 diff；
- `write` 永远使用 `oldText: null`，覆盖现有文件也可能被标为 create；
- 多段 Pi `edits[]` 会变成同一路径多个 `file_change`；
- `run-orchestrator.ts:1261-1321` 又按 `path + parentTaskId` 覆盖，可能只留下最后一段；
- `AgentFileChangeEvent` 没有 `toolCallId` 和 revision，无法可靠关联调用与文件变更。

### 4.7 专用文件 renderer 被 Generic renderer 覆盖

`toolActivityRendererRegistry` 已有文件 renderer，但 `AssistantActivity` 只要发现 `rawInput`、`rawOutput`、`locations` 或 structured content，就直接返回 `GenericToolActivity`。只有 command 和 hook 被特别放行。

见 `components/studio-message-parts/tool.tsx:861-894`。

Pi/ACP 正常执行一定会携带 `rawInput`，所以协议数据越完整，反而越容易失去专用文件体验。

此外：

- `getWrittenFileInfo()` 只接受 `write_file/edit_file`；
- edit 只解析旧 `old_string/new_string`；
- 不支持 Pi 的 `edits: [{ oldText, newText }]`；
- HTML Artifact 检测也依赖这个函数。

见 `components/studio-message-parts/file-output.tsx:97-129`、`components/studio-message-parts/renderer.tsx:293-305`。

### 4.8 当前完成态重复且层级不清

同一次文件变更可能同时存在于：

1. tool activity；
2. tool structured diff；
3. `file_change` part；
4. Artifact file card；
5. Turn edited files card。

但成功 `file_change` 又会从活动轨迹过滤掉：`components/studio-message-parts/renderer.tsx:155-197`；完成后的工具被折叠进 `TurnActivitySummary`：`:475-488`；最终只在末尾增加汇总卡：`:507-515`。

这与目标体验中的“写入文件 → 创建文件 +170 -0 → 默认可见内容/diff → 右侧成品”不是同一个信息层级。

### 4.9 HTML 预览能力已有，但没有自动触发和 revision 刷新

现有右侧面板已经具备可复用能力：

- 识别 HTML：`components/studio-chat/right-panel/previews.tsx:193-198`；
- 默认进入 rendered 模式；
- 可内联 Workspace 内 CSS 和图片；
- 有单资源、总资源数量和字节预算；
- 删除 `<script>`，使用 `sandbox=""` 的 `srcDoc` iframe。

当前缺口：

- 只有点击文件卡才 dispatch `STUDIO_OPEN_MARKDOWN_TARGET_EVENT`；
- 事件没有 `revision`、tab 策略、焦点策略或自动触发来源；
- 写入完成后没有自动 preview effect；
- 同一路径已打开时缺少明确的 revision 刷新契约；
- `sandbox_start_service` 的旧 URL renderer 仍在消息内嵌第二个 iframe，和右侧 Browser 重复。

相关位置：

- `components/studio-message-parts/file-output.tsx:249-264,625-649`
- `lib/studio-markdown-open.ts:7-18`
- `components/studio-chat/right-panel/index.tsx:698-892`
- `components/studio-message-parts/tool-output.tsx:126-165,264-266`

### 4.10 流式大文件存在近似 O(n²) 的传输风险

Pi `toolcall_delta` 每次发送累计的 `partialJson` 快照：`runtime/astraflow-acp/src/stream.mjs:331-350`。写入大 HTML 时，整个前缀会被反复跨 ACP 传输并触发 React 更新；当前链路还可能让部分快照进入 run snapshot 持久化。即使不假设每个 delta 都落库，传输本身也会随 chunk 数快速放大，因此应在 ACP forwarder 处先限频和限长。

UI 内部还有一套 LCS 动态规划 diff：`components/studio-message-parts/file-output.tsx:135-199`，虽然设置了矩阵上限，但仍不应在 React 中重新计算 runtime 已经能够提供的权威 patch。

## 5. 目标架构

目标不是增加更多抽象，而是收敛成四个唯一来源：

```text
WorkspaceRootService
  唯一决定：本轮 Agent、Terminal、文件树、Artifact 的 canonical root

ExecutionPolicy
  唯一决定：环境、权限模式、OS sandbox 包装、路径边界和静态网络策略

Tool Catalog + Tool Presentation
  唯一决定：provider 名、canonical 名、kind、权限类别和 renderer

Workspace Service Manager
  唯一决定：长服务启动、健康检查、日志、停止、恢复和 preview URL
```

目标调用链：

```text
Pi tool call
  -> canonical tool identity
  -> environment-specific runtime boundary
       local Default: 整个 ACP/Pi 进程已在 OS sandbox 内
       local Full Access: 明确的 unsandboxed ACP/Pi 进程
       bash remote: remote VM adapter
       service: Desktop host MCP -> Workspace Gateway ServiceManager
  -> structured tool result
  -> AgentEvent with provider/canonical/kind/toolCallId/revision
  -> ToolPresentation registry
  -> inline activity + optional right-panel preview request
```

## 6. `~/AstraFlow` 目录方案

### 6.1 三种 Workspace 目标和一个迁移兼容态

建议明确区分：

```ts
type WorkspaceOrigin =
  | "managed_local"
  | "selected_local"
  | "remote_sandbox"
  | "legacy_local"
```

| Origin | 根目录 | 是否自动创建 | 是否移动用户现有项目 |
| --- | --- | --- | --- |
| `managed_local` | `~/AstraFlow/<task>` | 是 | 不适用 |
| `selected_local` | 用户选择的 canonical path | 否 | 否 |
| `remote_sandbox` | `/workspace/...` | 由远端 Workspace 决定 | 否 |
| `legacy_local` | 旧 `userData/acp-workspaces` 或历史未绑定 cwd | 否，仅迁移兼容 | 仅显式迁移 |

建议把 `origin`、`allocation_key`、`created_by_session_id` 持久化到 `studio_workspaces`，不要再靠 `localProjectId === ""` 或 synthetic ID 推断。Session 继续通过 `workspace_id` 引用 Workspace，任务和 Workspace 仍是两个实体。`allocation_key` 使用稳定的 root-task ID：branch/continue 默认继承原 Workspace，只有显式“在新目录继续”才生成新 key。它对 managed root 唯一，用来让重试/崩溃恢复幂等，不能只依赖随机 Workspace UUID 防止同一路径重复注册。

数据库层可以继续保留 `type: "local" | "sandbox"` 作为 transport 判别，再增加：

```text
origin: managed_local | selected_local | remote_sandbox
```

并调整当前 `studio_workspaces` CHECK：

- `selected_local`：`type = local` 且 `local_project_id IS NOT NULL`；
- `managed_local`：`type = local` 且 `local_project_id IS NULL`；
- `remote_sandbox`：`type = sandbox` 且 `sandbox_id IS NOT NULL`。
- `legacy_local`：`type = local` 且 `local_project_id IS NULL`，以 origin 本身作为兼容标记；只允许现有 session 继续或显式迁移，不能用于新建任务。

本地项目唯一索引只约束 `selected_local`；managed Workspace 需要 `UNIQUE(origin, allocation_key)`，canonical path 还应有受大小写规则约束的唯一性检查。这样不用创建假的 `studio_local_projects` 记录，也不会把“任务目录”误装成用户主动添加的项目。

这不能由 `ensureSqliteTableColumns()` 简单加列完成。当前 CHECK 明确要求 `type = 'local'` 时必须有 `local_project_id`，`mapWorkspace()` 也会拒绝 local + NULL，删除逻辑依赖 local project 级联。Phase 1 必须事务式重建表：

1. 创建包含新 CHECK、origin 和 allocation 字段的临时表；
2. 回填现有 local 为 `selected_local`、现有 sandbox 为 `remote_sandbox`；
3. 复制关联、重建索引和外键，再原子换表；
4. 同步修改 `DbWorkspaceRow`、`mapWorkspace()`、`types.ts`、DTO/codegen、所有 create/update/delete 查询；
5. API 使用 discriminated union，禁止构造 `managed_local + localProjectId` 或 `selected_local + null`；
6. managed workspace 删除只解除绑定，默认不删除磁盘目录；用户另行确认后才执行可恢复的文件归档/删除。

### 6.2 可见目录和私有目录严格分离

用户可见：

```text
~/AstraFlow/
  2026-07-23-14-36-45-a1b2/
    demo.html
    assets/
    outputs/
```

Electron `userData` 内继续保留：

```text
data/                       SQLite
studio-files/               附件和本地交付缓存
studio-skills/              技能安装
acp-state/<stateOwnerId>/   Desktop-owned continuation/checkpoint state
sandbox-runtime/<studioSessionId>/<launchId>/
  home/                     per launch
  tmp/                      per launch
sandbox-cache/
  packages/<policyHash>/    explicit, quota-bound shared cache
automation-notifications/
```

不要把 `.astraflow-acp-state`、`.astraflow/pi`、`.astraflow-agent`、attachments、skills manifest、Sandbox HOME 或 cache 写进用户可见任务目录。若确实需要 Workspace 元数据，优先存数据库；不要为方便运行时而污染 `~/AstraFlow/<task>`。selected Workspace 可被多个 session 共用，所以 HOME/tmp 不能按 workspaceId 共享；可共享包缓存必须单列、只存无凭证内容并按 policy hash/quota 管理。新任务必须满足这一点；旧 `userData/acp-workspaces` 中已经存在的用户文件作为只读兼容例外保留到显式迁移，不能为了达成目录整洁而自动移动或删除。

### 6.3 Resolver 契约

进程所有权必须单一：Electron main 只负责从 `app.getPath("home")` 计算 managed root，并在启动时注入只读 `ASTRAFLOW_MANAGED_WORKSPACES_PATH`；现有持有 SQLite/workspace API 的 Next/server 进程独占 `WorkspaceRootService`、allocation lock、mkdir、DB transaction 和 reconciliation。不要把一次创建事务横跨 Electron IPC：

```ts
type ResolvedWorkspaceTarget = {
  workspaceId: string
  origin: WorkspaceOrigin
  canonicalRoot: string
  displayRoot: string
  runtimeStateRoot: string
}

resolveWorkspaceTarget({
  sessionId,
  boundWorkspace,
  createManagedIfMissing,
})
```

约束：

- 默认根由 Electron main 的 `join(app.getPath("home"), "AstraFlow")` 得出，再以受控 env/config 传给服务端；
- `ASTRAFLOW_MANAGED_WORKSPACES_PATH` 只用于测试、企业策略或用户设置覆盖；
- renderer 不接收任意“创建目录”能力；
- 在首个 Agent run 开始前完成目录创建和数据库绑定，工具执行过程中不再临时切 cwd；
- server 的 `WorkspaceRootService` 使用 allocation key 锁串行化同一任务的创建；先创建临时目录，完成 DB 事务后原子改名到最终目录。若 DB 失败则回收空临时目录；若改名失败则回滚 Workspace 记录；启动时 reconciliation 清理无记录的空临时目录并报告“有文件但无记录”的孤儿，不能静默删除；
- 创建后执行 `realpath`/nearest-existing-ancestor 校验；该检查用于诊断与路径一致性，不作为唯一安全边界，实际强制隔离由 OS sandbox 完成；
- 所有文件、终端、Agent、Markdown 相对路径和 Artifact resolver 使用同一个 canonical root；
- 检查 symlink escape；
- 目录名包含短随机 ID，避免同秒冲突；
- 创建失败时返回可操作错误，不回退到整个 home。

### 6.4 迁移策略

分三类处理：

1. 新建未绑定任务：直接创建 managed local Workspace；
2. 已有 local project 的旧任务回填 `selected_local`；没有 Workspace 记录但 cwd 指向旧 `userData/acp-workspaces` 或其他历史自动目录的 session，创建 `legacy_local` 记录并正式绑定，不能谎报为 selected/managed；
3. 旧路径缺失：显示“旧任务目录不可用”，提供显式“新建 AstraFlow 目录并复制可恢复文件”动作。

禁止：

- 首次升级时批量移动用户文件；
- 使用 symlink 假装迁移完成；
- 因会话重命名而移动目录；
- 删除会话时连带删除 Workspace；
- 把 `~/AstraFlow` 当成 OS sandbox 的 HOME。

历史 cwd 等于 home、`/`、盘符根、包含已变化 symlink 或无法 canonicalize 时，必须停止自动运行，提示用户重新选择项目或迁移到新的 managed Workspace。旧路径保留不等于无条件信任旧数据库内容。

从 `legacy_local` 显式“在新目录继续”会创建新的 managed Workspace，同时 fork 新的 `stateOwnerId`；不能把带旧 cwd 假设的 provider continuation state 直接恢复到新目录。旧会话和旧 state 保留为历史可读记录。

## 7. Default / Full Access 权限重构

### 7.1 新的产品类型

```ts
export const studioPermissionModes = ["default", "full_access"] as const
```

内部允许保留临时兼容态：

```ts
type EffectivePermissionMode =
  | "default"
  | "full_access"
  | "legacy_readonly"
```

兼容迁移：

- 旧 `ask` → `default`
- 旧 `auto` → `default`
- 旧 `full_access` → `full_access`
- 旧 `readonly` 不能静默升级成可写 Default；先保留 `legacy_readonly`，直到用户主动选择 Default 或 Full Access

公开下拉框仍只有两个可选项。历史只读会话可显示一次兼容状态说明，但不能继续成为第三个常驻权限选项。

存储和运行时必须分三层，不能直接让当前 `normalizePermissionMode()` 读取新的二值数组：

```ts
type StoredPermissionModeV1 =
  | "ask"
  | "auto"
  | "full_access"
  | "readonly"
  | "default"

type EffectivePermissionMode =
  | "default"
  | "full_access"
  | "legacy_readonly"

type PublicWritablePermissionMode = "default" | "full_access"
```

- 数据库增加 permission schema version，新 session 默认写 `default`；
- 读取 V1 时按上面的兼容表生成 effective mode，未知值 fail closed 到 `legacy_readonly`，不能回落成可写 Default；
- 在读取旧 session 时不立即破坏性 writeback；用户第一次明确选择新模式或后台迁移完成后才写 V2；
- API response 可返回 `effectiveMode` 和 `requiresPermissionMigration`，API write 只接受两个公开值；
- 模式切换按 run 边界原子生效：取消/结束旧 run，使旧 ACP session 失效，再以新 policy 启动，禁止把正在运行的 sandboxed ACP 热切成 Full Access。

Full Access 的确认不是一个脱离环境的 session 布尔值。另存主进程签发的 grant：

```ts
type LocalFullAccessGrant = {
  studioSessionId: string
  deviceId: string
  environment: "local"
  workspaceId: string
  policyVersion: number
  confirmedAt: string
}
```

- remote 选择 Full Access 不产生 local grant；
- remote → local、workspace rebind、device 改变或 policy version 提升时 effective mode 先降到 Default，并在 Desktop 本机重新确认；
- Mobile 和 Automation 不能创建或继承 local Full Access grant；只有本机可信 UI/主进程可以签发；
- 删除/过期 grant 不改历史 selection，但下一次 local run 按 Default 处理并提示一次。确认必须发生在 run start 的服务端/主进程检查，不只是下拉框视觉状态。

Automation 如果仍需要只读执行，应拆成 `AutomationExecutionPolicy` 或 plan/read-only workflow，不再复用聊天权限枚举。Mobile Channel 也应先拆独立类型或完成同步迁移，避免共享枚举造成隐式行为变化。

### 7.2 唯一 Policy Resolver

建议集中为：

```ts
resolveExecutionPolicy({
  mode,
  environment: "local" | "remote_sandbox",
  workspace,
  runtimeId,
})
```

输出至少包括：

```ts
type ExecutionPolicy = {
  runtimeBoundary: "local_os_sandbox" | "local_full" | "remote_vm"
  readableRoots: string[]
  writableRoots: string[]
  blockSensitiveHostPaths: boolean
  egress: {
    mode: "deny" | "allowlist" | "unrestricted"
    controlPlaneEndpoints: Array<{
      protocol: "http" | "https" | "unix" | "named_pipe"
      address: string
    }>
    rules: Array<{
      protocol: "http" | "https"
      host: string
      ports: number[]
    }>
    blockPrivateRanges: boolean
    blockMetadataEndpoints: boolean
    revalidateRedirectsAndDns: boolean
  }
  promptCodingTools: false
  hostEffectPolicy: "separate"
}
```

原则：

- Pi backend 只报告规范化事实，例如 tool、canonical paths、命令、network targets；
- 唯一 policy resolver 做最终 allow/block；
- 不再由 Desktop 和 Pi backend 各自维护一套字符串风险规则；
- “不询问”通过静态 allow/block 实现，而不是删除路径和 secret 校验；
- Full Access 的一次模式切换确认不等于每次 tool call 询问。
- Local Default 首期沿用并显式版本化当前 npm/PyPI 等安装源 allowlist；不匹配的网络目标直接拒绝，不弹权限。规则必须在每次 DNS 解析和 HTTP redirect 后重新验证，拒绝 loopback、RFC1918/link-local、Unix socket、云 metadata 和代理绕过；
- 整个 ACP 被包装后，模型 provider API、已配置的本地模型 endpoint 和 Desktop host-MCP bridge 属于 control plane，必须由可信配置解析成精确 endpoint 单独放行，不能与模型可请求的 tool egress 共用通配规则。默认拒绝一般 loopback/Unix socket，只允许本轮继承的 broker socket或用户已选 provider 地址；
- Remote AstraFlow Default/旧只读由 Gateway 创建独立 network namespace，
  不提供通用 egress，只通过 per-run Unix socket bridge 暴露 Gateway model
  proxy；VM terminal、Full Access 和其他 remote runtime 仍按各自已经验证的
  VM/network 信任边界描述，不能从 AstraFlow Pi 的实现外推 DLP 能力；
- Local Full Access 可使用 unrestricted egress，但仍保留超时、输出上限和进程回收；
- 本地 Full Access 对 coding file tools 的语义是允许访问宿主文件系统，因此不能继续无条件执行 `assertWorkspacePath`；但文件树、Review、Artifact 自动预览和交付仍只认绑定 Workspace，避免 UI 把任意宿主路径当成项目 Artifact。

coding approval 设为 never 不能绕过外部重要操作。在 `lib/agent/acp/host-tools.ts` 真正调用产品工具之前增加独立 `HostActionGateway`：

```text
Host MCP call
  -> Tool Catalog lookup(source, canonical name, effect category)
  -> coding/workspace-internal: resolved ExecutionPolicy
  -> connector/shared-system write: ImportantAction policy + Desktop confirmation
  -> execute product tool
```

Pi/provider 的 tool approval 只管 Agent coding flow，不是安全 enforcement point。发消息、修改 Jira/Slack/云资源、发布部署等确认由 Desktop host bridge 在执行前强制；未知 host tool 默认按重要写操作 fail closed。需要 contract test 证明 `promptCodingTools=false` 时外部写工具仍会停在 HostActionGateway。

### 7.3 Runtime 隔离矩阵和上线门槛

`StudioPermissionMode` 目前同时影响 AstraFlow/Pi、Codex、Claude、OpenCode、Mobile 和 Automation，不能只改 Pi 后把共享枚举整体切换。建议的投影是：

| Runtime / 场景 | Default | Full Access | 上线阻塞条件 |
| --- | --- | --- | --- |
| AstraFlow/Pi local | 整个 ACP/Pi 进程置于 OS sandbox；内部 coding approval 设为 never | 未包装的 ACP/Pi；内部 coding approval 设为 never | 真实 Pi → ACP → OS sandbox E2E |
| Codex local | `workspace-write`/等价受限 sandbox + `approval_policy=never` | `danger-full-access` + never | 固定版本协议测试，不凭字符串猜 mode |
| Claude local | 整个 Claude/ACP 进程先置于 OS sandbox，内部才可 `bypassPermissions` | 用户确认后才可在宿主使用 `bypassPermissions` | 未完成进程级隔离时不得将 Default 映射为 bypass |
| OpenCode local | 整个 runtime 置于 OS sandbox，内部 tool permission 可 allow | 用户确认后的宿主 allow | 验证其子进程继承隔离且不能启动脱离进程 |
| Remote AstraFlow/Pi | Gateway Bubblewrap + 无通用 egress 的 network namespace，仅桥接 model proxy；coding tools 无询问 | 同一单租户 VM 内 direct spawn | `agent.astraflow.workspace-confinement.v1` |
| 其他 remote runtimes | 只声明各 adapter 已验证的 VM、权限和网络边界 | 同左 | 不从 AstraFlow/Pi capability 外推 |
| Mobile | 复用绑定 session 的 resolved policy，不再自己解释共享枚举 | 同左 | context/resume 不得改变 effective mode |
| Automation | 独立 `AutomationExecutionPolicy`，保留只读/计划需求 | 不从聊天枚举隐式继承 | 类型和持久化先拆分 |

permissions V2 应由 runtime capability/version 控制。只有上表对应 runtime 的隔离测试通过，才能对该 runtime 启用“Default 无询问”；不能用一个全局 feature flag 把未验证 runtime 一起放开。

### 7.4 移除旧规则的顺序

`studio_permission_rules` 和 `allow_always` 不能第一步删除：

1. 先加入 V2 normalizer；
2. 所有 runtime adapter 完成 Default/Full Access 投影；
3. 旧会话、Mobile、Automation 完成迁移；
4. 停止创建新规则；
5. 观察一个兼容版本；
6. 再删除表、broker 分支和旧 i18n。

## 8. 恢复本地 OS sandbox

### 8.1 选择进程级边界，不只包装 `bash`

最终选择是：**Local Default 将整个本地 ACP/Pi 子进程置于 OS sandbox**。Pi 的 `read/write/edit/search` 在 ACP 子进程中直接调用 Node 文件 API，只给 `bash` 接 `CommandExecutionAdapter` 会留下未隔离文件通道；同进程的 lexical/realpath 检查也无法抵御校验后的 symlink 置换。OS policy 才是强制边界，path policy 只负责更好的错误和跨 provider 一致性。

目标启动链：

```text
Desktop/Next trusted parent
  -> resolve workspace + effective permission + immutable policy
  -> spawn sandbox-command-runner in long_lived_stdio mode
       control: parent <-> runner IPC
       data:    parent stdin/stdout <-> ACP stdin/stdout
  -> runner initializes @anthropic-ai/sandbox-runtime
  -> runner wraps and spawns runtime/astraflow-acp
  -> Pi file APIs and every descendant bash inherit the same OS sandbox
```

现有 runner 先从 stdin 读取一次 JSON，然后以 `stdio: ["ignore", ...]` 启动目标命令，不能承载 ACP 的双向 NDJSON。需要给它增加明确的 `long_lived_stdio` 模式：

- policy/bootstrap 只通过 parent-runner IPC 或额外 fd 传输，ACP 看不到控制通道；
- runner 将父进程 stdin 原样 pipe 给 ACP stdin，将 ACP stdout/stderr 原样转回；
- 可信 parent 生成 policy，绑定 `studioSessionId + workspaceId + canonicalRoot + policyVersion + random launchToken`；runner 只接受启动时那一次绑定，不接受 ACP/模型修改 root；
- `ASTRAFLOW_SANDBOX_RUNNER_PATH`、sandbox runtime/package binary 路径和每轮无凭证 HOME/tmp 由 Electron main 在 packaged/unpackaged 两种环境注入，路径缺失直接 fail closed，绝不回落 direct spawn；
- child env 从 allowlist 重建，不继承完整 `process.env`。真实 ModelVerse/OpenAI/Anthropic key、Desktop OAuth、proxy/MCP credential 不进入 ACP；可信 parent 提供每轮短期 opaque credential sentinel/proxy，由代理只对已验证 provider/MCP endpoint 注入真实凭证，bash env 再剥离 sentinel；
- policy 将 model provider、显式启用的 remote MCP、host-MCP 等 control-plane endpoint 与包源/tool egress 分开，从经过验证的 provider/MCP 配置生成 immutable 精确 allowlist；避免包住整个 ACP 后误伤模型调用，也避免用 `localhost:*` 通配重新打开宿主面；
- cancel 先通过 IPC 请求 runner 终止，runner 结束 ACP 和可管理后代；平台不能证明完整回收时按下述生命周期约束 fail closed/降级，不把“kill process group”宣传成能回收任意 double-fork；
- runner 崩溃、IPC 断开或 policy 初始化失败都让本轮失败，不自动重试成 Full Access；
- 网络 permission IPC 在 Default 中关闭，因为 egress 已静态 allow/deny；若将来恢复一次性网络授权，也只能由 parent 响应，ACP 不持有这个 IPC。

`Local Full Access` 则由相同 spawn factory 明确选择 direct ACP child，仍使用最小环境和 credential proxy；Full Access 只放宽宿主文件/命令边界，不顺带泄露 AstraFlow 自身凭证。它保留 abort、timeout、输出上限和平台能保证的进程回收。这样 Default/Full 的差异发生在 run 启动边界，不是在运行中的 tool hook 热切换。

进程生命周期按平台定义：

| 平台 | 强制机制 | 未满足时 |
| --- | --- | --- |
| Windows | Job Object + `KILL_ON_JOB_CLOSE`，所有 runtime descendants 必须进入同一 job | Default/Full Access run 不启用无询问后台进程 |
| Linux | cgroup v2 scope + pidfd/subreaper/PDEATHSIG，按 cgroup 回收 | 无 cgroup capability 时禁止 daemonization，测试 fail closed |
| macOS | sandbox profile 继续约束逃逸后代；native supervisor 验证 descendant tracking | Default 拒绝 `setsid`/double-fork/daemon 模式；Full Access 明示“后台进程可能存活”且不承诺强回收 |

普通 `bash` 不承担长服务。能长期运行的预览服务只走受管理 ServiceManager；本地在没有 `LocalServiceManager` 前不支持 Agent 自动后台服务。

### 8.2 文件、状态和附件

保留 Pi builtin，不重新引入平行的 `read_file/write_file/list_files`。Local Default 中：

- Workspace canonical root 是唯一用户可写根；
- sandbox HOME/tmp 是每次 launch 的无凭证临时可写根；它可被 bash 看到，因此不能存 continuation、token 或用户私有配置；
- durable `acp-state/<stateOwnerId>` 不挂进 ACP sandbox。新增 parent-owned `AcpStateBroker`：启动时把允许恢复的 checkpoint 通过 ACP bootstrap 注入内存，运行中用结构化 checkpoint event 回传给 Desktop 原子持久化；Pi resource loader 使用 in-memory/packaged read-only state；
- skills、Studio attachments 是只读根；
- Electron app/runtime/node/platform binaries 是执行所需只读根；
- `.ssh`、浏览器 profile、其他项目和 host secrets 不进入 allowlist；
- lexical、realpath 和 symlink 检查继续存在，但只作为预检和诊断；强制拒绝由进程级 OS policy完成。

上传附件不再复制到任务目录 `.astraflow/attachments`。本地 tool 返回 logical attachment handle，由 runner policy 给对应 `studio-files` 对象只读访问；远端先同步到 Gateway 私有 cache，再给 Agent 一个 Workspace 内的只读映射或受控下载 handle。无论哪种方式，文件卡展示原名，不能暴露 `userData` 物理路径。

### 8.3 Remote 的真实边界

审计时远端 ACP 只是 VM 内 direct `spawn`，`cwd=/workspace` 不构成边界。
当前实现已经在 Gateway/镜像侧补齐强制边界：Remote Default 与旧只读
使用 Bubblewrap user/mount/PID namespace 包住完整 Pi 进程树，
`/workspace` 是唯一可写宿主路径，Gateway/state/credential roots、
宿主 `/proc`、home/run/tmp 被遮蔽；独立 network namespace 无通用
egress，只通过 per-run Unix socket bridge 连接 Gateway model proxy；
缺少 Bubblewrap 或 socat 时 fail closed。
Remote Full Access 保留 VM 内 direct spawn。两种模式都不可能访问
Desktop 宿主机；Default 的 mount boundary 也不应被宣传成通用 DLP。

远程 checkpoint 同时改为 ACP WebSocket 上的 Desktop state broker：
Desktop 持有 AES-GCM key 和原子文件，远端不再挂载共享 checkpoint 目录。
Desktop 只有在 Gateway `/v1/health` 明确宣告
`agent.astraflow.workspace-confinement.v1` 时才允许以 Default/旧只读模式
创建远程 AstraFlow Agent connection；旧模板或缺失能力时要求重建 Sandbox，
不能静默退回 direct spawn。Remote Full Access 不依赖该能力。

### 8.4 必须补的真实链路测试

测试必须从真实 `AstraflowAcpAgent`/ACP runtime 发起，而不是只测 runner：

- Local Default 的 Pi `read/write/edit/search/bash` 都不能读取 Workspace 外的 `.ssh`、`.env`；
- 并发 symlink swap 仍不能读写出 Workspace；
- Workspace 内创建、编辑、安装允许的依赖不出现 permission request；
- Default 非 allowlist 网络、DNS rebinding、redirect 到私网/metadata 直接拒绝且不询问；
- timeout/abort/parent crash 会回收 ACP、直接 process group，以及平台 supervisor 能证明归属的 descendants；macOS 的 daemonization 拒绝/Full Access 降级语义单独测试；
- runner 缺失、sandbox runtime 初始化失败和 IPC 中断都 fail closed；
- Full Access 明确走 direct spawn，切换时旧 ACP 已失效；
- Remote Default 不会错误调用本地 OS sandbox runner；
- packaged Electron 能找到 runner、`@anthropic-ai/sandbox-runtime` 和平台二进制。

## 9. Sandbox Service 的完成态实现

### 9.1 工具所有权

`sandbox_start_service` 需要 Desktop 侧的 Sandbox provider 上下文来解析
`sandbox.getHost(port)`，而长服务进程由 Workspace Gateway 管理。当前生产
链路是：

```text
Pi
  -> Desktop host MCP: sandbox_start_service
  -> authenticated Workspace Gateway /v1/services
  -> Gateway ServiceManager 启动和管理进程
  -> Desktop 用 provider sandbox.getHost(port) 解析 publicUrl
  -> 返回结构化 service result
```

也就是说：

- 只对 `workspace.origin = remote_sandbox`、权限为显式 Full Access 且
  Gateway 宣告 `service.lifecycle.v2` 的主 Agent 暴露
  `sandbox_start_service`；Default/旧只读只保留 scripts-off 静态 HTML
  预览，专用 service 进程沙箱完成前不允许借 service tool 逃离
  Bubblewrap；
- 它通过现有 Desktop MCP bridge 进入 Pi，不再是不可达的旧函数；
- Gateway 管进程，Desktop 管 provider public host；
- `sandbox_get_host` 不再暴露给模型作为第二步工具；
- `run_command` 不恢复，普通命令继续由 Pi `bash` 执行。
- Local managed/selected Workspace 不注册该工具；单文件 HTML 用隔离 iframe。若以后要支持本地长服务，应单独设计 `LocalServiceManager`，不能把 remote Sandbox provider 语义伪装成本地能力；
- root Agent 和 subagent 的 MCP tool list 都按 `allowInSubagent` 过滤；
  `sandbox_start_service` 明确禁止进入 subagent。

旧的 `tmux/setsid/pkill/curl` 拼接脚本不再作为 service lifecycle fallback；
缺少 capability、owner 或 Full Access 时统一 fail closed。

### 9.2 Gateway API

Workspace Gateway protocol 1 已在认证后的 `/v1/health` 与
`/v1/workspace` 宣告：

```text
service.lifecycle.v2
```

接口：

```http
POST   /v1/services
GET    /v1/services?ownerSessionId=...
GET    /v1/services/:serviceId?ownerSessionId=...
GET    /v1/services/:serviceId/logs?ownerSessionId=...
DELETE /v1/services/:serviceId?ownerSessionId=...
```

所有接口复用 Gateway 已认证连接。`workspaceId` 和 Sandbox identity 从服务端
连接上下文取得；`ownerSessionId` 由 Desktop host tool 从当前 session 注入，
不进入模型 schema。Gateway 对 start/list/get/logs/stop 全部强制 owner
匹配，跨 session 或跨 Workspace 的 serviceId 一律返回 not found；旧的
ownerless manifest 不加载。ServiceManager 再把 `cwd` 和可选 `entryPath`
解析到该连接的 canonical workspace。Desktop/Gateway 以
`workspaceId + ownerSessionId + canonical relative entryPath` 派生稳定
artifactKey，不信任模型提交的 key；未提供 entryPath 的 service 使用独立
service artifact，不能自动“升级”某个文件 tab。删除 session 时只
best-effort 停止该 owner 的服务，一个失败不能误停其他 session。
从 Full Access 降级或离开当前 Sandbox workspace 时则使用强一致 cleanup：
Desktop 在和 service startup 相同的 session lock 内停止旧 owner scope，
list、stop 或 reap 无法确认时拒绝提交配置切换。

创建请求：

```ts
type StartWorkspaceServiceRequest = {
  ownerSessionId: string // Desktop-injected; absent from the model schema
  name: string
  command: string
  cwd: string
  port?: number
  env?: Record<string, string>
  healthPath?: string
  entryPath?: string
  idempotencyKey: string
  specRevision?: string
  replaceServiceId?: string
}
```

响应：

```ts
type WorkspaceService = {
  schemaVersion: 1
  serviceId: string
  ownerSessionId: string
  name: string
  status: "starting" | "healthy" | "unhealthy" | "stopped" | "failed"
  port: number
  cwd: string
  pid: number | null
  healthPath: string
  logPath: string
  startedAt: string
}
```

Desktop host tool 再补充：

```ts
{
  ...service,
  publicUrl: string
}
```

### 9.3 ServiceManager 行为

- 相同 owner 内的相同 `idempotencyKey` 在 pending 或 active 生命周期中复用
  同一操作，不重复执行；failed/stopped 后释放 key 以允许显式重试，不同
  owner 的 key、name 和 replacement scope 互不影响；
- 对规范化
  `ownerSessionId + command + cwd + port + env allowlist + healthPath +
  entryPath + specRevision`
  计算 `specFingerprint`；同一 owner/workspace/name/fingerprint 返回现有
  service；
- spec 变化不能被“同名幂等”静默替换，必须携带匹配当前 service 的
  `replaceServiceId`；`specRevision` 参与 fingerprint，但不替代显式
  replacement。manager 先启动新实例并确认健康，再停止旧实例；只有旧实例
  明确返回 `stopped` 才提交替换，否则回滚新实例并返回
  `SERVICE_REPLACE_FAILED`，新实例也无法 reap 时明确报告两组 unresolved；
- 服务命令必须保持 foreground；Linux/macOS 以独立 POSIX process group
  管理 root command 和同组 descendants，验证 listener 属于该 group 且绑定
  `0.0.0.0`/`::` 后才报告 healthy。常见 `nohup`、`tmux`、`setsid`、shell
  `&` 等后台包装直接拒绝；
- 任意 `npm dev`/shell command 不能接管 manager 已绑定的 socket，因此当前
  策略不宣称严格原子端口预留：manager 在 workspace/service allocation
  lock 下选择候选端口、注入 `PORT`，紧邻 spawn 前释放 probe socket；若
  `EADDRINUSE` 或 health 指向错误 PID，则在有界次数内换端口重试。只有未来
  支持 socket activation/FD passing 的 runtime 才能提供真正原子预留；
- 限制 cwd 在 Workspace 内；
- 默认要求服务监听 `0.0.0.0`，health check 使用 `127.0.0.1`；
- `env` 只接受显式 allowlist，剥离 provider token、Desktop OAuth、proxy
  credential 和所有 host secret；
- 日志写入 Gateway 私有运行目录，不只写 `/tmp`；
- 保留最近日志的有界内存与响应窗口；
- health check 有总超时、间隔、取消信号和最近日志；client 取消 start 时必须结束尚未交付的进程；
- Agent 进程结束不自动杀掉已交付的 preview service；
- 用户显式 stop、owner cleanup、Workspace 销毁和 Gateway 正常关闭时先
  TERM/宽限，再 KILL；普通 Agent turn 结束不触发；
- Gateway 异常重启后把非 stopped manifest 标记为
  `GATEWAY_RESTART_UNVERIFIED`，不 adopt、signal 或 kill 无法重新证明归属的
  persisted PID；
- subagent 不能创建长期服务；
- `publicUrl` 是 Desktop 根据当前 Sandbox connection 动态派生的易失值；恢复或重连后重新解析，不把旧 URL 当持久化事实。
- Desktop 必须验证 `sandbox.getHost(port)` 返回受支持的 `http:`/`https:` URL、端口和当前 Sandbox identity；拒绝 `file:`, `javascript:`, loopback/raw VM URL、credential-bearing URL 和跨 Sandbox host。

### 9.4 结构化工具结果

Desktop host MCP 与 `runtime/astraflow-acp/src/mcp-tools.mjs` 已按 MCP
`CallToolResult` 保留 `structuredContent`、`_meta` 和错误状态；text 只作为
模型可读 fallback：

```ts
type CallToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent?: {
    astraflow: {
      service: {
        schemaVersion: 1
        serviceId: string | null
        ownerSessionId?: string
        sessionId: string
        workspaceId?: string
        sandboxId?: string
        artifactKey: string | null
        entryPath: string | null
        status: string
        port: number | null
        publicUrl: string | null
        logPath: string
        specFingerprint: string
        failure?: string | null
      }
    }
  }
  _meta?: {
    "astraflow/resultSchema": "service.v1"
  }
  isError?: boolean
}
```

contract test 覆盖完整传递链：

```text
product tool result
  -> Desktop host MCP CallToolResult
  -> runtime mcp-tools 保留 structuredContent/_meta/details
  -> stream.mjs 写入 ACP tool_call_update meta
  -> acp-runtime 生成 AgentEvent
  -> ToolPresentation/React
```

每一层只做 schema validation，不 stringify 后再正则恢复。UI 已删除
`parseSandboxToolOutput()` 对“URL: ...”“Port: ...”文本的依赖；文本仅作为
模型和不支持 structured content 的客户端 fallback。

## 10. 工具迁移矩阵

| 旧能力 | 目标 | 动作 |
| --- | --- | --- |
| `run_code` | Pi `bash` + Python/Node 等运行时 | 删除旧定义；只有需要 notebook/cell 语义时才重新设计专用工具 |
| `run_command` | Pi `bash` / canonical `execute` | 删除旧定义和旧提示 |
| `list_files` | Pi `ls/find` | 删除重复实现 |
| `read_file` | Pi `read` | 删除重复实现 |
| `write_file` | Pi `write/edit` | 删除重复 executor，保留 canonical UI 名 |
| `sandbox_start_service` | Host MCP + Gateway ServiceManager | 已实现并注册；仅 Remote Full Access 可见 |
| `sandbox_get_host` | Desktop `PreviewUrlResolver` | 内部化，不再让模型二次调用 |
| `upload_file` | Desktop host MCP | 保留 |
| `download_file` | Desktop host MCP | 保留 |
| `createSessionSandboxGetter` | Host service/transfer 内部依赖 | 保留但不作为工具暴露 |

## 11. Tool Presentation 设计

### 11.1 保留 provider identity，再生成 canonical identity

```ts
type ToolIdentity = {
  providerToolName: string
  canonicalToolName: string
  kind: AgentToolKind
}
```

示例：

| Provider | canonical | kind |
| --- | --- | --- |
| Pi `write` | `write_file` | `edit` |
| Pi `edit` | `edit_file` | `edit` |
| Pi `bash` | `execute` | `execute` |
| Claude/Codex `write_file` | `write_file` | `edit` |
| MCP service tool | `sandbox_start_service` | `execute` |

唯一 Tool Catalog 应提供：

- alias/canonical name；
- ACP kind；
- permission category；
- renderer key；
-是否产生 Artifact；
- 是否允许在 subagent 中运行；
- i18n label key。

不要在 backend、stream、permission policy、React 和 i18n 分别维护相互独立的工具集合。

这三个值必须成为 `AgentToolCallEvent` 和持久化 event 的一等字段，不能只在 React 临时推导：

- provider adapter 只填 `providerToolName` 和 provider kind；
- Tool Catalog 生成 `canonicalToolName`，`getToolName()` 不再让泛化的 ACP kind 覆盖真实 provider name；
- permission/cache/dedupe 使用 `canonicalToolName`；
- renderer 使用 `canonicalToolName + kind`；
- debug/raw disclosure 始终展示 `providerToolName`；
- 迁移 `lib/agent/tool-names.ts` 的 alias 到同一 catalog，并给未知 provider tool 保留原名与 `kind = "other"`。

### 11.2 文件变更事件

扩展 `AgentFileChangeEvent`：

```ts
type AgentFileChangeEvent = {
  type: "file_change"
  eventId: string
  source: "tool" | "workspace_transport" | "user"
  workspaceId: string
  runId: string | null
  turnId: string | null
  parentTaskId: string | null
  toolCallId: string | null
  artifactKey: string | null
  revision: string | null
  transportRevision: string | null
  order: number
  path: string
  kind: "create" | "edit" | "delete"
  status: "complete" | "error"
  diff: string | null
  diffTruncated: boolean
  diffBlobId: string | null
  stats: { additions: number; deletions: number } | null
  error: { code: string; message: string } | null
}
```

规则：

- `eventId` 对所有来源稳定存在；Pi tool event 带 `toolCallId`，ACP `fs/writeTextFile`、用户编辑或第三方 provider 无关联工具时允许为 `null`，用 source/eventId/order 进入同一模型；
- 文件 artifactKey 由 `workspaceId + canonical relative entryPath` 派生，跨
  revision 稳定；service artifactKey 额外绑定 `ownerSessionId`，只有返回
  相同的受信 entryPath/artifactKey 才能升级当前 session 的文件 tab；
- mutation queue 的 owner 是 `runtime/astraflow-acp/src/backend.mjs` 创建 Pi file operations 的执行层，不是事后的 `stream.mjs`/Desktop mapper。root agent 和 subagent 注入同一个 workspace-scoped queue registry；每个 `workspaceId + canonicalPath` 在队列中读取 before、执行真实 write/edit operation、读取 after，防止快速连续或并发同路径写入把 diff 和 revision 串错；
- `write` 执行前读取已有文件并生成 create/edit 的真实 patch；
- `edit` 优先使用 Pi `result.details.patch/diff`；
- 每个 tool call 只产生一个完整 unified diff；
- 回合级汇总再按路径合并，不在 accumulator 中用后一个 diff 覆盖前一个；
- `revision` 定义为实际 post-write bytes 的 SHA-256；远端 transport 若有强 ETag/version 则同时保存为 `transportRevision`。失败或第三方 ACP provider 无法读回时 revision 显式为 `null`，不得用 tool input 猜一个成功版本；
- 大文件只传 path、有界 patch、统计和 revision，不重复存完整 old/new；完整 compressed patch 存入私有 `FileMutationStore`，返回 content-addressed `diffBlobId`。本地存 `userData`、远端由 Gateway 私有 state 持有，按 workspace/session quota 和 TTL 清理；Review 用 blob ID 获取并校验 revision。没有 blob 能力时 `diffTruncated=true` 必须明确显示“完整 diff 不可用”，不能假装仅凭 SHA-256 可恢复历史内容；
- `file_change` 是完成态权威来源，流式 input 只用于预览。

### 11.3 React renderer 生命周期

借鉴 Pi TUI 的行为，不直接复用 TUI 组件：

```ts
type ToolPresentation = {
  renderer:
    | "file-write"
    | "file-edit"
    | "command"
    | "search"
    | "service"
    | "generic"
  status: "streaming-input" | "running" | "complete" | "error"
  toolCallId: string
  path?: string
  contentPreview?: string
  patch?: string
  stats?: { additions: number; deletions: number }
  service?: ServicePresentation
}
```

关键规则：

- renderer registry 优先于 Generic fallback；
- `rawInput/rawOutput/content` 只是数据源，不得决定回退 Generic；
- 同一个 `toolCallId` 复用 renderer state；
- call input、running state 和 result 是独立数据阶段，但同一 `toolCallId` 只能有一个可见容器，禁止先渲染 call 卡再追加第二张 result 卡；
- renderer 抛错时才回退 Generic；
- 原始 JSON 放在“原始调用”次级 disclosure；
- 单文件 write 默认展开，多文件默认紧凑；
- 完成的主文件活动放在默认可见消息流中，不塞进默认关闭的 `TurnActivitySummary / Worked for`。每个成功文件 tool call 验收为“无需展开 Worked for 即可见，且恰好一张文件卡”。

Pi 0.80.7 可借鉴点：

- `tool-execution.js` 保留 `argsComplete/isPartial/expanded/state/lastComponent`；
- `write.js` 做增量高亮，默认 10 行，成功后不重复无意义成功文本；
- `edit.js` 参数完整后计算预览，结束后用真实 result details 校准；
- generic fallback 只在专用 renderer 缺失或失败时使用。

对应源码：

- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js`
- Pi 0.80.7 官方扩展文档：[extensions.md](https://github.com/earendil-works/pi/blob/v0.80.7/packages/coding-agent/docs/extensions.md)

### 11.4 自动换行和折叠

给 `SynaraCodeBlock` 增加：

```ts
defaultWrap?: boolean
wrapPreferenceKey?: string
collapsedLines?: number
```

默认：

| 内容 | 自动换行 | 默认展示 |
| --- | --- | --- |
| write/edit 内容 | 开 | 前 10 行 |
| unified diff | 开 | 变更附近，带展开 |
| 普通文本工具输出 | 开 | 有界高度 |
| shell/source/log | 关 | 尾部若干行 |

节流必须先发生在 transport，而不只是 React：

- `block.arguments` 仍是累计快照，不能把它直接称作增量。`stream.mjs` 为每个 toolCallId 保存上次已发送的 write-content prefix，最多每 75ms 或每新增 4 KiB 生成一次显式 wire delta：

  ```ts
  type ToolInputPreviewDelta = {
    toolCallId: string
    sequence: number
    totalBytes: number
    update:
      | { mode: "append"; offset: number; text: string }
      | { mode: "replace"; text: string }
    previewTruncated: boolean
  }
  ```

- 当新快照以前一快照为前缀时只发送 append；出现 provider 修正/非前缀时发送有界 replace。接收端严格检查 sequence/offset，丢序时请求/等待下一次 replace，不能拼出错误内容；
- UI preview 最多保留 32 KiB 和 10 行；不反复发送完整累计 `partialJson`；
- ACP 对同一 toolCallId 每秒最多持久化 15 个 partial snapshot，最终完成态再发送一次完整参数和权威 result；
- React 在此基础上按 animation frame/50–100ms 合并显示，完成后才做完整语法高亮；
- 未知 provider 无增量协议时只显示文件名和 byte count，不能为了预览复制数 MB JSON。

性能验收使用 1 MiB HTML：跨 ACP 的 partial payload 总量应保持为输入大小的常数倍，目标小于 3 MiB且不随 chunk 数平方增长；React partial commit 不超过每秒 15 次。

## 12. HTML 自动唤出右侧预览

### 12.1 Preview Request

不要让消息组件直接发一个无状态全局 link 事件。建议由拥有当前 session、visible messages 和 panel state 的 Workbench 生成受控请求：

```ts
type AutoArtifactPreviewRequest = {
  id: string
  sessionId: string
  runId: string
  turnId: string
  artifactKey: string
  workspace: StudioFileWorkspaceTarget
  target: { type: "file"; path: string; kind: "html"; revision: string }
  trigger: "tool_complete"
  sourceEventId: string
  toolCallId: string | null
  tabPolicy: "reuse-path" | "replace-unpinned-preview"
  focusPolicy: "preserve-user-focus" | "activate"
}

type ServiceArtifactPreviewRequest = {
  id: string
  sessionId: string
  runId: string
  turnId: string
  artifactKey: string
  workspace: StudioFileWorkspaceTarget
  target: {
    type: "url"
    url: string
    serviceId: string
    serviceRevision: string
    entryPath: string | null
  }
  trigger: "service_healthy"
  sourceEventId: string
  tabPolicy: "reuse-path" | "replace-unpinned-preview"
  focusPolicy: "preserve-user-focus" | "activate"
}

type UserArtifactPreviewRequest = {
  id: string
  sessionId: string
  workspace: StudioFileWorkspaceTarget
  target:
    | { type: "file"; path: string; kind: "html"; revision?: string }
    | { type: "url"; url: string; serviceId?: string }
  trigger: "user"
  tabPolicy: "reuse-path" | "new-tab"
  focusPolicy: "activate"
}

type StudioArtifactPreviewRequest =
  | AutoArtifactPreviewRequest
  | ServiceArtifactPreviewRequest
  | UserArtifactPreviewRequest
```

`activate` 只表示激活右侧 tab/panel，不调用 DOM `.focus()`；composer 是否保持键盘焦点由独立的 `preserveComposerFocus` 状态管理，避免把“显示预览”和“抢输入焦点”混成一个布尔值。

### 12.2 自动打开规则

- 只在 tool/file change `completed` 后触发；
- 首期仅 `.html/.htm`；
- 文件必须通过 Workspace transport `stat/read`；
- Workspace 外路径不自动打开；
- 只消费当前 run watermark 之后产生且携带当前 runId/turnId 的 event；session hydrate、历史消息重放和重开应用不会生成 auto request；
- 同一 `sessionId + artifactKey + sourceEventId + revision/serviceRevision` 只执行一次；
- 同路径复用 tab；
- 后续 edit 更新 revision 并刷新；
- 用户已固定 tab 时不替换；
- 用户在 Terminal/Review 或主动操作其他 panel 时不抢焦点，只提示“预览已就绪”；
- 不夺走 composer 键盘焦点；
- 历史消息重放不触发自动打开；
- failed/cancelled tool 不触发；
- 一轮最多自动激活一个主 Artifact。
- 用户关闭自动预览后记录 `sessionId + artifactKey + originatingRunId` suppression；同一 artifact 的后续 revision 只显示“已更新”而不重开，直到用户显式打开，或新 run 产生不同 artifactKey 的 primary；
- turn-level arbiter 以明确的 `run/turn_terminal` event 收敛候选；终止事件后 250–400ms 只用于吸收已经在途的 transport update，不作为判断 turn 结束的主依据。若先写静态 HTML、随后同一 turn 的 `service_healthy` 携带相同 artifactKey/entryPath，则复用同一 artifact tab 并从 file target 升级为 URL target，不能打开两个预览；
- `sandbox_start_service` 默认等待 health terminal（healthy/failed/timeout）后返回；若 provider 选择异步 start，Gateway 必须另发结构化 `service_healthy` event，不能靠轮询文本或日志 URL 触发。

如果一次写入多个 HTML，优先顺序为：

1. tool result 显式标记 `previewRole: "primary"`；
2. 顶层 `index.html`；
3. 最后完成的 HTML；
4. 其余仅生成文件卡。

### 12.3 静态和交互预览分层

基础 HTML：

- 复用当前 `StudioHtmlFilePreview`；
- CSS/图片只从当前 Workspace 读取；
- 不加载半成品。
- 截断、超过预览上限、revision 无法验证或读取失败的 HTML 只展示文件卡/source，不自动执行或渲染；

为了覆盖示例页中的按钮、计数器等原生交互，不能只给当前 DOM iframe 加 `allow-scripts`：死循环会卡 UI，CSP 也不能单独阻止所有 navigation/network side effect。Phase 5 应增加由 Electron main 管理的 `StudioArtifactSandboxView`（独立 ephemeral session/WebContentsView），普通 React renderer 只负责 tab chrome：

- `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true`、无 preload、无 Electron/Node bridge，使用每次 revision 唯一的非持久 partition；
- session `webRequest.onBeforeRequest` 网络层 deny-all；只使用预先由 Workspace transport 读取并内联的 data/blob/local content，不能依赖页面 CSP 自觉；
- `will-navigate`、redirect、`setWindowOpenHandler`、permission、download、protocol handler 全部 deny；`location=`, `sendBeacon`, form submit 和新窗口不能触达外网；
- 注入 CSP，例如 `default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`，作为第二层防御；
- 只允许受控的内联 style/script、data/blob 图片和已经通过 Workspace transport 读取并内联的本地资源；
- sanitizer 必须移除/拒绝外部 `<script src>`、`<link href>`、`iframe/object/embed`、`srcset`、CSS `url()`/`@import` 和 meta refresh；不能只依赖 `sandbox`，因为 sandboxed iframe 仍可能发起网络请求；
- 远程 fetch/WebSocket、跨 iframe 通信和持久 cookie 默认不可用；
- view 有 heartbeat/unresponsive watchdog 和 renderer-process memory/CPU budget；超时、死循环、内存膨胀或 crash 时 main 直接销毁该 webContents 并回退 source/static，不影响 Studio 主 renderer；
- 提供“暂停脚本/仅看静态”切换，脚本异常时自动退回 source/static；
- 首次执行内联脚本时在预览 chrome 显示清晰的“隔离脚本模式”标识和一键静态模式，不用权限弹窗打断；
- 每次 revision 销毁旧 view 并创建新的 opaque/ephemeral execution context，避免旧页面状态污染新版本。

在独立 WebContents、网络拦截和 watchdog 三项未完成前，自动预览只能使用无脚本静态模式；不能先用同 renderer 的 `sandbox="allow-scripts"` 作为过渡上线。

需要真实网络、模块打包或后端的页面：

- 仅 remote Full Access Agent 可调用 `sandbox_start_service`；Default
  明确提示“交互服务需 Full Access”，并继续展示 scripts-off 静态预览；
- 只在 structured service result 为 `healthy` 且 URL 通过当前 Sandbox identity/HTTP(S) 验证后打开右侧 Browser tab；
- `starting/unhealthy/failed`、日志中猜出的 URL 或 raw `localhost` 不自动打开，文件卡提供日志和重试；
- Browser 只接受受控 HTTP/HTTPS；
- 不开放 `file://`；
- 消息中不再内嵌第二个 service iframe。

## 13. Harness 简化建议

### 13.1 已完成的收敛与剩余清理

1. 已删除无生产调用方的 `lib/agent/pi-tools.ts`
   - `adaptAstraFlowToolsToPi`
   - `createPiLocalTools`
   - `createPiPlanTool`
   - Pi builtin coding tools 成为唯一文件/命令面。

2. 已删除 `lib/ai/tools/astraflow-sandbox.ts` 中不可达的
   run/list/read/write/get-host executor
   - 文件/命令面不再维护第二套 harness；
   - `sandbox_start_service` 已改为 Gateway client tool。

3. 已删除 `parseSandboxToolOutput()`
   - service renderer 只消费 `service.v1` structured result，不再用文本正则
     恢复结构。

4. 已删除未接入生产 renderer 的 `render-order.ts` 及其保障测试。

5. 剩余：旧 prompt
   - 删除所有要求模型调用未注册工具的提示。

6. 已删除只有测试引用的 `sortAstraFlowToolsForPromptCache`。

### 13.2 需要拆分的大文件

当前规模：

| 文件 | 行数 | 建议职责 |
| --- | ---: | --- |
| `lib/agent/acp/acp-runtime.ts` | 7,876 | transport/session、tool mapper、file mapper、permission projection、subagent 分拆 |
| `runtime/astraflow-acp/src/agent.mjs` | 2,153 | session orchestration、tool assembly、subagent 分拆 |
| `runtime/astraflow-acp/src/backend.mjs` | 671 | builtin operations、permission facts、tool factory 分拆；OS boundary 不放在这里 |
| `runtime/astraflow-acp/src/stream.mjs` | 514 | ACP forwarding 与 Tool Presentation metadata 分拆 |

建议结构：

```text
lib/agent/acp/
  runtime-session.ts
  transport.ts
  mapper/
    tool-events.ts
    file-changes.ts
    content.ts
  permission-projection.ts

runtime/astraflow-acp/src/
  policy/
    tool-facts.mjs
    path-diagnostics.mjs
  tools/
    builtin-tools.mjs
    service-tool.mjs
  stream/
    acp-forwarder.mjs
    presentation.mjs
```

不要再增加一个通用插件框架；只拆出明确变化轴。

### 13.3 Pi 依赖审计

扩展依赖已经收敛，只保留精确版本 `pi-subagents@0.34.0`；根
`package.json` 与 `runtime/astraflow-acp/package.json` 同步锁定。早期审计
中的 `@hypabolic/pi-hypa`、`context-mode`、`pi-mcp-adapter`、
`pi-web-access`、`pi-workspace-history` 已移除，不再携带旧
`@mariozechner/pi-*` 依赖树。

当前可追踪链路为：

```text
pi-subagents@0.34.0
  -> Desktop activation: lib/agent/pi-packages.ts
  -> ACP activation: runtime/astraflow-acp/src/pi-session.mjs
  -> shipped capability: pi-subagents skill/resources + static slash command
  -> tests: tests/pi-packages.test.ts,
            tests/studio-slash-commands.test.ts,
            runtime/astraflow-acp/test/agent.test.mjs
```

运行时没有激活 `pi-subagents` 的 TUI/background/intercom extension；它只
加载编排 skill/resources，并把可执行 `/status`、`/review`、`/plan`
映射到 AstraFlow ACP 自己的工具链。以后新增 Pi 扩展仍必须同时提供
production activation point、用户能力和唯一能力测试，否则不得进入
依赖、打包脚本或 smoke matrix。

## 14. 分阶段实施

### Phase 0：固定现状和安全门槛

目标：先让断链可测试，避免后续 UI 改动掩盖执行问题。

改动：

- 增加静态测试：prompt 不得引用未注册工具；
- 增加 Host manifest 与实际 tool list 一致性测试；
- 增加真实 ACP 调用链的进程级隔离失败测试；
- 修正当前 fixture 中 `write -> edit` 的错误预期；
- 只为 managed Workspace 用户迁移保留可回滚开关；service、permissions 和 renderer 使用明确 protocol capability/schema version，避免四个长期漂移的布尔 feature flags。

完成标准：

- CI 能明确证明当前 service 不可达；
- CI 能明确证明真实 Pi 文件工具和 bash 是否都经过 OS sandbox；
- 后续任何退化都能被测试捕获。

### Phase 1：Managed Workspace Root

主要文件：

- `electron/main.cjs`
- `lib/agent/acp/workspace.ts`
- 新增 `lib/studio-managed-workspace.ts`
- `lib/studio-default-workspace.ts`
- `lib/studio-db/connection.ts`
- `lib/studio-db/helpers.ts`
- `lib/studio-db/workspaces.ts`
- `lib/studio-types.ts`
- `components/studio-chat-workbench.tsx`
- Workspace/session API

改动：

- 增加 `ASTRAFLOW_MANAGED_WORKSPACES_PATH`；
- Electron main 解析 `~/AstraFlow` 并注入受控 root；
- 事务式重建 `studio_workspaces`、backfill selected/remote origin，为旧未绑定 session 创建 `legacy_local` 记录，并增加 managed allocation 唯一约束；
- API/DB 使用 managed/selected/remote discriminated union，修复 mapper 和独立删除语义；
- 创建 `managed_local` Workspace并实现 mkdir/DB compensation 与启动 reconciliation；
- 增加 parent-owned `AcpStateBroker`，把 Pi session/checkpoint、resource loader、attachments、Gateway file cache 和 sandbox state 与用户 root 分开；
- 取消 home fallback；
- 让 Agent、Terminal、文件树和 Artifact 使用同一 canonical root；
- 旧 session 重新验证后保持 `legacy_local` 路径兼容；过宽或危险 cwd 要求用户迁移，新目录继续时 fork stateOwner。

完成标准：

- 新未绑定任务只在 `~/AstraFlow/<task>` 生成用户文件；
- 新任务不再把用户文件写进 `userData`；旧目录作为显式兼容例外保留；
- `~/AstraFlow` 不出现 `.astraflow/pi`、attachments、Agent/Gateway cache 或 Sandbox HOME；
- 显式本地项目和远程 Workspace 行为不变。

### Phase 2：真实 Pi/ACP 本地 OS sandbox

主要文件：

- `lib/agent/acp/acp-runtime.ts`
- `runtime/astraflow-acp/src/backend.mjs`
- `lib/agent/astraflow-acp-config.ts`
- `lib/agent/sandbox/*`
- `electron/sandbox-command-runner.mjs`
- `scripts/prepare-electron-app.mjs`

改动：

- 给 runner 增加 long-lived stdio 模式，整个 local ACP/Pi 进程在 Default 中由 runner 包装；
- IPC bootstrap 绑定 session/workspace/root/policy，错误 fail closed；
- child 最小 env、credential proxy、control plane/tool egress 分层；
- per-launch 无凭证 HOME/tmp、read-only roots 和版本化静态 egress policy；
- Windows Job/Linux cgroup/macOS 降级约束的进程生命周期；
- 真实 ACP E2E 隔离测试；
- timeout、abort、network、runner crash 和进程组测试；
- packaged app runner/runtime/platform binary smoke。

完成标准：

- Local Default 的真实 Pi `read/write/edit/search/bash` 都无法越界；
- Workspace 内 coding tools 不询问；
- sandbox 初始化失败不会回退到 direct spawn；
- Remote 如实使用单租户 VM 边界，不错误套用本地路径规则。

### Phase 3：Default / Full Access

主要文件：

- `lib/studio-types.ts`
- `lib/studio-db/*`
- session API schema
- `components/studio-chat/composer.tsx`
- `components/studio-chat/status-panel.tsx`
- `lib/i18n.ts`
- runtime permission adapters
- Mobile / Automation types

改动：

- stored/effective/public 三层 V2 类型、schema version、数据库 normalizer 和 `legacy_readonly` 兼容态；
- 唯一 ExecutionPolicy；
- local Full Access grant 绑定 device/environment/workspace/policyVersion，rebind 时重新确认；
- 按 runtime 隔离矩阵映射，未通过 E2E 的 runtime 不启用无询问 Default；
- 模式切换取消旧 run/ACP，再以不可变 policy 重启；
- Desktop `HostActionGateway` 独立拦截 connector/shared-system 重要写操作；
- 停止创建新 allow-always 规则；
- 只显示两个选项。

完成标准：

- Remote Sandbox Default 的 coding tools 权限请求数为 0；
- Local Default 在隔离成立时权限请求数为 0；
- 外部重要操作确认不受影响；
- 旧 readonly 不发生静默权限提升。
- Claude/OpenCode Default 不会被错误映射到宿主 `bypass/allow`；
- remote Full Access rebind 到 local 不会静默获得宿主权限，Mobile/Automation 不能签发 grant；
- coding tools 无询问时，外部 host write 仍被 gateway 确认；
- Remote UI 不再把 `/workspace` 描述成未实现的强隔离边界。

### Phase 4：Service lifecycle

主要文件：

- 新增 `runtime/workspace-gateway/src/service-manager.mjs`
- `runtime/workspace-gateway/src/server.mjs`
- Gateway client / `lib/codebox-runtime.ts`
- `lib/ai/tools/studio.ts`
- `lib/agent/acp/host-tools.ts`
- `runtime/astraflow-acp/src/mcp-tools.mjs`
- `runtime/astraflow-acp/host-tools-manifest.json`

改动：

- Gateway service API；
- `sandbox_start_service` 仅注册到显式 Full Access 且具备 capability 的
  remote sandbox 主 Agent；Default、旧只读、subagent、local 均过滤；
- MCP `structuredContent/_meta` 端到端透传；
- provider public URL resolver；
- start/list/logs/stop、idempotency/fingerprint/explicit replace；
- env allowlist、allocation lock + PORT 注入 + 有界冲突重试、health cancel、graceful shutdown 和 crash reconciliation；
- capability/version 升级和兼容检查。

完成标准：

- Pi 能列出并调用工具；
- 幂等重试、显式替换、健康检查、日志、停止和恢复通过；
- 返回的 URL 是 public URL，不是 Sandbox localhost；
- unhealthy/raw/untrusted URL 不会触发预览；
- prompt 不再引用 `sandbox_get_host`。

### Phase 5：Tool renderer V2 和 HTML 自动预览

主要文件：

- `runtime/astraflow-acp/src/backend.mjs`
- `runtime/astraflow-acp/src/stream.mjs`
- `lib/agent/acp/acp-runtime.ts`
- `lib/agent/events.ts`
- `lib/agent/run-orchestrator.ts`
- `components/studio-message-parts/tool.tsx`
- `components/studio-message-parts/file-output.tsx`
- `components/studio-message-parts/renderer.tsx`
- `components/synara-code-block.tsx`
- `components/studio-chat/right-panel/*`

改动：

- provider/canonical/kind 分离；
- 透传真实 result details；
- event schema 固化 provider/canonical/kind，修复 `getToolName` precedence；
- `file_change` 加 event/source/workspace/run/turn/artifact/toolCall/order/error 和权威 revision；
- 同路径 mutation queue 保证 before/write/after/diff/revision 原子排序；
- full diff 进入有 quota/TTL 的私有 FileMutationStore；
- FileMutationPresentation 唯一入口；
- registry 优先；
- 一个 toolCallId 只有一个容器，主文件卡移出默认关闭的 Worked for；
- transport 先节流/限长，React 再合并；10 行折叠和自动换行；
- discriminated PreviewRequest、run/turn terminal、artifactKey、live watermark、close suppression、turn arbiter、tab reuse 和 revision refresh；
- HTML sanitizer + CSP + 独立 ephemeral WebContents 网络 deny/watchdog + static fallback；
- service URL 进入右侧 Browser；
- 删除消息内重复 iframe。

完成标准：

- `write` 与 `edit` 语义准确；
- 多段 edit 不丢 patch；
- rawInput 不再迫使文件工具退化 Generic；
- 1 MiB write 的 partial payload 保持近似线性且 React 每秒更新不超过 15 次；
- HTML 完成后只自动打开一次；
- 后续编辑原位刷新且不抢 composer 焦点；
- 用户关闭后同任务 revision 不重开；同 turn file → healthy service 只升级一个 tab。

### Phase 6：清理和文档

- 删除死 `pi-tools.ts`；
- 删除旧 Sandbox executor 和失效 prompt；
- 删除重复权限分类与文本 service parser；
- 审计并删除未激活 Pi packages；
- 更新：
  - `docs/local-agent-sandbox.md`
  - `docs/agent-runtime-replatform.md`
  - Workspace Gateway protocol 文档
  - Artifact / Tool Presentation contract

## 15. 验收测试矩阵

### 15.1 Workspace

- [ ] 新建未绑定任务创建 `~/AstraFlow/<stable-task-directory>`；
- [ ] 任务重命名不移动目录；
- [ ] 删除聊天不删除目录；
- [ ] 同一 allocation retry 不会创建两个目录或两条 Workspace 记录；
- [ ] mkdir/DB 任一步失败可补偿，重启能发现并安全处理 orphan；
- [ ] 显式本地项目保持原路径；
- [ ] Remote Workspace 保持 `/workspace/...`；
- [ ] Agent、Terminal、文件树、Review、Markdown 和 Artifact root 一致；
- [ ] 不再回退整个用户 home；
- [ ] `~/AstraFlow` 不出现 ACP/Pi state、attachments、Gateway cache、Sandbox HOME/cache/tmp；
- [ ] 旧 home/root/symlink cwd 不会自动进入 Default；
- [ ] 旧自动 cwd 被记录为 `legacy_local`，迁移新目录时 fork stateOwner；
- [ ] branch/continuation 继续使用正确 `stateOwnerId`，不与 Workspace 生命周期混淆；
- [ ] 两个 session 共用 selected Workspace 时仍有独立 HOME/tmp，缓存不含凭证。

### 15.2 Permission / isolation

- [ ] Remote Default 的 Pi coding tools 不产生 permission request；
- [ ] Local Default 的 Workspace 内 Pi coding tools 不产生 permission request；
- [ ] Local Default 的 Pi `read/write/edit/search/bash` 都不能读写 Workspace 外敏感路径；
- [ ] 并发 symlink swap 仍被 OS sandbox 拒绝；
- [ ] runner 缺失、初始化失败和 IPC 断开均 fail closed；
- [ ] provider/remote MCP/host bridge control plane 和 npm/PyPI tool egress 分离；未知外网、redirect/DNS rebinding、私网和 metadata 被静态拒绝且不弹卡；
- [ ] ACP/bash env 看不到真实 ModelVerse/OAuth/MCP credential，Full Access 也只拿短期 scoped sentinel 且 bash env 被剥离；
- [ ] bash 不能读取或破坏 Desktop-owned continuation state；
- [ ] Windows Job Object、Linux cgroup 和 macOS 降级策略分别通过；不把 process-group kill 冒充任意 daemon 强回收；
- [ ] Full Access 切换有一次明确提示；
- [ ] 切换 Full Access 会结束旧 run，不能热升级正在运行的 ACP；
- [ ] remote→local、workspace/device/policyVersion 变化时 Full Access 重新确认，Mobile/Automation 不能签发 local grant；
- [ ] Remote Full Access 不声称拥有 Desktop 宿主机权限；
- [ ] Remote Default 如实标注 VM 边界，不把 cwd 当隔离；
- [ ] 旧 readonly 会话不自动变可写；
- [ ] Codex/Claude/OpenCode 每个 runtime 的 Default 映射都有独立 E2E，未验证者不会得到宿主 bypass；
- [ ] `promptCodingTools=false` 时外部连接器重要写操作仍在 Desktop HostActionGateway 强制确认。

### 15.3 Service

- [ ] remote Full Access 主 Agent 的 `tools/list` 包含
  `sandbox_start_service`；Default、旧只读、local 和 subagent 不包含，
  stale/direct call 返回明确 Full Access 错误；
- [ ] Full Access 降级或 Sandbox workspace rebind 必须先 owner-scoped
  停止旧 workspace 的全部 service；list/stop/reap 任一未确认成功时
  PATCH fail closed，不能先显示 Default 再遗留 Full Access 进程；
- [ ] cleanup 与 service startup 使用同一 session lock，并在锁内复核
  active run、live permission 与 captured workspace；stale run launch 在
  queued 前复核当前 workspace/runtime/permission；
- [ ] Mobile/Automation 等同步入口不能绕过 cleanup 把 remote Full Access
  直接写成 Default；
- [ ] foreground server command 能成功启动；
- [ ] 相同 idempotency key/fingerprint 不重复启动，变化 spec 必须显式替换；
- [ ] 端口冲突可诊断；
- [ ] manager 用 allocation lock、PORT 注入和有界冲突重试处理并发，不虚假承诺 shell command 的原子 socket 接管；
- [ ] env allowlist 不泄露 Desktop/provider secrets；
- [ ] health failure 返回最近日志；
- [ ] start cancel、health timeout、正常关闭和异常重启 reconciliation 行为确定；
- [ ] structured result 全链路不被 stringify；
- [ ] public URL 正确且绑定当前 Sandbox identity；
- [ ] start/list/logs/stop 都强制 Desktop session owner；跨 session 返回
  not found，旧 ownerless manifest 不列出，删除 session 只 best-effort
  停止该 owner；
- [ ] ACP 重启后状态可恢复或明确标记 stale；
- [ ] Agent 结束不会遗留无法管理的孤儿进程。

### 15.4 File rendering

- [ ] Pi `write` 映射为 `write_file`，Pi `edit` 映射为 `edit_file`；
- [ ] write 新建和覆盖分别识别 create/edit；
- [ ] edit 真实 unified patch 穿过 Pi → ACP → AgentEvent；
- [ ] 多段 edit 不丢任何变更；
- [ ] 快速连续/并发同路径 write/edit 的 diff、order 和 SHA-256 revision 对应真实磁盘内容；
- [ ] 非 tool 文件变更有 eventId 且允许 null toolCallId；
- [ ] 截断 diff 可通过受 quota/TTL 管理的 diffBlobId 打开；无 blob 时明确不可恢复；
- [ ] `rawInput/content` 存在时仍命中专用 renderer；
- [ ] 运行中显示最多 10 行且默认自动换行；
- [ ] 完成后无需展开 Worked for 即可看到恰好一个主文件活动，不重复 raw JSON/diff/card；
- [ ] 1 MiB write 的跨 ACP partial payload 小于 3 MiB、React commit 不超过 15/s。

### 15.5 HTML preview

- [ ] `.html/.htm` 完成后自动打开 rendered preview；
- [ ] 流式半成品不加载；
- [ ] 同路径 revision 原位刷新；
- [ ] pinned tab 不被替换；
- [ ] Terminal/Review 使用中不抢焦点；
- [ ] tab 激活不夺走 composer DOM 焦点；
- [ ] hydration、历史消息重放和应用重开不自动打开；
- [ ] 用户关闭后同一 artifact/run 的后续 revision 不重开，显式用户打开可恢复；
- [ ] run/turn terminal 驱动 arbiter；同一 artifactKey 的静态 HTML 后启动 healthy service 时复用并升级同一 tab；
- [ ] 异步 service 只有结构化 `service_healthy` event 能触发自动打开；
- [ ] 静态文件预览不执行任何脚本、事件处理器或表单行为；
- [ ] external src/link/srcset/iframe/CSS url/@import/meta refresh 均被移除且无网络请求；
- [ ] `location=`, sendBeacon、form/window navigation 不能在静态预览中执行或发请求；
- [ ] 截断、过大或 revision 不可信的 HTML 不自动渲染；
- [ ] interactive app 通过 service URL 和右侧 Browser 运行；
- [ ] unhealthy service、raw localhost 和非法 public URL 不自动打开并可查看日志；
- [ ] Workspace 外文件不自动预览。

## 16. 建议验证命令

实施阶段仍遵循仓库约定，不启动 dev server、不运行完整 build：

```bash
bun run typecheck
bun run lint
bun test tests/local-sandbox-policy.test.ts
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 bun test tests/local-sandbox-integration.test.ts
bun test tests/studio-tool-rendering.test.ts
bun test tests/studio-html-preview.test.tsx
bun test tests/studio-workspace-tabs.test.ts
node --test runtime/astraflow-acp/test/agent.test.mjs
node --test runtime/workspace-gateway/test/server.test.mjs
git diff --check
```

此外，CI 不能只跑当前会静默 skip 的 integration suite。需要在 macOS、Windows、Linux 分别设置 `ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1`，增加真实 Pi → ACP → long-lived runner 测试；release smoke 还要从 packaged Electron 启动一次，验证 `app.asar.unpacked` 中 runner、sandbox runtime 和平台二进制可用且故障时 fail closed。

还应新增一个跨层 E2E fixture：

```text
用户：帮我写一个简单的 HTML 示例
  -> Pi 流式 write
  -> inline 自动换行
  -> write completed + authoritative file_change
  -> 右侧自动打开 rendered preview
  -> Pi edit 同一 HTML
  -> 原 tab revision refresh
  -> 全程无 Sandbox coding permission prompt
```

## 17. 不建议的实现方式

- 不要把整个 `userData` 或现有 `sandbox-workspaces` 搬到 `~/AstraFlow`；
- 不要继续把整个用户 home 当默认 Workspace；
- 不要在整个本地 ACP/Pi 进程进入 OS sandbox 前直接关闭权限询问；
- 不要重新维护第二套 `read_file/write_file/run_command`；
- 不要让模型用 `nohup/tmux/&` 自己管理产品级 preview service；
- 不要让 UI 继续从纯文本工具输出正则提取 URL、端口和文件；
- 不要用 ACP `kind` 代替 tool identity；
- 不要在 React 中重新猜测 runtime 已经能给出的真实 diff；
- 不要在 tool input streaming 阶段自动打开 HTML；
- 不要为复刻截图而开放 Electron `file://` 或带 Node bridge 的 HTML。

## 18. 最终建议

这次可以作为一次明确的“小型 runtime replatform 收尾”，而不是继续局部修补：

1. `~/AstraFlow` 只承载用户任务文件；
2. `userData` 只承载应用与运行时私有状态；
3. Default 是“隔离内无打扰”，Full Access 是“明确关闭本地隔离”；
4. Pi builtin tools 是唯一文件/命令工具面；
5. `sandbox_start_service` 是 remote Full Access 的唯一长服务工具，由
   Gateway 管生命周期、Desktop 解 public URL；Default 在专用 service
   进程沙箱落地前不暴露该工具；
6. Tool Presentation 使用结构化事实驱动 React，不再用字符串和重复模型猜测；
7. HTML 静态安全预览自动打开且始终 scripts-off，需要脚本、真实网络或后端的应用通过 service URL 运行；
8. 完成迁移后删除旧 Pi 直连层和失效 Sandbox 工具。

这样既能得到截图里的顺滑体验，也能避免“为了不弹权限，实际把宿主机静默放开”的安全回归。

## 19. 实施验收记录（2026-07-23）

### 19.1 已落地的实现

1. Managed Workspace

   - 未绑定任务在第一次 Agent run 前事务式分配稳定的
     `~/AstraFlow/<timestamp>-<short-id>` 目录；allocation token、mkdir、
     SQLite 写入和 orphan reconciliation 都有幂等/补偿路径。
   - 显式选择的本地项目不搬迁；远程 Workspace 继续使用远端路径；删除
     会话不删除用户目录。
   - Pi checkpoint、附件、SQLite、runtime HOME/cache/tmp、Gateway state
     都留在 Electron `userData` 或远程 VM 私有 state root，不写入
     `~/AstraFlow`。

2. Default / Full Access

   - Composer 公开选项只包含 Default 与 Full Access。旧
     `legacy_readonly` 仅用于旧数据 fail-closed 展示和迁移，不是新的可选
     模式。
   - 本地 Full Access 由 Electron 签发并校验一次性 grant，绑定
     session、workspace、device、policy version 与有效期；run 进行中不能
     热切换。
   - 本地 Default 不再对 Pi coding tools 逐次询问，整个 ACP/Pi 进程树先
     进入 OS sandbox。初始化、runner、IPC 或策略失败均关闭执行，不回退
     到宿主进程。
   - 远程 Default 文案说明它是单租户 VM 内的 Workspace 进程边界，不把
     `/workspace` 宣称成通用 DLP；Remote Full Access 只关闭 VM 内的
     Bubblewrap，不声称能访问本机。
   - Gateway 仅在 Bubblewrap/socat 可用时宣告
     `agent.astraflow.workspace-confinement.v1`。Desktop 对远程 Default/旧
     只读强制要求该 capability；旧模板 fail closed，Full Access 不要求。

3. Provider、state 与 MCP control plane

   - 本地 Pi、Claude Code ACP、OpenCode ACP、Codex Direct 和 Claude
     Native 的 Desktop-managed ModelVerse 路径只使用 43 字符短期 scoped
     token；真实 provider key 留在 Desktop proxy。OpenCode 通过匿名 fd 3
     读取 token，env/config/argv 不含 bearer；Linux runner 在
     session-private `TMPDIR` 中用随机 `0700` 目录 + `0600` FIFO 交付 fd 3，
     并在 `exec` 前 unlink，用户 Workspace 不落瞬时节点。Claude Code 开启
     subprocess env scrub，Pi bash 也会再次剥离 token。
   - 本地 Default 的 provider egress 使用精确 loopback host + port；
     npm/PyPI 只加入精确的 443 endpoint。未知目的地不触发用户审批并直接
     拒绝。
   - Pi checkpoint 通过 Desktop-owned `AcpStateBroker` 加密、限额、原子
     持久化；state root、master key 与 migration metadata 不进入 ACP
     child。
   - 用户安装的 MCP HTTP/SSE headers 与 stdio command/env 只在 Desktop
     bridge 内存在。runtime 没有 `mcpCapabilities.acp` 时连接器 fail
     closed，并产生不含秘密的 `unavailableMcpConnectors` 诊断。
   - HTTP/SSE MCP 与 Gateway model proxy 都校验全部 DNS answer、拒绝
     private/special-use/metadata/mixed answer，并对已验证地址做 DNS pin。

4. Sandbox service

   - `sandbox_start_service` 已进入版本化 host-tool manifest，只对显式
     Full Access 且具备 `service.lifecycle.v2` 的 remote Sandbox 主 Agent
     注册；Default、旧只读、local、subagent 和无 capability runtime 均
     不可见/不可调用。Default 仍支持 scripts-off 静态 HTML 预览。
   - Pi → ACP MCP bridge → Desktop → Workspace Gateway 全链路保留
     `service.v1` structured result。右侧 service card 使用身份绑定的
     list/logs/stop relay，不从文本猜 URL。
   - Gateway 实现 allocation lock、PORT 注入、有界端口重试、spec
     fingerprint/idempotency、显式 replacement、health/logs、env
     allowlist、HTTP disconnect cancel，以及 TERM→KILL；全部 service
     identity、查询和操作绑定 Desktop 注入的 session owner，ownerless
     旧 manifest fail closed。
   - Full Access 降级或 Sandbox workspace rebind 在和 service startup 相同
     的 session lock 内执行 owner-scoped cleanup；list/stop/reap 未确认时
     阻止配置切换。删除 session 保持 best-effort cleanup。
   - Linux/macOS 只在 listener 属于 root command 的 POSIX process group
     且绑定 `0.0.0.0`/`::` 时报告 healthy。restart 只把旧 manifest 标记
     `GATEWAY_RESTART_UNVERIFIED`，不会 kill 未验证 PID；无法证明 reap
     时返回 `SERVICE_REAP_FAILED`。Windows 当前不广告该 capability。

5. Tool rendering 与右侧预览

   - Pi `write/edit` 保留 provider identity，同时映射到 canonical
     `write_file/edit_file` presentation。一个 `toolCallId` 只产生一个主
     activity；known tool 不会因 `rawInput/content` 回退为 raw JSON。
   - `FileMutationStore` 串行化同一路径 revision，记录 SHA-256、order、
     create/edit/delete、行数统计和 bounded diff。截断 diff 使用与
     session/path/revision 绑定并受 TTL/quota 管理的 `diffBlobId` 延迟加载。
   - 流式 write 预览有字节/频率限制、默认自动换行且只展示有限行；完成后
     由 authoritative file card 取代重复 tool/result/diff 卡片。
   - `.html/.htm` 只在可信的完成态 revision 自动打开。相同 artifact 原
     tab 刷新，pinned/Terminal/Review 不被抢占，关闭 suppression 按
     run + artifact 记录，显式打开可恢复。
   - 静态 HTML 采用 scripts-off sanitizer + deny-by-default CSP，移除
     script、handler、frame、refresh、外链与表单提交属性，并内联或清除
     CSS network source；保留的 form 控件由空 iframe sandbox 与
     `form-action 'none'` 保持不可提交。需要 JavaScript/网络/后端的页面
     只能在 remote Full Access 下通过 healthy service URL 在右侧 Browser
     guest process 运行。

6. 收敛与删除

   - 删除无生产调用方的 `lib/agent/pi-tools.ts` 与
     `scripts/astraflow-mcp-stdio-wrapper.mjs`，移除 packaging/check/smoke
     引用和不再使用的 Pi workspace-history package 依赖。
   - Pi builtin coding tools 是唯一文件/命令面；产品工具统一走
     Desktop host bridge + `HostActionGateway`，不再维护第二套
     `read/write/edit/run_command` harness。

### 19.2 当前工作树验证

以下命令均在未启动 dev server、未运行完整 build 的前提下通过：

```bash
bun run typecheck
bun run lint
bun run test:astraflow-agent
bun run test:automations
bun run test:studio-workspaces
bun run smoke:workspace-gateway
node --test tests/astraflow-acp-local-sandbox.node.test.mjs
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 \
  bun test tests/local-sandbox-integration.test.ts
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 \
  bun test tests/opencode-local-sandbox.test.ts
bun test tests/local-full-access-grant.test.ts \
  tests/agent-provider-proxy.test.ts \
  tests/external-agent-provider-proxy.test.ts \
  tests/studio-tool-rendering.test.ts \
  tests/studio-auto-preview.test.ts \
  tests/studio-html-preview.test.tsx \
  tests/studio-workspace-tabs.test.ts \
  tests/studio-workspace-service.test.ts \
  tests/studio-session-service-transition.test.ts \
  tests/studio-workspace-service-cleanup.test.ts \
  tests/studio-file-mutation-route.test.ts \
  tests/studio-review-diff.test.tsx \
  tests/opencode-local-sandbox.test.ts \
  tests/acp-state-key.test.ts \
  tests/local-sandbox-policy.test.ts \
  tests/safe-web-fetch.test.ts
git diff --check
```

测试数量会随 contract case 增加，因此不在完成态文档中固化总数；以上命令
及其退出码是验收依据。当前工作树所有非 skip case 均通过。macOS 开发机上
Workspace Gateway 明确跳过 Linux-only adversarial confinement case 和两个
PTY platform case；真实 OS sandbox/OpenCode integration 由显式环境变量
开启，release CI 仍需在各目标平台执行。

### 19.3 明确保留的边界与 release gate

- Remote Sandbox VM 本身及其 terminal 仍是可联网的单租户 VM 边界，不是
  DLP；但 Remote AstraFlow Default/旧只读 Agent child 位于无通用 egress
  的 network namespace，只能通过 per-run bridge 连接 Gateway model proxy。
  Gateway 将 Desktop 传入 AstraFlow、Codex、Claude Code、OpenCode 的模型
  key 收敛到 per-run loopback proxy；OpenCode 的 scoped bearer 只经匿名 fd
  交付并在 OpenCode 配置加载时消费，后续 shell 子进程既不继承该 fd，也
  读不到 bearer。VM terminal、Full Access、其他 runtime 以及用户显式配置
  的凭证仍属于各自的 VM/network 信任边界。
- npm/PyPI 虽然限定精确 443 endpoint，仍对完整本地 ACP 进程树开放，
  不是 install-only broker；Local Default 不能宣传成通用防外传模式。
- Linux/macOS service lifecycle 的所有权单位是 POSIX process group，
  不是 cgroup/Job Object。产品拒绝常见 daemon wrapper，但不能把
  process-group kill 宣称成对恶意 `setsid()` 后代的绝对回收；远程 VM
  teardown 是外层边界。
- 当前 service process 仍在远程 VM 中 direct spawn，没有复用 Agent
  Bubblewrap；因此工具只对显式 Full Access 暴露。Default 要重新开放交互
  service，必须先实现兼容监听端口/health/public-host 的专用 service
  sandbox，不能依赖工具说明或 cwd 检查。
- Windows Local Default 在 stable-CA credential masking 可用前 fail
  closed；Windows service lifecycle 在 Job Object supervisor 落地前不
  广告。不会自动降级到 Full Access。
- macOS/Linux/Windows 的 packaged Electron、`app.asar.unpacked` runner
  与平台 runtime 仍需 release CI 分别执行真实 smoke。第 15 节对应的
  cross-platform 项目保持未勾选，不能只凭当前 macOS 开发机测试放行。
