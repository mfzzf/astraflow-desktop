# AstraFlow Desktop Multi-Agent Review Index - 2026-07-05

本次审查按用户要求派出 5 个 GPT-5.5 / xhigh 子代理，分别覆盖组件复用、代码质量、极致客户端性能、UI/UX、架构耦合。所有子代理均产出独立 Markdown 报告；本文件只做索引和交叉优先级汇总。

## 子代理报告

| 子代理 | 审查方向 | 报告 |
| --- | --- | --- |
| Subagent 01 | 网络现成组件/成熟库替代自研轮子 | [2026-07-05-subagent-01-component-reuse.md](./2026-07-05-subagent-01-component-reuse.md) |
| Subagent 02 | 代码规范、屎山、不可维护和工程行为问题 | [2026-07-05-subagent-02-code-quality.md](./2026-07-05-subagent-02-code-quality.md) |
| Subagent 03 | 客户端/运行时极致性能 | [2026-07-05-subagent-03-performance.md](./2026-07-05-subagent-03-performance.md) |
| Subagent 04 | UI/UX 审美与桌面体验 | [2026-07-05-subagent-04-ui-ux.md](./2026-07-05-subagent-04-ui-ux.md) |
| Subagent 05 | 紧耦合与架构边界 | [2026-07-05-subagent-05-coupling-architecture.md](./2026-07-05-subagent-05-coupling-architecture.md) |

## 最高优先级交叉结论

### P0 - Studio/chat 是当前最大的性能和维护风险集中区

涉及报告：Subagent 01、03、05。

关键证据：
- `components/studio-shell.tsx` 静态导入 chat/image/video/audio 四个 Studio workbench，实际只渲染一个 mode。
- `components/studio-chat-workbench.tsx` 约 6004 行，且静态导入 `SkillsMarketPage`；插件弹窗未打开时也把 3619 行 marketplace 拉进 chat 客户端图。
- 消息 API 返回全量历史，前端无分页/窗口化，SSE 不可用时还会 1 秒轮询全量消息。
- Chat UI、route、runner、orchestrator、DB message shape、SSE snapshot 端到端耦合。

建议方向：先做按 mode/dlg 懒加载和消息窗口化，再抽 chat application service 与 typed transport。不要继续在 `studio-chat-workbench.tsx` 内追加新功能。

### P0 - 媒体生成后端把 route handler 当成 provider adapter/job runner/repository

涉及报告：Subagent 02、05。

关键证据：
- audio/video POST 接收浏览器传来的 `openapi`、`fields`、`path`、`statusPath`、`modelConstant`，而 image route 已经采用服务端 registry 解析。
- audio/image/video 三条生成 route 的生命周期不一致：audio/image 在请求内长轮询，video 返回 `202` 并用 `after` 继续执行。
- route handler 同时负责鉴权、OpenAPI adapter、provider HTTP、polling、DB 状态、媒体落盘和响应归一化。

建议方向：audio/video 改成只接收 `modelId`、`operationId`、prompt、params、media，服务端解析 operation；建立统一 generation job runner，async provider 一律 `202 + persisted state`。

### P1 - 客户端 server-state 管理大量手写，已经超过 React `useEffect + local state` 的合理边界

涉及报告：Subagent 01、02、03。

关键证据：
- Skills、Models、API Keys、media models、installed skills/MCP 都有各自的 fetch/loading/error/cache/invalidation 写法。
- Model Square 搜索每次输入都可触发 `limit=all` 全量 catalog 获取，route 内再逐页拉 UCloud。
- Project/auth/cache invalidation 靠 `refreshNonce`、`queueMicrotask`、localStorage、自定义事件和手写 AbortController 串联。

建议方向：引入 TanStack Query 或 SWR，按 query key 管理 server state；模型 catalog 做 TTL 缓存和输入 debounce；mutation 统一 invalidate 对应 query。

### P1 - 大对象和代码高亮在客户端主线程上形成明显瓶颈

涉及报告：Subagent 03。

关键证据：
- 图片附件允许约 50 MB 文件转成约 70 MB data URL，并作为 message attachment JSON 存入 SQLite，之后每次全量消息 reload 都带回。
- `components/prompt-kit/code-block.tsx` 在 Client Component 里直接 import 默认 `shiki`，该入口拉 full grammar/theme bundle，并在 effect 中高亮。

建议方向：附件持久化后只返回 metadata + content URL + thumbnail；Shiki 改 `shiki/core` 小语言集、懒加载/缓存、streaming 期间不高亮。

### P1 - `studio-db` 和 CodeBox runtime 是典型跨域巨型模块

涉及报告：Subagent 02、05。

关键证据：
- `lib/studio-db.ts` 约 4884 行，同时拥有 sessions/messages/files/settings/OAuth/ModelVerse key/skills/MCP/CodeBox/image generations。
- `lib/codebox-runtime.ts` 同时处理 E2B、ModelVerse/GitHub 凭据、shell setup、code-server、SSH、DB persistence、terminal session。

建议方向：拆出 DB connection/migrations，按 bounded context 拆 repositories；CodeBox 拆成 `CodeBoxService` + `SandboxGateway` + `CodeBoxRepository` + `CredentialProvider` + `TerminalSessionStore`。

### P1 - UI 固定高度和窄窗口适配仍有剪裁风险

涉及报告：Subagent 04。

关键证据：
- Models 页在 sub-lg 下单列布局，但 page frame `overflow-hidden`、filter aside `h-full`、只有 results pane 可滚动，结果可能被推到不可达区域。
- image/video/audio workbench 使用固定横向 split 和固定表单宽度，窗口变窄时输出区被挤压或剪裁。
- Image Studio 输出历史被压进一个固定 canvas，生成多张后缩小而非形成可浏览列表。

建议方向：sub-lg 改 `flex-col` 或过滤 popover/accordion；结果/输出历史拥有唯一 `overflow-y-auto` 内容 pane；media 表单 rail 在窄窗口可折叠或堆叠。

## 现成组件/库替代清单

优先替代点：
- Client server-state：TanStack Query 或 SWR。
- 管理表格：TanStack Table + shadcn table primitives。
- 动态表单和字段数组：React Hook Form + Zod resolver + shadcn Form。
- 视频播放器：复用已引入的 Media Chrome React，替代手写 video controls。
- 长列表/聊天/market grids：TanStack Virtual 或按业务窗口化。
- 文件树：React Arborist 或 React Complex Tree。
- streaming markdown/code：Streamdown 或 AI SDK UI message primitives；Shiki 改 core/lazy/worker/server transform。

## 验证与约束

- 已运行 `bun run lint`：通过。
- 已运行 `bun run typecheck`：通过。
- 按 `AGENTS.md` 要求未运行 `bun run build`，未启动 dev server。
- 审查期间发现工作树已有无关修改：`.github/workflows/electron-package.yml`。
- 参考了本地 Next 16 文档 `node_modules/next/dist/docs/`，并查阅了 TanStack Query/Virtual、React Hook Form、Media Chrome 等官方资料。

