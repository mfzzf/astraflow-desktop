# Studio 工作区类型与 Code 沙箱绑定修复方案

状态：Implemented（核心代码与自动化验证已完成；真实 UCloud Sandbox E2E 与新模板部署待执行）

日期：2026-07-13

关联分支：`codex/remote-code-sandbox`

关联方案：[`internal-remote-code-sandbox-architecture.md`](./internal-remote-code-sandbox-architecture.md)

## 1. 本次结论

Studio 需要明确区分三个实体，不能再用“会话是否碰巧绑定过 Sandbox”推断工作区类型：

1. **Code 沙箱**：由“Code 沙箱”页面管理的远程计算容器，可运行、暂停、恢复或销毁。
2. **工作区**：一个可工作的目录，类型固定为 `local` 或 `sandbox`。
3. **任务 / 会话**：归属于某个工作区的聊天和 Agent 执行记录。

工作区的准确含义是：

```text
本地工作区 = 本机上的一个目录
沙箱工作区 = 某个已有 Code 沙箱中的一个目录
```

因此，“新建沙箱工作区”不应该创建 Code 沙箱，而应该：

1. 选择一个已有 Code 沙箱；
2. 在该沙箱内选择一个目录；
3. 将 `sandboxId + rootPath` 保存为一个 Studio 工作区。

一个 Code 沙箱可以包含多个工作区，例如：

```text
Code 沙箱 sandbox-01
├── /workspace/project-a      -> 工作区 A
├── /workspace/project-b      -> 工作区 B
└── /workspace/experiments/x  -> 工作区 C
```

工作区类型一旦创建就保持不变。切换工作区意味着切换整套文件、终端和 Agent 执行上下文，而不是只切换一个 UI 标签。

## 2. 已发现的问题

### 2.1 本地工作区被误识别成 Sandbox 工作区

截图中“当前文件夹位置查询”同时出现于：

- 顶层工作区列表，并带有 `SANDBOX` 标记；
- 本地 `Desktop` 工作区下面的任务列表。

这是同一个会话被同时判定为两种类型，不是单纯的展示重复。

当前 `getStudioRemoteWorkspaceSummary()` 只检查 `studio_session_sandboxes` 是否存在记录。只要某个会话曾触发远程文件或远程终端接口，就可能被展示为 Sandbox 工作区，即使它已经通过 `projectId` 绑定了本地目录。

### 2.2 文件、终端和 Agent 出现“分裂工作区”

截图中同一页面出现了两个不同的当前目录：

- Agent 执行 `pwd` 得到 `/Users/zzf/Desktop`；
- 右侧终端连接到远程 Sandbox，并位于 `/workspace`。

这意味着页面标题、本地项目、Agent、文件面板和终端没有共享同一个工作区来源。用户看到的是本地工作区，但右侧能力实际操作的是另一台远程机器。

这是高风险问题：用户可能在错误的文件系统中查看、编辑或执行命令。

### 2.3 远程接口会把普通会话自动变成 Sandbox 会话

当前调用链为：

```text
右侧远程文件/终端
  -> /api/studio/sessions/:sessionId/workspace/*
  -> ensureStudioRemoteWorkspace(sessionId)
  -> getOrCreateSessionSandbox(...)
```

`ensureStudioRemoteWorkspace()` 在没有绑定时会创建或绑定 Sandbox。于是，一个本地会话仅仅因为打开了右侧终端，就可能新增 `studio_session_sandboxes` 记录，随后又被侧栏识别成 Sandbox 工作区。

类型识别因此依赖一次有副作用的运行时操作，形成循环错误：

```text
误走远程终端
  -> 自动绑定 Sandbox
  -> 被识别为 Sandbox 工作区
  -> 后续继续走远程文件和终端
```

### 2.4 “工作区”和“任务”被实现成了同一个实体

当前 `POST /api/studio/remote-workspaces` 会同时：

1. 创建一个 `studio_session`；
2. 创建一个新的 Code Sandbox；
3. 将 Sandbox 绑定到该会话。

这会导致侧栏中的远程“工作区”本质上仍是一条任务 / 会话记录。它无法自然支持：

- 一个工作区下面有多个任务；
- 一个 Sandbox 中选择不同文件夹作为不同工作区；
- 删除工作区但保留 Code 沙箱；
- 在工作区之间切换而不创建新会话。

