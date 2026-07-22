"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBankCardLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiCoupon3Line,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiFileCopyLine,
  RiFlashlightLine,
  RiHistoryLine,
  RiInformationLine,
  RiKey2Line,
  RiLineChartLine,
  RiLoader4Line,
  RiMore2Line,
  RiRefreshLine,
  RiRestartLine,
  RiShieldKeyholeLine,
  RiShoppingBag3Line,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { getSidebarAwarePageInsetClassName } from "@/components/app-page-inset"
import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type CompSharePlanModel = {
  code: string
  name: string
  ratio: number
}

type CompSharePlan = {
  code: string
  name: string
  limitPer5h: number
  limitPerWeek: number
  limitPerMonth: number
  concurrencyLimit: number
  isTeam: boolean
  status: number
  createdAt: string | number | null
  models: CompSharePlanModel[]
  price: number
  originalPrice: number
}

type CompShareUserPlan = {
  code: string
  planCode: string
  planName: string
  displayName: string
  limitPer5h: number
  limitPerWeek: number
  limitPerMonth: number
  concurrencyLimit: number
  usagePer5h: number
  usagePerWeek: number
  usagePerMonth: number
  isTeam: boolean
  status: number
  createdAt: string | number | null
  expireAt: string | number | null
  keys: CompShareKey[]
}

type CompShareKey = {
  code: string
  name: string
  maskedApiKey: string | null
  status: number
  userPlanCode: string
  userPlan: CompShareUserPlan | null
  createdAt: string | number | null
  updatedAt: string | number | null
  selected: boolean
}

type CompShareUsageRecord = {
  id: string | number | null
  userPlanCode: string
  keyCode: string
  keyName: string
  userPlanName: string
  requestUuid: string
  upstreamId: string
  modelCode: string
  modelName: string
  requestMethod: string
  requestPath: string
  startTime: number
  endTime: number
  usageRaw: unknown
  cost: number
  createdAt: string | number | null
  updatedAt: string | number | null
}

type OneTimeKey = {
  keyCode: string
  userPlanCode: string
  apiKey: string
}

type PurchaseResponse = {
  userPlan: CompShareUserPlan | null
  userPlans: CompShareUserPlan[]
  requestedCount: number
  successCount: number
  partial: boolean
  selectedKey: { keyCode: string; userPlanCode: string } | null
  oneTimeKeys: OneTimeKey[]
  warning: { retCode: number; message: string } | null
}

type UpgradeQuote = {
  price: number
  originalPrice: number
  newPlanPrice: number
  newPlanOriginalPrice: number
}

type RechargeQuote = {
  userPlanCode: string
  planCode: string
  planName: string
  price: number
  originalPrice: number
  currentExpireAt: string | number | null
  balance: {
    amount: number
    amountFree: number
    amountFreeze: number
    amountCredit: number
    amountAvailable: number
  }
  sufficientBalance: boolean
}

type UsageFilters = {
  keyCode: string
  beginDate: string
  endDate: string
}

type PlansTab = "overview" | "catalog" | "keys" | "usage"
type PlanAudience = "individual" | "team"
type LoadStatus = "loading" | "ready" | "error"

const HIDDEN_CODING_PLAN_CODES: Record<string, true> = {
  "cp-lcnqfh3obetl9mmz": true,
  "cp-h7inzqgevsjf1ema": true,
}

