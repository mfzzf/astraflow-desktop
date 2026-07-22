# CompShare OpenAPI Manager 接口文档

本文档覆盖 `internal/api` 下已注册的全部 Action（共 14 个），用于对齐网关调用参数与响应结构。

## 通用约定

- 请求方法：`POST`
- 请求体：JSON，必须包含 `Action`
- 统一响应结构：
  - `Action`：响应动作名（通常为请求 Action + "Response"）
  - `RetCode`：返回码（0 表示成功，非 0 表示错误）
  - `Message`：返回消息
  - `request_uuid`：请求唯一标识

### BaseRequest 公共字段

以下字段来自 `pkg/api/base.go` 的 `BaseRequest`，所有接口请求都内嵌这些字段：

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| Action | `Action` | string | 接口动作名 |
| CompanyID | `company_id` | uint64 | 公司 ID（多数接口必填） |
| TopOrganizationID | `top_organization_id` | uint32 | 顶级组织 ID（多数接口必填） |
| OrganizationID | `organization_id` | uint32 | 项目/组织 ID（多数接口必填） |
| UserID | `user_id` | uint64 | 用户 ID |
| UserEmail | `user_email` | string | 用户邮箱 |
| RequestUUID | `request_uuid` | string | 请求唯一 ID |
| Region | `Region` | string | 透传兼容字段 |
| Zone | `Zone` | string | 透传兼容字段 |
| ZoneID | `zone_id` | uint32 | 透传兼容字段 |
| ProjectID | `ProjectId` | string | 透传兼容字段 |
| AZGroup | `az_group` | uint32 | 透传兼容字段 |
| Channel | `channel` | uint64 | 渠道 |
| AccountId | `account_id` | uint32 | 账户 ID |

### 常见错误码

| RetCode | 含义 |
|---|---|
| 120 | DataFail |
| 150 | ServiceUnavailable |
| 160 | Missing Action |
| 210 | Missing Params |
| 230 | Params Error |
| 216824 | Resource Not Exists |
| 217000 | Action Error |

---

## 接口清单

| Action | Handler 文件 | Request 类型 | Response 类型 | 用途 |
|---|---|---|---|---|
| BuyOpenAPIPlan | `buy_openapi_plan.go` | `BuyOpenAPIPlanRequest` | `BuyOpenAPIPlanResponse` | 购买套餐（个人/团队） |
| CreateOpenAPIKey | `create_openapi_key.go` | `CreateOpenAPIKeyRequest` | `CreateOpenAPIKeyResponse` | 创建 API Key |
| DeleteOpenAPIKey | `delete_openapi_key.go` | `DeleteOpenAPIKeyRequest` | `DeleteOpenAPIKeyResponse` | 删除 API Key |
| UpdateOpenAPIKey | `update_openapi_key.go` | `UpdateOpenAPIKeyRequest` | `UpdateOpenAPIKeyResponse` | 更新 API Key 名称 |
| ListOpenAPIKeys | `list_openapi_keys.go` | `ListOpenAPIKeysRequest` | `ListOpenAPIKeysResponse` | 查询公司下所有 Key |
| ListOpenAPIPlans | `list_openapi_plans.go` | `ListOpenAPIPlansRequest` | `ListOpenAPIPlansResponse` | 查询所有套餐模板 |
| ListOpenAPIUsageRecords | `list_openapi_usage_records.go` | `ListOpenAPIUsageRecordsRequest` | `ListOpenAPIUsageRecordsResponse` | 查询用量记录 |
| GetOpenAPIUserPlans | `get_openapi_user_plans.go` | `GetOpenAPIUserPlansRequest` | `GetOpenAPIUserPlansResponse` | 查询公司下所有套餐实例 |
| GetOpenAPIUserPlanByKey | `get_openapi_user_plan_by_key.go` | `GetOpenAPIUserPlanByKeyRequest` | `GetOpenAPIUserPlanByKeyResponse` | 根据 Key 查询套餐信息 |
| GetOpenAPIPlanUpgradePrice | `get_openapi_plan_upgrade_price.go` | `GetOpenAPIPlanUpgradePriceRequest` | `GetOpenAPIPlanUpgradePriceResponse` | 查询套餐升级价格 |
| UpgradeOpenAPIUserPlan | `upgrade_openapi_user_plan.go` | `UpgradeOpenAPIUserPlanRequest` | `UpgradeOpenAPIUserPlanResponse` | 升级用户套餐 |
| CreateOpenAPIUserPlanRecharge | `create_openapi_user_plan_recharge.go` | `CreateOpenAPIUserPlanRechargeRequest` | `CreateOpenAPIUserPlanRechargeResponse` | 套餐续费 |
| DeleteOpenAPIUserPlan | `delete_openapi_user_plan.go` | `DeleteOpenAPIUserPlanRequest` | `DeleteOpenAPIUserPlanResponse` | 删除用户套餐 |
| UpdateOpenAPIUserPlanDisplayName | `update_openapi_user_plan_display_name.go` | `UpdateOpenAPIUserPlanDisplayNameRequest` | `UpdateOpenAPIUserPlanDisplayNameResponse` | 更新套餐显示名称 |

