# Phase 3: `/skills` 改名为“专家 / 技能 / 连接器”

## 阶段目标

在现有 `/skills` 页面内完成信息架构调整，把原来的插件页改成统一能力中心：

```text
专家 / 技能 / 连接器
```

不新增 `/experts` 路由，不新增 `/capabilities` 路由。现有 `/skills` 继续作为入口。

## 已确认决策

- 只改名并扩展现有 `/skills` 页面。
- 在 `/skills` 页面新增“专家”内容。
- 不创建独立专家页面路由。
- 不把 `/skills` redirect 到新路由。
- 技能和连接器现有功能必须保持可用。

## 当前基线

现有页面：

```text
app/skills/page.tsx
components/skills-market-page.tsx
components/skills-market/hooks/use-skills-market-page-state.tsx
components/skills-market/skills-market-components.tsx
components/skills-market/types.ts
```

当前行为：

- `/skills` 渲染 `SkillsMarketPage`。
- 页面内部用 `pluginType` 区分 `skills` 和 `mcp`。
- `view` 区分 `market` 和 `mine`。
- 已经有技能市场、已安装技能、MCP 列表和手动 MCP 添加。

导航相关：

```text
components/app-sidebar.tsx
components/i18n-provider.tsx
```

现有 AGENTS 约束提到“Keep the first navigation items as Models and SKILLS unless the product direction changes”。本目标明确改变产品方向，因此可以把 SKILLS 的显示语义改为“专家 / 技能 / 连接器”能力中心。

## 命名策略

用户侧不再使用 Plugin 作为主概念。

替换建议：

| 旧词 | 新词 |
| --- | --- |
| Plugin | 能力 |
| Skills | 技能 |
| MCP | 连接器 |
| Marketplace | 市场 |
| Installed | 已安装 / 已启用 |
| Add MCP manually | 手动添加连接器 |

英文界面：

- Experts
- Skills
- Connectors
- Market
- Installed
- Add connector

中文界面：

- 专家
- 技能
- 连接器
- 市场
- 已安装
- 手动添加连接器

## 状态模型

当前状态类似：

```ts
pluginType: "skills" | "mcp"
view: "market" | "mine"
```

建议改为：

```ts
capabilityType: "experts" | "skills" | "connectors"
view: "market" | "mine"
```

映射：

- `experts` -> 专家。
- `skills` -> 技能。
- `mcp` 底层 API 保留，但 UI 状态命名为 `connectors`。

实现上可以分两步：

1. 先把 UI 文案和状态命名改成 capability。
2. 再把专家数据接入 `experts` tab。

## 页面结构

`/skills` 页面顶部：

- 搜索框。
- 类型 segmented control：专家 / 技能 / 连接器。
- 视图 segmented control：市场 / 已安装，专家第一版可以只做市场。
- 当前类型的上下文操作：
  - 专家：刷新、分类筛选、类型筛选。
  - 技能：扫描本地技能、导入。
  - 连接器：刷新、手动添加连接器。
- summary count 放在搜索和筛选控件之后，例如 `244 available · 55 metadata-only`。

内容区：

- 专家 tab：专家卡片、分类筛选、详情面板和召唤入口。
- 技能 tab：复用当前 skill cards。
- 连接器 tab：复用当前 MCP cards。

## 组件拆分建议

现有 `SkillsMarketPage` 已经同时处理 skills 和 mcp。新增 experts 时，建议先拆出能力中心骨架，避免单文件继续膨胀。

建议结构：

```text
components/skills-market-page.tsx
components/capability-center/capability-tabs.tsx
components/capability-center/capability-toolbar.tsx
components/experts-market/experts-tab.tsx
components/experts-market/expert-card.tsx
components/experts-market/expert-detail-panel.tsx
components/skills-market/...
components/connectors-market/...
```

保守迁移路径：

1. 保留 `SkillsMarketPage` 作为 `/skills` 页容器。
2. 新增 `capabilityType`，替换 `pluginType`。
3. 把现有 skills 逻辑包装为 `SkillsCapabilityTab`。
4. 把现有 mcp 逻辑包装为 `ConnectorsCapabilityTab`。
5. 新增 `ExpertsCapabilityTab`。

## API 接入

专家 tab 调用 Kratos OpenAPI codegen 客户端，不直接请求文件系统。

需要的接口：

```text
GET /v1/expert-categories
GET /v1/experts
GET /v1/experts/{expert_id}
GET /v1/experts/{expert_id}/runtime
```

前端请求层要求：

- 优先读持久缓存展示首屏。
- 后台按 `catalog_hash` 刷新。
- 详情按需请求。
- 召唤专家时再请求 runtime payload。

## 与 Phase 4 的关系

Phase 3 负责 `/skills` 页的信息架构、命名和 tab 容器。

Phase 4 在这个专家 tab 中实现完整专家体验：

- 专家列表。
- 分类筛选。
- 专家详情。
- prompt 展示。
- 团队成员展示。
- 召唤入口。

## 验收标准

- `/skills` 仍是唯一能力中心入口。
- 页面明确呈现“专家 / 技能 / 连接器”三个能力类型。
- UI 不再把 Skills/MCP 统称为 Plugin。
- 技能安装、扫描、启用、删除不回归。
- 连接器列表、手动添加、启用、删除不回归。
- 专家 tab 已有稳定挂载位置。
- 不新增 `/experts` 或 `/capabilities` 路由。
- 控件宽度保持内容感知，不引入固定大空白。