### 2.5 新建工作区错误地拥有了 Sandbox 生命周期

Studio 新建工作区当前直接调用 `createCodeBoxSandbox()`，失败回滚时还可能调用 `killCodeBoxSandbox()`。

正确的所有权应当是：

- “Code 沙箱”页面负责创建、暂停、恢复、重命名和销毁 Sandbox；
- Studio 工作区只引用已有 Sandbox；
- 删除 Studio 工作区只解除绑定，不得销毁 Code 沙箱；
- 使用暂停中的 Sandbox 时允许 auto-resume。

### 2.6 Gateway 缓存无法正确支持同一 Sandbox 的多个目录

当前 Workspace Gateway 连接以 `sandboxId` 为缓存键，但启动参数中的 `ASTRAFLOW_WORKSPACE_ROOT` 又取决于传入的 `workspacePath`。

如果同一 Sandbox 的工作区 A 先以 `/workspace/project-a` 启动 Gateway，工作区 B 再请求 `/workspace/project-b`，缓存可能继续复用 A 的根目录。反过来重启 Gateway 又会中断 A。

因此不能简单地把不同工作区目录继续作为 Gateway 进程根目录。

### 2.7 Agent 写入目录与打开的 Sandbox 工作区不一致，导致文件渲染消失

最新截图中，页面打开的 Sandbox 工作区和右侧终端根目录是 `/workspace`，但 Agent 实际执行命令和生成文件的位置是：

```text
/home/user/astraflow
```

生成的 PPTX 和脚本也落在该目录：

```text
/home/user/astraflow/ppt-skill-test.pptx
/home/user/astraflow/create-test-ppt.js
```

当前远程文件面板与文件卡片却把可访问根目录硬编码为 `/workspace`。例如：

- `lib/ai/tools/astraflow-sandbox.ts` 仍把 `/home/user/astraflow` 作为命令、文件和输出的默认目录；
- `components/studio-message-parts/file-output.tsx` 使用固定的 `REMOTE_STUDIO_WORKSPACE_PATH`（`/workspace`）解析并检查生成文件；
- `lib/studio-markdown-artifacts.ts` 会拒绝不在当前允许根目录内的绝对路径。

所以 PPTX 虽然真实存在，但文件卡片无法通过 `/workspace` 的 Gateway `stat/read` 找到它，原有的 PPTX、DOCX、PDF、表格、图片等文件渲染入口就不会出现。这不是渲染组件被删除，而是生成文件落在了 UI 无法访问的另一棵目录树中。

该问题与终端串线属于同一个根因：Agent、终端、文件系统和 Artifact resolver 没有使用同一个 canonical workspace root。

## 3. 正确的领域模型

### 3.1 StudioWorkspace 使用显式判别联合

前后端统一使用显式类型，不再通过 `projectId`、`remoteWorkspace` 或 Sandbox 绑定记录猜测类型。

```ts
type StudioWorkspace =
  | {
      id: string
      type: "local"
      name: string
      rootPath: string
      localProjectId: string
      createdAt: string
      updatedAt: string
      lastOpenedAt: string | null
    }
  | {
      id: string
      type: "sandbox"
      name: string
      rootPath: string
      sandboxId: string
      createdAt: string
      updatedAt: string
      lastOpenedAt: string | null
    }
```

关键约束：

- `type` 创建后不可隐式改变；
- `local` 必须有 `localProjectId`，不得有 `sandboxId`；
- `sandbox` 必须有 `sandboxId`，不得有 `localProjectId`；
- `sandboxId + rootPath` 在同一用户下应唯一；
- `rootPath` 必须是已存在的目录；
- Sandbox 工作区目录必须位于该 Code 沙箱允许的 Gateway 根目录内；
- 一个工作区可以关联多个任务 / 会话；
- 一个 Code 沙箱可以关联多个不同目录的工作区。

### 3.2 StudioSession 只引用 Workspace

`studio_sessions` 增加 `workspace_id`：

```text
studio_sessions.workspace_id -> studio_workspaces.id
```

任务不再自行决定本地或远程。任务的文件系统、终端和运行位置全部继承所属工作区。