---

## 1) BuyOpenAPIPlan

**用途**：购买 OpenAPI 套餐，支持个人套餐和团队套餐购买。

- Action: `BuyOpenAPIPlan`
- 请求类型：`BuyOpenAPIPlanRequest`
- 响应类型：`BuyOpenAPIPlanResponse`

### 功能说明

- **个人套餐购买**（`IsTeam=false`）：
  - 一个公司只能有一个生效的非团队套餐（团队套餐不计入此限制）
  - 自动复用公司下未删除的 Key（不包括绑定到团队套餐的 Key）
  - 购买数量固定为 1
  
- **团队套餐购买**（`IsTeam=true`）：
  - 支持批量购买（1-100 份）
  - 每份独立创建用户套餐和 Key，不复用存量 Key
  - 支持部分成功：第一份失败时整体回滚；中途失败时保留已成功份，清理失败份
  
- **流水线**：参数校验 → 创建资源 → 计费下单 → 落库 → 激活资源 → 异步交付订单
- **失败回滚**：取消订单、软删套餐/Key、删除资源系统记录

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| PlanCode | `PlanCode` | string | 是 | 套餐模板 Code |
| KeyName | `KeyName` | string | 否 | 初始 Key 名称，默认 `default` |
| IsTeam | `IsTeam` | bool | 否 | 是否团队购买，默认 false |
| Count | `Count` | int | 否 | 团队购买份数（1-100），非团队购买忽略此参数 |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| UserPlan | `UserPlan` | object | 第一份套餐信息（向后兼容） |
| UserPlans | `UserPlans` | array | 所有成功购买的套餐列表 |
| RequestedCount | `RequestedCount` | int | 请求购买数量 |
| SuccessCount | `SuccessCount` | int | 实际成功数量 |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`PlanCode` 必填
- 非团队购买时，公司已有活跃的非团队套餐会返回错误
- 团队购买时，套餐模板必须是团队套餐（`is_team=1`）
- 特定老套餐（`cp-lcnqfh3obetl9mmz`、`cp-h7inzqgevsjf1ema`）禁止购买

---

## 2) CreateOpenAPIKey

**用途**：为指定的用户套餐创建一个新的 API Key。

- Action: `CreateOpenAPIKey`
- 请求类型：`CreateOpenAPIKeyRequest`
- 响应类型：`CreateOpenAPIKeyResponse`

### 功能说明

