# Codex 环境信息与右侧面板分析

分析来源：`/Applications/Codex.app/Contents/Resources/app.asar` 解包后的前端 bundle，重点文件是 `/private/tmp/codex-asar-analysis/webview/assets/local-conversation-thread-DhV7q0nP.js`、`thread-app-shell-chrome-DQOff_ey.js`、`thread-side-panel-tabs-BhQ8TJIi.js` 和 `review-mode-content-CKAFHiEI.js`。

## 环境信息什么时候显示

Codex 的环境信息是本地线程的 summary panel section。它只在满足这些条件时渲染：

- 当前是 local conversation thread，不是 mobile/narrow thread shell。
- 会话不是 projectless。
- 当前环境状态是 git workspace。
- 会话有 `cwd`，并能解析出 workspace/root。

bundle 里对应的判断可概括为：`!isMobile && !isProjectless && environment.kind === "git" && resolvedCwd`。满足后渲染环境 section，里面包含变更、远程、分支、提交/推送等行。

## 输入框和消息如何左移

Codex 不是直接压缩输入框宽度，而是计算 summary panel 的展示模式，然后给主聊天内容一个横向 transform。

核心常量和逻辑：

- 聊天目标内容宽度：`736px`
- 环境信息 panel 宽度：`300px`
- panel 与内容间距：`16px`
- `sideSpace = (mainContentTargetWidth - 736) / 2`
- `sideSpace < 180`：overlay 模式，不做 inline 左移。
- `180 <= sideSpace < 400`：shift 模式，内容左移 `-(300 + 16) / 2 = -158px`。
- `sideSpace >= 400`：gutter 模式，右侧自然有足够留白，不左移。

AstraFlow 现在在 `components/studio-chat-workbench.tsx` 复用了同一组阈值：用 `ResizeObserver` 观测聊天视口宽度，在 shift 模式下同时给消息滚动区、空状态 composer、底部 composer 加 `translateX(-158px)`。

## 组件与样式结构

Codex 的 summary panel 由一组内部组件组成：

- `Root`：绝对定位在 thread 右侧，`pointer-events-none`，panel 本身恢复 `pointer-events-auto`。
- `Content`：固定 `width: 300px`，`h-fit` / `max-h-full`，圆角 `rounded-3xl`，背景使用 dropdown surface token，带 electron elevation。
- `Section`：每个 section 有 sticky header、底部分隔线、可折叠内容。
- `Row`：统一的 flex row，左侧 icon，中间 label，右侧 delta/count/chevron。

关键视觉特征：

- panel 是浮层，不参与主 flex 布局。
- 宽度稳定为 300px。
- 大圆角、轻边框/阴影、内部滚动。
- section header sticky，行高紧凑，变更数字用绿色 `+` 和红色 `-`。
- 来源为空时仍显示 `来源 / 暂无来源`，而不是隐藏整个 section。
- 环境信息本身没有旧的 close / refresh 控制；右上只保留 `+`，用于添加/打开来源。
- `h-fit` 很关键；如果外层 absolute 同时设置 top/bottom，内部 flex item 不能用 stretch/flex-1 撑满，否则会退化成截图里的整屏高“Git 工具”卡片。

AstraFlow 对应落点：

- `components/studio-chat/status-panel.tsx`
- `StudioStatusPanel`
- `StudioStatusPanelSection`
- `StudioStatusDeltaSummary`

## 审查、终端、浏览器、文件如何进入右侧面板

Codex 的右侧面板不是单个 hard-coded view，而是 thread app shell 的 tab 系统。`thread-side-panel-tabs-BhQ8TJIi.js` 导出一组打开函数，例如：

- `openThreadReviewSidePanelTab`
- `openThreadLastTurnReviewSidePanelTab`
- `openThreadBranchReviewSidePanelTab`
- `openThreadBrowserSidePanelTab`
- `openSessionSandboxSidePanel`
- `toggleThreadSidePanel`

新建 tab 的菜单会根据当前线程能力动态生成：有 git workspace 才显示 Review，有 workspace root 才显示 Files，有 browser capability 才显示 Browser，terminal/bottom panel 走同一套 tab controller。

渲染分工：

- Review：从环境信息的“变更”行打开 diff tab。审查页展示 scope、分支/基线信息、总增删行，以及按文件分组的 unified diff。
- Files：artifact/file output 或 markdown file link 会通过 `openInSidePanel` 进入文件 tab。
- Browser：browser tabs 可以在 right/bottom panel 间共享 tab id，summary panel 里也会聚合 browser tab summaries。
- Terminal：底部 panel 和右侧 panel 都是 tab outlet，terminal tab 由 shell controller 管理，关闭/聚焦/新增走同一套 tab model。

## 本次 AstraFlow 改动

- 环境信息 panel 不再只在有 git 变更时出现；选中本地项目后即可显示。
- 删除旧 `Git 工具` 概念：入口、面板标题、aria/tooltip 都改为 `环境信息`。
- 移除旧面板里的刷新、关闭和顶层折叠控件，避免继续呈现成工具窗口。
- panel 改成 300px 浮层、`h-fit`、`rounded-3xl`、section 分隔线、sticky section header，并保留 `来源 / 暂无来源`。
- 环境 section 按 Codex 顺序展示：变更、远程、分支、提交或推送。
- `+` 按钮打开 Files 右侧面板，用于添加/查看来源。
- 消息区和 composer 在中等宽度下按 Codex 逻辑左移 158px，宽屏保持 gutter，不挤压内容。
- Review 已接入右侧 workspace tab：点击环境信息里的“变更”会读取本地 git diff，打开审查 tab；tab strip 的新增菜单也会在有本地项目时提供“审查”。