const plansCopy = {
  en: {
    title: "Coding Plan",
    loading: "Loading package information",
    overview: "My plans",
    catalog: "Plans",
    keys: "API keys",
    usage: "Usage",
    refresh: "Refresh",
    refreshing: "Refreshing",
    loadFailed: "Could not load package information",
    loadFailedDescription:
      "Check your CompShare credentials and try again. Existing information remains visible when available.",
    retry: "Try again",
    activePlans: "Active packages",
    activePlansDescription:
      "Monitor quotas, manage billing, and choose which package powers the model gateway.",
    activeCount: "active",
    quotaUsage: "Quota usage",
    noActivePlans: "No active package yet",
    noActivePlansDescription:
      "Choose a package from the catalog to unlock its models and create a scoped API key.",
    browseCatalog: "Browse catalog",
    invalidPlans: "Package history",
    invalidPlansDescription:
      "Deleted and inactive packages are retained here for audit context.",
    noInvalidPlans: "No inactive packages",
    audienceLabel: "Plan type",
    individualPlansDescription:
      "Personal plans are designed for one account and include one scoped model gateway.",
    teamPlansDescription:
      "Team plans support multiple seats and issue an independent scoped key for each purchased plan.",
    billingUnit: "/ month",
    benefits: "Plan benefits",
    modelCoverage: "Included models",
    modelRatiosBenefit: "Transparent per-model usage multipliers",
    toolCompatibility:
      "Works with Claude Code, OpenCode, and compatible agents",
    noCatalogPlans: "No packages are currently available",
    noCatalogPlansDescription:
      "The provider returned an empty catalog. Refresh to check again.",
    team: "Team",
    individual: "Individual",
    active: "Active",
    inactive: "Inactive",
    selected: "Selected",
    select: "Use this key",
    selecting: "Selecting",
    statusUnavailable: "Unavailable",
    fiveHourQuota: "5-hour quota",
    weeklyQuota: "Weekly quota",
    monthlyQuota: "Monthly quota",
    concurrency: "Concurrent requests",
    used: "used",
    notSet: "Not set",
    model: "model",
    models: "models",
    includedModels: "Included models",
    gatewayModel: "Gateway model",
    multiplier: "Multiplier",
    viewAllModels: "View all models",
    noModels: "No models listed",
    expires: "Expires",
    created: "Created",
    noExpiry: "No expiry provided",
    keyCount: "API keys",
    manageKeys: "Manage keys",
    packageActions: "Package actions",
    upgrade: "Upgrade",
    recharge: "Recharge",
    rename: "Rename",
    delete: "Delete",
    purchase: "Purchase",
    purchasing: "Purchasing",
    currentPackage: "Current package",
    included: "included",
    priceUnavailable: "Price unavailable",
    perPackage: "per package",
    originalPrice: "Original price",
    purchaseTitle: "Purchase package",
    purchaseDescription:
      "Review the package and billing details before creating provider resources.",
    teamCount: "Number of team packages",
    teamCountDescription:
      "Each package receives its own scoped API key. You can purchase 1–100 at once.",
    teamCountInvalid: "Enter a whole number from 1 to 100.",
    keyName: "Initial key name",
    keyNamePlaceholder: "default",
    keyNameDescription:
      "Use a recognizable name. You can rename the key later without rotating it.",
    estimatedTotal: "Estimated total",
    billingNotice:
      "Confirming may create a billable CompShare order. This action is not a preview.",
    individualBlocked:
      "An active individual package already exists. Upgrade that package or choose a team package.",
    packageUnavailable: "This package is not currently purchasable.",
    cancel: "Cancel",
    confirmPurchase: "Confirm purchase",
    purchaseSucceeded: "Package purchased",
    purchasePartial: "Purchase partially completed",
    partialTitle: "Some team packages were not created",
    partialDescription:
      "Successful packages remain active. Review the result before retrying so you do not purchase duplicates.",
    requested: "Requested",
    completed: "Completed",
    dismiss: "Dismiss",
    upgradeTitle: "Upgrade package",
    upgradeDescription:
      "Choose a replacement package, request an exact prorated quote, then confirm the upgrade.",
    targetPackage: "Target package",
    chooseTarget: "Choose a target package",
    getQuote: "Get quote",
    quoting: "Getting quote",
    quoteRequired: "Request a quote to enable confirmation.",
    upgradePrice: "Amount due now",
    newPackagePrice: "New package price",
    usageResetWarning:
      "Upgrading resets all 5-hour, weekly, and monthly usage counters to zero. The expiry date does not change.",
    confirmUpgrade: "Confirm upgrade",
    upgrading: "Upgrading",
    upgraded: "Package upgraded",
    noUpgradeTargets:
      "No compatible upgrade targets are available in the current catalog.",
    rechargeTitle: "Recharge package",
    rechargeDescription:
      "Recharge extends this package through a new CompShare billing order without changing its quotas.",
    rechargeWarning:
      "Subscription renewals are charged immediately and are non-refundable. Confirm the current amount before paying.",
    rechargeAmount: "Renewal total",
    balancePayment: "Account balance",
    availableBalance: "Available balance",
    rechargeQuoteLoading: "Loading current renewal price",
    insufficientBalance:
      "The available CompShare balance is not enough for this renewal.",
    confirmRecharge: "Confirm and pay",
    recharging: "Recharging",
    recharged: "Package recharged",
    orderCreated: "Order created",
    renamePackageTitle: "Rename package",
    renamePackageDescription:
      "The display name helps distinguish packages and does not change the package template.",
    displayName: "Display name",
    displayNameRequired: "Enter a display name.",
    save: "Save",
    saving: "Saving",
    packageRenamed: "Package renamed",
    deletePackageTitle: "Delete package",
    deletePackageDescription:
      "This permanently disables the package and every API key attached to it.",
    deletePackageWarning:
      "Provider resources and keys are removed immediately. This action cannot be undone.",
    typeToConfirm: "Type the package name to confirm",
    confirmationMismatch: "The confirmation does not match the package name.",
    confirmDeletePackage: "Delete package",
    deleting: "Deleting",
    packageDeleted: "Package deleted",
    keysDescription:
      "Keys are scoped to one package. Existing secrets stay masked; newly issued secrets are shown only once.",
    createKey: "Create key",
    noKeys: "No API keys",
    noKeysDescriptionWithPlans:
      "Create a scoped key for an active package, then select it for model requests.",
    noKeysDescriptionWithoutPlans:
      "Purchase a package before creating an API key.",
    package: "Package",
    name: "Name",
    secret: "Secret",
    status: "Status",
    actions: "Actions",
    providerDetails: "Provider details",
    keyActions: "Key actions",
    createKeyTitle: "Create API key",
    createKeyDescription:
      "The key is scoped to the selected package and becomes the active model key after creation.",
    choosePackage: "Choose a package",
    create: "Create",
    creating: "Creating",
    keyCreated: "API key created",
    renameKeyTitle: "Rename API key",
    renameKeyDescription:
      "Renaming changes only the label. The underlying secret remains the same.",
    keyNameRequired: "Enter a key name.",
    keyRenamed: "API key renamed",
    deleteKeyTitle: "Delete API key",
    deleteKeyDescription:
      "This key stops working immediately. Requests using the secret will be rejected.",
    selectedKeyDeleteWarning:
      "This is the currently selected model key. Deleting it also clears the active package selection.",
    confirmDeleteKey: "Delete key",
    keyDeleted: "API key deleted",
    keySelected: "Model key selected",
    providerDetailsTitle: "Provider package details",
    providerDetailsDescription:
      "Live package information resolved by the provider from this key code.",
    providerDetailsFailed: "Could not resolve provider package details.",
    oneTimeTitle: "Save your new API key now",
    oneTimeDescription:
      "This is the only time the full secret is shown. Copy it before closing; it cannot be revealed again.",
    oneTimeTeamDescription:
      "Each team package has a different secret. Save every key before closing this dialog.",
    copy: "Copy",
    copyAll: "Copy all",
    copied: "Copied to clipboard",
    copyFailed: "Could not copy the key",
    closeAndHide: "I saved the keys",
    usageDescription:
      "Inspect provider request records, model multipliers, and billable request cost.",
    usageFilters: "Usage filters",
    allKeys: "All keys",
    beginDate: "From date",
    endDate: "Through date",
    applyFilters: "Apply",
    invalidDateRange: "The end date must not be earlier than the start date.",
    usageLoadFailed: "Could not load provider usage",
    noUsage: "No usage records",
    noUsageDescription:
      "Requests made with package keys will appear here. Adjust the filters or make a model request first.",
    request: "Request",
    key: "Key",
    cost: "Cost",
    started: "Started",
    details: "Details",
    previous: "Previous",
    next: "Next",
    page: "Page",
    usageDetailsTitle: "Provider usage record",
    usageDetailsDescription:
      "Request metadata returned by CompShare. Full API key secrets are never included.",
    requestId: "Request ID",
    upstreamId: "Upstream ID",
    method: "Method",
    path: "Path",
    duration: "Duration",
    providerUsage: "Provider usage",
    rawUsageUnavailable: "No provider usage payload was recorded.",
    unknown: "Unknown",
    operationFailed: "The operation could not be completed.",
  },
  zh: {
    title: "Coding Plan",
    loading: "正在加载套餐信息",
    overview: "我的套餐",
    catalog: "购买方案",
    keys: "API 密钥",
    usage: "用量",
    refresh: "刷新",
    refreshing: "正在刷新",
    loadFailed: "无法加载套餐信息",
    loadFailedDescription:
      "请检查优云智算凭证后重试。若已有缓存数据，页面会继续保留显示。",
    retry: "重试",
    activePlans: "生效套餐",
    activePlansDescription:
      "查看配额与账单操作，并选择用于模型网关的套餐密钥。",
    activeCount: "个生效",
    quotaUsage: "配额使用",
    noActivePlans: "尚无生效套餐",
    noActivePlansDescription:
      "请先从套餐目录购买套餐，以解锁对应模型并创建专属 API 密钥。",
    browseCatalog: "浏览套餐",
    invalidPlans: "套餐历史",
    invalidPlansDescription: "已删除和已失效套餐会保留在此，便于审计。",
    noInvalidPlans: "暂无失效套餐",
    audienceLabel: "方案类型",
    individualPlansDescription:
      "个人方案绑定当前账号，适合个人开发者和单人模型调用。",
    teamPlansDescription:
      "团队方案支持批量购买，每份方案都会签发独立的模型调用密钥。",
    billingUnit: "元/月",
    benefits: "权益说明",
    modelCoverage: "覆盖模型",
    modelRatiosBenefit: "不同模型倍率透明，按实际调用扣减配额",
    toolCompatibility: "支持 Claude Code、OpenCode 等兼容 Agent 工具",
    noCatalogPlans: "当前没有可购买套餐",
    noCatalogPlansDescription: "服务商返回了空目录，请刷新后重试。",
    team: "团队",
    individual: "个人",
    active: "生效",
    inactive: "失效",
    selected: "已选择",
    select: "使用此密钥",
    selecting: "正在选择",
    statusUnavailable: "不可用",
    fiveHourQuota: "5 小时配额",
    weeklyQuota: "每周配额",
    monthlyQuota: "每月配额",
    concurrency: "并发请求",
    used: "已用",
    notSet: "未设置",
    model: "个模型",
    models: "个模型",
    includedModels: "包含模型",
    gatewayModel: "网关模型",
    multiplier: "倍率",
    viewAllModels: "查看全部模型",
    noModels: "未列出模型",
    expires: "到期时间",
    created: "创建时间",
    noExpiry: "未提供到期时间",
    keyCount: "API 密钥",
    manageKeys: "管理密钥",
    packageActions: "套餐操作",
    upgrade: "升级",
    recharge: "续费",
    rename: "重命名",
    delete: "删除",
    purchase: "购买",
    purchasing: "正在购买",
    currentPackage: "当前套餐",
    included: "已包含",
    priceUnavailable: "价格暂不可用",
    perPackage: "每份",
    originalPrice: "原价",
    purchaseTitle: "购买套餐",
    purchaseDescription: "创建服务商资源前，请核对套餐和计费信息。",
    teamCount: "团队套餐数量",
    teamCountDescription: "每份套餐都会获得独立密钥，一次可购买 1–100 份。",
    teamCountInvalid: "请输入 1–100 之间的整数。",
    keyName: "初始密钥名称",
    keyNamePlaceholder: "default",
    keyNameDescription: "建议使用易识别的名称，后续重命名不会轮换密钥。",
    estimatedTotal: "预计总价",
    billingNotice: "确认后可能生成优云智算计费订单，此操作不是价格预览。",
    individualBlocked: "已有生效的个人套餐，请升级该套餐或选择团队套餐。",
    packageUnavailable: "该套餐当前不可购买。",
    cancel: "取消",
    confirmPurchase: "确认购买",
    purchaseSucceeded: "套餐购买成功",
    purchasePartial: "部分套餐购买成功",
    partialTitle: "部分团队套餐未创建",
    partialDescription:
      "已成功的套餐会继续生效。再次购买前请核对结果，避免重复下单。",
    requested: "计划购买",
    completed: "成功创建",
    dismiss: "关闭提示",
    upgradeTitle: "升级套餐",
    upgradeDescription: "选择目标套餐，获取精确补差价，再确认升级。",
    targetPackage: "目标套餐",
    chooseTarget: "选择目标套餐",
    getQuote: "获取报价",
    quoting: "正在报价",
    quoteRequired: "请先获取报价，随后才能确认升级。",
    upgradePrice: "当前应付",
    newPackagePrice: "新套餐价格",
    usageResetWarning:
      "升级会将 5 小时、每周和每月用量全部清零，套餐到期时间不变。",
    confirmUpgrade: "确认升级",
    upgrading: "正在升级",
    upgraded: "套餐升级成功",
    noUpgradeTargets: "当前目录没有兼容的升级目标。",
    rechargeTitle: "套餐续费",
    rechargeDescription:
      "续费会通过新的优云智算订单延长套餐有效期，不改变配额。",
    rechargeWarning:
      "订阅服务续费后立即计费，且不支持退款。请确认最新续费金额后再支付。",
    rechargeAmount: "续费合计",
    balancePayment: "账户余额",
    availableBalance: "可用余额",
    rechargeQuoteLoading: "正在获取最新续费价格",
    insufficientBalance: "优云智算账户可用余额不足，暂时无法续费。",
    confirmRecharge: "确认并支付",
    recharging: "正在续费",
    recharged: "套餐续费成功",
    orderCreated: "订单已创建",
    renamePackageTitle: "重命名套餐",
    renamePackageDescription: "显示名称仅用于区分套餐，不会更改套餐模板。",
    displayName: "显示名称",
    displayNameRequired: "请输入显示名称。",
    save: "保存",
    saving: "正在保存",
    packageRenamed: "套餐已重命名",
    deletePackageTitle: "删除套餐",
    deletePackageDescription: "删除会立即停用套餐及其下所有 API 密钥。",
    deletePackageWarning: "服务商资源和密钥会立即移除，且无法撤销。",
    typeToConfirm: "输入套餐名称以确认",
    confirmationMismatch: "输入内容与套餐名称不一致。",
    confirmDeletePackage: "删除套餐",
    deleting: "正在删除",
    packageDeleted: "套餐已删除",
    keysDescription:
      "每个密钥只属于一个套餐。现有密钥始终脱敏，新密钥仅展示一次。",
    createKey: "创建密钥",
    noKeys: "暂无 API 密钥",
    noKeysDescriptionWithPlans:
      "请为生效套餐创建专属密钥，再将其选为模型请求密钥。",
    noKeysDescriptionWithoutPlans: "购买套餐后才能创建 API 密钥。",
    package: "套餐",
    name: "名称",
    secret: "密钥",
    status: "状态",
    actions: "操作",
    providerDetails: "服务商详情",
    keyActions: "密钥操作",
    createKeyTitle: "创建 API 密钥",
    createKeyDescription:
      "新密钥仅属于所选套餐，创建后会自动成为当前模型密钥。",
    choosePackage: "选择套餐",
    create: "创建",
    creating: "正在创建",
    keyCreated: "API 密钥已创建",
    renameKeyTitle: "重命名 API 密钥",
    renameKeyDescription: "重命名只修改标签，底层密钥不会改变。",
    keyNameRequired: "请输入密钥名称。",
    keyRenamed: "API 密钥已重命名",
    deleteKeyTitle: "删除 API 密钥",
    deleteKeyDescription: "密钥会立即失效，使用该密钥的请求将被拒绝。",
    selectedKeyDeleteWarning: "这是当前模型密钥，删除后也会清除当前套餐选择。",
    confirmDeleteKey: "删除密钥",
    keyDeleted: "API 密钥已删除",
    keySelected: "模型密钥已选择",
    providerDetailsTitle: "服务商套餐详情",
    providerDetailsDescription: "服务商根据该密钥编码实时解析出的套餐信息。",
    providerDetailsFailed: "无法解析服务商套餐详情。",
    oneTimeTitle: "请立即保存新 API 密钥",
    oneTimeDescription:
      "完整密钥只显示这一次。关闭前请复制保存，之后无法再次查看。",
    oneTimeTeamDescription: "每份团队套餐对应不同密钥，关闭前请保存全部密钥。",
    copy: "复制",
    copyAll: "复制全部",
    copied: "已复制到剪贴板",
    copyFailed: "无法复制密钥",
    closeAndHide: "我已保存密钥",
    usageDescription: "查看服务商请求记录、模型倍率和计费请求次数。",
    usageFilters: "用量筛选",
    allKeys: "全部密钥",
    beginDate: "开始日期",
    endDate: "结束日期",
    applyFilters: "应用",
    invalidDateRange: "结束日期不能早于开始日期。",
    usageLoadFailed: "无法加载服务商用量",
    noUsage: "暂无用量记录",
    noUsageDescription:
      "套餐密钥发起请求后会显示在这里。请调整筛选条件或先发起模型请求。",
    request: "请求",
    key: "密钥",
    cost: "消耗",
    started: "开始时间",
    details: "详情",
    previous: "上一页",
    next: "下一页",
    page: "第",
    usageDetailsTitle: "服务商用量记录",
    usageDetailsDescription: "优云智算返回的请求元数据，不包含完整 API 密钥。",
    requestId: "请求 ID",
    upstreamId: "上游 ID",
    method: "方法",
    path: "路径",
    duration: "耗时",
    providerUsage: "服务商用量",
    rawUsageUnavailable: "未记录服务商用量数据。",
    unknown: "未知",
    operationFailed: "操作未完成。",
  },
} as const

type PlansCopy = (typeof plansCopy)[keyof typeof plansCopy]

type ApiEnvelope<Data> =
  | { ok: true; data: Data }
  | {
      ok: false
      message?: string
      error?:
        | string
        | {
            code?: string
            message?: string
            requestId?: string
            details?: unknown
          }
    }

async function requestData<Data>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  })
  let payload: ApiEnvelope<Data> | null = null

  try {
    payload = (await response.json()) as ApiEnvelope<Data>
  } catch {
    payload = null
  }

  if (!response.ok || !payload?.ok) {
    const error = payload && !payload.ok ? payload.error : null
    const message =
      typeof error === "string"
        ? error
        : error?.message ||
          (payload && !payload.ok ? payload.message : "") ||
          `Request failed with status ${response.status}.`
    throw new Error(message)
  }

  return payload.data
}

function localeTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(localeTag(locale), {
    maximumFractionDigits: 2,
  }).format(value)
}

function formatMoney(value: number, locale: string) {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value)
}