- 在资源系统创建 Key 资源
- 生成唯一的 API Key（64 字符随机字符串）
- Key 与指定的用户套餐绑定
- API Key 唯一性冲突时自动重试（最多 8 次）
- 失败时自动回滚：软删数据库记录、删除资源系统记录

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 用户套餐实例 Code |
| KeyName | `KeyName` | string | 否 | Key 名称，默认 `default` |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| Key | `Key` | object | 新建的 Key 信息（`Code/Name/APIKey/Status/CreatedAt`） |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`UserPlanCode` 必填
- 用户套餐必须存在且属于指定公司

---

## 3) DeleteOpenAPIKey

**用途**：软删除指定的 API Key（设置 deleted_at 和 status=0）。

- Action: `DeleteOpenAPIKey`
- 请求类型：`DeleteOpenAPIKeyRequest`
- 响应类型：`DeleteOpenAPIKeyResponse`

### 功能说明

- 软删除 Key 记录（不物理删除）
- 删除后 API Key 将无法继续使用
- 同时更新资源系统状态

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| KeyCode | `KeyCode` | string | 是 | Key 唯一编码 |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段

仅返回通用 `BaseResponse` 字段。

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`KeyCode` 必填
- `KeyCode` 会 trim 空格，空串视为非法

---

## 4) UpdateOpenAPIKey

**用途**：更新 API Key 的名称。

- Action: `UpdateOpenAPIKey`
- 请求类型：`UpdateOpenAPIKeyRequest`
- 响应类型：`UpdateOpenAPIKeyResponse`

### 功能说明

- 仅支持更新 Key 的名称字段
- 名称为空时设置为 `default`
- 返回更新后的完整 Key 信息

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| KeyCode | `KeyCode` | string | 是 | Key 唯一编码 |
| KeyName | `KeyName` | string | 否 | 新名称，空值时置为 `default` |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| Key | `Key` | object | 更新后的 Key 信息 |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`KeyCode` 必填
- `KeyCode` 会 trim 空格，空串视为非法

---

## 5) ListOpenAPIKeys

**用途**：查询指定公司下的所有 API Key 列表（包括关联的套餐信息）。

- Action: `ListOpenAPIKeys`
- 请求类型：`ListOpenAPIKeysRequest`
- 响应类型：`ListOpenAPIKeysResponse`

### 功能说明

- 返回公司下所有未软删除的 Key
- 包含每个 Key 关联的用户套餐详细信息
- 可用于管理和查看公司的所有 API Key

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| TotalCount | `TotalCount` | int | Key 总数 |
| Keys | `Keys` | array | Key 列表，元素类型 `KeyListItem` |

**KeyListItem** 主要字段：
- `Code`：Key 唯一编码
- `Name`：Key 名称
- `APIKey`：API Key 字符串
- `Status`：状态（1=正常）
- `UserPlanCode`：关联的套餐编码
- `UserPlan`：完整的套餐信息对象
- `CreatedAt`：创建时间
- `UpdatedAt`：更新时间

### 参数校验

- `company_id`、`top_organization_id`、`organization_id` 必填

---

## 6) ListOpenAPIPlans

**用途**：查询所有可购买的套餐模板列表（包括价格和支持的模型）。

- Action: `ListOpenAPIPlans`
- 请求类型：`ListOpenAPIPlansRequest`
- 响应类型：`ListOpenAPIPlansResponse`

### 功能说明

- 返回所有状态正常的套餐模板
- 并发查询每个套餐的购买价格（从计费系统获取实时价格）
- 包含每个套餐支持的 AI 模型列表和倍率信息
- 价格查询失败不影响套餐列表返回（价格为 0）

### 请求参数

无业务专属参数（仅 `BaseRequest` 公共字段）。可选传入 `top_organization_id` 用于价格查询，未传时使用默认组织 ID。

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| TotalCount | `TotalCount` | int | 套餐总数 |
| Plans | `Plans` | array | 套餐列表，元素类型 `PlanItem` |