迁移期可以暂时保留 `project_id`，但新逻辑只把它当兼容字段，不能再作为类型判断的主来源。

### 3.3 `studio_session_sandboxes` 不再表示工作区类型

该表目前记录“某个会话绑定了某个 Sandbox”，但它可能来自 Agent 执行、旧沙箱机制或本次错误触发的远程终端。

修复后：

- 不允许用该表判断侧栏是否显示 `SANDBOX`；
- Studio Sandbox 工作区使用独立的 `studio_workspaces.sandbox_id`；
- 如果旧的按会话执行 Sandbox 仍需保留，该表仅服务于旧执行机制；
- 远程文件和终端不得再通过该表自动创建工作区。

## 4. 工作区类型是传输层的唯一来源

工作区类型必须同时控制文件、终端、Agent、Git、预览和路径显示。

| 能力 | 本地工作区 | Sandbox 工作区 |
| --- | --- | --- |
| 根目录 | 本机绝对路径 | 既有 Sandbox 内选定目录 |
| 文件目录 | Electron 本机文件桥接 | Gateway HTTP |
| 文件读取/预览 | Electron 本机文件桥接 | Gateway HTTP |
| 终端 | Electron 本机 PTY | Gateway WebSocket PTY |
| Agent cwd | 本机工作区目录 | Sandbox 工作区目录 |
| Git / Review | 本机 Git | Gateway Git API |
| 生成文件与预览 | 从本地工作区读取并渲染 | 从选定 Sandbox 工作区读取并渲染 |
| 系统打开 / Finder | 支持 | 不支持，改为 Code Server/下载 |
| Sandbox auto-resume | 不适用 | 首次访问时执行 |

以下混用必须被禁止：

- 本地工作区 + 远程终端；
- 本地工作区 + 远程文件树；
- Sandbox 工作区 + 本机 `node-pty`；
- Sandbox 工作区 + 本机文件读取；
- 同一任务中 Agent cwd 与右侧终端根目录不一致。
- Agent 把用户文件写到 Workspace root 之外，再让 UI 从另一目录读取；
- 仅因绝对路径无法解析就静默丢失文件卡片或预览入口。

Composer 当前的“本地 / 远程”环境选择不能独立覆盖工作区类型。进入已绑定工作区后，应由 `workspace.type` 派生执行模式：

```text
workspace.type = local   -> local transport
workspace.type = sandbox -> sandbox transport
```

模型、权限模式等仍可独立选择，但工作区传输模式不可在任务内部随意切换。

## 5. 新建工作区交互

### 5.1 第一步：选择工作区类型

保留两个入口：

- 本地文件夹
- Code 沙箱文件夹

### 5.2 本地工作区

流程：

1. 调用 Electron 文件夹选择器；
2. 校验目录存在且可访问；
3. 创建或复用 `studio_local_projects`；
4. 创建 `type = local` 的 `studio_workspaces`；
5. 打开工作区，但不强制创建任务。

### 5.3 Sandbox 工作区

流程：

1. 调用已有 `GET /api/codebox/sandboxes?state=all` 获取当前账号已有 Sandbox；
2. 展示运行中、已暂停和未知状态，禁止在此处直接创建 Sandbox；
3. 用户选择一个 Sandbox；
4. 如 Sandbox 已暂停，在浏览目录或确认时通过 `Sandbox.connect()` auto-resume；
5. 复用目录浏览接口选择该 Sandbox 内的文件夹；
6. 校验目录位于允许的 Gateway 根目录下；
7. 创建 `type = sandbox` 的 Studio 工作区绑定；
8. 打开工作区，但不强制创建任务。

没有可用 Sandbox 时显示明确空状态：

```text
暂无可用 Code 沙箱
[前往 Code 沙箱创建]
```

该按钮导航到 Code 沙箱页面。用户创建完成后返回并刷新列表。

### 5.4 建议的选择器信息

Sandbox 列表至少显示：

- Sandbox 名称；
- 状态：运行中 / 已暂停 / 未知；
- `sandboxId` 的短格式；
- 默认工作目录；
- 最近使用时间；
- 可选仓库来源。

目录选择器复用现有 `WorkspaceDirectoryDialog` 的浏览能力，但 Studio 模式下只允许选择 Gateway 允许范围内的目录。

