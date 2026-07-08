# Phase 1: 后端导入、数据库和专家 API

## 阶段目标

把 `agents/` 下的 WorkBuddy 专家数据通过 CLI 脚本导入独立部署的 Kratos 后端 PostgreSQL 数据库，并提供客户端可用的专家目录、专家详情和专家运行时配置接口。

第一阶段不改 Agent 行为，只打通数据供应链。

## 当前代码基线

后端位于：

```text
backend/astraflow-api/
```

当前状态：

- Kratos protobuf-first scaffold 已存在。
- HTTP / gRPC server 已存在。
- OpenAPI 生成链路已存在。
- 目前只有 `HealthService`。
- `configs/config.yaml` 当前已经配置 PostgreSQL DSN。
- `internal/data/data.go` 的 `Data` 仍是 TODO database client，需要接入 PostgreSQL 连接池和 repository。
- `internal/server/http.go` 只注册了 Health HTTP service。

这意味着 Phase 1 需要先补齐 PostgreSQL 数据层，再新增 ExpertService，并生成 OpenAPI 供客户端 codegen 使用。

前端已有参考实现：

- `app/api/skills/route.ts`：技能市场列表。
- `app/api/skills/[slug]/route.ts`：技能详情。
- `app/api/skills/installed/route.ts`：本地安装技能。
- `lib/studio-db/skills.ts`：本地保存 skill metadata 和 skill markdown。
- `lib/studio-db/connection.ts`：桌面本地持久缓存 schema 管理。

这些可以作为客户端持久缓存和数据形态参考，但专家主数据应由独立 Kratos 后端和 PostgreSQL 负责。

## 数据源输入

第一阶段导入脚本读取：

```text
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/index.json
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/expert_center.json
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/experts/*/manifest/plugin.json
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/experts/*/manifest/agents/*.md
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/experts/*/manifest/skills/*/SKILL.md
agents/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z/experts/*/manifest/mcp/.mcp.json
```

现有脚本可复用逻辑：

- `agents/scripts/extract_workbuddy_experts.js`
- `agents/scripts/export_workbuddy_experts_recursive.js`
- `agents/scripts/download_workbuddy_expert_center.js`
计划新增稳定的导入脚本，作为写入 PostgreSQL 的唯一导入入口。旧探索脚本中有绝对路径和 WorkBuddy 本地缓存假设，适合作参考，不适合作为 AstraFlow 导入入口。

运行方式：

```bash
node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z \
  --database-url "$ASTRAFLOW_EXPERT_DATABASE_URL"
```

脚本职责：

- 读取 `backend/astraflow-api/migration/workbuddy/` 下的 WorkBuddy 导出数据。
- 同时兼容 `experts/*/prompts/*.md` 和 `experts/*/manifest/agents/*.md` 作为 agent prompt 源。
- 规范化专家、分类、prompt、skill、mcp 和 team 结构。
- 计算 runtime hash。
- 连接 PostgreSQL。
- 使用事务 upsert 数据。
- 输出导入报告。

导入后应满足：

- categories：13。
- experts：299。
- downloaded：244。
- metadata_only：55。
- agent：256。
- team：43。
- promptFiles：404。
- normalized `SKILL.md` files：439。
- mcpFiles：2。
- expertErrors：0。

## 规范化数据模型

建议脚本内部先把原始数据规整成中间结构，再写入 PostgreSQL：

```text
raw WorkBuddy files
  -> normalize script
  -> normalized in-memory records
  -> PostgreSQL transaction
  -> import report
```

规范化记录建议包含：

```json
{
  "id": "ExecutiveSummaryGenerator",
  "slug": "executive-summary-generator",
  "source": "workbuddy",
  "sourceFolder": "ExecutiveSummaryGenerator__executive-summary-generator",
  "type": "agent",
  "status": "downloaded",
  "categoryId": "10-ProjectQuality",
  "displayName": { "zh": "简明明", "en": "Remy" },
  "profession": { "zh": "战略报告顾问", "en": "Executive Summary Generator" },
  "description": { "zh": "...", "en": "..." },
  "avatar": "avatars/expert.png",
  "tags": [{ "zh": "执行摘要", "en": "Executive Summary" }],
  "quickPrompts": [{ "zh": "...", "en": "..." }],
  "defaultInitPrompt": { "zh": "...", "en": "..." },
  "agents": [],
  "skills": [],
  "mcp": [],
  "team": null,
  "hash": "sha256..."
}
```

`hash` 必须由参与运行时的内容计算，包括 manifest、agent prompt、skills、mcp、teamInfo。客户端用它判断缓存是否过期。

## 数据库设计

已确认服务端数据库使用 PostgreSQL。不要在后端第一版引入 SQLite 分支。

原则：

- Kratos 后端独立部署，连接 PostgreSQL。
- 前端不直连数据库，只通过 Kratos API 和 OpenAPI codegen 客户端访问。
- `internal/biz` 定义 repository 接口，`internal/data` 实现 PostgreSQL。
- 导入脚本也复用同一套数据结构或 SQL 约束，避免导入逻辑和 API 查询逻辑产生不同语义。