**PlanItem** 主要字段：
- `Code`：套餐模板编码
- `Name`：套餐名称
- `LimitPer5h`：5 小时调用次数限制
- `LimitPerWeek`：周调用次数限制
- `LimitPerMonth`：月调用次数限制
- `ConcurrencyLimit`：并发数限制
- `IsTeam`：是否团队套餐
- `Status`：状态
- `CreatedAt`：创建时间
- `Models`：支持的模型列表（含模型编码、名称、倍率）
- `Price`：实付价格（元）
- `OriginalPrice`：原价（元）

---

## 7) ListOpenAPIUsageRecords

**用途**：查询 API 调用用量记录，支持多维度过滤和分页。

- Action: `ListOpenAPIUsageRecords`
- 请求类型：`ListOpenAPIUsageRecordsRequest`
- 响应类型：`ListOpenAPIUsageRecordsResponse`

### 功能说明

- 查询公司下的 API 调用历史记录
- 支持按 Key、时间范围过滤
- 支持分页查询（默认每页 20 条，最多 100 条）
- 记录不包含敏感的 APIKey 字段

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| KeyCodes | `KeyCodes` | []string | 否 | 按 key_code 过滤（支持多个） |
| BeginTime | `BeginTime` | int64 | 否 | `start_time` 起始时间（Unix 秒，含边界） |
| EndTime | `EndTime` | int64 | 否 | `start_time` 结束时间（Unix 秒，不含边界） |
| Page | `Page` | int | 否 | 页码（1-based，默认 1） |
| PageSize | `PageSize` | int | 否 | 每页条数（范围 [10,100]，默认 20） |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| TotalCount | `TotalCount` | int | 总条数 |
| Page | `Page` | int | 当前页 |
| PageSize | `PageSize` | int | 每页大小 |
| Records | `Records` | array | 记录列表，元素类型 `UsageRecordItem` |

**UsageRecordItem** 主要字段：
- `ID`：记录 ID
- `CompanyID`：公司 ID
- `UserPlanCode`：套餐编码
- `KeyCode`：Key 编码
- `KeyName`：Key 名称
- `UserPlanName`：套餐名称
- `RequestUUID`：请求唯一标识
- `UpstreamID`：上游请求 ID
- `ModelCode`：模型编码
- `ModelName`：模型名称
- `RequestMethod`：请求方法
- `RequestPath`：请求路径
- `StartTime`：开始时间（Unix 秒）
- `EndTime`：结束时间（Unix 秒）
- `UsageRaw`：原始用量 JSON
- `Cost`：消耗次数
- `CreatedAt`：创建时间
- `UpdatedAt`：更新时间

**注意**：响应中不包含 `APIKey` 字段（安全考虑）

### 参数校验与分页规则

- `company_id`、`top_organization_id`、`organization_id` 必填
- 同时传 `BeginTime` 与 `EndTime` 时，必须满足 `BeginTime <= EndTime`
- `Page < 1` 会被修正为 `1`
- `PageSize` 会被夹紧到 `[10, 100]`；`0` 时默认 `20`

---

## 8) GetOpenAPIUserPlans

**用途**：查询指定公司下的所有套餐实例（包括生效和已删除的套餐）。

- Action: `GetOpenAPIUserPlans`
- 请求类型：`GetOpenAPIUserPlansRequest`
- 响应类型：`GetOpenAPIUserPlansResponse`

### 功能说明

- 返回公司所有套餐实例，包括：
  - `UserPlans`：正常生效的套餐（未软删除）
  - `InvalidUserPlans`：已软删除的套餐（历史记录）
- 包含每个套餐的配额、用量、过期时间等完整信息
- 包含套餐关联的所有 Key 列表

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| TotalCount | `TotalCount` | int | 套餐数量（仅生效套餐） |
| UserPlans | `UserPlans` | array | 生效套餐列表，元素类型 `UserPlanItem` |
| InvalidUserPlans | `InvalidUserPlans` | array | 已删除套餐列表，元素类型 `UserPlanItem` |

