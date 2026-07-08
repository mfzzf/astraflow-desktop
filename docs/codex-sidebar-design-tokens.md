# Codex.app 侧栏设计 Token 与类名参考

提取自 `/Applications/Codex.app/Contents/Resources/app.asar`（Electron + Vite bundle，`grep -a` 直接可读）。用于 AstraFlow Studio 右侧面板 Codex 化迁移时对齐视觉。所有值可 1:1 落到 Tailwind v4 / CSS 变量。

## 侧栏宽度

```css
--spacing-token-sidebar: clamp(240px, 300px, min(520px, calc(100vw - 320px)));
--sidebar-footer-height: 72px;
```

环境信息 summary panel 固定 `300px`、`h-fit`、`max-h-full`、`rounded-3xl`、浮层（`pointer-events-none` root + panel 恢复 auto）。内容列 `--thread-content-max-width: 480px/500px`；聊天目标宽 736px；shift 模式左移 `-(300+16)/2 = -158px`（本项目已实现）。

## Diff 颜色系统

基色：

```css
--diffs-added-light:  #0dbe4e;   --diffs-added-dark:  #5ecc71;
--diffs-deleted-light:#ff2e3f;   --diffs-deleted-dark:#ff6762;
--diffs-bg: light-dark(var(--diffs-light-bg,#fff), var(--diffs-dark-bg,#000));
```

派生（整行背景/强调/上下文/分隔条，全部 `light-dark()` + `color-mix(in lab, ...)`）：

```css
--diffs-bg-addition: light-dark(
  color-mix(in lab, var(--diffs-bg) 88%, var(--diffs-addition-base)),
  color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-addition-base)));
--diffs-bg-deletion: light-dark(
  color-mix(in lab, var(--diffs-bg) 88%, var(--diffs-deletion-base)),
  color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-deletion-base)));
--diffs-bg-addition-emphasis: light-dark(
  rgb(from var(--diffs-addition-base) r g b / .15),
  rgb(from var(--diffs-addition-base) r g b / .2));
--diffs-bg-deletion-emphasis: /* 同上，deletion-base */;
--diffs-bg-context: light-dark(
  color-mix(in lab, var(--diffs-bg) 98.5%, var(--diffs-mixer)),
  color-mix(in lab, var(--diffs-bg) 92.5%, var(--diffs-mixer)));
--diffs-bg-context-gutter: light-dark(
  color-mix(in lab, var(--diffs-bg-context) 90%, var(--diffs-bg)),
  color-mix(in lab, var(--diffs-bg-context) 45%, var(--diffs-bg)));
--diffs-bg-separator: light-dark(
  color-mix(in lab, var(--diffs-bg) 96%, var(--diffs-mixer)),
  color-mix(in lab, var(--diffs-bg) 85%, var(--diffs-mixer)));
--diffs-bg-buffer: color-mix(in lab, var(--diffs-bg) 92%, var(--diffs-mixer));
```

行号列布局：`--diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr)`。
surface 覆盖：`--codex-diffs-surface-override` 可设为 `var(--color-token-diff-surface)`、dropdown/input background 的 50% color-mix；`--color-token-diff-surface: color-mix(in srgb, var(--color-token-main-surface-primary) 94%, var(--color-token-foreground))`。
header padding：`--codex-diffs-header-padding-x/y`（默认 `1rem` / `0.25rem`）。

## 圆角 / Squircle

```css
--radius-full: 9999px;  --radius-md: .5rem;  --radius-sm: .375rem;
--radius-{xs..4xl}: calc(var(--radius-*-base) * var(--corner-radius-scale));
--radius-token-row: 10px;
--codex-corner-shape: superellipse(1.5);   /* 或 round */
/* rounded-3xl/4xl 元素带 corner-shape: var(--codex-corner-shape) */
```

## Summary panel 行（`group/summary-panel-row`）

- 容器：`group/summary-panel-row relative isolate flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent px-0 text-left`
- density：comfortable `min-h-8 py-1.5`，compact `h-7 py-1`
- 可交互态：`cursor-interaction text-token-foreground` + `before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm hover:before:bg-token-list-hover-background`；否则 `text-token-text-secondary`
- 结构：左 icon，中 `truncate text-base` label，右 actions/trailing
- actions 悬停显现：默认 `hidden`，`group-hover/summary-panel-row:flex group-focus-within/summary-panel-row:flex`（或 opacity-0 → 100 变体）

## Diff 文件头（`group/diff-header`）

- 容器：`group/diff-header text-size-chat @container/diff-header relative flex items-center gap-2`
  - 面板变体：`py-0.5 ps-3 pe-2 hover:bg-token-list-hover-background`
  - 默认变体：`px-[var(--codex-diffs-header-padding-x,1rem)] py-[var(--codex-diffs-header-padding-y,0.25rem)] hover:bg-token-list-hover-background/30`
- sticky：`z-10 sticky top-0` + `backdrop-blur-sm`，背景 `color-mix(in srgb, var(--codex-diffs-surface) 88%, transparent)`
- 路径：窄容器只显文件名（`@xs/diff-header:hidden` / `@xs/diff-header:inline` 切换），路径用 `[direction:rtl]` truncate、内部 `[direction:ltr] [unicode-bidi:plaintext]`；目录段 `text-token-text-tertiary`、文件名段 `text-token-text-primary`
- 右侧：增删统计（`linesAdded/linesRemoved` 组件，绿 `+n` 红 `-n`）、文件操作按钮、"Open in editor" 按钮（`opacity-0 group-hover/file-diff:opacity-100`，`ghost`/`ghostMuted` toolbar 尺寸）
- checkbox/action 区：`opacity-0 group-focus-within/diff-header:opacity-100 group-hover/diff-header:opacity-100`

## 标签栏（segmented toggle，`segmented-toggle-*.js`）

- tablist：`role="tablist"`，可滚动时 `hide-scrollbar overflow-x-auto overflow-y-hidden`
- 每个 tab item：`relative flex min-w-0 items-center` + 有关闭按钮时 `group/tab`
- tab button：`role="tab"`，`cursor-interaction items-center text-sm font-medium`；选中 `text-token-text-primary` + `selectedClassName`（pill），未选中 `text-token-text-secondary`
- segmented edges 变体：首/尾 `rounded-l-md` / `rounded-r-md`，间隔 `h-full w-px self-stretch bg-token-border`
- 关闭按钮：`cursor-interaction text-token-text-tertiary hover:text-token-text-primary`，icon `icon-2xs`

## 其他确认事实

- Codex 右侧面板是 thread app shell 的 tab 系统（`thread-side-panel-tabs-*.js`），导出 `openThreadReviewSidePanelTab` / `openThreadBrowserSidePanelTab` / `toggleThreadSidePanel` 等；+ 菜单按能力动态生成（git workspace → Review，workspace root → Files，browser capability → Browser）。
- 环境信息 section 顺序：变更、本地/远程、分支、提交或推送；下方 Plan（套餐）、子智能体、来源（空时显示"暂无来源"）。
- i18n 字符串确认存在：`环境信息`、`子智能体`、`套餐`、`Side chat`、`origin/main`。
- 主样式文件 `app-jOJotR-N.css`（Tailwind v4：`light-dark()`、`color-mix(in oklab/lab, ...)`、`--color-token-*` 语义层 alias `--vscode-*`）。