## 6. Gateway 根目录策略

为了支持“一个 Sandbox 包含多个工作区目录”，每个 Sandbox 只运行一个稳定的 Gateway：

```text
Gateway root = Code 沙箱的基础工作目录，通常为 /workspace
Workspace root = Gateway root 下的某个子目录
```

例如：

```text
Gateway root:   /workspace
Workspace root: /workspace/project-a
```

桌面控制面保存工作区相对前缀 `project-a`。每次调用 Gateway 时：

```text
用户请求的工作区相对路径
  -> 与 project-a 前缀安全拼接
  -> 发送给 Gateway
```

必须同时做两层路径校验：

1. Desktop/BFF 校验请求不能逃出选定的 Workspace root；
2. Gateway 校验最终路径不能逃出其 Sandbox Gateway root。

终端创建时 cwd 固定从选定 Workspace root 开始。

当前以 `sandboxId` 缓存 Gateway 连接的方式可以保留，但缓存的 Gateway root 必须稳定，不能再随某个 Studio Workspace 的 `rootPath` 改变。

### 6.1 Canonical Workspace Root 契约

打开工作区后必须只生成一个 canonical root，并把它注入所有能力：

```text
workspace.rootPath
  = Agent 默认 cwd
  = Terminal 初始 cwd
  = 文件树根目录
  = Git/Review 根目录
  = Markdown 相对路径根目录
  = 用户可见生成文件的允许根目录
```

Sandbox 工作区示例：

```text
选中的 Workspace root: /workspace/project-a

Agent pwd:               /workspace/project-a
Terminal pwd:            /workspace/project-a
文件树 root:             /workspace/project-a
PPT 输出:                /workspace/project-a/outputs/demo.pptx
```

`/home/user/astraflow` 可以继续存放 Agent runtime、Skill 缓存或内部临时文件，但不能再作为用户项目和用户可见 Artifact 的默认输出目录。运行时私有目录与产品工作区必须明确分离。

Agent 工具初始化时应接收 `workspaceId` 和 `workspaceRoot`，删除代码工作区执行路径中对 `/home/user/astraflow` 的硬编码默认值。用户未指定输出路径时，生成文件应落在工作区内的统一输出目录，例如 `<workspaceRoot>/outputs`。

### 6.2 恢复文件卡片和 Artifact 渲染

现有 `StudioBinaryFilePreview`、`StudioStructuredTextFilePreview` 以及 PPTX renderer 等渲染能力应保留并重新接入 Workspace transport，不重新实现一套渲染器。

建议将聊天消息中的文件引用先归一化为稳定的 Artifact 引用：

```ts
type StudioWorkspaceArtifact = {
  workspaceId: string
  relativePath: string
  name: string
  mimeType: string | null
  size: number | null
  source: "tool" | "markdown" | "generated"
}
```

渲染流程统一为：

```text
工具输出或 Markdown 文件路径
  -> 按当前 Workspace root 解析成 relativePath
  -> 通过 Workspace transport 执行 stat/read
  -> 创建文件卡片
  -> 使用已有 PPTX/DOCX/PDF/XLSX/图片/文本渲染器预览
```

必须覆盖三类来源：

1. `write_file` / `edit_file` 等结构化工具输出；
2. Assistant Markdown 中出现的绝对或相对文件链接；
3. Skills、脚本和媒体工具生成但没有 `write_file` activity 的文件。

不能只依赖 Assistant 是否正确输出 Markdown 链接。只要工具返回了有效 Artifact 路径，就应生成可打开的文件卡片。

对于历史消息中的 `/home/user/astraflow/...` 文件：

- 如果该文件仍在同一个 Sandbox 且确认属于当前工作区，可提供显式“复制到工作区”恢复动作；
- 不得把 Workspace root 临时扩大到 `/home/user`；
- 不得静默隐藏，应显示“文件位于当前工作区之外，无法预览”的明确状态；
- 新生成文件必须从源头写入 canonical Workspace root，不继续制造这种路径。

## 7. API 调整建议

### 7.1 工作区管理

```text
GET    /api/studio/workspaces
POST   /api/studio/workspaces
GET    /api/studio/workspaces/:workspaceId
PATCH  /api/studio/workspaces/:workspaceId
DELETE /api/studio/workspaces/:workspaceId
```