function toDate(value: string | number | null) {
  if (value === null || value === "") return null
  const numeric = typeof value === "number" ? value : Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value: string | number | null, locale: string) {
  const date = toDate(value)
  if (!date) return "—"
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

function formatDateTime(value: string | number | null, locale: string) {
  const date = toDate(value)
  if (!date) return "—"
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatUnixDateTime(value: number, locale: string) {
  return formatDateTime(value || null, locale)
}

function formatDuration(record: CompShareUsageRecord, locale: string) {
  const milliseconds = Math.max(0, (record.endTime - record.startTime) * 1000)
  if (!milliseconds) return "—"
  if (milliseconds < 1000) return `${formatCount(milliseconds, locale)} ms`
  return `${formatCount(milliseconds / 1000, locale)} s`
}

function planLabel(plan: CompShareUserPlan) {
  return plan.displayName.trim() || plan.planName.trim() || plan.code
}

function modelCountLabel(count: number, copy: PlansCopy) {
  return `${count} ${count === 1 ? copy.model : copy.models}`
}

function parseDateStart(value: string) {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? undefined
    : Math.floor(date.getTime() / 1000)
}

function parseDateEnd(value: string) {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return undefined
  date.setDate(date.getDate() + 1)
  return Math.floor(date.getTime() / 1000)
}

function formatUsageRaw(value: unknown) {
  if (value === null || value === undefined || value === "") return ""

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function QuotaMeter({
  label,
  limit,
  usage,
  copy,
  locale,
}: {
  label: string
  limit: number
  usage?: number
  copy: PlansCopy
  locale: string
}) {
  const hasLimit = limit > 0
  const currentUsage = Math.max(0, usage ?? 0)
  const percentage = hasLimit
    ? Math.min(100, Math.max(0, (currentUsage / limit) * 100))
    : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {hasLimit
            ? usage === undefined
              ? formatCount(limit, locale)
              : `${formatCount(currentUsage, locale)} / ${formatCount(limit, locale)}`
            : copy.notSet}
        </span>
      </div>
      {hasLimit && usage !== undefined ? (
        <div
          aria-label={`${label}: ${formatCount(currentUsage, locale)} ${copy.used}`}
          aria-valuemax={limit}
          aria-valuemin={0}
          aria-valuenow={Math.min(currentUsage, limit)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

function EmptyPanel({
  action,
  description,
  icon,
  title,
}: {
  action?: React.ReactNode
  description: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <Empty className="min-h-72 rounded-4xl border bg-card shadow-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

function PlansSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={label}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-52 max-w-full" />
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <Skeleton className="h-28 w-full" />
            </CardContent>
            <CardFooter>
              <Skeleton className="h-9 w-full" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ModelPreview({
  models,
  copy,
  locale,
  onViewAll,
}: {
  models: CompSharePlanModel[]
  copy: PlansCopy
  locale: string
  onViewAll: () => void
}) {
  if (!models.length) {
    return <p className="text-sm text-muted-foreground">{copy.noModels}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{copy.includedModels}</span>
        <Button type="button" variant="ghost" size="xs" onClick={onViewAll}>
          <RiEyeLine data-icon="inline-start" aria-hidden />
          {copy.viewAllModels}
        </Button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {models.slice(0, 4).map((model) => (
          <li
            className="flex min-w-0 items-center justify-between gap-3 text-sm"
            key={model.code || model.name}
          >
            <span className="truncate text-muted-foreground" title={model.name}>
              {model.name || model.code}
            </span>
            <Badge variant="secondary">
              ×{formatCount(model.ratio, locale)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CatalogPlanCard({
  actionLabel,
  blocked,
  copy,
  locale,
  onAction,
  onViewModels,
  plan,
  purchaseIsTeam,
}: {
  actionLabel: string
  blocked: boolean
  copy: PlansCopy
  locale: string
  onAction: () => void
  onViewModels: () => void
  plan: CompSharePlan
  purchaseIsTeam: boolean
}) {
  const unavailable = plan.status !== 1
  const disabled = blocked || unavailable
  const disabledReason = blocked
    ? copy.individualBlocked
    : unavailable
      ? copy.packageUnavailable
      : ""
  const featuredModels = plan.models
    .slice(0, 3)
    .map((model) => model.name || model.code)
    .filter(Boolean)
    .join(", ")

  return (
    <Card className="group relative h-full overflow-hidden border-border/70 bg-card/95 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-12 size-44 rounded-full bg-primary/8 blur-3xl transition-transform duration-300 group-hover:scale-110"
      />
      <CardHeader className="relative gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="truncate text-lg">
            {plan.name || plan.code}
          </CardTitle>
          <Badge variant={purchaseIsTeam ? "default" : "secondary"}>
            {purchaseIsTeam ? (
              <RiTeamLine data-icon="inline-start" aria-hidden />
            ) : (
              <RiUserLine data-icon="inline-start" aria-hidden />
            )}
            {purchaseIsTeam ? copy.team : copy.individual}
          </Badge>
        </div>
        <CardDescription className="max-w-72 leading-relaxed">
          {purchaseIsTeam
            ? copy.teamPlansDescription
            : copy.individualPlansDescription}
        </CardDescription>
        <div className="flex items-end gap-2">
          {plan.price > 0 ? (
            <>
              <span className="text-4xl leading-none font-semibold tracking-tight tabular-nums">
                {formatCount(plan.price, locale)}
              </span>
              <span className="pb-0.5 text-sm text-muted-foreground">
                {copy.billingUnit}
              </span>
            </>
          ) : (
            <span className="text-lg font-semibold">
              {copy.priceUnavailable}
            </span>
          )}
        </div>
        {plan.originalPrice > plan.price && plan.originalPrice > 0 ? (
          <p className="text-xs text-muted-foreground tabular-nums line-through">
            {copy.originalPrice}: {formatMoney(plan.originalPrice, locale)}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="relative flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">
              {copy.fiveHourQuota}
            </p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCount(plan.limitPer5h, locale)}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">{copy.weeklyQuota}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCount(plan.limitPerWeek, locale)}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">{copy.monthlyQuota}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCount(plan.limitPerMonth, locale)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{copy.benefits}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onViewModels}
          >
            <RiEyeLine data-icon="inline-start" aria-hidden />
            {copy.viewAllModels}
          </Button>
        </div>
        <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <RiCheckLine aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <span>
              {copy.modelCoverage}: {featuredModels || copy.noModels}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <RiCheckLine aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <span>{copy.modelRatiosBenefit}</span>
          </li>
          <li className="flex items-start gap-2">
            <RiCheckLine aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <span>{copy.toolCompatibility}</span>
          </li>
        </ul>
        <Badge className="w-fit" variant="outline">
          {copy.concurrency}: {formatCount(plan.concurrencyLimit, locale)}
        </Badge>
      </CardContent>
      <CardFooter className="relative flex-col items-stretch gap-2">
        <Button
          className="h-11"
          type="button"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
        <p
          aria-hidden={!disabledReason}
          className={cn(
            "min-h-4 text-xs text-muted-foreground",
            !disabledReason && "invisible"
          )}
        >
          {disabledReason || "\u00a0"}
        </p>
      </CardFooter>
    </Card>
  )
}

function OwnedPlanCard({
  catalogPlan,
  copy,
  locale,
  onDelete,
  onManageKeys,
  onRecharge,
  onRename,
  onUpgrade,
  onViewModels,
  plan,
}: {
  catalogPlan: CompSharePlan | null
  copy: PlansCopy
  locale: string
  onDelete: () => void
  onManageKeys: () => void
  onRecharge: () => void
  onRename: () => void
  onUpgrade: () => void
  onViewModels: () => void
  plan: CompShareUserPlan
}) {
  return (
    <Card className="overflow-hidden rounded-3xl border-border/70 bg-card shadow-sm">
      <CardHeader className="gap-3 border-b pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="truncate text-lg">{planLabel(plan)}</CardTitle>
          <Badge variant={plan.status !== 1 ? "destructive" : "secondary"}>
            {plan.status !== 1 ? copy.inactive : copy.active}
          </Badge>
          <Badge variant="outline">
            {plan.isTeam ? copy.team : copy.individual}
          </Badge>
        </div>
        {plan.displayName ? (
          <CardDescription>{plan.planName}</CardDescription>
        ) : null}
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`${copy.packageActions}: ${planLabel(plan)}`}
                type="button"
                variant="ghost"
                size="icon-sm"
              >
                <RiMore2Line aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={onRename}>
                  <RiEditLine aria-hidden />
                  {copy.rename}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <RiDeleteBinLine aria-hidden />
                {copy.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-6">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-background/70 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{copy.expires}</dt>
            <dd className="mt-1 font-medium">
              {plan.expireAt
                ? formatDate(plan.expireAt, locale)
                : copy.noExpiry}
            </dd>
          </div>
          <div className="rounded-2xl border bg-background/70 px-4 py-3">
            <dt className="text-xs text-muted-foreground">
              {copy.concurrency}
            </dt>
            <dd className="mt-1 font-medium tabular-nums">
              {plan.concurrencyLimit > 0
                ? formatCount(plan.concurrencyLimit, locale)
                : copy.notSet}
            </dd>
          </div>
          <div className="rounded-2xl border bg-background/70 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{copy.keyCount}</dt>
            <dd className="mt-1 font-medium tabular-nums">
              {plan.keys.length}
            </dd>
          </div>
        </dl>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="text-sm font-medium">{copy.quotaUsage}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border bg-muted/15 p-4">
                <QuotaMeter
                  copy={copy}
                  label={copy.fiveHourQuota}
                  limit={plan.limitPer5h}
                  locale={locale}
                  usage={plan.usagePer5h}
                />
              </div>
              <div className="rounded-2xl border bg-muted/15 p-4">
                <QuotaMeter
                  copy={copy}
                  label={copy.weeklyQuota}
                  limit={plan.limitPerWeek}
                  locale={locale}
                  usage={plan.usagePerWeek}
                />
              </div>
              <div className="rounded-2xl border bg-muted/15 p-4">
                <QuotaMeter
                  copy={copy}
                  label={copy.monthlyQuota}
                  limit={plan.limitPerMonth}
                  locale={locale}
                  usage={plan.usagePerMonth}
                />
              </div>
            </div>
          </div>

          <div className="min-w-0 border-border lg:border-l lg:pl-6">
            <ModelPreview
              copy={copy}
              locale={locale}
              models={catalogPlan?.models ?? []}
              onViewAll={onViewModels}
            />
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
        <span className="text-xs text-muted-foreground">
          {copy.created} · {formatDate(plan.createdAt, locale)}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onRecharge}>
            <RiRestartLine data-icon="inline-start" aria-hidden />
            {copy.recharge}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onUpgrade}>
            <RiFlashlightLine data-icon="inline-start" aria-hidden />
            {copy.upgrade}
          </Button>
          <Button type="button" size="sm" onClick={onManageKeys}>
            <RiKey2Line data-icon="inline-start" aria-hidden />
            {copy.manageKeys}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

function SectionHeading({
  badge,
  description,
  id,
  title,
}: {
  badge?: React.ReactNode
  description: string
  id: string
  title: string
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {badge ? <div className="shrink-0">{badge}</div> : null}
    </div>
  )
}

function CompSharePlansPage() {
  const { locale } = useI18n()
  const copy = plansCopy[locale]
  const { open: sidebarOpen, isMobile } = useSidebar()
  const needsSidebarToggleOffset = isMobile || !sidebarOpen
  const [activeTab, setActiveTab] = React.useState<PlansTab>("catalog")
  const [planAudience, setPlanAudience] =
    React.useState<PlanAudience>("individual")
  const [ownedPlanAudience, setOwnedPlanAudience] =
    React.useState<PlanAudience>("individual")
  const [keyAudience, setKeyAudience] =
    React.useState<PlanAudience>("individual")
  const keyAudienceRef = React.useRef<PlanAudience>("individual")
  React.useEffect(() => {
    function openRequestedTab() {
      if (window.location.hash === "#api-keys") {
        setActiveTab("keys")
      }
    }

    openRequestedTab()
    window.addEventListener("hashchange", openRequestedTab)
    return () => window.removeEventListener("hashchange", openRequestedTab)
  }, [])
  const [status, setStatus] = React.useState<LoadStatus>("loading")
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadError, setLoadError] = React.useState("")
  const [catalogPlans, setCatalogPlans] = React.useState<CompSharePlan[]>([])
  const [userPlans, setUserPlans] = React.useState<CompShareUserPlan[]>([])
  const [invalidUserPlans, setInvalidUserPlans] = React.useState<
    CompShareUserPlan[]
  >([])
  const [keys, setKeys] = React.useState<CompShareKey[]>([])
  const [selectedKeyCode, setSelectedKeyCode] = React.useState<string | null>(
    null
  )
  const keyRequestRef = React.useRef(0)
  const [busyAction, setBusyAction] = React.useState("")
  const [dialogError, setDialogError] = React.useState("")
  const [purchaseTarget, setPurchaseTarget] =
    React.useState<CompSharePlan | null>(null)
  const [purchaseCount, setPurchaseCount] = React.useState("1")
  const [purchaseKeyName, setPurchaseKeyName] = React.useState("default")
  const [purchaseIsTeam, setPurchaseIsTeam] = React.useState(false)
  const [purchaseResult, setPurchaseResult] =
    React.useState<PurchaseResponse | null>(null)
  const [upgradeTarget, setUpgradeTarget] =
    React.useState<CompShareUserPlan | null>(null)
  const [upgradePlanCode, setUpgradePlanCode] = React.useState("")
  const [upgradeQuote, setUpgradeQuote] = React.useState<UpgradeQuote | null>(
    null
  )
  const upgradeQuoteRequestRef = React.useRef(0)
  const [rechargeTarget, setRechargeTarget] =
    React.useState<CompShareUserPlan | null>(null)
  const [rechargeQuote, setRechargeQuote] =
    React.useState<RechargeQuote | null>(null)
  const rechargeQuoteRequestRef = React.useRef(0)
  const [renamePlanTarget, setRenamePlanTarget] =
    React.useState<CompShareUserPlan | null>(null)
  const [renamePlanValue, setRenamePlanValue] = React.useState("")
  const [deletePlanTarget, setDeletePlanTarget] =
    React.useState<CompShareUserPlan | null>(null)
  const [deletePlanConfirmation, setDeletePlanConfirmation] = React.useState("")
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false)
  const [createKeyPlanCode, setCreateKeyPlanCode] = React.useState("")
  const [createKeyName, setCreateKeyName] = React.useState("default")
  const [renameKeyTarget, setRenameKeyTarget] =
    React.useState<CompShareKey | null>(null)
  const [renameKeyValue, setRenameKeyValue] = React.useState("")
  const [deleteKeyTarget, setDeleteKeyTarget] =
    React.useState<CompShareKey | null>(null)
  const [oneTimeKeys, setOneTimeKeys] = React.useState<OneTimeKey[]>([])
  const [modelDetails, setModelDetails] = React.useState<CompSharePlan | null>(
    null
  )
  const [keyDetailsOpen, setKeyDetailsOpen] = React.useState(false)
  const [keyDetailsStatus, setKeyDetailsStatus] =
    React.useState<LoadStatus>("loading")
  const [keyDetails, setKeyDetails] = React.useState<{
    key: CompShareKey | null
    userPlan: CompShareUserPlan | null
  } | null>(null)
  const [keyDetailsError, setKeyDetailsError] = React.useState("")
  const [usageDraft, setUsageDraft] = React.useState<UsageFilters>({
    keyCode: "",
    beginDate: "",
    endDate: "",
  })
  const [usageFilters, setUsageFilters] = React.useState<UsageFilters>({
    keyCode: "",
    beginDate: "",
    endDate: "",
  })
  const [usagePage, setUsagePage] = React.useState(1)
  const [usageRefreshKey, setUsageRefreshKey] = React.useState(0)
  const [usageStatus, setUsageStatus] = React.useState<LoadStatus>("loading")
  const [usageError, setUsageError] = React.useState("")
  const [usageRecords, setUsageRecords] = React.useState<
    CompShareUsageRecord[]
  >([])
  const [usageTotalCount, setUsageTotalCount] = React.useState(0)
  const [usagePageSize, setUsagePageSize] = React.useState(20)
  const [usageDetails, setUsageDetails] =
    React.useState<CompShareUsageRecord | null>(null)

  const loadCoreData = React.useCallback(
    async (options?: { signal?: AbortSignal; silent?: boolean }) => {
      if (options?.silent) {
        setRefreshing(true)
      } else {
        setStatus("loading")
      }

      try {
        const [catalogData, personalPlanData, teamPlanData, keyData] =
          await Promise.all([
            requestData<{ totalCount: number; plans: CompSharePlan[] }>(
              "/api/compshare/plans",
              { signal: options?.signal }
            ),
            requestData<{
              totalCount: number
              userPlans: CompShareUserPlan[]
              invalidUserPlans: CompShareUserPlan[]
            }>("/api/compshare/user-plans?isTeam=false", {
              signal: options?.signal,
            }),
            requestData<{
              totalCount: number
              userPlans: CompShareUserPlan[]
              invalidUserPlans: CompShareUserPlan[]
            }>("/api/compshare/user-plans?isTeam=true", {
              signal: options?.signal,
            }),
            requestData<{
              totalCount: number
              keys: CompShareKey[]
              selectedKeyCode: string | null
            }>(
              `/api/compshare/keys?isTeam=${keyAudienceRef.current === "team"}`,
              { signal: options?.signal }
            ),
          ])

        setCatalogPlans(
          catalogData.plans.filter(
            (plan) => !HIDDEN_CODING_PLAN_CODES[plan.code]
          )
        )
        setUserPlans([...personalPlanData.userPlans, ...teamPlanData.userPlans])
        setInvalidUserPlans([
          ...personalPlanData.invalidUserPlans,
          ...teamPlanData.invalidUserPlans,
        ])
        setKeys(keyData.keys)
        setSelectedKeyCode(keyData.selectedKeyCode)
        setLoadError("")
        setStatus("ready")
      } catch (error) {
        if (options?.signal?.aborted) return
        setLoadError(error instanceof Error ? error.message : copy.loadFailed)
        setStatus("error")
      } finally {
        if (!options?.signal?.aborted) setRefreshing(false)
      }
    },
    [copy.loadFailed]
  )

  React.useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadCoreData({ signal: controller.signal })
      }
    })
    return () => controller.abort()
  }, [loadCoreData])

  React.useEffect(() => {
    if (activeTab !== "usage") return
    const controller = new AbortController()

    async function loadUsage() {
      setUsageStatus("loading")
      setUsageError("")
      const params = new URLSearchParams({
        page: String(usagePage),
        pageSize: String(usagePageSize),
      })
      if (usageFilters.keyCode) params.append("keyCode", usageFilters.keyCode)
      const beginTime = parseDateStart(usageFilters.beginDate)
      const endTime = parseDateEnd(usageFilters.endDate)
      if (beginTime !== undefined) params.set("beginTime", String(beginTime))
      if (endTime !== undefined) params.set("endTime", String(endTime))

      try {
        const data = await requestData<{
          totalCount: number
          page: number
          pageSize: number
          records: CompShareUsageRecord[]
        }>(`/api/compshare/usage?${params.toString()}`, {
          signal: controller.signal,
        })
        setUsageRecords(data.records)
        setUsageTotalCount(data.totalCount)
        setUsagePage(data.page)
        setUsagePageSize(data.pageSize)
        setUsageStatus("ready")
      } catch (error) {
        if (controller.signal.aborted) return
        setUsageError(
          error instanceof Error ? error.message : copy.usageLoadFailed
        )
        setUsageStatus("error")
      }
    }

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadUsage()
      }
    })
    return () => controller.abort()
  }, [
    activeTab,
    copy.usageLoadFailed,
    usageFilters,
    usagePage,
    usagePageSize,
    usageRefreshKey,
  ])

  const catalogByCode = React.useMemo(
    () => new Map(catalogPlans.map((plan) => [plan.code, plan])),
    [catalogPlans]
  )
  const activeIndividualPlan =
    userPlans.find((plan) => !plan.isTeam && plan.status === 1) ?? null
  const hasActiveIndividualPlan = Boolean(activeIndividualPlan)
  const activeIndividualCatalogPlan = activeIndividualPlan
    ? (catalogByCode.get(activeIndividualPlan.planCode) ?? null)
    : null
  const activeIndividualTierPrice = activeIndividualCatalogPlan
    ? activeIndividualCatalogPlan.originalPrice ||
      activeIndividualCatalogPlan.price
    : 0
  const audiencePlans = catalogPlans.toSorted((left, right) => {
    const leftPrice = left.price > 0 ? left.price : Number.POSITIVE_INFINITY
    const rightPrice = right.price > 0 ? right.price : Number.POSITIVE_INFINITY

    return leftPrice - rightPrice || left.name.localeCompare(right.name)
  })
  const selectedKey = keys.find((key) => key.code === selectedKeyCode) ?? null
  const keyPlans = userPlans.filter(
    (plan) => plan.status === 1 && plan.isTeam === (keyAudience === "team")
  )
  const ownedUserPlans = userPlans.filter(
    (plan) => plan.isTeam === (ownedPlanAudience === "team")
  )
  const ownedInvalidUserPlans = invalidUserPlans.filter(
    (plan) => plan.isTeam === (ownedPlanAudience === "team")
  )
  const usagePageCount = Math.max(
    1,
    Math.ceil(usageTotalCount / Math.max(1, usagePageSize))
  )

  function operationError(error: unknown) {
    const message =
      error instanceof Error ? error.message : copy.operationFailed
    setDialogError(message)
    toast.error(message)
  }

  async function loadKeyAudience(audience: PlanAudience) {
    if (audience === keyAudienceRef.current || busyAction) return

    const requestId = keyRequestRef.current + 1
    keyRequestRef.current = requestId
    setBusyAction("load-keys")

    try {
      const data = await requestData<{
        totalCount: number
        keys: CompShareKey[]
        selectedKeyCode: string | null
      }>(`/api/compshare/keys?isTeam=${audience === "team"}`)
      if (keyRequestRef.current !== requestId) return

      keyAudienceRef.current = audience
      setKeyAudience(audience)
      setKeys(data.keys)
      setSelectedKeyCode(data.selectedKeyCode)
    } catch (error) {
      if (keyRequestRef.current !== requestId) return
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      if (keyRequestRef.current === requestId) setBusyAction("")
    }
  }

  function openKeys(audience: PlanAudience) {
    setActiveTab("keys")
    void loadKeyAudience(audience)
  }

  function openPurchase(plan: CompSharePlan, isTeamPurchase: boolean) {
    setDialogError("")
    setPurchaseCount("1")
    setPurchaseKeyName("default")
    setPurchaseIsTeam(isTeamPurchase)
    setPurchaseTarget(plan)
  }

  async function purchasePlan() {
    if (!purchaseTarget || !purchaseCountValid) return
    const count = purchaseQuantity
    setBusyAction("purchase")
    setDialogError("")

    try {
      const data = await requestData<PurchaseResponse>(
        "/api/compshare/plans/purchase",
        {
          method: "POST",
          body: JSON.stringify({
            planCode: purchaseTarget.code,
            keyName: purchaseKeyName.trim() || undefined,
            ...(purchaseIsTeam ? { isTeam: true, count } : {}),
          }),
        }
      )
      setPurchaseResult(data)
      setPurchaseTarget(null)
      setActiveTab("overview")
      if (data.oneTimeKeys.length) setOneTimeKeys(data.oneTimeKeys)
      if (data.partial) {
        toast.warning(copy.purchasePartial)
      } else {
        toast.success(copy.purchaseSucceeded)
      }
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  function closeUpgrade() {
    upgradeQuoteRequestRef.current += 1
    setUpgradeTarget(null)
    setUpgradePlanCode("")
    setUpgradeQuote(null)
    setDialogError("")
    if (busyAction === "upgrade-quote") setBusyAction("")
  }

  async function loadUpgradeQuote(
    plan: CompShareUserPlan,
    newPlanCode: string
  ) {
    const requestId = upgradeQuoteRequestRef.current + 1
    upgradeQuoteRequestRef.current = requestId
    setUpgradeQuote(null)
    setDialogError("")
    setBusyAction("upgrade-quote")

    try {
      const data = await requestData<UpgradeQuote>(
        `/api/compshare/user-plans/${encodeURIComponent(
          plan.code
        )}/upgrade-quote?newPlanCode=${encodeURIComponent(newPlanCode)}`
      )
      if (upgradeQuoteRequestRef.current === requestId) {
        setUpgradeQuote(data)
      }
    } catch (error) {
      if (upgradeQuoteRequestRef.current === requestId) {
        operationError(error)
      }
    } finally {
      if (upgradeQuoteRequestRef.current === requestId) {
        setBusyAction("")
      }
    }
  }

  function openUpgrade(plan: CompShareUserPlan, preferredPlanCode?: string) {
    const target = catalogPlans.find(
      (candidate) =>
        candidate.status === 1 &&
        candidate.code !== plan.planCode &&
        (!preferredPlanCode || candidate.code === preferredPlanCode)
    )
    setDialogError("")
    setUpgradeTarget(plan)
    setUpgradePlanCode(target?.code ?? "")
    setUpgradeQuote(null)
    if (target) void loadUpgradeQuote(plan, target.code)
  }

  async function confirmUpgrade() {
    if (!upgradeTarget || !upgradePlanCode || !upgradeQuote) return
    setBusyAction("upgrade")
    setDialogError("")

    try {
      const data = await requestData<{
        userPlan: CompShareUserPlan | null
        orderNo: string | null
      }>(
        `/api/compshare/user-plans/${encodeURIComponent(
          upgradeTarget.code
        )}/upgrade`,
        {
          method: "POST",
          body: JSON.stringify({ newPlanCode: upgradePlanCode }),
        }
      )
      setUpgradeTarget(null)
      toast.success(
        data.orderNo
          ? `${copy.upgraded} · ${copy.orderCreated}: ${data.orderNo}`
          : copy.upgraded
      )
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  function closeRecharge() {
    rechargeQuoteRequestRef.current += 1
    setRechargeTarget(null)
    setRechargeQuote(null)
    setDialogError("")
    if (busyAction === "recharge-quote") setBusyAction("")
  }

  async function openRecharge(plan: CompShareUserPlan) {
    const requestId = rechargeQuoteRequestRef.current + 1
    rechargeQuoteRequestRef.current = requestId
    setRechargeTarget(plan)
    setRechargeQuote(null)
    setDialogError("")
    setBusyAction("recharge-quote")

    try {
      const quote = await requestData<RechargeQuote>(
        `/api/compshare/user-plans/${encodeURIComponent(plan.code)}/recharge`
      )
      if (rechargeQuoteRequestRef.current === requestId) {
        setRechargeQuote(quote)
      }
    } catch (error) {
      if (rechargeQuoteRequestRef.current === requestId) {
        operationError(error)
      }
    } finally {
      if (rechargeQuoteRequestRef.current === requestId) {
        setBusyAction("")
      }
    }
  }

  async function rechargePlan() {
    if (!rechargeTarget || !rechargeQuote) return
    setBusyAction("recharge")
    setDialogError("")

    try {
      const data = await requestData<{ orderNo: string | null }>(
        `/api/compshare/user-plans/${encodeURIComponent(
          rechargeTarget.code
        )}/recharge`,
        {
          method: "POST",
          body: JSON.stringify({ expectedPrice: rechargeQuote.price }),
        }
      )
      setRechargeTarget(null)
      setRechargeQuote(null)
      toast.success(
        data.orderNo
          ? `${copy.recharged} · ${copy.orderCreated}: ${data.orderNo}`
          : copy.recharged
      )
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
      setRechargeQuote(null)
    } finally {
      setBusyAction("")
    }
  }

  async function renamePlan() {
    if (!renamePlanTarget || !renamePlanValue.trim()) return
    setBusyAction("rename-plan")
    setDialogError("")

    try {
      await requestData<{ userPlanCode: string; displayName: string }>(
        `/api/compshare/user-plans/${encodeURIComponent(
          renamePlanTarget.code
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: renamePlanValue.trim() }),
        }
      )
      setRenamePlanTarget(null)
      toast.success(copy.packageRenamed)
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  async function deletePlan() {
    if (!deletePlanTarget) return
    if (deletePlanConfirmation.trim() !== planLabel(deletePlanTarget)) return
    setBusyAction("delete-plan")
    setDialogError("")

    try {
      await requestData<{ userPlanCode: string }>(
        `/api/compshare/user-plans/${encodeURIComponent(
          deletePlanTarget.code
        )}`,
        { method: "DELETE" }
      )
      setDeletePlanTarget(null)
      toast.success(copy.packageDeleted)
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  function openCreateKey(planCode?: string) {
    const firstPlanCode = planCode || keyPlans[0]?.code || ""
    setDialogError("")
    setCreateKeyPlanCode(firstPlanCode)
    setCreateKeyName("default")
    setCreateKeyOpen(true)
  }

  async function createKey() {
    if (!createKeyPlanCode) return
    setBusyAction("create-key")
    setDialogError("")

    try {
      const data = await requestData<{
        key: CompShareKey | null
        selectedKey: { keyCode: string; userPlanCode: string } | null
        oneTimeKeys: OneTimeKey[]
      }>("/api/compshare/keys", {
        method: "POST",
        body: JSON.stringify({
          userPlanCode: createKeyPlanCode,
          keyName: createKeyName.trim() || undefined,
        }),
      })
      setCreateKeyOpen(false)
      if (data.oneTimeKeys.length) setOneTimeKeys(data.oneTimeKeys)
      toast.success(copy.keyCreated)
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  async function renameKey() {
    if (!renameKeyTarget || !renameKeyValue.trim()) return
    setBusyAction("rename-key")
    setDialogError("")

    try {
      await requestData<{ key: CompShareKey | null }>(
        `/api/compshare/keys/${encodeURIComponent(renameKeyTarget.code)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ keyName: renameKeyValue.trim() }),
        }
      )
      setRenameKeyTarget(null)
      toast.success(copy.keyRenamed)
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  async function deleteKey() {
    if (!deleteKeyTarget) return
    setBusyAction("delete-key")
    setDialogError("")

    try {
      await requestData<{ keyCode: string }>(
        `/api/compshare/keys/${encodeURIComponent(deleteKeyTarget.code)}`,
        { method: "DELETE" }
      )
      setDeleteKeyTarget(null)
      toast.success(copy.keyDeleted)
      await loadCoreData({ silent: true })
    } catch (error) {
      operationError(error)
    } finally {
      setBusyAction("")
    }
  }

  async function selectKey(key: CompShareKey) {
    if (key.selected || busyAction) return
    setBusyAction(`select-key:${key.code}`)

    try {
      await requestData<{
        selectedKey: { keyCode: string; userPlanCode: string } | null
      }>("/api/compshare/keys/selected", {
        method: "PUT",
        body: JSON.stringify({ keyCode: key.code }),
      })
      setSelectedKeyCode(key.code)
      setKeys((current) =>
        current.map((candidate) => ({
          ...candidate,
          selected: candidate.code === key.code,
        }))
      )
      toast.success(copy.keySelected)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.operationFailed)
    } finally {
      setBusyAction("")
    }
  }

  async function openProviderDetails(key: CompShareKey) {
    setKeyDetailsOpen(true)
    setKeyDetailsStatus("loading")
    setKeyDetailsError("")
    setKeyDetails(null)

    try {
      const data = await requestData<{
        key: CompShareKey | null
        userPlan: CompShareUserPlan | null
      }>(
        `/api/compshare/user-plans/by-key?keyCode=${encodeURIComponent(key.code)}`
      )
      setKeyDetails(data)
      setKeyDetailsStatus("ready")
    } catch (error) {
      setKeyDetailsError(
        error instanceof Error ? error.message : copy.providerDetailsFailed
      )
      setKeyDetailsStatus("error")
    }
  }

  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(copy.copied)
    } catch {
      toast.error(copy.copyFailed)
    }
  }

  function applyUsageFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const beginTime = parseDateStart(usageDraft.beginDate)
    const endTime = parseDateEnd(usageDraft.endDate)
    if (
      beginTime !== undefined &&
      endTime !== undefined &&
      beginTime >= endTime
    ) {
      toast.error(copy.invalidDateRange)
      return
    }
    setUsagePage(1)
    setUsageFilters(usageDraft)
  }

  function renderOverview() {
    return (
      <div className="flex flex-col gap-8">
        {purchaseResult?.partial ? (
          <Alert className="border-border-warning">
            <RiInformationLine className="text-text-warning" aria-hidden />
            <AlertTitle>{copy.partialTitle}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>
                {purchaseResult.warning?.message || copy.partialDescription}
              </span>
              <span className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {copy.requested}: {purchaseResult.requestedCount}
                </Badge>
                <Badge variant="secondary">
                  {copy.completed}: {purchaseResult.successCount}
                </Badge>
              </span>
              <Button
                className="w-fit"
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setPurchaseResult(null)}
              >
                {copy.dismiss}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <div
          aria-label={copy.audienceLabel}
          className="inline-flex w-fit items-center gap-1 rounded-xl bg-muted p-1"
          role="group"
        >
          <Button
            aria-pressed={ownedPlanAudience === "individual"}
            className={cn(
              "gap-2 rounded-lg px-4",
              ownedPlanAudience === "individual" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            onClick={() => setOwnedPlanAudience("individual")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RiUserLine data-icon="inline-start" aria-hidden />
            {copy.individual}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCount(
                userPlans.filter((plan) => !plan.isTeam).length,
                locale
              )}
            </span>
          </Button>
          <Button
            aria-pressed={ownedPlanAudience === "team"}
            className={cn(
              "gap-2 rounded-lg px-4",
              ownedPlanAudience === "team" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            onClick={() => setOwnedPlanAudience("team")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RiTeamLine data-icon="inline-start" aria-hidden />
            {copy.team}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCount(
                userPlans.filter((plan) => plan.isTeam).length,
                locale
              )}
            </span>
          </Button>
        </div>

        <section
          className="flex flex-col gap-4"
          aria-labelledby="active-plans-title"
        >
          <SectionHeading
            badge={
              <Badge variant="secondary">
                {ownedUserPlans.length} {copy.activeCount}
              </Badge>
            }
            id="active-plans-title"
            description={copy.activePlansDescription}
            title={copy.activePlans}
          />
          {ownedUserPlans.length ? (
            <div className="grid gap-4">
              {ownedUserPlans.map((plan) => (
                <OwnedPlanCard
                  catalogPlan={catalogByCode.get(plan.planCode) ?? null}
                  copy={copy}
                  key={plan.code}
                  locale={locale}
                  onDelete={() => {
                    setDialogError("")
                    setDeletePlanConfirmation("")
                    setDeletePlanTarget(plan)
                  }}
                  onManageKeys={() =>
                    openKeys(plan.isTeam ? "team" : "individual")
                  }
                  onRecharge={() => {
                    void openRecharge(plan)
                  }}
                  onRename={() => {
                    setDialogError("")
                    setRenamePlanValue(planLabel(plan))
                    setRenamePlanTarget(plan)
                  }}
                  onUpgrade={() => openUpgrade(plan)}
                  onViewModels={() => {
                    const catalogPlan = catalogByCode.get(plan.planCode)
                    if (catalogPlan) setModelDetails(catalogPlan)
                  }}
                  plan={plan}
                />
              ))}
            </div>
          ) : (
            <EmptyPanel
              action={
                <Button type="button" onClick={() => setActiveTab("catalog")}>
                  <RiCoupon3Line data-icon="inline-start" aria-hidden />
                  {copy.browseCatalog}
                </Button>
              }
              description={copy.noActivePlansDescription}
              icon={<RiCoupon3Line aria-hidden />}
              title={copy.noActivePlans}
            />
          )}
        </section>

        <section
          className="flex flex-col gap-4"
          aria-labelledby="invalid-plans-title"
        >
          <SectionHeading
            description={copy.invalidPlansDescription}
            id="invalid-plans-title"
            title={copy.invalidPlans}
          />
          {ownedInvalidUserPlans.length ? (
            <Card size="sm">
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{copy.name}</TableHead>
                      <TableHead>{copy.package}</TableHead>
                      <TableHead>{copy.created}</TableHead>
                      <TableHead>{copy.status}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownedInvalidUserPlans.map((plan) => (
                      <TableRow key={plan.code}>
                        <TableCell className="font-medium">
                          {planLabel(plan)}
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">
                            {plan.planName}
                          </span>
                        </TableCell>
                        <TableCell>
                          {formatDate(plan.createdAt, locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{copy.inactive}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
              <RiHistoryLine aria-hidden />
              {copy.noInvalidPlans}
            </div>
          )}
        </section>
      </div>
    )
  }

  function renderCatalog() {
    const audienceDescription =
      planAudience === "team"
        ? copy.teamPlansDescription
        : copy.individualPlansDescription

    return (
      <section className="flex flex-col gap-5" aria-labelledby="catalog-title">
        <SectionHeading
          badge={
            <Badge variant="secondary">
              {formatCount(audiencePlans.length, locale)}
            </Badge>
          }
          id="catalog-title"
          description={audienceDescription}
          title={copy.catalog}
        />
        <div
          aria-label={copy.audienceLabel}
          className="inline-flex w-fit items-center gap-1 rounded-xl bg-muted p-1"
          role="group"
        >
          <Button
            aria-pressed={planAudience === "individual"}
            className={cn(
              "gap-2 rounded-lg px-4",
              planAudience === "individual" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            onClick={() => setPlanAudience("individual")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RiUserLine data-icon="inline-start" aria-hidden />
            {copy.individual}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCount(catalogPlans.length, locale)}
            </span>
          </Button>
          <Button
            aria-pressed={planAudience === "team"}
            className={cn(
              "gap-2 rounded-lg px-4",
              planAudience === "team" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            onClick={() => setPlanAudience("team")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RiTeamLine data-icon="inline-start" aria-hidden />
            {copy.team}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCount(catalogPlans.length, locale)}
            </span>
          </Button>
        </div>
        {audiencePlans.length ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {audiencePlans.map((plan) => {
              const isPersonalMode = planAudience === "individual"
              const isCurrentPlan =
                isPersonalMode && activeIndividualPlan?.planCode === plan.code
              const candidateTierPrice = plan.originalPrice || plan.price
              const canUpgrade =
                isPersonalMode &&
                Boolean(activeIndividualPlan) &&
                activeIndividualTierPrice > 0 &&
                candidateTierPrice > activeIndividualTierPrice
              const blocked =
                isPersonalMode &&
                Boolean(activeIndividualPlan) &&
                !isCurrentPlan &&
                !canUpgrade
              const actionLabel = isCurrentPlan
                ? copy.recharge
                : canUpgrade
                  ? copy.upgrade
                  : copy.purchase

              return (
                <CatalogPlanCard
                  actionLabel={actionLabel}
                  blocked={blocked}
                  copy={copy}
                  key={plan.code}
                  locale={locale}
                  onAction={() => {
                    if (isCurrentPlan && activeIndividualPlan) {
                      void openRecharge(activeIndividualPlan)
                      return
                    }
                    if (canUpgrade && activeIndividualPlan) {
                      openUpgrade(activeIndividualPlan, plan.code)
                      return
                    }
                    openPurchase(plan, planAudience === "team")
                  }}
                  onViewModels={() => setModelDetails(plan)}
                  plan={plan}
                  purchaseIsTeam={planAudience === "team"}
                />
              )
            })}
          </div>
        ) : (
          <EmptyPanel
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadCoreData()}
              >
                <RiRefreshLine data-icon="inline-start" aria-hidden />
                {copy.refresh}
              </Button>
            }
            description={copy.noCatalogPlansDescription}
            icon={<RiShoppingBag3Line aria-hidden />}
            title={copy.noCatalogPlans}
          />
        )}
      </section>
    )
  }

  function renderKeys() {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="keys-title">
        <SectionHeading
          badge={
            <Button
              type="button"
              size="sm"
              disabled={!keyPlans.length || Boolean(busyAction)}
              onClick={() => openCreateKey()}
            >
              <RiAddLine data-icon="inline-start" aria-hidden />
              {copy.createKey}
            </Button>
          }
          id="keys-title"
          description={copy.keysDescription}
          title={copy.keys}
        />
        <div
          aria-label={copy.audienceLabel}
          className="inline-flex w-fit items-center gap-1 rounded-xl bg-muted p-1"
          role="group"
        >
          <Button
            aria-pressed={keyAudience === "individual"}
            className={cn(
              "gap-2 rounded-lg px-4",
              keyAudience === "individual" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            disabled={Boolean(busyAction)}
            onClick={() => void loadKeyAudience("individual")}
            size="sm"
            type="button"
            variant="ghost"
          >
            {busyAction === "load-keys" && keyAudience === "team" ? (
              <RiLoader4Line
                className="animate-spin"
                data-icon="inline-start"
                aria-hidden
              />
            ) : (
              <RiUserLine data-icon="inline-start" aria-hidden />
            )}
            {copy.individual}
          </Button>
          <Button
            aria-pressed={keyAudience === "team"}
            className={cn(
              "gap-2 rounded-lg px-4",
              keyAudience === "team" &&
                "bg-background text-foreground shadow-sm hover:bg-background"
            )}
            disabled={Boolean(busyAction)}
            onClick={() => void loadKeyAudience("team")}
            size="sm"
            type="button"
            variant="ghost"
          >
            {busyAction === "load-keys" && keyAudience === "individual" ? (
              <RiLoader4Line
                className="animate-spin"
                data-icon="inline-start"
                aria-hidden
              />
            ) : (
              <RiTeamLine data-icon="inline-start" aria-hidden />
            )}
            {copy.team}
          </Button>
        </div>
        {selectedKey ? (
          <Alert>
            <RiShieldKeyholeLine aria-hidden />
            <AlertTitle>{copy.selected}</AlertTitle>
            <AlertDescription>
              <span className="font-medium text-foreground">
                {selectedKey.name || selectedKey.code}
              </span>{" "}
              · {selectedKey.maskedApiKey || "••••••••"} ·{" "}
              {selectedKey.userPlan?.displayName ||
                selectedKey.userPlan?.planName ||
                userPlans.find((plan) => plan.code === selectedKey.userPlanCode)
                  ?.displayName ||
                selectedKey.userPlanCode}
            </AlertDescription>
          </Alert>
        ) : null}
        {keys.length ? (
          <Card size="sm">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.name}</TableHead>
                    <TableHead>{copy.secret}</TableHead>
                    <TableHead>{copy.package}</TableHead>
                    <TableHead>{copy.status}</TableHead>
                    <TableHead className="text-right">{copy.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => {
                    const boundPlan =
                      key.userPlan ??
                      userPlans.find(
                        (plan) => plan.code === key.userPlanCode
                      ) ??
                      null
                    const selecting = busyAction === `select-key:${key.code}`
                    return (
                      <TableRow
                        key={key.code}
                        data-state={key.selected ? "selected" : undefined}
                      >
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-medium">
                              {key.name || key.code}
                            </span>
                            {key.selected ? (
                              <Badge variant="secondary">
                                <RiCheckLine
                                  data-icon="inline-start"
                                  aria-hidden
                                />
                                {copy.selected}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {key.code}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {key.maskedApiKey || "••••••••"}
                        </TableCell>
                        <TableCell>
                          {boundPlan ? planLabel(boundPlan) : key.userPlanCode}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              key.status === 1 ? "outline" : "destructive"
                            }
                          >
                            {key.status === 1 ? copy.active : copy.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant={key.selected ? "secondary" : "outline"}
                              size="sm"
                              disabled={
                                key.selected ||
                                key.status !== 1 ||
                                Boolean(busyAction)
                              }
                              onClick={() => void selectKey(key)}
                            >
                              {selecting ? (
                                <RiLoader4Line
                                  className="animate-spin"
                                  data-icon="inline-start"
                                  aria-hidden
                                />
                              ) : (
                                <RiCheckLine
                                  data-icon="inline-start"
                                  aria-hidden
                                />
                              )}
                              {key.selected
                                ? copy.selected
                                : selecting
                                  ? copy.selecting
                                  : copy.select}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label={`${copy.keyActions}: ${key.name || key.code}`}
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                >
                                  <RiMore2Line aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void openProviderDetails(key)
                                    }
                                  >
                                    <RiEyeLine aria-hidden />
                                    {copy.providerDetails}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setDialogError("")
                                      setRenameKeyValue(key.name || "default")
                                      setRenameKeyTarget(key)
                                    }}
                                  >
                                    <RiEditLine aria-hidden />
                                    {copy.rename}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => {
                                      setDialogError("")
                                      setDeleteKeyTarget(key)
                                    }}
                                  >
                                    <RiDeleteBinLine aria-hidden />
                                    {copy.delete}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <EmptyPanel
            action={
              keyPlans.length ? (
                <Button type="button" onClick={() => openCreateKey()}>
                  <RiAddLine data-icon="inline-start" aria-hidden />
                  {copy.createKey}
                </Button>
              ) : (
                <Button type="button" onClick={() => setActiveTab("catalog")}>
                  <RiCoupon3Line data-icon="inline-start" aria-hidden />
                  {copy.browseCatalog}
                </Button>
              )
            }
            description={
              keyPlans.length
                ? copy.noKeysDescriptionWithPlans
                : copy.noKeysDescriptionWithoutPlans
            }
            icon={<RiKey2Line aria-hidden />}
            title={copy.noKeys}
          />
        )}
      </section>
    )
  }

  function renderUsage() {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="usage-title">
        <SectionHeading
          badge={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={usageStatus === "loading"}
              onClick={() => setUsageRefreshKey((value) => value + 1)}
            >
              <RiRefreshLine
                className={cn(usageStatus === "loading" && "animate-spin")}
                data-icon="inline-start"
                aria-hidden
              />
              {copy.refresh}
            </Button>
          }
          id="usage-title"
          description={copy.usageDescription}
          title={copy.usage}
        />
        <Card size="sm">
          <CardHeader>
            <CardTitle>{copy.usageFilters}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
              onSubmit={applyUsageFilters}
            >
              <Field>
                <FieldLabel htmlFor="usage-key-filter">{copy.key}</FieldLabel>
                <Select
                  value={usageDraft.keyCode || "__all"}
                  onValueChange={(value) =>
                    setUsageDraft((current) => ({
                      ...current,
                      keyCode: value === "__all" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger id="usage-key-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__all">{copy.allKeys}</SelectItem>
                      {keys.map((key) => (
                        <SelectItem key={key.code} value={key.code}>
                          {key.name || key.code}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="usage-begin-date">
                  {copy.beginDate}
                </FieldLabel>
                <Input
                  id="usage-begin-date"
                  type="date"
                  value={usageDraft.beginDate}
                  onChange={(event) =>
                    setUsageDraft((current) => ({
                      ...current,
                      beginDate: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="usage-end-date">{copy.endDate}</FieldLabel>
                <Input
                  id="usage-end-date"
                  type="date"
                  value={usageDraft.endDate}
                  onChange={(event) =>
                    setUsageDraft((current) => ({
                      ...current,
                      endDate: event.target.value,
                    }))
                  }
                />
              </Field>
              <Button type="submit" variant="outline">
                {copy.applyFilters}
              </Button>
            </form>
          </CardContent>
        </Card>

        {usageStatus === "error" ? (
          <Alert variant="destructive">
            <RiInformationLine aria-hidden />
            <AlertTitle>{copy.usageLoadFailed}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{usageError}</span>
              <Button
                className="w-fit"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setUsageRefreshKey((value) => value + 1)}
              >
                <RiRefreshLine data-icon="inline-start" aria-hidden />
                {copy.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {usageStatus === "loading" ? (
          <Card size="sm">
            <CardContent className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton className="h-10 w-full" key={index} />
              ))}
            </CardContent>
          </Card>
        ) : usageStatus === "error" ? null : usageRecords.length ? (
          <Card size="sm">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.request}</TableHead>
                    <TableHead>{copy.gatewayModel}</TableHead>
                    <TableHead>{copy.key}</TableHead>
                    <TableHead>{copy.cost}</TableHead>
                    <TableHead>{copy.started}</TableHead>
                    <TableHead className="text-right">{copy.details}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageRecords.map((record, index) => (
                    <TableRow
                      key={String(record.id ?? record.requestUuid ?? index)}
                    >
                      <TableCell>
                        <div className="font-medium">
                          {record.requestMethod || copy.unknown}{" "}
                          <span className="font-normal text-muted-foreground">
                            {record.requestPath || "—"}
                          </span>
                        </div>
                        <div className="mt-0.5 max-w-56 truncate font-mono text-xs text-muted-foreground">
                          {record.requestUuid || record.upstreamId || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{record.modelName || record.modelCode || "—"}</div>
                        {record.modelCode && record.modelName ? (
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {record.modelCode}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div>{record.keyName || record.keyCode || "—"}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {record.userPlanName || record.userPlanCode || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatCount(record.cost, locale)}
                      </TableCell>
                      <TableCell>
                        {formatUnixDateTime(record.startTime, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          aria-label={`${copy.details}: ${record.modelName || record.requestUuid || index}`}
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setUsageDetails(record)}
                        >
                          <RiEyeLine aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {copy.page} {usagePage} / {usagePageCount} ·{" "}
                  {formatCount(usageTotalCount, locale)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={usagePage <= 1}
                    onClick={() =>
                      setUsagePage((page) => Math.max(1, page - 1))
                    }
                  >
                    <RiArrowLeftSLine data-icon="inline-start" aria-hidden />
                    {copy.previous}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={usagePage >= usagePageCount}
                    onClick={() =>
                      setUsagePage((page) => Math.min(usagePageCount, page + 1))
                    }
                  >
                    {copy.next}
                    <RiArrowRightSLine data-icon="inline-end" aria-hidden />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyPanel
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveTab("keys")}
              >
                <RiKey2Line data-icon="inline-start" aria-hidden />
                {copy.manageKeys}
              </Button>
            }
            description={copy.noUsageDescription}
            icon={<RiLineChartLine aria-hidden />}
            title={copy.noUsage}
          />
        )}
      </section>
    )
  }

  const parsedPurchaseCount = Number(purchaseCount)
  const purchaseCountValid =
    !purchaseIsTeam ||
    (Number.isInteger(parsedPurchaseCount) &&
      parsedPurchaseCount >= 1 &&
      parsedPurchaseCount <= 100)
  const purchaseQuantity =
    purchaseIsTeam && purchaseCountValid ? parsedPurchaseCount : 1
  const purchaseBlocked = Boolean(
    purchaseTarget &&
    ((!purchaseIsTeam && hasActiveIndividualPlan) ||
      purchaseTarget.status !== 1)
  )
  const upgradeTargets = upgradeTarget
    ? catalogPlans.filter(
        (plan) => plan.status === 1 && plan.code !== upgradeTarget.planCode
      )
    : []
  const deletePlanMatches = Boolean(
    deletePlanTarget &&
    deletePlanConfirmation.trim() === planLabel(deletePlanTarget)
  )
  const rawUsage = usageDetails ? formatUsageRaw(usageDetails.usageRaw) : ""

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as PlansTab)}
      >
        <header
          className={getSidebarAwarePageInsetClassName({
            className: "shrink-0 border-b bg-background",
            needsSidebarToggleOffset,
            variant: "toolbar",
          })}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {copy.title}
              </h1>
              {selectedKey ? (
                <Badge variant="outline" className="hidden sm:inline-flex">
                  <RiShieldKeyholeLine data-icon="inline-start" aria-hidden />
                  {selectedKey.name || copy.selected}
                </Badge>
              ) : null}
            </div>
            <Button
              aria-label={refreshing ? copy.refreshing : copy.refresh}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={refreshing}
              onClick={() => void loadCoreData({ silent: true })}
            >
              <RiRefreshLine
                className={cn(refreshing && "animate-spin")}
                aria-hidden
              />
            </Button>
          </div>
          <TabsList variant="line" className="mt-3 max-w-full overflow-x-auto">
            <TabsTrigger value="catalog">
              <RiCoupon3Line data-icon="inline-start" aria-hidden />
              {copy.catalog}
            </TabsTrigger>
            <TabsTrigger value="overview">
              <RiBankCardLine data-icon="inline-start" aria-hidden />
              {copy.overview}
            </TabsTrigger>
            <TabsTrigger value="keys">
              <RiKey2Line data-icon="inline-start" aria-hidden />
              {copy.keys}
            </TabsTrigger>
            <TabsTrigger value="usage">
              <RiLineChartLine data-icon="inline-start" aria-hidden />
              {copy.usage}
            </TabsTrigger>
          </TabsList>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            {loadError ? (
              <Alert variant="destructive" className="mb-6">
                <RiInformationLine aria-hidden />
                <AlertTitle>{copy.loadFailed}</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <span>{loadError || copy.loadFailedDescription}</span>
                  <Button
                    className="w-fit"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCoreData()}
                  >
                    <RiRefreshLine data-icon="inline-start" aria-hidden />
                    {copy.retry}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {status === "loading" ? (
              <PlansSkeleton label={copy.loading} />
            ) : (
              <>
                <TabsContent value="overview" className="mt-0">
                  {renderOverview()}
                </TabsContent>
                <TabsContent value="catalog" className="mt-0">
                  {renderCatalog()}
                </TabsContent>
                <TabsContent value="keys" className="mt-0">
                  {renderKeys()}
                </TabsContent>
                <TabsContent value="usage" className="mt-0">
                  {renderUsage()}
                </TabsContent>
              </>
            )}
          </div>
        </div>
      </Tabs>

      <Dialog
        open={Boolean(purchaseTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "purchase") {
            setPurchaseTarget(null)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.purchaseTitle}</DialogTitle>
            <DialogDescription>{copy.purchaseDescription}</DialogDescription>
          </DialogHeader>
          {purchaseTarget ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/50 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">
                    {purchaseTarget.name || purchaseTarget.code}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {purchaseTarget.code}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">
                    {purchaseTarget.price > 0
                      ? formatMoney(purchaseTarget.price, locale)
                      : copy.priceUnavailable}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {copy.perPackage}
                  </div>
                </div>
              </div>
              <FieldGroup>
                {purchaseIsTeam ? (
                  <Field data-invalid={!purchaseCountValid}>
                    <FieldLabel htmlFor="purchase-count">
                      {copy.teamCount}
                    </FieldLabel>
                    <Input
                      id="purchase-count"
                      aria-invalid={!purchaseCountValid}
                      inputMode="numeric"
                      min={1}
                      max={100}
                      step={1}
                      type="number"
                      value={purchaseCount}
                      onChange={(event) => setPurchaseCount(event.target.value)}
                    />
                    <FieldDescription>
                      {copy.teamCountDescription}
                    </FieldDescription>
                    {!purchaseCountValid ? (
                      <FieldError>{copy.teamCountInvalid}</FieldError>
                    ) : null}
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="purchase-key-name">
                    {copy.keyName}
                  </FieldLabel>
                  <Input
                    id="purchase-key-name"
                    maxLength={128}
                    placeholder={copy.keyNamePlaceholder}
                    value={purchaseKeyName}
                    onChange={(event) => setPurchaseKeyName(event.target.value)}
                  />
                  <FieldDescription>{copy.keyNameDescription}</FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex items-center justify-between gap-4 border-y py-3">
                <span className="text-sm text-muted-foreground">
                  {copy.estimatedTotal}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {purchaseTarget.price > 0
                    ? formatMoney(
                        purchaseTarget.price * purchaseQuantity,
                        locale
                      )
                    : copy.priceUnavailable}
                </span>
              </div>
              <Alert>
                <RiInformationLine aria-hidden />
                <AlertDescription>{copy.billingNotice}</AlertDescription>
              </Alert>
              {purchaseBlocked ? (
                <Alert variant="destructive">
                  <RiCloseCircleLine aria-hidden />
                  <AlertDescription>
                    {!purchaseIsTeam && hasActiveIndividualPlan
                      ? copy.individualBlocked
                      : copy.packageUnavailable}
                  </AlertDescription>
                </Alert>
              ) : null}
              {dialogError ? (
                <Alert variant="destructive">
                  <RiInformationLine aria-hidden />
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "purchase"}
              onClick={() => setPurchaseTarget(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              disabled={
                purchaseBlocked ||
                !purchaseCountValid ||
                busyAction === "purchase"
              }
              onClick={() => void purchasePlan()}
            >
              {busyAction === "purchase" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : (
                <RiShoppingBag3Line data-icon="inline-start" aria-hidden />
              )}
              {busyAction === "purchase"
                ? copy.purchasing
                : copy.confirmPurchase}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(upgradeTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "upgrade") {
            closeUpgrade()
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.upgradeTitle}</DialogTitle>
            <DialogDescription>{copy.upgradeDescription}</DialogDescription>
          </DialogHeader>
          {upgradeTarget ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4">
                <span className="text-sm text-muted-foreground">
                  {copy.currentPackage}
                </span>
                <span className="font-medium">{planLabel(upgradeTarget)}</span>
              </div>
              {upgradeTargets.length ? (
                <Field>
                  <FieldLabel htmlFor="upgrade-plan-select">
                    {copy.targetPackage}
                  </FieldLabel>
                  <Select
                    value={upgradePlanCode}
                    onValueChange={(value) => {
                      setUpgradePlanCode(value)
                      if (upgradeTarget) {
                        void loadUpgradeQuote(upgradeTarget, value)
                      }
                    }}
                  >
                    <SelectTrigger id="upgrade-plan-select">
                      <SelectValue placeholder={copy.chooseTarget} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {upgradeTargets.map((plan) => (
                          <SelectItem key={plan.code} value={plan.code}>
                            {plan.name} · {formatMoney(plan.price, locale)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Alert>
                  <RiInformationLine aria-hidden />
                  <AlertDescription>{copy.noUpgradeTargets}</AlertDescription>
                </Alert>
              )}
              {upgradeQuote ? (
                <div className="grid grid-cols-2 gap-4 rounded-2xl border p-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      {copy.upgradePrice}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatMoney(upgradeQuote.price, locale)}
                    </span>
                    {upgradeQuote.originalPrice > upgradeQuote.price ? (
                      <span className="text-xs text-muted-foreground line-through">
                        {formatMoney(upgradeQuote.originalPrice, locale)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      {copy.newPackagePrice}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatMoney(upgradeQuote.newPlanPrice, locale)}
                    </span>
                    {upgradeQuote.newPlanOriginalPrice >
                    upgradeQuote.newPlanPrice ? (
                      <span className="text-xs text-muted-foreground line-through">
                        {formatMoney(upgradeQuote.newPlanOriginalPrice, locale)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : busyAction === "upgrade-quote" ? (
                <Skeleton className="h-24 rounded-2xl" />
              ) : null}
              <Alert>
                <RiInformationLine aria-hidden />
                <AlertDescription>{copy.usageResetWarning}</AlertDescription>
              </Alert>
              {dialogError ? (
                <Alert variant="destructive">
                  <RiInformationLine aria-hidden />
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "upgrade"}
              onClick={closeUpgrade}
            >
              {copy.cancel}
            </Button>
            {!upgradeQuote ? (
              <Button
                type="button"
                disabled={!upgradePlanCode || busyAction === "upgrade-quote"}
                onClick={() => {
                  if (upgradeTarget && upgradePlanCode) {
                    void loadUpgradeQuote(upgradeTarget, upgradePlanCode)
                  }
                }}
              >
                {busyAction === "upgrade-quote" ? (
                  <RiLoader4Line
                    className="animate-spin"
                    data-icon="inline-start"
                    aria-hidden
                  />
                ) : (
                  <RiRefreshLine data-icon="inline-start" aria-hidden />
                )}
                {busyAction === "upgrade-quote" ? copy.quoting : copy.retry}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busyAction === "upgrade"}
                onClick={() => void confirmUpgrade()}
              >
                {busyAction === "upgrade" ? (
                  <RiLoader4Line
                    className="animate-spin"
                    data-icon="inline-start"
                    aria-hidden
                  />
                ) : (
                  <RiFlashlightLine data-icon="inline-start" aria-hidden />
                )}
                {busyAction === "upgrade"
                  ? copy.upgrading
                  : copy.confirmUpgrade}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rechargeTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "recharge") {
            closeRecharge()
          }
        }}
      >
        <DialogContent className="sm:max-w-xl" closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.rechargeTitle}</DialogTitle>
            <DialogDescription>{copy.rechargeDescription}</DialogDescription>
          </DialogHeader>

          {rechargeTarget ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4 rounded-2xl border bg-muted/20 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {planLabel(rechargeTarget)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.expires} ·{" "}
                    {formatDateTime(rechargeTarget.expireAt, locale)}
                  </p>
                </div>
                <Badge variant="outline">{copy.balancePayment}</Badge>
              </div>

              {busyAction === "recharge-quote" ? (
                <div
                  className="grid gap-3 sm:grid-cols-2"
                  aria-label={copy.rechargeQuoteLoading}
                >
                  <Skeleton className="h-24 rounded-2xl" />
                  <Skeleton className="h-24 rounded-2xl" />
                </div>
              ) : rechargeQuote ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border bg-background p-4">
                      <p className="text-xs text-muted-foreground">
                        {copy.rechargeAmount}
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                        {formatMoney(rechargeQuote.price, locale)}
                      </p>
                      {rechargeQuote.originalPrice > rechargeQuote.price ? (
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums line-through">
                          {copy.originalPrice}:{" "}
                          {formatMoney(rechargeQuote.originalPrice, locale)}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border bg-background p-4">
                      <p className="text-xs text-muted-foreground">
                        {copy.availableBalance}
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                        {formatMoney(
                          rechargeQuote.balance.amountAvailable,
                          locale
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.balancePayment}
                      </p>
                    </div>
                  </div>

                  {!rechargeQuote.sufficientBalance ? (
                    <Alert variant="destructive">
                      <RiInformationLine aria-hidden />
                      <AlertDescription>
                        {copy.insufficientBalance}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Alert>
                    <RiInformationLine aria-hidden />
                    <AlertDescription>{copy.rechargeWarning}</AlertDescription>
                  </Alert>
                </>
              ) : null}

              {dialogError ? (
                <Alert variant="destructive">
                  <RiInformationLine aria-hidden />
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "recharge"}
              onClick={closeRecharge}
            >
              {copy.cancel}
            </Button>
            {rechargeQuote ? (
              <Button
                type="button"
                disabled={
                  busyAction === "recharge" || !rechargeQuote.sufficientBalance
                }
                onClick={() => void rechargePlan()}
              >
                {busyAction === "recharge" ? (
                  <RiLoader4Line
                    className="animate-spin"
                    data-icon="inline-start"
                    aria-hidden
                  />
                ) : (
                  <RiRestartLine data-icon="inline-start" aria-hidden />
                )}
                {busyAction === "recharge"
                  ? copy.recharging
                  : `${copy.confirmRecharge} · ${formatMoney(
                      rechargeQuote.price,
                      locale
                    )}`}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busyAction === "recharge-quote" || !rechargeTarget}
                onClick={() => {
                  if (rechargeTarget) void openRecharge(rechargeTarget)
                }}
              >
                {busyAction === "recharge-quote" ? (
                  <RiLoader4Line
                    className="animate-spin"
                    data-icon="inline-start"
                    aria-hidden
                  />
                ) : (
                  <RiRefreshLine data-icon="inline-start" aria-hidden />
                )}
                {busyAction === "recharge-quote"
                  ? copy.rechargeQuoteLoading
                  : copy.retry}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renamePlanTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "rename-plan") {
            setRenamePlanTarget(null)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.renamePackageTitle}</DialogTitle>
            <DialogDescription>
              {copy.renamePackageDescription}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field
              data-invalid={Boolean(
                renamePlanTarget && !renamePlanValue.trim()
              )}
            >
              <FieldLabel htmlFor="rename-package-name">
                {copy.displayName}
              </FieldLabel>
              <Input
                id="rename-package-name"
                aria-invalid={Boolean(
                  renamePlanTarget && !renamePlanValue.trim()
                )}
                autoFocus
                maxLength={128}
                value={renamePlanValue}
                onChange={(event) => setRenamePlanValue(event.target.value)}
              />
              {!renamePlanValue.trim() ? (
                <FieldError>{copy.displayNameRequired}</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          {dialogError ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "rename-plan"}
              onClick={() => setRenamePlanTarget(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              disabled={!renamePlanValue.trim() || busyAction === "rename-plan"}
              onClick={() => void renamePlan()}
            >
              {busyAction === "rename-plan" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : null}
              {busyAction === "rename-plan" ? copy.saving : copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deletePlanTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "delete-plan") {
            setDeletePlanTarget(null)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.deletePackageTitle}</DialogTitle>
            <DialogDescription>
              {copy.deletePackageDescription}
            </DialogDescription>
          </DialogHeader>
          {deletePlanTarget ? (
            <div className="flex flex-col gap-4">
              <Alert variant="destructive">
                <RiDeleteBinLine aria-hidden />
                <AlertDescription>{copy.deletePackageWarning}</AlertDescription>
              </Alert>
              <Field
                data-invalid={Boolean(
                  deletePlanConfirmation && !deletePlanMatches
                )}
              >
                <FieldLabel htmlFor="delete-package-confirmation">
                  {copy.typeToConfirm}: {planLabel(deletePlanTarget)}
                </FieldLabel>
                <Input
                  id="delete-package-confirmation"
                  aria-invalid={Boolean(
                    deletePlanConfirmation && !deletePlanMatches
                  )}
                  autoComplete="off"
                  value={deletePlanConfirmation}
                  onChange={(event) =>
                    setDeletePlanConfirmation(event.target.value)
                  }
                />
                {deletePlanConfirmation && !deletePlanMatches ? (
                  <FieldError>{copy.confirmationMismatch}</FieldError>
                ) : null}
              </Field>
              {dialogError ? (
                <Alert variant="destructive">
                  <RiInformationLine aria-hidden />
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "delete-plan"}
              onClick={() => setDeletePlanTarget(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deletePlanMatches || busyAction === "delete-plan"}
              onClick={() => void deletePlan()}
            >
              {busyAction === "delete-plan" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : (
                <RiDeleteBinLine data-icon="inline-start" aria-hidden />
              )}
              {busyAction === "delete-plan"
                ? copy.deleting
                : copy.confirmDeletePackage}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createKeyOpen}
        onOpenChange={(open) => {
          if (!open && busyAction !== "create-key") {
            setCreateKeyOpen(false)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.createKeyTitle}</DialogTitle>
            <DialogDescription>{copy.createKeyDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="create-key-plan">{copy.package}</FieldLabel>
              <Select
                value={createKeyPlanCode}
                onValueChange={setCreateKeyPlanCode}
              >
                <SelectTrigger id="create-key-plan">
                  <SelectValue placeholder={copy.choosePackage} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {keyPlans.map((plan) => (
                      <SelectItem key={plan.code} value={plan.code}>
                        {planLabel(plan)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={Boolean(!createKeyName.trim())}>
              <FieldLabel htmlFor="create-key-name">{copy.keyName}</FieldLabel>
              <Input
                id="create-key-name"
                aria-invalid={Boolean(!createKeyName.trim())}
                maxLength={128}
                value={createKeyName}
                onChange={(event) => setCreateKeyName(event.target.value)}
              />
              {!createKeyName.trim() ? (
                <FieldError>{copy.keyNameRequired}</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          {dialogError ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "create-key"}
              onClick={() => setCreateKeyOpen(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              disabled={
                !createKeyPlanCode ||
                !createKeyName.trim() ||
                busyAction === "create-key"
              }
              onClick={() => void createKey()}
            >
              {busyAction === "create-key" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : (
                <RiAddLine data-icon="inline-start" aria-hidden />
              )}
              {busyAction === "create-key" ? copy.creating : copy.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameKeyTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "rename-key") {
            setRenameKeyTarget(null)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.renameKeyTitle}</DialogTitle>
            <DialogDescription>{copy.renameKeyDescription}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(!renameKeyValue.trim())}>
            <FieldLabel htmlFor="rename-key-name">{copy.keyName}</FieldLabel>
            <Input
              id="rename-key-name"
              aria-invalid={Boolean(!renameKeyValue.trim())}
              autoFocus
              maxLength={128}
              value={renameKeyValue}
              onChange={(event) => setRenameKeyValue(event.target.value)}
            />
            {!renameKeyValue.trim() ? (
              <FieldError>{copy.keyNameRequired}</FieldError>
            ) : null}
          </Field>
          {dialogError ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "rename-key"}
              onClick={() => setRenameKeyTarget(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              disabled={!renameKeyValue.trim() || busyAction === "rename-key"}
              onClick={() => void renameKey()}
            >
              {busyAction === "rename-key" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : null}
              {busyAction === "rename-key" ? copy.saving : copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteKeyTarget)}
        onOpenChange={(open) => {
          if (!open && busyAction !== "delete-key") {
            setDeleteKeyTarget(null)
            setDialogError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.deleteKeyTitle}</DialogTitle>
            <DialogDescription>{copy.deleteKeyDescription}</DialogDescription>
          </DialogHeader>
          {deleteKeyTarget?.selected ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertDescription>
                {copy.selectedKeyDeleteWarning}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="font-medium">
              {deleteKeyTarget?.name || deleteKeyTarget?.code}
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {deleteKeyTarget?.maskedApiKey || "••••••••"}
            </div>
          </div>
          {dialogError ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction === "delete-key"}
              onClick={() => setDeleteKeyTarget(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busyAction === "delete-key"}
              onClick={() => void deleteKey()}
            >
              {busyAction === "delete-key" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden
                />
              ) : (
                <RiDeleteBinLine data-icon="inline-start" aria-hidden />
              )}
              {busyAction === "delete-key"
                ? copy.deleting
                : copy.confirmDeleteKey}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={oneTimeKeys.length > 0}
        onOpenChange={(open) => {
          if (!open) setOneTimeKeys([])
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          closeLabel={copy.closeAndHide}
        >
          <DialogHeader>
            <DialogTitle>{copy.oneTimeTitle}</DialogTitle>
            <DialogDescription>
              {oneTimeKeys.length > 1
                ? copy.oneTimeTeamDescription
                : copy.oneTimeDescription}
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <RiShieldKeyholeLine aria-hidden />
            <AlertDescription>{copy.oneTimeDescription}</AlertDescription>
          </Alert>
          <div className="flex flex-col gap-3">
            {oneTimeKeys.map((key, index) => (
              <div className="rounded-2xl border p-4" key={key.keyCode}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {copy.key} {index + 1}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {key.keyCode}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyKey(key.apiKey)}
                  >
                    <RiFileCopyLine data-icon="inline-start" aria-hidden />
                    {copy.copy}
                  </Button>
                </div>
                <code className="mt-3 block rounded-xl bg-muted px-3 py-2 text-xs leading-relaxed break-all select-all">
                  {key.apiKey}
                </code>
              </div>
            ))}
          </div>
          <DialogFooter>
            {oneTimeKeys.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void copyKey(
                    oneTimeKeys
                      .map((key) => `${key.keyCode}\t${key.apiKey}`)
                      .join("\n")
                  )
                }
              >
                <RiFileCopyLine data-icon="inline-start" aria-hidden />
                {copy.copyAll}
              </Button>
            ) : null}
            <Button type="button" onClick={() => setOneTimeKeys([])}>
              <RiCheckLine data-icon="inline-start" aria-hidden />
              {copy.closeAndHide}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(modelDetails)}
        onOpenChange={(open) => !open && setModelDetails(null)}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          closeLabel={copy.cancel}
        >
          <DialogHeader>
            <DialogTitle>
              {modelDetails?.name || copy.includedModels}
            </DialogTitle>
            <DialogDescription>
              {modelDetails
                ? modelCountLabel(modelDetails.models.length, copy)
                : copy.noModels}
            </DialogDescription>
          </DialogHeader>
          {modelDetails?.models.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.gatewayModel}</TableHead>
                  <TableHead className="text-right">
                    {copy.multiplier}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelDetails.models.map((model) => (
                  <TableRow key={model.code || model.name}>
                    <TableCell className="font-medium">{model.name}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      ×{formatCount(model.ratio, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiCoupon3Line aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{copy.noModels}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={keyDetailsOpen}
        onOpenChange={(open) => {
          setKeyDetailsOpen(open)
          if (!open) {
            setKeyDetails(null)
            setKeyDetailsError("")
          }
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.providerDetailsTitle}</DialogTitle>
            <DialogDescription>
              {copy.providerDetailsDescription}
            </DialogDescription>
          </DialogHeader>
          {keyDetailsStatus === "loading" ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : keyDetailsStatus === "error" ? (
            <Alert variant="destructive">
              <RiInformationLine aria-hidden />
              <AlertTitle>{copy.providerDetailsFailed}</AlertTitle>
              <AlertDescription>{keyDetailsError}</AlertDescription>
            </Alert>
          ) : keyDetails?.userPlan ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/50 p-4">
                <div>
                  <div className="font-medium">
                    {planLabel(keyDetails.userPlan)}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {keyDetails.userPlan.code}
                  </div>
                </div>
                <Badge
                  variant={
                    keyDetails.userPlan.status === 1
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {keyDetails.userPlan.status === 1
                    ? copy.active
                    : copy.inactive}
                </Badge>
              </div>
              <div className="flex flex-col gap-4">
                <QuotaMeter
                  copy={copy}
                  label={copy.fiveHourQuota}
                  limit={keyDetails.userPlan.limitPer5h}
                  locale={locale}
                  usage={keyDetails.userPlan.usagePer5h}
                />
                <QuotaMeter
                  copy={copy}
                  label={copy.weeklyQuota}
                  limit={keyDetails.userPlan.limitPerWeek}
                  locale={locale}
                  usage={keyDetails.userPlan.usagePerWeek}
                />
                <QuotaMeter
                  copy={copy}
                  label={copy.monthlyQuota}
                  limit={keyDetails.userPlan.limitPerMonth}
                  locale={locale}
                  usage={keyDetails.userPlan.usagePerMonth}
                />
              </div>
              {keyDetails.key ? (
                <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{copy.key}</dt>
                    <dd className="mt-1 font-medium">
                      {keyDetails.key.name || keyDetails.key.code}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy.secret}</dt>
                    <dd className="mt-1 font-mono text-xs">
                      {keyDetails.key.maskedApiKey || "••••••••"}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiKey2Line aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{copy.providerDetailsFailed}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(usageDetails)}
        onOpenChange={(open) => !open && setUsageDetails(null)}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          closeLabel={copy.cancel}
        >
          <DialogHeader>
            <DialogTitle>{copy.usageDetailsTitle}</DialogTitle>
            <DialogDescription>
              {copy.usageDetailsDescription}
            </DialogDescription>
          </DialogHeader>
          {usageDetails ? (
            <div className="flex flex-col gap-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.model}
                  </dt>
                  <dd className="font-medium">
                    {usageDetails.modelName || usageDetails.modelCode || "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">{copy.cost}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatCount(usageDetails.cost, locale)}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.requestId}
                  </dt>
                  <dd className="font-mono text-xs break-all">
                    {usageDetails.requestUuid || "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.upstreamId}
                  </dt>
                  <dd className="font-mono text-xs break-all">
                    {usageDetails.upstreamId || "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.method}
                  </dt>
                  <dd className="font-medium">
                    {usageDetails.requestMethod || "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">{copy.path}</dt>
                  <dd className="font-mono text-xs break-all">
                    {usageDetails.requestPath || "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.started}
                  </dt>
                  <dd>{formatUnixDateTime(usageDetails.startTime, locale)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    {copy.duration}
                  </dt>
                  <dd>{formatDuration(usageDetails, locale)}</dd>
                </div>
              </dl>
              <Separator />
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{copy.providerUsage}</h3>
                {rawUsage ? (
                  <pre className="max-h-72 overflow-auto rounded-2xl bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {rawUsage}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {copy.rawUsageUnavailable}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}

export { CompSharePlansPage }