**UserPlanItem** 主要字段：
- `Code`：用户套餐编码
- `CompanyID`：公司 ID
- `PlanCode`：套餐模板编码
- `PlanName`：套餐模板名称
- `DisplayName`：套餐显示名称（可自定义）
- `LimitPer5h`：5 小时配额
- `LimitPerWeek`：周配额
- `LimitPerMonth`：月配额
- `ConcurrencyLimit`：并发限制
- `UsagePer5h`：5 小时已用量
- `UsagePerWeek`：周已用量
- `UsagePerMonth`：月已用量
- `IsTeam`：是否团队套餐
- `Status`：状态（1=正常，0=已删除）
- `CreatedAt`：创建时间
- `ExpireAt`：过期时间（Unix 秒）
- `Keys`：关联的 Key 列表

### 参数校验

- `company_id`、`top_organization_id`、`organization_id` 必填

---

## 9) GetOpenAPIUserPlanByKey

**用途**：根据 Key 编码或 API Key 字符串查询关联的套餐信息。

- Action: `GetOpenAPIUserPlanByKey`
- 请求类型：`GetOpenAPIUserPlanByKeyRequest`
- 响应类型：`GetOpenAPIUserPlanByKeyResponse`

### 功能说明

- 通过 Key 快速查询其绑定的用户套餐
- 支持通过 `KeyCode`（资源编码）或 `APIKey`（API Key 字符串）查询
- 同时返回 Key 和套餐的完整信息
- 常用于 API 请求鉴权时获取配额和限流信息

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| KeyCode | `KeyCode` | string | 条件必填 | 与 `APIKey` 二选一；同时传时优先 `KeyCode` |
| APIKey | `APIKey` | string | 条件必填 | 与 `KeyCode` 二选一 |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| Key | `Key` | object | Key 信息（`KeyItem`） |
| UserPlan | `UserPlan` | object | 绑定套餐信息（`UserPlanItem`） |

### 参数校验

- `KeyCode` 与 `APIKey` 不能同时为空
- 至少提供一个查询条件

---

## 10) GetOpenAPIPlanUpgradePrice

**用途**：计算套餐升级的价格（补差价）。

- Action: `GetOpenAPIPlanUpgradePrice`
- 请求类型：`GetOpenAPIPlanUpgradePriceRequest`
- 响应类型：`GetOpenAPIPlanUpgradePriceResponse`

### 功能说明

- 查询从当前套餐升级到目标套餐需要支付的差价
- 基于剩余有效期按比例计算
- 返回实付价和原价，支持折扣展示
- 调用前可用于向用户展示升级成本

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 当前用户套餐实例 Code |
| NewPlanCode | `NewPlanCode` | string | 是 | 目标套餐模板 Code |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| Price | `Price` | float64 | 升级实付差价（元） |
| OriginalPrice | `OriginalPrice` | float64 | 升级原价（元） |
| NewPlanPrice | `NewPlanPrice` | float64 | 新套餐购买价（元） |
| NewPlanOriginalPrice | `NewPlanOriginalPrice` | float64 | 新套餐购买原价（元） |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`UserPlanCode`、`NewPlanCode` 必填
- 目标套餐不能和当前套餐相同
- 特定老套餐（`cp-lcnqfh3obetl9mmz`、`cp-h7inzqgevsjf1ema`、`cp-fgxrw829h9964tnj`）禁止作为升级目标

---

## 11) UpgradeOpenAPIUserPlan

**用途**：将用户套餐升级到更高级别的套餐（对齐预付费升级流程）。

- Action: `UpgradeOpenAPIUserPlan`
- 请求类型：`UpgradeOpenAPIUserPlanRequest`
- 响应类型：`UpgradeOpenAPIUserPlanResponse`

### 功能说明

