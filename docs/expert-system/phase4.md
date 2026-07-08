# Phase 4: 在 `/skills` 内新增专家能力页签

## 阶段目标

在现有 `/skills` 页面内新增“专家”页签，参考 WorkBuddy 专家中心的信息架构和使用方式，让用户可以浏览、筛选、查看详情、查看原始专家 prompt，并召唤专家。

不新增独立 `/experts` 路由。

## 页面定位

专家页签不是营销页，也不是静态介绍页。首屏必须是可用的专家工作台：

- 搜索专家。
- 按分类筛选。
- 区分单专家和团队专家。
- 查看专家能力、成员、技能、quick prompts。
- 查看原始专家 prompt。
- 一键召唤进入 Studio 会话。

## 参考 WorkBuddy 的结构

可以参考 WorkBuddy：

- 专家中心按领域分类。
- 专家卡片展示头像、名字、职业、简介、标签和推荐开场问题。
- 团队专家展示多个成员。
- 进入专家时使用默认开场 prompt 或 quick prompt。
- 专家和团队都被视为可召唤对象。

不要直接复制：

- WorkBuddy 原始视觉资产。
- WorkBuddy 的内部工具命名。
- WorkBuddy TeamCreate / SendMessage 的完整交互。

允许展示：

- 单专家原始 prompt。
- 团队 lead prompt。
- 团队 member prompt。
- 技能摘要和技能文件标题。

展示时必须标识为“专家定义内容”，避免用户误解为 AstraFlow 系统规则。

## 挂载位置

专家体验挂载在：

```text
app/skills/page.tsx
components/skills-market-page.tsx
```

推荐组件：

```text
components/experts-market/experts-tab.tsx
components/experts-market/expert-toolbar.tsx
components/experts-market/expert-category-rail.tsx
components/experts-market/expert-card.tsx
components/experts-market/expert-detail-panel.tsx
components/experts-market/expert-prompt-viewer.tsx
components/experts-market/expert-team-members.tsx
components/experts-market/use-experts.ts
components/experts-market/types.ts
```

## 数据接口

页面依赖 Phase 1 的 Kratos API 和 OpenAPI codegen 客户端：

```text
GET /v1/expert-categories
GET /v1/experts
GET /v1/experts/{expert_id}
GET /v1/experts/{expert_id}/runtime
```

首屏：

- 从客户端持久缓存读取 catalog。
- 后台请求最新 catalog hash。
- hash 变化时刷新分类和列表。

详情：

- 按需请求 `GET /v1/experts/{expert_id}`。
- 允许返回 prompt 展示数据。
- 缓存已查看详情，避免重复打开详情时闪烁。

召唤：

- 请求 `GET /v1/experts/{expert_id}/runtime`。
- 创建 Studio 会话。
- 保存 expert snapshot。
- 用 defaultInitPrompt 或 quick prompt 预填 composer。

## 页面布局

桌面布局建议：

```text
/skills
  顶部能力切换：专家 | 技能 | 连接器
  专家工具栏
    搜索
    类型筛选: 全部 / 单专家 / 团队
    排序: 推荐 / 最近 / 名称
    summary count

  专家内容区
    左侧分类列表
    中间专家卡片网格
    右侧详情面板
```

固定高度 shell 下：

- 页面 wrapper 用 `flex min-h-0 flex-1 overflow-hidden`。
- 顶部工具栏固定。
- 专家列表区域单独 `overflow-y-auto`。
- 卡片列表用自然高度 flex/grid，避免 grid auto rows 作为直接滚动容器压缩卡片。

移动布局：

- 顶部搜索和筛选折叠为两行。
- 分类用横向 scroll tabs。
- 专家卡片单列。
- 详情用当前 `/skills` 内的 full-screen dialog 或可返回面板。

## 专家卡片信息

卡片字段：

- avatar
- displayName
- profession
- description 两到三行
- type badge：专家 / 团队
- category
- tags，最多 3 个
- quick prompt 1 条，可点击填入 composer
- skill count
- member count
- mcp required 状态
- summon button

metadata-only 专家：

- 可以展示。
- summon button disabled。
- tooltip 或小型 inline 状态说明“缺少完整专家包”。

团队专家卡片：

- 显示 lead 名称。
- 显示成员数量。
- 显示最多 4 个成员头像或 initials。

## 详情面板

详情字段：

- displayName / profession / description。
- defaultInitPrompt。
- quick prompts 列表。
- tags。
- 团队成员列表，包含 role、name、profession。
- skills 列表，展示名称和描述。
- connector requirements。
- 数据状态：downloaded / metadata-only。
- 版本：runtimeHash 或 updatedAt。
- prompt viewer。
- summon action。

Prompt viewer：

- 单专家展示主 prompt。
- 团队展示 lead prompt 和 member prompt tabs。
- 默认折叠，用户点击后展开。
- 使用只读代码/markdown viewer。
- 显示“专家定义内容，不覆盖系统规则”说明。

## 召唤专家流程

推荐流程：

1. 用户在 `/skills` 的专家 tab 点击“召唤”。
2. 如果专家 `status=metadata_only`，直接 toast 提示不可用。
3. 请求 runtime payload。
4. 创建 chat session。
5. 保存 expert snapshot。
6. 如果专家有 defaultInitPrompt，进入 Studio 后把它填入 composer。
7. 用户确认发送后进入 Phase 2 runtime。

快速 prompt 行为：

- 点击 quick prompt：创建专家会话并预填 composer。
- 第一版不自动发送，避免用户误触。

错误处理：

- API 加载失败用 Sonner toast。
- 分类/列表为空是页面状态。
- 认证失败走现有 AuthSessionGuard。

## 客户端持久缓存

专家 tab 使用本地持久缓存提升首屏：

- `studio_expert_catalog_cache`
- `studio_expert_detail_cache`
- `studio_session_experts`

缓存策略：

- catalog 缓存专家列表和分类。
- detail 缓存已查看专家详情，包括 prompt 展示数据。
- runtime payload 召唤时按需拉取，不作为普通 catalog 缓存长期保存。
- MCP secret 不进入缓存。

## 与现有 Studio 的连接

需要改造入口：

- 新建专家会话后跳转到现有 Studio chat session URL。
- AppSidebar 会话列表可以显示专家 badge 或专家 avatar。
- Studio header 或 composer 附近显示当前专家。
- 普通 chat 会话不显示专家状态。

会话标题：

- 初始标题可以用专家名称 + quick prompt 前几个字。
- 后续仍允许现有 title generation 覆盖，或保留专家名称前缀。建议第一版保留普通标题生成，专家 badge 独立显示。

## 验收标准

- `/skills` 中专家 tab 可以展示专家分类和专家列表。
- 搜索、分类筛选、类型筛选可用。
- 单专家卡片和团队专家卡片信息完整。
- metadata-only 专家不能召唤，并有明确提示。
- 点击专家可查看详情。
- 前端可以展示原始专家 prompt。
- 点击召唤能创建绑定专家的 Studio 会话。
- 页面在固定高度 shell 下只有列表区域滚动，不出现 body/page 双重滚动。
- 控件在移动端不溢出、不重叠。
- 不新增 `/experts` 路由。
