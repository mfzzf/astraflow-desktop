# UI 一致性审计

记录目标：找出同一产品区域内页面相邻、功能相似，但组件、CSS 或样式写法不一致的位置，并把已经收敛的内容与剩余风险分开维护。

## 已收敛

### 页面级搜索、分页、加载更多

共享组件：

- `components/page-controls.tsx`
  - `PageSearchInput`
  - `PagePaginationBar`
  - `PageLoadMoreBar`
  - `PageEmptyState`

已接入：

- `components/experts-market/experts-tab.tsx`
- `components/skills-market-page.tsx`
- `components/model-square-page.tsx`
- `components/file-library-page.tsx`

收敛的问题：

- 专家页和技能/MCP 页原来各自手写上一页/下一页按钮，分页栏间距和固定位置不一致。
- Experts、Skills、Models、Files 的搜索框高度、图标位置和 padding 分散在各页面里。
- Models 与 Files 的“显示更多”按钮容器间距不同。
- Models 与 Files 的空结果/空文件库状态结构不同；现在统一使用 `PageEmptyState`。
- Files 媒体卡片外壳原来是 `rounded-lg border`，与 Models 的 catalog card 体系不一致；现在对齐为 `rounded-4xl` + shadow/ring。

### token / panel 搜索框

共享组件：

- `components/search-input.tsx`
  - `TokenSearchInput`
  - `PanelSearchInput`

已接入：

- `components/desktop-shell/desktop-sidebar.tsx`
- `components/desktop-shell/settings-secondary-sidebar.tsx`
- `components/studio-api-settings-page.tsx`
- `components/studio-chat/composer-session-scope.tsx`
- `components/studio-chat/right-panel/files.tsx`

收敛的问题：

- 桌面侧边栏与设置二级侧边栏原来复制了同一套 token 搜索框。
- API Key 管理、项目选择弹窗、右侧文件面板都手写搜索框，但语境不同；现在拆成 token 与 panel 两类，避免硬套主内容页的 `PageSearchInput`。

### 媒体生成工作台布局

共享常量：

- `components/studio-media-workbench-layout.ts`
  - `studioMediaWorkbenchShellClassName`
  - `studioMediaWorkbenchSidebarClassName`
  - `studioMediaWorkbenchCanvasClassName`
  - `studioMediaEmptyStateClassName`

已接入：

- `components/studio-image-workbench.tsx`
- `components/studio-video-workbench.tsx`
- `components/studio-audio-workbench.tsx`

收敛的问题：

- Image / Video / Audio 三个工作台的 shell、左侧参数栏、右侧画布布局原来重复写三份。
- Image / Video 空状态与 Audio 空状态不一致；现在统一为虚线边框空状态。

### 媒体输出操作区和状态徽标

共享组件：

- `components/studio-media-output-actions.tsx`
  - `MediaOutputActions`
  - `MediaStatusBadge`

已接入：

- `components/studio-image-workbench.tsx`
- `components/studio-video-workbench.tsx`
- `components/studio-audio-workbench.tsx`

收敛的问题：

- Image / Video 输出 tile 的 hover 操作层原来各自手写下载按钮样式，Image 还单独手写保存按钮加载态。
- Audio 输出卡片里的下载/保存按钮与 Image 的保存语义一致，但 CSS 单独维护。
- Image / Video 的 generation status badge 原来复制相同圆角、边框和完成/失败色彩语义；现在由 `MediaStatusBadge` 统一。

### 弹窗列表和 CodeBox dialog 圆角

共享组件：

- `components/dialog-list-panel.tsx`
  - `DialogListSection`
  - `DialogListGrid`
  - `DialogListEmpty`
  - dialog list item class constants

已接入：

- `components/skills-market/skills-market-components.tsx`
- `components/codebox/dialogs/confirm-action-dialog.tsx`
- `components/codebox/dialogs/open-vscode-dialog.tsx`
- `components/codebox/dialogs/rename-sandbox-dialog.tsx`
- `components/codebox/dialogs/workspace-directory-dialog.tsx`

