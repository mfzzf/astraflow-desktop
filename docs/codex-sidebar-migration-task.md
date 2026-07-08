# 任务：Studio 右侧面板 Codex 化完整迁移

你在 AstraFlow Desktop（Next.js + Electron，Tailwind v4，bun）仓库根目录工作。工作树干净，基线 commit `b7959d3`。这是一次大型 UI 迁移，按下面的阶段顺序执行，每个阶段完成后运行 `bun run typecheck` 确认无误再继续。全部完成后运行 `bun run typecheck && bun run lint`，不要提交 commit（留给人工审查）。

## 目标（Summary）

把 Studio 当前自研的右侧工具面板替换为 Codex 风格的统一侧栏系统，覆盖：审查（Review/Diff）、浏览器、文件、侧边聊天、终端、摘要（环境信息）、Plan、子智能体。当前 Git 工具浮层不再作为主入口，改为 Codex 式环境信息摘要 + 右侧多标签 panel。

必读参考：`docs/codex-environment-summary-analysis.md`（Codex 原版行为分析）和 `docs/codex-sidebar-design-tokens.md`（从 Codex.app bundle 提取的精确设计 token 与类名，视觉必须对齐这份文档，不要凭感觉发明样式）。

## 现状地图（已勘探，直接使用）

- `components/studio-chat/right-panel/index.tsx`（988 行）：自研 `StudioRightPanel` 编排器。tab 状态在本地 `useState`（`workspaceTabs`/`activeWorkspaceTabId`），受控 props：`open/focused/mode/width/onModeChange/onWidthChange...`。`handleOpenProjectReview`（约 176-235 行）自己 fetch `GET /api/studio/local-projects/git?id=...` —— 与 workbench 重复。左缘拖拽 resize 在 533-550 行。消费事件 `STUDIO_OPEN_REVIEW_PANEL_EVENT`、`STUDIO_OPEN_MARKDOWN_TARGET_EVENT`。还导出 `StudioRightPanelLauncher`、`getStudioRightPanelItems`、`StudioRightPanelModeMenu`（+ 菜单）。
- `components/studio-chat/right-panel/tab-strip.tsx`：自研 tab 条，无拖拽排序、无右键菜单。
- `components/studio-chat/right-panel/`：`review.tsx`（`StudioReviewPanel` + 文件分节）、`browser.tsx`、`files.tsx`、`side-chat.tsx`（纯本地 mock 状态）、`terminal.tsx`、`previews.tsx`、`workspace-tabs.ts`（tab 工厂 + `useCloseTabCommand`）、`types.ts`（`StudioRightPanelMode`、`StudioWorkspaceTab`）、`labels.ts`（zh/en 标签包 `getStudioRightPanelLabels`）。
- `components/desktop-shell/side-panel.tsx`：**已建成但无人使用**的 Codex 式 `TabbedSidePanel`（358-615 行）+ `useSidePanelController`（118-229 行），底层 `lib/app-shell/tab-controller.ts` 的 `createRightPanelController()`（jotai）。功能齐全：ResizeHandle（clamp 320-960，localStorage 持久化）、expand 全宽模式、@dnd-kit 拖拽排序、per-tab 下拉菜单、preview/pin、Cmd+W。`SidePanelTab` 记录含 `id/title/icon/content/closable/menuItems/onBeforeClose...`。**这是迁移目标底座。**
- `components/studio-chat/status-panel.tsx`（874 行）：浮动环境信息卡（300px，absolute top-right）。Sections：环境（变更行→打开审查、远程 dropdown、分支 dropdown、提交或推送→commit dialog）、目标、进度（todos）、变更、来源。导出 `StudioStatusPanel/StudioStatusPanelSection/StudioStatusDeltaSummary/StudioFileChangeCard`。目前**不显示子智能体和 Plan 入口**。
- `components/studio-chat-workbench.tsx`（2164 行）：面板接线。`handleOpenWorkspaceChanges`（667-714 行）自己 fetch git diff 再 `openStudioReviewPanel(...)` 发事件（重复路径之一）。`getSummaryPanelDisplayMode`（overlay/shift/gutter，shift 时聊天内容 translateX(-158px)）。快捷键：⌘J 终端、⌘⌥B 右面板、⌘P 文件、⌘⌥S 侧聊、⌘T 浏览器。`latestPlanTodos`（283-301 行）从消息里扫最后一个 `type:"plan"` part。
- `components/studio-chat/panel-storage.ts`：`useRightPanelOpen/Mode/Width` 等（useSyncExternalStore + localStorage）。**`clampRightPanelWidth` 硬 clamp 300-460 —— 460px 上限就是"拖拽像自动收起"bug 的根因。**
- `components/studio-file-diff.tsx`：`parseUnifiedDiff` + `UnifiedDiffView`（unified diff 渲染，含 "N unmodified lines" 分隔）。`synthesizeAdditionsDiff` 上限 200k 字符。
- `lib/studio-review-panel.ts`：`STUDIO_OPEN_REVIEW_PANEL_EVENT`、`StudioReviewFileChange`、`openStudioReviewPanel`。
- Git API：`app/api/studio/local-projects/git/route.ts`（GET diff：MAX_DIFF_FILES=50、untracked 200KB、返回 `truncated`；POST commit/push）。`app/api/studio/local-projects/route.ts` 产出 `StudioLocalProjectGitInfo`（`lib/studio-types.ts:250-262`，**没有 ahead/behind 字段**）。
- 子智能体：`StudioMessagePart type:"subagent"`（`lib/studio-types.ts:140-153`：taskId/name/status/todos/activities），目前只在消息流内由 `components/studio-message-parts/subagent.tsx` 渲染。Plan part：`type:"plan"`（content + todos），由 `plan-todo.tsx` 渲染。
- i18n：全局 `useI18n()`（`components/i18n-provider.tsx`）+ 面板私有 `getStudioRightPanelLabels(locale)` 并存，新增字符串沿用 labels.ts 模式（zh/en 都要）。