创建请求使用判别联合：

```json
{
  "type": "local",
  "path": "/Users/me/project"
}
```

```json
{
  "type": "sandbox",
  "sandboxId": "sandbox-123",
  "rootPath": "/workspace/project-a",
  "name": "project-a"
}
```

Sandbox 创建请求只建立引用，不得调用 `createCodeBoxSandbox()`，失败回滚也不得调用 `killCodeBoxSandbox()`。

### 7.2 文件和终端改为 Workspace 作用域

将当前以 `sessionId` 为入口的工作区接口迁移为以 `workspaceId` 为入口：

```text
GET    /api/studio/workspaces/:workspaceId/fs/entries
GET    /api/studio/workspaces/:workspaceId/fs/file
POST   /api/studio/workspaces/:workspaceId/terminals
DELETE /api/studio/workspaces/:workspaceId/terminals/:terminalId
```

服务端先读取显式 `StudioWorkspace`：

- `type = local`：远程 HTTP 路由拒绝请求；Renderer 使用 Electron 本地桥接；
- `type = sandbox`：校验 Sandbox 所有权和目录后连接 Gateway；
- 不存在或类型不匹配：返回 `409 WORKSPACE_TYPE_MISMATCH`，绝不自动创建 Sandbox。

### 7.3 CodeBox API 复用

可以复用：

```text
GET /api/codebox/sandboxes?state=all
GET /api/codebox/sandboxes/:sandboxId/directories?path=...
```

但在作为 Studio 产品入口前，需要补齐 `requireAuthenticatedRequest()` 和当前账号 / 项目所有权校验。

## 8. 数据库建议

新增 `studio_workspaces`：

```sql
CREATE TABLE studio_workspaces (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('local', 'sandbox')),
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  local_project_id TEXT,
  sandbox_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  CHECK (
    (type = 'local' AND local_project_id IS NOT NULL AND sandbox_id IS NULL)
    OR
    (type = 'sandbox' AND sandbox_id IS NOT NULL AND local_project_id IS NULL)
  )
);
```

`studio_sessions` 增加：

```sql
workspace_id TEXT REFERENCES studio_workspaces(id) ON DELETE SET NULL
```

建议索引：

```sql
CREATE INDEX studio_sessions_workspace_id_idx
  ON studio_sessions(workspace_id, updated_at DESC);

CREATE UNIQUE INDEX studio_workspaces_local_unique_idx
  ON studio_workspaces(local_project_id)
  WHERE type = 'local';

CREATE UNIQUE INDEX studio_workspaces_sandbox_path_unique_idx
  ON studio_workspaces(sandbox_id, root_path)
  WHERE type = 'sandbox';
```

## 9. 现有数据迁移与污染修复

### 9.1 可以安全自动迁移的数据

- `studio_local_projects` 每条记录创建一个 `local` Workspace；
- 有 `project_id` 的 session 绑定对应 Local Workspace；
- 同一个本地目录只创建一个 Workspace。

### 9.2 不能直接按 Sandbox 绑定自动迁移的数据

`studio_session_sandboxes` 不能作为 Remote Workspace 的可靠来源，因为记录可能来自：

- 旧的按会话远程执行；
- 当前错误的右侧远程终端；
- 当前错误的远程文件面板；
- 新版“远程工作区”创建流程。

迁移规则应保守：

1. session 有 `project_id` 时始终按本地工作区处理；
2. 即使它还有 `studio_session_sandboxes` 记录，也不得显示 `SANDBOX` 标记；
3. 不自动 kill 对应 Sandbox；
4. 不在首次迁移时静默删除冲突绑定；
5. 对 `project_id IS NULL + sandbox binding` 的记录生成候选清单，确认后再导入为 Sandbox Workspace；
6. 新 schema 上线后只允许通过显式工作区创建接口产生 Sandbox Workspace。

对于截图中的重复会话，修复后的展示规则应立即做到“本地优先且只出现一次”。历史 Sandbox 绑定的清理应作为独立、可审计的数据修复步骤。

## 10. 侧栏和页面行为

侧栏层级统一为：

```text
工作区
├── Desktop                         LOCAL
│   ├── 当前文件夹位置查询
│   └── 移动端 · 2026/7/13
└── project-a                       SANDBOX
    ├── 修复登录流程
    └── 增加单元测试
```

