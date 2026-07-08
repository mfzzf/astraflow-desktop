# AstraFlow 专家系统实施规划

## 目标

把 `agents/` 目录下已经整理好的 WorkBuddy 专家数据导入独立部署的 AstraFlow Kratos 后端 PostgreSQL 数据库，并提供专家目录、专家详情、运行时专家配置接口。客户端持久缓存轻量元数据；用户召唤专家时，再按专家 ID 拉取完整运行时配置。

后续在现有 AstraFlow Agent 上支持单专家和专家团队，调整现有插件页的信息架构，在 `/skills` 页面内新增“专家 / 技能 / 连接器”能力中心体验。

本目录只写实施分析和阶段计划，不包含代码修改。

## 当前结论

WorkBuddy 的专家系统不是单纯的 prompt 列表，而是一个插件化专家包系统：

- 每个专家包以 `.codebuddy-plugin/plugin.json` 为入口。
- 专家指令位于 `agents/*.md`，Markdown frontmatter 提供 `name`、`description`、`displayName`、`profession`、`skills`、`maxTurns` 等元信息。
- 能力扩展位于 `skills/*/SKILL.md`，少量专家还带 `.mcp.json`。
- 单专家通过 `expertType: "agent"` 和 `agentName` 指定主 Agent。
- 团队专家通过 `expertType: "team"`、`teamInfo.leadAgent`、`teamInfo.memberAgents`、`members` 和多个 `agents/*.md` 组合成一个协作团队。
- WorkBuddy 在运行时不会把专家中心列表直接塞进模型上下文，而是在会话激活时解析专家包，把选中的专家 Agent 应用到默认 Agent 上，再把专家指令包装进专门的 expert prompt block。

AstraFlow 当前具备改造基础：

- `backend/astraflow-api` 是独立部署的 Kratos 后端，目前只有 Health API，`Data` 层还没有数据库客户端。后端服务端数据库使用 PostgreSQL。
- 前端是 Next.js 应用，当前相关页面和组件在 `app/`、`components/`、`lib/` 下；现有 `/skills` 页面已经有 Skills / MCP 的市场和已安装列表。
- 本地 Studio SQLite 已有 `studio_installed_skills`、`studio_mcp_servers`、`studio_sessions`、`studio_messages` 等表，适合保存客户端缓存、会话选择和运行状态。
- Agent 运行时集中在 `lib/agent/runtime.ts`、`lib/studio-chat-runner.ts`、`lib/agent/run-orchestrator.ts`、`lib/agent/adapters/astraflow-runtime.ts`，当前已经支持 skills、mcp、subagents、plan、sandbox、permission 等能力。

## 数据现状

专家数据位置：

```text
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/
```

关键文件：

- `index.json`：已规整的专家索引，包含分类、专家元数据、下载状态和文件统计。
- `expert_center.json`：原始专家中心清单。
- `download-summary.json`：下载统计。
- `missing-experts.csv`：只有元数据、缺少完整包的专家。
- `experts/*/manifest/plugin.json`：每个已下载专家包的入口。
- `experts/*/manifest/agents/*.md`：专家或团队成员提示词。
- `experts/*/manifest/skills/*/SKILL.md`：专家引用技能。
- `agents/scripts/*.js`：现有导出、下载、抽取脚本。

已确认统计：

- 专家中心总数：299。
- 已下载完整包：244。
- 元数据存在但包缺失：55。
- 专家类型：256 个单专家，43 个团队专家。
- 已下载文件：1786。
- Agent prompt 文件：404。
- 下载摘要中的 Skill 相关文件：483；可导入的 normalized `SKILL.md` 条目按 Phase 1 验收为 439。
- MCP 文件：2。
- Command 文件：0。

分类分布：

| 分类 | 数量 |
| --- | ---: |
| ContentCreative | 34 |
| MarketingGrowth | 33 |
| Engineering | 33 |
| FinanceInvestment | 31 |
| GameSpatial | 24 |
| DataAI | 22 |
| ProjectQuality | 22 |
| SecurityCompliance | 22 |
| TencentZone | 22 |
| ProductDesign | 17 |
| IndustryConsultant | 16 |
| SalesCommerce | 13 |
| OperationsHR | 10 |

## 总体架构

建议分成三个层次：

1. 后端专家库：负责导入、去重、索引、搜索、详情和运行时 payload。
2. 客户端持久元数据缓存：只保存专家列表、分类、版本、更新时间、轻量展示字段和必要的展示缓存。
3. Agent 运行时快照：召唤专家时按 ID 拉取完整 prompt、team、skills、mcp 和策略配置，绑定到会话并传给 runtime。