收敛的问题：

- Skills import dialog 内的 candidate / duplicate / invalid 列表原来各自手写 section header、badge、grid、空状态和小卡片。
- CodeBox dialogs 原来局部覆盖 `DialogContent` 为 `rounded-3xl`，与全局 dialog 默认 `rounded-4xl` 不一致；现在去掉局部圆角覆盖。

### 弹窗 icon header

共享组件：

- `components/dialog-icon-header.tsx`
  - `DialogIconHeader`

已接入：

- `components/codebox/dialogs/confirm-action-dialog.tsx`
- `components/codebox/dialogs/open-vscode-dialog.tsx`
- `components/codebox/dialogs/rename-sandbox-dialog.tsx`
- `components/codebox/dialogs/workspace-directory-dialog.tsx`

收敛的问题：

- CodeBox 的多个 dialog 原来在 `DialogHeader` 内重复写 icon 方块、title、description。
- 删除 sandbox 弹窗和普通 CodeBox 弹窗的 icon 色彩语义现在由 `tone` 统一管理。

### 密集列表行

共享组件：

- `components/dense-list-row.tsx`
  - `DenseListRow`

已接入：

- `components/skills-market/skills-market-components.tsx`
- `components/experts-market/experts-tab.tsx`

收敛的问题：

- Skills / MCP / Experts 的主列表行原来重复 `flex min-w-0 items-center gap-4 border-b py-3.5 transition-colors hover:bg-muted/40`。
- Skills 与 Experts 的 skeleton 行原来也分别手写同类行高和边框，现在和实际列表行共享密度。

### sidebar-aware 页面 inset

共享 helper：

- `components/app-page-inset.ts`
  - `getSidebarAwarePageInsetClassName`

已接入：

- `components/model-square-page.tsx`
- `components/file-library-page.tsx`
- `components/skills-market-page.tsx`
- `components/codebox-page.tsx`

收敛的问题：

- Models / Files / Skills / CodeBox 原来各自手写 sidebar 收起或移动端时的 `pt-14` / `pt-16` 顶部避让。
- Files toolbar、Files 内容区、CodeBox 标准页面、Models catalog 页面、Skills market 页面现在通过明确 variant 管理页面 inset，避免后续局部 padding 漂移。

## 仍需处理

### 页面 shell header 模式

当前不一致：

- `components/model-square-page.tsx`
  - 顶部筛选区是 sticky rounded card。
- `components/file-library-page.tsx`
  - 顶部工具栏是 border-bottom band。
- `components/skills-market-page.tsx`
  - 顶部 header 根据嵌入模式切换 border 与 gap。
- `components/codebox-page.tsx`
  - 没有独立 toolbar/header band，主要靠 panel title 承载页面内容。

建议后续抽象：

- 明确两种 header：`toolbar band` 和 `sticky filter surface`，不要各页面随手组合 padding。

### 卡片圆角和列表项密度

当前不一致：

- Models 使用 `Card` 默认 `rounded-4xl`。
- CodeBox 面板和 sandbox item 使用 `rounded-2xl`。
- File Library 媒体卡片已对齐 `rounded-4xl`，但 CodeBox 仍是工具面板语义，是否并入 catalog card 需要单独确认。

建议后续抽象：

- CatalogCard：Models / Files / 未来卡片型市场列表可选择统一尺寸、圆角和 hover。
- CodeBoxPanel / SandboxCard：如果 CodeBox 后续继续使用卡片面板，应显式命名为工具面板体系，而不是散落 `rounded-2xl border`。

### 管理弹窗 header 语义

当前不一致：

- Studio API / Agent Model 等管理弹窗多直接使用文字 header，没有共享 icon header 语义。

建议后续抽象：

- 明确哪些管理弹窗需要 icon header，哪些只保留文字；已抽出的 `DialogIconHeader` 可复用，但不应强行给所有弹窗加 icon。
