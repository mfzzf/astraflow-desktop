# Studio Chat 与远程 Skills 修复任务

## 背景

Studio Chat 在模型执行、工作过程收起和远程沙箱 Skills 使用链路上存在体验与可用性问题。本任务统一修复以下问题，并补充必要的自动化验证。

## 任务范围

### 1. 执行过程中保留用户的滚动位置

- 模型正在输出时，用户主动向上滚动后，不得被新内容或布局变化强制拉回最下方。
- 用户仍停留在底部时，可以继续自动跟随实时输出。
- 用户重新滚动到底部或主动执行“回到底部”操作后，恢复自动跟随。
- 鼠标滚轮、触控板拖动滚动条以及键盘向上浏览都应能退出自动跟随状态。

### 2. Work 完成后自动收起

- 模型执行期间展示完整 Work 过程和耗时。
- Turn 完成后自动将整个 Work 过程收起，仅保留 `Worked for …` 摘要入口。
- 用户仍可手动展开已完成的 Work 过程。
- Work 中存在错误时也应默认收起；错误状态应在摘要或对应入口中清晰可见，避免依赖自动展开表达错误。
- 流式状态切换为完成状态时，不得沿用执行期间的展开状态。

### 3. 修复远程沙箱安装 GitHub Skill 的失败链路

复现输入：

```text
安装这个 skills https://github.com/diffusionstudio/lottie
```

当前问题：远程沙箱中的 `astraflow_skills` MCP 启动失败，出现：

```text
MCP startup failed: No such file or directory (os error 2)
```

修复要求：

- 远程沙箱中的 AstraFlow Skills 服务必须能够正常启动，并暴露 `list_installed_skills`、`load_skill`、`read_skill_file` 和需要时的 `prepare_skill_sandbox`。
- 不得依赖仅存在于本机开发环境的绝对路径或可执行文件。
- 安装器收到 GitHub 仓库根链接时，应能定位仓库中的 `SKILL.md`；如果存在多个候选目录，应向用户展示候选项，而不是直接失败或猜测。
- 安装完成后应验证 Skill 已写入当前远程沙箱可识别的 Skills 根目录，并能在下一轮对话中加载。
- 使用 `diffusionstudio/lottie` 仓库作为回归用例，预期识别并安装其中实际的 Skill（当前示例为 `text-to-lottie`）。

### 4. Prompt 输入框 `/` 选择器支持远程沙箱 Skills

- Prompt 输入框的 `/` 选择器应展示当前远程沙箱实际可用的 Skills。
- 选择 Skill 后，应插入或绑定可被当前 Agent 正确解析并调用 `load_skill` 的 Skill 引用。
- 本地与远程存在同名 Skill 时去重，并优先使用当前会话远程沙箱中的版本。
- 沙箱未连接或远程 Skills 列表加载失败时，不展示不可用项，并提供明确、非阻塞的错误反馈。
- 远程 Skill 安装、移除、启用或禁用后，选择器应刷新，无需重建会话。
- Skills 数据必须按当前会话及其远程工作区隔离，不能串到其他会话或工作区。

### 5. 修复远程沙箱会话标题被 Skills 前言污染

- 不得采用 `Installed AstraFlow Skills are globally enabled ...`、`AstraFlow Skills are registered ...` 等运行时 Skills 前言作为会话标题。
- 自动标题润色结果命中运行时前言时，应回退到用户原始请求生成的标题。
- 已经被 Skills 前言污染的本地或远程会话，应从第一条可见用户消息恢复标题。
- 恢复标题时应移除开头的 Skill 命令，包括 `/$skill` 和带命名空间的 `/remote:skill`。

## 验收与验证

- 为滚动跟随状态、Work 完成状态切换、远程 Skills 发现/安装和 `/` 选择器数据合并补充回归测试。
- 默认运行：

```bash
bun run typecheck
bun run lint
git diff --check
```

- 不启动开发服务器，不运行生产构建，除非任务后续明确要求。