规则：

- `SANDBOX` 标记只显示在 `workspace.type === "sandbox"` 的工作区行；
- 本地工作区可不显示标记，或显示低干扰的 `LOCAL`；
- 任务行不再重复显示为顶层工作区；
- 点击工作区切换整套文件/终端/Agent 上下文；
- 点击任务只切换该工作区内的会话；
- 页面标题旁显示工作区名称和类型，方便确认当前上下文。

## 11. 修复实施顺序

### Phase 0：先阻止继续污染

1. 远程文件/终端入口在没有显式 Sandbox Workspace 时返回类型错误；
2. 禁止 `ensureStudioRemoteWorkspace()` 为普通 session 自动创建 Sandbox；
3. 侧栏不再以 `studio_session_sandboxes` 推断工作区类型；
4. 本地 session 即使有冲突 Sandbox 绑定，也只显示在本地工作区下。

### Phase 1：建立独立 Workspace 实体

1. 新增 `studio_workspaces` 和 `studio_sessions.workspace_id`；
2. 增加判别联合类型和 repository/API；
3. 迁移本地项目与 session；
4. 将侧栏改为 Workspace -> Session 层级。

### Phase 2：改造新建工作区流程

1. 本地模式选择本机文件夹；
2. Sandbox 模式列出已有 Code 沙箱；
3. 选择 Sandbox 后浏览并选择目录；
4. 保存引用，不创建或销毁 Sandbox；
5. 暂停 Sandbox 在访问时 auto-resume。

### Phase 3：双传输层恢复

1. Local Workspace 恢复 Electron 本机文件桥接；
2. Local Workspace 恢复仅供本地模式使用的本机 PTY；
3. Sandbox Workspace 保持 Gateway HTTP/WSS；
4. Git、Review、文件预览和 Markdown 资源解析全部按 Workspace type 路由；
5. 移除所有硬编码“Studio 一律使用 `/workspace`”或“Agent 一律使用 `/home/user/astraflow`”的用户工作目录；
6. 将 `workspaceRoot` 注入 Agent 工具、终端、文件树、Git 和 Artifact resolver；
7. 恢复 PPTX、DOCX、PDF、XLSX、图片及文本文件卡片和右侧预览。

### Phase 4：Gateway 多目录支持

1. Gateway root 固定为 CodeBox 基础工作目录；
2. BFF 为每个 Studio Workspace 施加目录前缀；
3. 校验多工作区同 Sandbox 并发时不会互相改写根目录；
4. Terminal cwd、文件读取和文件监听都限制在选定目录内。

### Phase 5：迁移与清理

1. 输出冲突绑定报告；
2. 对本地 session 的误绑定做可审计清理；
3. 对旧远程候选工作区提供确认/导入；
4. 清理旧 `/api/studio/remote-workspaces` 和 session-scoped workspace 接口。

## 12. 验收标准

### 类型与展示

- [x] 本地工作区永远不会出现 `SANDBOX` 标记；
- [x] 同一个任务不会同时出现在顶层 Sandbox 列表和本地工作区下；
- [x] Sandbox 工作区必须能追溯到明确的 `workspaceId + sandboxId + rootPath`；
- [x] 工作区与任务在数据和 UI 中是两个实体。

### 本地工作区

- [x] 选择 Desktop 后，文件树读取本机 Desktop；
- [x] 右侧终端 `pwd` 与本地工作区根目录一致；
- [x] Agent `pwd`、终端 `pwd`、文件树根目录三者一致；
- [x] 打开本地终端不会创建任何 Sandbox 绑定；
- [x] 本地文件可以使用系统应用打开或在 Finder/Explorer 中显示。

### Sandbox 工作区

- [x] 新建流程只列出已有 Code 沙箱，不创建新 Sandbox；
- [x] 可以选择 Sandbox 内的子目录作为工作区；
- [ ] 已暂停 Sandbox 在打开目录/终端时自动恢复（连接链路已实现，真实 UCloud E2E 待验证）；
- [x] 文件树、终端和 Agent 都位于选定子目录；
- [x] Agent 默认 `pwd` 与 Workspace root 完全一致，不再落到 `/home/user/astraflow`；
- [x] 删除 Studio 工作区不会 kill Code 沙箱；
- [x] 同一 Sandbox 的两个不同目录可同时作为工作区，互不串目录（自动化路径隔离已通过，真实并发 E2E 见第 13 节）。

