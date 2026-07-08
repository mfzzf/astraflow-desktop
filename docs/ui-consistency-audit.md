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

## 仍需处理

### 页面 shell padding 和 header 模式

当前不一致：

- `components/model-square-page.tsx`
  - 主容器使用 `p-4 lg:p-6`，顶部筛选区是 sticky rounded card。
- `components/file-library-page.tsx`
  - 顶部工具栏是 border-bottom band，内容区另有 `px-4 py-4 sm:px-6`。
- `components/skills-market-page.tsx`
  - 主容器使用 `px-6 pt-6 lg:px-8 lg:pt-8`，嵌入模式另有分支。
- `components/codebox-page.tsx`
  - 直接在 section 上处理 sidebar collapsed offset 和 padding。

建议后续抽象：

- 一个 dashboard/catalog page shell，用于 Models / Files / Skills / CodeBox 这类非 Chat 主页面。
- 明确两种 header：`toolbar band` 和 `sticky filter surface`，不要各页面随手组合 padding。

### 卡片圆角和列表项密度

当前不一致：

- Models 使用 `Card` 默认 `rounded-4xl`。
- Skills 市场卡片多处是 `rounded-2xl`，导入列表部分是 `rounded-lg`。
- CodeBox 面板和 sandbox item 使用 `rounded-2xl`。

建议后续抽象：

- CatalogCard：Models / Skills / Files 可选择统一尺寸、圆角和 hover。
- DenseListRow：专家列表、文件列表、sandbox 列表这类横向条目统一行高和边框。

### 媒体输出卡片操作区

当前不一致：

- Image / Video 输出 tile 是图像/视频覆盖层按钮。
- Audio 输出是列表卡片里的播放器和按钮组。
- Save / Download 按钮样式相近但仍在各文件中手写。

建议后续抽象：

- MediaOutputActions：统一保存、下载、加载中和已保存状态。
- MediaStatusBadge：Image / Video 已有相似状态 badge，Audio 可接入同一语义。

### 弹窗和导入列表

当前不一致：

- Skills import dialog 内的 candidate / duplicate / invalid 列表各自写了小卡片和空状态。
- CodeBox dialogs 使用 `rounded-3xl`，主 app dialog 默认是 `rounded-4xl`。

建议后续抽象：

- DialogListPanel：用于可滚动的弹窗列表。
- DialogIconHeader：统一 CodeBox 与管理弹窗的 icon header。