- 升级套餐配额（5小时/周/月限制、并发限制等）
- 更新套餐快照并重置用量计数器
- 通过计费系统 ModifyResource 补差价
- 升级后用量重置为 0，开始使用新配额
- **流水线**：校验 → 计费改配（补差价订单）→ 本地更新套餐快照和用量 → 交付订单
- **失败回滚**：取消未交付订单（ReceiptOrder(-1)）

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 当前用户套餐实例 Code |
| NewPlanCode | `NewPlanCode` | string | 是 | 目标套餐模板 Code |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| UserPlan | `UserPlan` | object | 升级后的套餐信息（`UserPlanItem`） |
| OrderNo | `OrderNo` | string | 计费订单号（可能为空） |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`UserPlanCode`、`NewPlanCode` 必填
- 目标套餐必须存在且 `order_product_id` 已配置
- 目标套餐不能与当前套餐相同
- 特定老套餐（`cp-lcnqfh3obetl9mmz`、`cp-h7inzqgevsjf1ema`、`cp-fgxrw829h9964tnj`）禁止作为升级目标

### 注意事项

- 升级成功后，所有用量计数器（5小时/周/月）重置为 0
- 套餐有效期不变，按剩余时长补差价
- 订单交付失败会告警，但不影响升级结果（本地数据已更新）

---

## 12) CreateOpenAPIUserPlanRecharge

**用途**：为用户套餐续费（延长有效期）。

- Action: `CreateOpenAPIUserPlanRecharge`
- 请求类型：`CreateOpenAPIUserPlanRechargeRequest`
- 响应类型：`CreateOpenAPIUserPlanRechargeResponse`

### 功能说明

- 对现有套餐进行续费，延长使用期限
- 不改变套餐配额，仅延长有效期
- 通过计费系统创建续费订单
- 续费成功后套餐过期时间顺延

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 套餐实例 Code |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| OrderNo | `OrderNo` | string | 续费订单号（可能为空） |

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`UserPlanCode` 必填
- 套餐必须存在且属于指定公司

---

## 13) DeleteOpenAPIUserPlan

**用途**：删除用户套餐（软删除，同时删除关联的 Key 和资源）。

- Action: `DeleteOpenAPIUserPlan`
- 请求类型：`DeleteOpenAPIUserPlanRequest`
- 响应类型：`DeleteOpenAPIUserPlanResponse`

### 功能说明

- 软删除套餐记录（设置 `deleted_at` 和 `status=0`）
- 同时软删除该套餐下的所有 Key
- 删除资源系统中的套餐和 Key 资源
- 删除后套餐和 Key 将无法继续使用

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 套餐实例 Code |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |
| TopOrganizationID | `top_organization_id` | uint32 | 是 | 顶级组织 ID |
| OrganizationID | `organization_id` | uint32 | 是 | 组织/项目 ID |

### 响应字段

仅返回通用 `BaseResponse` 字段。

### 参数校验

- `company_id`、`top_organization_id`、`organization_id`、`UserPlanCode` 必填
- 套餐必须存在且属于指定公司

---

## 14) UpdateOpenAPIUserPlanDisplayName

**用途**：更新用户套餐的显示名称（自定义名称）。

- Action: `UpdateOpenAPIUserPlanDisplayName`
- 请求类型：`UpdateOpenAPIUserPlanDisplayNameRequest`
- 响应类型：`UpdateOpenAPIUserPlanDisplayNameResponse`

### 功能说明

- 允许用户自定义套餐的显示名称
- 不影响套餐模板名称（`PlanName`）
- 用于个性化标识和管理多个套餐

### 请求参数

| 字段 | JSON | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 是 | 套餐实例 Code |
| DisplayName | `DisplayName` | string | 是 | 显示名称（最大 128 字符） |
| CompanyID | `company_id` | uint64 | 是 | 公司 ID |

### 响应字段（业务部分）

| 字段 | JSON | 类型 | 说明 |
|---|---|---|---|
| UserPlanCode | `UserPlanCode` | string | 套餐编码 |
| DisplayName | `DisplayName` | string | 更新后的显示名称 |

### 参数校验

