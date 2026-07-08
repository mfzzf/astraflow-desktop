# Phase 5: 联调、验证和灰度

## 阶段目标

把 Phase 1 到 Phase 4 串成可发布能力，完成数据、后端、前端和 Agent runtime 的端到端验证。

## 联调主链路

必须打通：

```text
导入专家数据
  -> 后端 API 查询专家
  -> 前端在 /skills 专家 tab 展示专家
  -> 用户召唤专家
  -> 创建 Studio 会话并绑定 expert snapshot
  -> Agent runtime 注入专家上下文
  -> 单专家完成任务
  -> 团队专家调用成员 subagent
  -> UI 展示运行过程
```

## 数据验证

导入后检查：

- 专家总数 299。
- 完整包 244。
- metadata-only 55。
- 单专家 256。
- 团队专家 43。
- prompt 文件接近 404。
- normalized `SKILL.md` 文件 439。原始下载摘要里的 `skillFiles=483` 是下载文件统计，不作为可导入技能条目验收数。
- mcp 文件 2。
- 分类数量 13。
- 每个 downloaded 专家都有 runtime hash。
- 每个 team 专家都有 lead agent。
- 每个 member agent 都能找到 prompt。

需要生成导入报告：

```text
docs/expert-system/import-report-YYYYMMDD.md
```

报告包含：

- source path
- source generatedAt
- import run id
- counts
- failed experts
- metadata-only experts
- hash summary

## 后端验证

命令：

```bash
cd backend/astraflow-api
go test ./...
```

如果改了 proto：

```bash
cd backend/astraflow-api
make api
go test ./...
```

需要验证：

- OpenAPI 能生成。
- OpenAPI 客户端 codegen 能生成并被前端专家 tab 调用。
- `GET /v1/expert-categories` 返回 13 个分类。
- `GET /v1/experts` 分页正常。
- 搜索中文和英文都能返回结果。
- `GET /v1/experts/{id}` 对 downloaded 和 metadata-only 返回正确状态。
- `GET /v1/experts/{id}/runtime` 对 downloaded 返回完整 payload。
- `GET /v1/experts/{id}/runtime` 对 metadata-only 返回不可用错误。

## 前端验证

默认命令：

```bash
bun run lint
bun run typecheck
```

项目规则要求不要默认跑 build，也不要默认启动 dev server。只有用户明确要求或 release-critical 时再跑 build。

需要验证：

- `/skills` 命名为“专家 / 技能 / 连接器”能力中心。
- `/skills` 专家 tab 能渲染。
- 搜索和筛选不会造成布局跳动。
- 固定高度 shell 下滚动区域正确。
- 专家详情不会被裁切。
- 召唤专家后跳转 Studio。
- Studio 会话列表仍能正常加载、重命名、归档、删除。

## Agent runtime 验证

单专家用例：

- ExecutiveSummaryGenerator：输入一段长报告，检查输出是否体现摘要专家风格。
- DataAnalyticsReporter：输入数据分析需求，检查是否按分析报告结构输出。
- DesignMdArchitect：输入设计文档需求，检查是否保持架构师角色。

团队专家用例：

- ContentMonetizationTeam：输入内容变现需求，检查 lead 是否调用至少一个 member subagent。
- 团队成员输出是否回到 lead 汇总。
- UI 是否展示成员名称和状态。

回归用例：

- 未选择专家的普通聊天。
- 普通代码任务。
- 项目 AGENTS.md 读取。
- 权限弹窗。
- 文件搜索 broad home glob 防护。
- 已安装技能仍可用。
- MCP 连接器仍可管理。

## 灰度策略

建议加 feature flag：

```text
ASTRAFLOW_EXPERTS_ENABLED=1
ASTRAFLOW_EXPERT_TEAMS_ENABLED=1
```

灰度顺序：

1. 只开放专家目录浏览。
2. 开放单专家召唤。
3. 开放专家技能注入。
4. 开放团队专家。
5. 开放 MCP 需求提示。

如果团队专家不稳定，可以保留目录展示，但禁用召唤 team。

## 观测和日志

需要记录：

- expert catalog loaded
- expert runtime fetched
- expert session bound
- expert run started
- expert run completed
- expert team member started/completed/failed
- expert runtime payload missing
- expert hash mismatch

日志不能记录：

- 用户密钥。
- MCP secret。
- 大段用户输入。
- 完整专家 prompt，除非显式 debug 模式。

## 失败处理

常见失败：

- 专家包缺失：metadata-only，不允许召唤。
- prompt 文件无法解析：导入失败并记录 expert id。
- team lead 缺失：禁用 team 召唤。
- member prompt 缺失：禁用对应成员，team 标记 degraded。
- runtime hash 不匹配：提示刷新专家快照。
- 后端不可达：前端使用上次缓存展示，但禁用新的召唤。
- MCP 未安装：允许召唤，但提示连接器缺失，runtime 不启用该 MCP。

## 发布前检查清单

- 数据导入报告已生成。
- OpenAPI 已更新。
- 后端测试通过。
- 前端 lint/typecheck 通过。
- 普通 chat 回归通过。
- 单专家 smoke test 通过。
- 团队专家 smoke test 通过或 feature flag 关闭。
- `/skills` 旧入口不破。
- 不存在新增 `/experts` 路由。
- metadata-only 状态明确。
- 专家 prompt 不在列表接口返回，但可以在详情接口返回并在前端展示。

## 后续增强

可在第一版稳定后推进：

- 专家收藏和最近使用。
- 专家安装/启用概念。
- 专家评分和使用次数。
- 用户自定义专家。
- 团队成员可视化协作时间线。
- 真正的 TeamCreate / SendMessage 协议。
- 专家运行结果模板。
- 专家和项目类型自动推荐。
- 云端专家市场同步。