## 阶段 1 — 修拖拽宽度 bug（最高优先级，独立可验证）

1. `panel-storage.ts` + `constants.ts`：把右面板宽度上限从 460 改为 Codex 式动态上限 `min(960, viewportWidth - 320)`（下限保持 320 左右，参考 token `clamp(240px, 300px, min(520px, calc(100vw - 320px)))` 的思路但面板允许拉更宽；与 `desktop-shell` 的 `clampPanelWidth` 320-960 对齐）。存储 key 升级为 `right-panel-width.v3` 以避免旧值污染。
2. 拖拽只改宽度，任何宽度都不触发关闭；关闭只由关闭按钮、Escape、显式 toggle 触发。
3. workbench 窗口 resize 时的 re-clamp 逻辑同步更新。

## 阶段 2 — 用 TabbedSidePanel 替换自研壳层

1. 在 Studio 内引入 `useSidePanelController` + `TabbedSidePanel`（`components/desktop-shell/side-panel.tsx`），替换 `right-panel/index.tsx` 里的自研 `<aside>` + tab 状态机 + `tab-strip.tsx`。
2. 把现有内容组件适配成 `SidePanelTab` 工厂/adapter：review、browser、files、side-chat、terminal（保留现组件 `review.tsx/browser.tsx/files.tsx/side-chat.tsx/terminal.tsx/previews.tsx` 的内容实现，只换壳）。文件和终端多 tab 保持常驻挂载（keep-mounted）语义。
3. 顶部标签栏按 Codex 样式：选中态 pill（segmented toggle 类名见 token 文档）、`+` 菜单（固定项：终端、浏览器、文件、侧边聊天；有本地 git 项目且未打开审查 tab 时提供"审查"）、右侧展开/收起（expand 模式已有）、关闭、tab 右键/下拉菜单（关闭其他、关闭右侧等，controller 已支持）。
4. 迁移现有行为：⌘W 关闭 tab、快捷键（⌘P/⌘⌥S/⌘T/⌘J/⌘⌥B）、`STUDIO_OPEN_REVIEW_PANEL_EVENT` 和 markdown 打开事件改为调用 controller.openTab、外部 `mode` 受控入口的兼容（workbench 侧尽量简化为 controller 调用）。
5. `panel-storage.ts` 只保留 status-panel / terminal-panel / browser 设置等仍需要的存储；面板宽度交给 TabbedSidePanel 的 `storageKey` 持久化。tab 列表本身仍可会话内存态。
6. 精简或退役 `tab-strip.tsx`（TabbedSidePanel 已拥有 tabs/菜单/关闭/拖拽）。