建议表：

### expert_categories

保存专家分类。

字段：

- `id`
- `name_zh`
- `name_en`
- `description_zh`
- `description_en`
- `sort_order`
- `expert_count`
- `created_at`
- `updated_at`

### experts

保存专家轻量元数据。

字段：

- `id`
- `slug`
- `source`
- `source_folder`
- `source_plugin`
- `type`: `agent` / `team` / `plugin`
- `status`: `downloaded` / `metadata_only` / `disabled`
- `category_id`
- `display_name_zh`
- `display_name_en`
- `profession_zh`
- `profession_en`
- `description_zh`
- `description_en`
- `avatar_path`
- `tags_json`
- `quick_prompts_json`
- `default_init_prompt_json`
- `downloaded_file_count`
- `prompt_count`
- `skill_file_count`
- `mcp_file_count`
- `runtime_hash`
- `search_text`
- `created_at`
- `updated_at`

索引：

- `idx_experts_category_status`
- `idx_experts_type_status`
- `idx_experts_runtime_hash`
- `idx_experts_search_text`。第一版可用 `ILIKE`，后续改 PostgreSQL full-text search 或 trigram index。

### expert_agents

保存专家 prompt 和团队成员 prompt。

字段：

- `id`
- `expert_id`
- `agent_name`
- `role`: `lead` / `member` / `single`
- `display_name_zh`
- `display_name_en`
- `profession_zh`
- `profession_en`
- `description`
- `prompt_markdown`
- `frontmatter_json`
- `skills_json`
- `max_turns`
- `sort_order`
- `content_hash`
- `created_at`
- `updated_at`

### expert_skills

保存专家包内技能。

字段：

- `id`
- `expert_id`
- `skill_slug`
- `relative_path`
- `skill_md`
- `metadata_json`
- `content_hash`
- `created_at`
- `updated_at`

### expert_mcp_servers

保存专家包声明的 MCP。

字段：

- `id`
- `expert_id`
- `relative_path`
- `mcp_json`
- `server_count`
- `content_hash`
- `created_at`
- `updated_at`

### expert_team_members

保存团队展示结构和运行时结构。

字段：

- `id`
- `expert_id`
- `agent_name`
- `role`
- `display_name_zh`
- `display_name_en`
- `profession_zh`
- `profession_en`
- `avatar_path`
- `sort_order`

### expert_import_runs

保存导入批次，方便校验和回滚。

字段：

- `id`
- `source_path`
- `source_generated_at`
- `started_at`
- `finished_at`
- `status`
- `expert_count`
- `downloaded_count`
- `metadata_only_count`
- `prompt_count`
- `skill_count`
- `mcp_count`
- `error_message`

## API 设计

Proto service 建议：

```protobuf
service ExpertService {
  rpc ListExpertCategories(ListExpertCategoriesRequest) returns (ListExpertCategoriesResponse);
  rpc ListExperts(ListExpertsRequest) returns (ListExpertsResponse);
  rpc GetExpert(GetExpertRequest) returns (GetExpertResponse);
  rpc GetExpertRuntime(GetExpertRuntimeRequest) returns (GetExpertRuntimeResponse);
}
```

HTTP 映射建议：

```text
GET /v1/expert-categories
GET /v1/experts
GET /v1/experts/{expert_id}
GET /v1/experts/{expert_id}/runtime
```

不做管理导入接口。第一版只允许 CLI 脚本导入，避免线上 API 被误触发或被滥用。

## ListExperts 响应契约

列表接口必须轻量，不返回完整 prompt 和 skill markdown。

请求参数：

- `page_size`
- `page_token`
- `category_id`
- `type`
- `status`
- `query`
- `order_by`: `popular` / `recent` / `name`，第一版可以只支持 `recent` 和 `name`
- `locale`: `zh` / `en`

响应字段：

- `experts[]`
- `next_page_token`
- `total_size`
- `catalog_version`
- `catalog_hash`
- `updated_at`

专家列表项：

```json
{
  "id": "ExecutiveSummaryGenerator",
  "slug": "executive-summary-generator",
  "type": "agent",
  "status": "downloaded",
  "categoryId": "10-ProjectQuality",
  "displayName": "简明明",
  "profession": "战略报告顾问",
  "description": "将冗长报告浓缩为高管可快速消化的精华摘要",
  "avatarUrl": "/v1/experts/ExecutiveSummaryGenerator/assets/avatars/expert.png",
  "tags": ["执行摘要", "战略报告", "决策简报"],
  "quickPrompts": ["为商业计划书撰写高管摘要"],
  "promptCount": 1,
  "skillCount": 2,
  "mcpCount": 0,
  "runtimeHash": "sha256..."
}
```

## GetExpert 响应契约