### 文件生成与渲染

- [ ] 在 Sandbox 工作区生成 PPTX 后自动显示文件卡片，并可打开幻灯片预览（代码与 Artifact 测试已通过，真实生成 E2E 待验证）；
- [x] DOCX、PDF、XLSX、图片、Markdown、HTML 和普通代码文件继续使用已有渲染能力；
- [x] 工具返回的文件路径即使没有写进 Markdown，也能生成 Artifact 卡片；
- [x] Markdown 相对路径以当前 Workspace root 解析；
- [x] 本地文件通过 Local transport 预览，Sandbox 文件通过 Gateway transport 预览；
- [x] Agent、终端、文件树和 Artifact resolver 对同一文件得到一致路径；
- [x] Workspace root 外的历史文件显示明确错误或迁移动作，不再静默消失；
- [x] 生成文件后刷新文件树即可在选定 Workspace 目录中看到该文件。

### 安全与错误处理

- [x] Local Workspace 请求远程 Gateway API 时返回明确的类型冲突错误；
- [x] Sandbox Workspace 不会调用本机文件 IPC 或本机 PTY；
- [x] 任意 `..`、符号链接或编码路径都不能逃出 Workspace root；
- [x] 只能选择当前账号有权访问的 Code 沙箱；
- [x] 连接失败不会改变工作区类型，也不会新建 Sandbox。

## 13. 实施结果与待部署项

本方案已于 `codex/remote-code-sandbox` 分支实施，已落地：

- 显式 `StudioWorkspace` 判别联合、`studio_workspaces` 表、`studio_sessions.workspace_id` 及本地数据迁移；
- Workspace CRUD，以及 Workspace 作用域的文件、终端和 Git Review API；
- 侧栏 `Workspace -> Session` 层级，`SANDBOX` 标记只由 `workspace.type` 决定；
- 新建工作区支持本地目录，或选择已有 Code Sandbox 中的目录，不在 Studio 中创建或销毁 Sandbox；
- Local 文件 / 预览 / 系统打开 / `node-pty` 与 Sandbox Gateway HTTP / WebSocket 双传输层；
- 每个 Sandbox 的 Gateway root 固定，BFF 对 Workspace 子目录施加前缀与边界校验；
- Agent cwd、终端 cwd、文件树、Git Review 和 Artifact resolver 统一使用 `workspace.rootPath`；
- `write_file` / `edit_file`、结构化工具输出和 Markdown 文件引用均可生成 Workspace Artifact 卡片；根目录外的历史文件显示明确不可预览状态；
- 旧 session-scoped 远程接口只作无副作用兼容，Local / 未绑定 Workspace 返回 `409 WORKSPACE_TYPE_MISMATCH`，不再自动创建 Sandbox。

自动化验证覆盖 SQLite 迁移、类型污染修复、Workspace 路径隔离、本地符号链接逃逸、同 Sandbox 多子目录、Gateway 文件 / PTY / Git Review、Artifact 解析、typecheck 和 lint。

仍需在发布前执行的环境工作：

1. 使用最新 `runtime/workspace-gateway` 重建并发布 Code Sandbox 模板，使新 Sandbox 具备 `git.review` capability；旧 Gateway 不支持时 UI 会回退到 session changes。
2. 在真实 UCloud 环境中验证 paused -> auto-resume，以及同一 Sandbox 两个 Workspace 的 HTTP / WebSocket 并发切换。
3. 用真实 PPTX / DOCX / PDF / XLSX 生成流程做一次端到端预览回归。
4. 在各发布目标上运行一次打包后的 Electron 回归，确认随应用分发的 `node-pty` 原生模块 ABI 与本地终端、窗口退出清理流程正常。
5. 生成旧 `project_id IS NULL + studio_session_sandboxes` 候选清单，再人工确认导入或清理；不自动删除或 kill 历史 Sandbox。
6. 待兼容窗口结束后，删除已废弃的 `/api/studio/remote-workspaces` 和 session-scoped workspace 路由。