## 阶段 3 — Review/Diff 重做

1. 审查 tab 顶部按 Codex：分支下拉、总增删统计（绿 `+n` 红 `-n`）、`main → origin/main` 基线行；工具栏图标按钮（查看选项、排序/折叠全部、搜索、视图切换、文件入口、筛选）——没有后端支撑的按钮先做 UI 占位 + disabled/tooltip，不要造假功能。
2. Git diff 组件按 token 文档重构视觉：文件头（sticky + backdrop-blur、React/文件类型图标、目录灰/文件名黑的 RTL truncate 路径、增删统计、checkbox/open 按钮 hover 显现）、红绿整行背景（`--diffs-bg-addition/deletion` 及 emphasis）、左侧 change bar、行号列（`--diffs-code-grid`）、折叠 unchanged lines（现有 "N unmodified lines" 交互保留，样式对齐）。把 diff 颜色 token 加进全局 CSS（light/dark 用 `light-dark()`）。
3. 大 diff 性能：文件分节懒渲染/分块（如 content-visibility 或按文件虚拟化），保留滚动位置与折叠状态。
4. 合并重复的 git diff 获取：抽一个共享 hook/模块（如 `lib/studio-review-data.ts`），workbench 的 `handleOpenWorkspaceChanges`、right-panel 的 `handleOpenProjectReview`、消息里的"已编辑文件"卡片共用同一份数据与 loading 状态；尊重 API `truncated` 标志并在 UI 提示。
5. 后端小增强（可选但推荐）：git info 增加 ahead/behind（`rev-list --left-right --count @{upstream}...HEAD`），供 `main → origin/main` 行显示推送状态。

## 阶段 4 — 环境信息摘要 + Plan + 子智能体

1. `status-panel.tsx` 保持 300px、rounded-3xl、h-fit、sticky section header 浮层形态（已基本到位），section 顺序：变更、本地/远程、分支、提交或推送；下方新增 **Plan** section 和 **子智能体** section；保留来源（空时"暂无来源"）。顶部只留 `+`（添加来源）。
2. Plan section：显示最近的 plan part 标题（`latestPlanTodos` 来源逻辑已在 workbench），点击滚动到消息里对应 plan 卡片或展开进度。
3. 子智能体 section：从当前会话消息聚合 `type:"subagent"` parts，显示 agent 图标 + 名称 + 运行中/完成状态（running 用 spinner/彩色点，complete 用常规态）；点击滚动定位到消息流中对应的 subagent 卡片。
4. 摘要开关：标题栏"切换摘要"按钮控制浮层显隐（现有 `useStatusPanelOpen` 语义保留）。

## 阶段 5 — Browser / Files / Side Chat 收尾

1. 浏览器 tab：Codex 风格工具栏（地址/状态、刷新/停止、打开设置）、空状态与加载态；iframe 方案保留。
2. 文件 tab：文件列表 + 刷新 + 打开预览维持，文件预览 tab 纳入 shell tab 记录（controller.openTab，preview 语义：单击预览、双击 pin）。
3. 侧边聊天 tab：去掉 `side-chat.tsx` 的 mock 本地状态，接入当前 Studio 会话的消息模型与 composer（复用现有消息渲染组件；如果完整接线过大，至少做到消息持久于 tab 生命周期之外并复用真实 composer 组件，并在代码中留 TODO 注明剩余接线点）。

## 约束

- 样式必须对齐 `docs/codex-sidebar-design-tokens.md` 的 token/类名；项目已是 Tailwind v4，可直接用 `light-dark()`/`color-mix()`。
- 不要破坏现有 zh/en 双语：新字符串加进 `labels.ts` 或 `i18n-provider` 现有模式。
- 遵循仓库 AGENTS.md 的约定；组件风格与邻近代码一致。
- 阶段间保持可编译（typecheck 通过）；不要 commit。
- 如某项与现实冲突（如 API 缺字段），选择最小可行实现并在最终报告里说明。

## 验证

- `bun run typecheck` 与 `bun run lint` 全绿。
- 最后输出一份变更总结：每阶段做了什么、改了哪些文件、未尽事项（TODO 清单）。