- `company_id`、`UserPlanCode`、`DisplayName` 必填
- `DisplayName` 不能为空（trim 后）
- `DisplayName` 长度不能超过 128 个字符（按 rune 计算）
- 套餐必须存在且属于指定公司

## 错误返回补充说明

常见错误码及其含义：

| RetCode | 含义 | 说明 |
|---|---|---|
| 0 | Success | 操作成功 |
| 120 | DataFail | 数据操作失败 |
| 150 | ServiceUnavailable | 服务不可用（如数据库连接失败） |
| 160 | Missing Action | 缺少 Action 参数 |
| 210 | MissingParams | 缺少必填参数 |
| 230 | ParamsError | 参数值不合法（如时间区间错误、升级目标与当前套餐相同） |
| 216824 | ResourceNotExists | 关联资源不存在（套餐、Key、计费资源等） |
| 217000 | ActionError | 业务处理失败（DB 操作、外部服务调用、事务失败等） |

### 错误响应示例

```json
{
  "Action": "BuyOpenAPIPlanResponse",
  "RetCode": 210,
  "Message": "missing required parameter: company_id",
  "request_uuid": "req-12345"
}
```

### 常见错误场景

1. **MissingParams (210)**
   - 缺少 `company_id`、`top_organization_id`、`organization_id` 等必填字段
   - `PlanCode`、`UserPlanCode`、`KeyCode` 等业务必填字段为空

2. **ParamsError (230)**
   - 时间区间不合法：`BeginTime > EndTime`
   - 升级套餐与当前套餐相同
   - 团队购买数量超出范围（1-100）
   - 显示名称长度超过 128 字符

3. **ResourceNotExists (216824)**
   - 套餐模板不存在
   - 用户套餐实例不存在
   - Key 不存在或不属于指定公司

4. **ActionError (217000)**
   - 公司已有活跃套餐，禁止重复购买（非团队套餐）
   - 套餐模板未配置 `order_product_id`
   - 资源系统调用失败
   - 计费系统调用失败
   - 数据库事务失败
   - 老套餐禁止购买/升级

5. **ServiceUnavailable (150)**
   - 数据库连接失败
   - 外部服务不可用

---

## 附加说明

### 关于套餐类型

- **个人套餐**（`IsTeam=false`）：
  - 一个公司只能有一个生效的个人套餐
  - 可以复用公司下现有的 Key
  - 购买时会自动绑定未删除的 Key
  
- **团队套餐**（`IsTeam=true`）：
  - 一个公司可以购买多个团队套餐
  - 每个团队套餐独立创建 Key，不复用
  - 支持批量购买（1-100 份）
  - 团队套餐的 Key 不会被个人套餐复用

### 关于资源管理

- 所有套餐和 Key 都在资源系统（UResource）中注册
- 资源状态流转：Init(0) → Normal(1)
- 删除操作会同时清理数据库记录和资源系统记录

### 关于计费流程

- 购买套餐：创建资源 → 下单 → 落库 → 激活资源 → 异步交付订单
- 升级套餐：ModifyResource（补差价）→ 更新本地快照 → 交付订单
- 续费套餐：创建续费订单 → 延长有效期
- 失败回滚：取消订单（ReceiptOrder(-1)）、软删记录、删除资源

### 关于用量统计

- 套餐包含三个时间维度的用量统计：
  - 5 小时滚动窗口（`UsagePer5h`）
  - 周滚动窗口（`UsagePerWeek`）
  - 月滚动窗口（`UsagePerMonth`）
- 升级套餐后所有用量计数器重置为 0
- 每个维度都有对应的更新时间戳

### API Key 安全

- API Key 为 64 字符随机字符串
- 生成时检查唯一性，冲突时自动重试
- 查询用量记录时不返回完整 API Key
- Key 删除后立即失效，无法恢复

---

文档中未逐一展开所有子字段的完整定义时，请以 `pkg/api/*.go` 中对应 `Request/Response` 结构体为最终准入标准。