详情接口返回页面展示需要的信息，并允许返回完整 prompt markdown 供前端展示。

应包含：

- 基础元数据。
- tags、quickPrompts、defaultInitPrompt。
- 团队成员展示信息。
- skills 摘要。
- mcp 摘要。
- agents prompt 展示数据，包括单专家 prompt 和团队成员 prompt。
- 是否可召唤：`runtimeAvailable`。
- 不可召唤原因：例如 `metadata_only`。

注意：prompt 可以展示，但必须作为“专家定义内容”呈现，不能在 UI 上暗示它高于 AstraFlow 系统规则或工具权限规则。

## GetExpertRuntime 响应契约

运行时接口只在召唤专家或继续专家会话时调用，返回完整运行配置。

应包含：

```json
{
  "expert": {
    "id": "ContentMonetizationTeam",
    "type": "team",
    "runtimeHash": "sha256...",
    "defaultInitPrompt": "帮我设计一套适合我账号的内容变现方案"
  },
  "agents": [
    {
      "name": "content-monetization-team-lead",
      "role": "lead",
      "promptMarkdown": "...",
      "frontmatter": {},
      "skills": ["content-monetization-ops"],
      "maxTurns": 150
    }
  ],
  "team": {
    "leadAgent": "content-monetization-team-lead",
    "memberAgents": ["cps-specialist", "cpe-cpm-expert"]
  },
  "skills": [
    {
      "slug": "content-monetization-ops",
      "skillMarkdown": "...",
      "metadata": {}
    }
  ],
  "mcp": [],
  "policy": {
    "allowRawPromptDisplay": false,
    "toolScope": "declared"
  }
}
```

## 导入脚本设计

建议新增一个脚本入口：

1. `backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs`

职责：

- 只读 `backend/astraflow-api/migration/workbuddy/` 导出目录。
- 内部 normalize。
- 写入 PostgreSQL。
- 输出导入报告。

导入必须满足：

- 幂等：重复导入同一批数据不会产生重复专家。
- 可追踪：保存 source path、source generatedAt、runtime hash。
- 可校验：导入后统计必须匹配 source summary。
- 可降级：metadata-only 专家进入 `experts`，但不生成 runtime payload。
- 可部分失败：单个专家包解析失败时记录错误，不中断全部导入，除非核心 index 文件不可读。
- 不通过 HTTP admin API 导入。

## 验证要求

导入后应检查：

- `experts` 总数 = 299。
- `status=downloaded` = 244。
- `status=metadata_only` = 55。
- `type=agent` = 256。
- `type=team` = 43。
- `expert_agents` prompt 数接近 404。
- `expert_skills` normalized `SKILL.md` 数 = 439。原始下载摘要中的 `skillFiles=483` 是下载文件统计，不等同于可导入的 `SKILL.md` 数。
- `expert_mcp_servers` mcp 数 = 2。
- 所有 `downloaded` 专家都有 `runtime_hash`。
- 所有 `team` 专家都有 lead agent。
- 所有 agent prompt 文件都能被 UTF-8 读取。

## 客户端缓存契约

客户端需要持久缓存，缓存只保存：

- `catalog_hash`
- `catalog_version`
- `updated_at`
- categories
- expert list items
- 可选的详情展示缓存，包括原始 prompt 展示数据

不缓存：

- 完整 `SKILL.md`
- MCP 配置密钥
- 大型 assets

建议本地加表：

- `studio_expert_catalog_cache`
- `studio_session_experts`
- `studio_expert_detail_cache`

`studio_expert_catalog_cache` 用于页面首屏和离线兜底，`studio_expert_detail_cache` 用于已查看专家详情和 prompt 展示缓存，`studio_session_experts` 用于会话绑定专家快照。

运行时 payload 仍按需拉取，不长期缓存完整技能包和 MCP 配置。

## Phase 1 交付物

- PostgreSQL 连接和迁移初始化。
- Expert proto、service、biz、data、HTTP 注册。
- 专家 CLI 导入脚本。
- 导入报告。
- 专家分类、列表、详情、runtime API。
- OpenAPI 生成。
- 前端 OpenAPI 客户端 codegen。
- 客户端请求类型和轻量缓存策略文档。

## Phase 1 不做

- 不改 AstraFlow Agent prompt 注入。
- 不实现专家团队协作。
- 不重做插件页。
- 不新增 `/experts` 路由。
- 不把所有专家 prompt 加载到客户端内存。
- 不做 `POST /v1/admin/experts/import`。

## 验收标准

本阶段完成后，应该可以：

1. 从 `agents/` 目录导入全部 299 个专家。
2. 通过 API 分页查询专家。
3. 查询某个专家详情。
4. 对 downloaded 专家获取完整 runtime payload。
5. 对 metadata-only 专家返回明确不可召唤状态。
6. OpenAPI 生成并完成客户端 codegen。
7. 客户端能按 `catalog_hash` 判断持久缓存是否需要刷新。