目标数据流：

```text
agents/WorkBuddy export
  -> CLI import script normalize + validate
  -> standalone Kratos backend PostgreSQL database
  -> GET /v1/expert-categories
  -> GET /v1/experts
  -> generated OpenAPI client
  -> persistent client metadata cache
  -> user selects expert
  -> GET /v1/experts/{id}/runtime
  -> create/update Studio session expert snapshot
  -> AstraFlow Agent runtime injects expert/team context
```

## 后端边界

后端应该提供稳定的专家系统 API，而不是让前端直接遍历 `agents/` 目录。

后端职责：

- 导入 `agents/` 数据。
- 保存专家元数据、分类、prompt、技能、MCP、团队结构。
- 对外提供分页、搜索、分类过滤、详情和运行时 payload。
- 提供数据版本、hash、更新时间，便于客户端缓存。
- 区分 `downloaded` 和 `metadata_only` 专家。

前端职责：

- 持久缓存专家列表元数据。
- 在 `/skills` 页面内渲染专家市场和详情。
- 在会话创建或切换时保存选中的 `expertId` 和 `expertSnapshotVersion`。
- 运行时只请求当前专家详情，不把全量专家数据加载进内存。
- 允许在详情中展示原始专家 prompt，但必须明确标识为专家定义内容，并避免把 prompt 当作系统规则展示。

Agent runtime 职责：

- 根据会话专家快照构建系统提示词。
- 绑定专家声明的 skills、mcp 和 team members。
- 把团队成员映射到已有 subagent 能力，先支持 Lead -> Member 的可控任务分发。
- 记录专家运行事件，便于 UI 展示团队协作过程。

## 阶段计划

| 阶段 | 文档 | 目标 |
| --- | --- | --- |
| Phase 1 | [phase1.md](./phase1.md) | PostgreSQL 数据库、CLI 导入脚本、Kratos 专家 API、OpenAPI codegen、客户端持久缓存契约 |
| Phase 2 | [phase2.md](./phase2.md) | 改造 AstraFlow Agent，支持专家 prompt、skills、mcp 和专家团队 |
| Phase 3 | [phase3.md](./phase3.md) | 把现有 `/skills` 插件页改成“专家 / 技能 / 连接器”的统一能力中心 |
| Phase 4 | [phase4.md](./phase4.md) | 在 `/skills` 内新增专家页签，参考 WorkBuddy 专家中心的信息架构和交互 |
| Phase 5 | [phase5.md](./phase5.md) | 联调、迁移、验证、灰度和后续增强 |

## 关键实现原则

- 专家列表和运行时 payload 分离。列表接口必须轻，运行时详情按需拉取。
- 运行时使用专家快照。会话开始后即使专家库更新，当前会话也应保持可复现。
- 专家 prompt 的权限低于 AstraFlow 系统规则、工具安全规则和用户授权规则。
- 团队专家第一版复用现有 subagent 能力，实现 lead agent -> member subagents；不第一步实现完整 WorkBuddy TeamCreate / SendMessage 协议。
- 缺失完整包的 55 个专家可以先展示为 metadata-only，但不能召唤。
- 技能和 MCP 引用需要显式声明、按专家绑定，不允许专家 prompt 动态扩大工具权限。
- UI 参考 WorkBuddy 的专家中心结构，在 `/skills` 页面内完成；不要直接复制视觉资产。

## 已确认决策

1. 后端是独立部署的 Kratos 服务，不随桌面客户端本地进程部署。
2. 服务端数据库使用 PostgreSQL。
3. 专家数据导入只做 CLI 脚本，不做后台导入接口。
4. API 做在 Kratos 后端，通过 OpenAPI 生成客户端 codegen。
5. 客户端需要持久缓存专家元数据。
6. 允许前端展示原始专家 prompt。
7. 团队专家第一版按 lead agent -> member subagents 实现。
8. 不新增 `/experts` 路由；专家能力加在现有 `/skills` 页面中。
9. 当前阶段只规划，不做 Go 依赖安装、后端代码实现或验证。

## 建议落地顺序

1. 先完成 Phase 1，确保专家数据可通过 CLI 重复导入 PostgreSQL，可通过 Kratos API 查询，并能生成 OpenAPI 客户端。
2. 再做 Phase 2 的单专家运行链路，确认 prompt 注入、skills 注入、会话快照和权限边界。
3. 在单专家稳定后支持 team lead + member subagents。
4. 同步做 Phase 3 的 `/skills` 能力中心重命名，避免专家、技能、连接器信息架构割裂。
5. 最后做 Phase 4 `/skills` 内专家页签和 Phase 5 联调验证。
