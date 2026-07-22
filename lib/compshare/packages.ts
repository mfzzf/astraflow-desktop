import "server-only"

import {
  callCompShareAction,
  CompShareApiError,
  type CompShareParamValue,
} from "@/lib/compshare/control-plane"
import { invalidateCompShareEntitlements } from "@/lib/compshare/entitlements"
import {
  clearCompShareSelectedApiKey,
  getCompShareApiKeyByCode,
  getCompShareControlCredentials,
  getCompShareSelectedApiKey,
  removeCompShareApiKey,
  saveCompShareSelectedApiKey,
  upsertCompShareApiKey,
} from "@/lib/studio-db/compshare"

type CompShareBaseResponse = {
  Action?: unknown
  RetCode?: unknown
  Message?: unknown
  request_uuid?: unknown
  [key: string]: unknown
}

type RawRecord = Record<string, unknown>

export type CompSharePlanModel = {
  code: string
  name: string
  ratio: number
}

export type CompSharePlan = {
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

export type CompShareKey = {
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

export type CompShareUserPlan = {
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
  usagePer5hUpdatedAt: string | number | null
  usagePerWeekUpdatedAt: string | number | null
  usagePerMonthUpdatedAt: string | number | null
  usagePer5hResetAt: string | number | null
  usagePerWeekResetAt: string | number | null
  usagePerMonthResetAt: string | number | null
  isTeam: boolean
  status: number
  createdAt: string | number | null
  expireAt: string | number | null
  keys: CompShareKey[]
}

export type CompShareBalance = {
  amount: number
  amountFree: number
  amountFreeze: number
  amountCredit: number
  amountAvailable: number
}

export type CompShareRechargeQuote = {
  userPlanCode: string
  planCode: string
  planName: string
  price: number
  originalPrice: number
  currentExpireAt: string | number | null
  balance: CompShareBalance
  sufficientBalance: boolean
}

export type CompShareUsageRecord = {
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

export type BuyCompSharePlanInput = {
  planCode: string
  keyName?: string
  isTeam?: boolean
  count?: number
}

export type CompShareUsageQuery = {
  keyCodes?: string[]
  beginTime?: number
  endTime?: number
  page: number
  pageSize: number
}

export class CompSharePackageError extends Error {
  readonly code: string
  readonly status: number
  readonly retCode?: number
  readonly requestId?: string

  constructor({
    message,
    code,
    status,
    retCode,
    requestId,
    cause,
  }: {
    message: string
    code: string
    status: number
    retCode?: number
    requestId?: string
    cause?: unknown
  }) {
    super(message, { cause })
    this.name = "CompSharePackageError"
    this.code = code
    this.status = status
    this.retCode = retCode
    this.requestId = requestId
  }
}

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null
}

function asRecords(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is RawRecord => item !== null)
    : []
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function asDecimal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asBoolean(value: unknown) {
  return value === true || value === 1
}

function asTimestamp(value: unknown): string | number | null {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : null
}

function maskApiKey(value: unknown) {
  const apiKey = asString(value)
  if (!apiKey) return null
  return `••••••••${apiKey.slice(-4)}`
}

function selectedKeyCode() {
  return getCompShareSelectedApiKey()?.keyCode ?? ""
}

function adaptPlanModel(value: RawRecord): CompSharePlanModel {
  return {
    code: asString(value.Code),
    name: asString(value.Name),
    ratio: asNumber(value.Ratio),
  }
}

function adaptPlan(value: RawRecord): CompSharePlan {
  return {
    code: asString(value.Code),
    name: asString(value.Name),
    limitPer5h: asNumber(value.LimitPer5h),
    limitPerWeek: asNumber(value.LimitPerWeek),
    limitPerMonth: asNumber(value.LimitPerMonth),
    concurrencyLimit: asNumber(value.ConcurrencyLimit),
    isTeam: asBoolean(value.IsTeam),
    status: asNumber(value.Status),
    createdAt: asTimestamp(value.CreatedAt),
    models: asRecords(value.Models).map(adaptPlanModel),
    price: asNumber(value.Price),
    originalPrice: asNumber(value.OriginalPrice),
  }
}

function adaptKey(
  value: RawRecord,
  selectedCode: string,
  includeUserPlan = true,
  fallbackUserPlanCode = ""
): CompShareKey {
  const userPlan = includeUserPlan ? asRecord(value.UserPlan) : null
  const code = asString(value.Code)

  return {
    code,
    name: asString(value.Name),
    maskedApiKey: maskApiKey(value.APIKey),
    status: asNumber(value.Status),
    userPlanCode: asString(value.UserPlanCode) || fallbackUserPlanCode,
    userPlan: userPlan ? adaptUserPlan(userPlan, selectedCode) : null,
    createdAt: asTimestamp(value.CreatedAt),
    updatedAt: asTimestamp(value.UpdatedAt),
    selected: Boolean(code && code === selectedCode),
  }
}

function adaptUserPlan(
  value: RawRecord,
  selectedCode: string
): CompShareUserPlan {
  const code = asString(value.Code)
  return {
    code,
    planCode: asString(value.PlanCode),
    planName: asString(value.PlanName),
    displayName: asString(value.DisplayName),
    limitPer5h: asNumber(value.LimitPer5h),
    limitPerWeek: asNumber(value.LimitPerWeek),
    limitPerMonth: asNumber(value.LimitPerMonth),
    concurrencyLimit: asNumber(value.ConcurrencyLimit),
    usagePer5h: asNumber(value.UsagePer5h),
    usagePerWeek: asNumber(value.UsagePerWeek),
    usagePerMonth: asNumber(value.UsagePerMonth),
    usagePer5hUpdatedAt: asTimestamp(
      value.UsagePer5hUpdatedAt ??
        value.UsagePer5HUpdatedAt ??
        value.UsagePer5hUpdateAt ??
        value.UpdatedAtPer5h ??
        value.UpdateAtPer5h
    ),
    usagePerWeekUpdatedAt: asTimestamp(
      value.UsagePerWeekUpdatedAt ??
        value.UsagePerWeekUpdateAt ??
        value.UpdatedAtPerWeek ??
        value.UpdateAtPerWeek
    ),
    usagePerMonthUpdatedAt: asTimestamp(
      value.UsagePerMonthUpdatedAt ??
        value.UsagePerMonthUpdateAt ??
        value.UpdatedAtPerMonth ??
        value.UpdateAtPerMonth
    ),
    usagePer5hResetAt: asTimestamp(
      value.UsagePer5hResetAt ??
        value.UsagePer5HResetAt ??
        value.ResetAtPer5h ??
        value.NextResetAtPer5h
    ),
    usagePerWeekResetAt: asTimestamp(
      value.UsagePerWeekResetAt ??
        value.ResetAtPerWeek ??
        value.NextResetAtPerWeek
    ),
    usagePerMonthResetAt: asTimestamp(
      value.UsagePerMonthResetAt ??
        value.ResetAtPerMonth ??
        value.NextResetAtPerMonth
    ),
    isTeam: asBoolean(value.IsTeam),
    status: asNumber(value.Status),
    createdAt: asTimestamp(value.CreatedAt),
    expireAt: asTimestamp(value.ExpireAt),
    keys: asRecords(value.Keys).map((key) =>
      adaptKey(key, selectedCode, false, code)
    ),
  }
}

function adaptUsageRecord(value: RawRecord): CompShareUsageRecord {
  return {
    id:
      typeof value.ID === "string" ||
      (typeof value.ID === "number" && Number.isFinite(value.ID))
        ? value.ID
        : null,
    userPlanCode: asString(value.UserPlanCode),
    keyCode: asString(value.KeyCode),
    keyName: asString(value.KeyName),
    userPlanName: asString(value.UserPlanName),
    requestUuid: asString(value.RequestUUID),
    upstreamId: asString(value.UpstreamID),
    modelCode: asString(value.ModelCode),
    modelName: asString(value.ModelName),
    requestMethod: asString(value.RequestMethod),
    requestPath: asString(value.RequestPath),
    startTime: asNumber(value.StartTime),
    endTime: asNumber(value.EndTime),
    usageRaw: value.UsageRaw ?? null,
    cost: asNumber(value.Cost),
    createdAt: asTimestamp(value.CreatedAt),
    updatedAt: asTimestamp(value.UpdatedAt),
  }
}

function errorStatus(retCode: number) {
  switch (retCode) {
    case 210:
    case 230:
      return 400
    case 216824:
      return 404
    case 217000:
      return 409
    case 150:
      return 503
    default:
      return 502
  }
}

function assertResponse(
  response: CompShareBaseResponse,
  acceptNonZero?: (response: CompShareBaseResponse) => boolean
) {
  const retCode = asNumber(response.RetCode)
  if (retCode === 0 || acceptNonZero?.(response)) return response

  throw new CompSharePackageError({
    message: asString(response.Message) || "CompShare rejected the request.",
    code: `COMPSHARE_${retCode || "INVALID_RESPONSE"}`,
    status: retCode ? errorStatus(retCode) : 502,
    retCode: retCode || undefined,
    requestId: asString(response.request_uuid) || undefined,
  })
}

async function callPackageAction(
  params: Record<string, CompShareParamValue>,
  acceptNonZero?: (response: CompShareBaseResponse) => boolean
) {
  const credentials = getCompShareControlCredentials()
  if (!credentials) {
    throw new CompSharePackageError({
      message: "CompShare credentials are not configured.",
      code: "COMPSHARE_CREDENTIALS_REQUIRED",
      status: 503,
    })
  }

  try {
    const response = await callCompShareAction<CompShareBaseResponse>({
      credentials,
      params,
    })
    return assertResponse(response, acceptNonZero)
  } catch (error) {
    if (error instanceof CompSharePackageError) throw error
    if (error instanceof CompShareApiError) {
      throw new CompSharePackageError({
        message: error.message,
        code: `COMPSHARE_${error.retCode ?? "REQUEST_FAILED"}`,
        status:
          error.retCode === undefined
            ? error.status
            : errorStatus(error.retCode),
        retCode: error.retCode,
        cause: error,
      })
    }
    throw new CompSharePackageError({
      message: "The CompShare service request failed.",
      code: "COMPSHARE_REQUEST_FAILED",
      status: 502,
      cause: error,
    })
  }
}

export type CompShareOneTimeKey = {
  apiKey: string
  keyCode: string
  userPlanCode: string
}

function capturedKeyFromRecord(
  value: RawRecord | null,
  fallbackUserPlanCode = ""
): CompShareOneTimeKey | null {
  if (!value) return null
  const apiKey = asString(value.APIKey)
  const keyCode = asString(value.Code)
  const userPlanCode = asString(value.UserPlanCode) || fallbackUserPlanCode
  return apiKey && keyCode && userPlanCode
    ? { apiKey, keyCode, userPlanCode }
    : null
}

function capturedKeysFromUserPlan(value: RawRecord | null) {
  if (!value) return []
  const userPlanCode = asString(value.Code)
  const captured: CompShareOneTimeKey[] = []
  const direct = capturedKeyFromRecord(asRecord(value.Key), userPlanCode)
  if (direct) captured.push(direct)

  for (const key of asRecords(value.Keys)) {
    const item = capturedKeyFromRecord(key, userPlanCode)
    if (item) captured.push(item)
  }
  return captured
}

function captureCreatedKeys(
  response: CompShareBaseResponse,
  userPlanCode: string
) {
  const captured = capturedKeyFromRecord(asRecord(response.Key), userPlanCode)
  return captured ? [captured] : []
}

function capturePurchasedKeys(response: CompShareBaseResponse) {
  const captured = capturedKeysFromUserPlan(asRecord(response.UserPlan))
  const knownCodes = new Set(captured.map((key) => key.keyCode))

  for (const userPlan of asRecords(response.UserPlans)) {
    for (const key of capturedKeysFromUserPlan(userPlan)) {
      if (!knownCodes.has(key.keyCode)) {
        captured.push(key)
        knownCodes.add(key.keyCode)
      }
    }
  }
  return captured
}

function storeCapturedKeys(
  captured: CompShareOneTimeKey[],
  selectFirst: boolean
) {
  for (const key of captured) {
    upsertCompShareApiKey(key)
  }
  const selected = selectFirst ? captured[0] : null
  if (!selected) return null

  saveCompShareSelectedApiKey(selected)
  return {
    keyCode: selected.keyCode,
    userPlanCode: selected.userPlanCode,
  }
}

function finishMutation() {
  invalidateCompShareEntitlements()
}

export async function listCompSharePlans() {
  const response = await callPackageAction({ Action: "ListOpenAPIPlans" })
  return {
    totalCount: asNumber(response.TotalCount),
    plans: asRecords(response.Plans).map(adaptPlan),
  }
}

export async function buyCompSharePlan(input: BuyCompSharePlanInput) {
  const isTeam = input.isTeam ?? false
  const requestedCount = isTeam ? (input.count ?? 1) : 1
  const response = await callPackageAction(
    {
      Action: "BuyOpenAPIPlan",
      PlanCode: input.planCode,
      KeyName: input.keyName || "default",
      ...(isTeam ? { IsTeam: true } : {}),
      Count: requestedCount,
    },
    (candidate) => asNumber(candidate.SuccessCount) > 0
  )
  const oneTimeKeys = capturePurchasedKeys(response)
  const selectedKey = storeCapturedKeys(oneTimeKeys, true)
  finishMutation()

  const selectedCode = selectedKeyCode()
  const userPlans = asRecords(response.UserPlans).map((plan) =>
    adaptUserPlan(plan, selectedCode)
  )
  const firstUserPlanRecord = asRecord(response.UserPlan)
  const successCount = asNumber(response.SuccessCount) || userPlans.length
  const gatewayRetCode = asNumber(response.RetCode)

  return {
    userPlan: firstUserPlanRecord
      ? adaptUserPlan(firstUserPlanRecord, selectedCode)
      : (userPlans[0] ?? null),
    userPlans,
    requestedCount: asNumber(response.RequestedCount) || requestedCount,
    successCount,
    partial: successCount > 0 && successCount < requestedCount,
    selectedKey,
    oneTimeKeys,
    warning:
      gatewayRetCode === 0
        ? null
        : {
            retCode: gatewayRetCode,
            message:
              asString(response.Message) ||
              "Only part of the team purchase completed.",
          },
  }
}

export async function createCompShareKey(input: {
  userPlanCode: string
  keyName?: string
}) {
  const response = await callPackageAction({
    Action: "CreateOpenAPIKey",
    UserPlanCode: input.userPlanCode,
    KeyName: input.keyName || "default",
  })
  const oneTimeKeys = captureCreatedKeys(response, input.userPlanCode)
  const selectedKey = storeCapturedKeys(oneTimeKeys, true)
  finishMutation()
  const key = asRecord(response.Key)

  return {
    key: key ? adaptKey(key, selectedKeyCode()) : null,
    selectedKey,
    oneTimeKeys,
  }
}

export async function deleteCompShareKey(keyCode: string) {
  await callPackageAction({ Action: "DeleteOpenAPIKey", KeyCode: keyCode })
  removeCompShareApiKey(keyCode)
  finishMutation()
  return { keyCode }
}

export async function renameCompShareKey(keyCode: string, keyName: string) {
  const response = await callPackageAction({
    Action: "UpdateOpenAPIKey",
    KeyCode: keyCode,
    KeyName: keyName || "default",
  })
  finishMutation()
  const key = asRecord(response.Key)
  return {
    key: key ? adaptKey(key, selectedKeyCode()) : null,
  }
}

export async function listCompShareKeys(input?: { isTeam?: boolean }) {
  let userPlanCodes: string[] | undefined

  if (typeof input?.isTeam === "boolean") {
    const plans = await listCompShareUserPlans({ isTeam: input.isTeam })
    userPlanCodes = [...plans.userPlans, ...plans.invalidUserPlans]
      .filter((plan) => plan.isTeam === input.isTeam)
      .map((plan) => plan.code)

    if (!userPlanCodes.length) {
      return {
        totalCount: 0,
        selectedKeyCode: selectedKeyCode() || null,
        keys: [],
      }
    }
  }

  const response = await callPackageAction({
    Action: "ListOpenAPIKeys",
    ...(userPlanCodes ? { UserPlanCodes: userPlanCodes } : {}),
  })
  const allowedPlanCodes = userPlanCodes ? new Set(userPlanCodes) : null
  const rawKeys = asRecords(response.Keys).filter(
    (key) =>
      !allowedPlanCodes || allowedPlanCodes.has(asString(key.UserPlanCode))
  )
  const captured = rawKeys
    .map((key) => capturedKeyFromRecord(key))
    .filter((key): key is CompShareOneTimeKey => key !== null)
  storeCapturedKeys(captured, false)
  const selectedCode = selectedKeyCode()
  return {
    totalCount: allowedPlanCodes
      ? rawKeys.length
      : asNumber(response.TotalCount),
    selectedKeyCode: selectedCode || null,
    keys: rawKeys.map((key) => adaptKey(key, selectedCode)),
  }
}

export function getCompShareSelectedKeyStatus() {
  const selected = getCompShareSelectedApiKey()
  return selected
    ? {
        keyCode: selected.keyCode,
        userPlanCode: selected.userPlanCode,
      }
    : null
}

export async function selectCompShareKey(keyCode: string) {
  const response = await callPackageAction({
    Action: "GetOpenAPIUserPlanByKey",
    KeyCode: keyCode,
  })
  const rawKey = asRecord(response.Key)
  const rawUserPlan = asRecord(response.UserPlan)
  const userPlanCode =
    asString(rawKey?.UserPlanCode) || asString(rawUserPlan?.Code)
  const apiKey = asString(rawKey?.APIKey) || getCompShareApiKeyByCode(keyCode)

  if (!apiKey || !userPlanCode) {
    throw new CompSharePackageError({
      message: "The selected CompShare key is unavailable.",
      code: "COMPSHARE_KEY_UNAVAILABLE",
      status: 409,
    })
  }

  saveCompShareSelectedApiKey({
    keyCode,
    apiKey,
    userPlanCode,
    planCode: asString(rawUserPlan?.PlanCode) || undefined,
    name: asString(rawKey?.Name) || undefined,
  })
  finishMutation()
  return { keyCode, userPlanCode }
}

export function clearCompShareSelectedKey() {
  const selected = getCompShareSelectedApiKey()
  clearCompShareSelectedApiKey()
  finishMutation()
  return selected
    ? {
        keyCode: selected.keyCode,
        userPlanCode: selected.userPlanCode,
      }
    : null
}

export async function listCompShareUsageRecords(query: CompShareUsageQuery) {
  const response = await callPackageAction({
    Action: "ListOpenAPIUsageRecords",
    KeyCodes: query.keyCodes ?? [],
    ...(query.beginTime === undefined ? {} : { BeginTime: query.beginTime }),
    ...(query.endTime === undefined ? {} : { EndTime: query.endTime }),
    Page: query.page,
    PageSize: query.pageSize,
  })
  return {
    totalCount: asNumber(response.TotalCount),
    page: asNumber(response.Page) || query.page,
    pageSize: asNumber(response.PageSize) || query.pageSize,
    records: asRecords(response.Records).map(adaptUsageRecord),
  }
}

export async function listCompShareUserPlans(input?: { isTeam?: boolean }) {
  const response = await callPackageAction({
    Action: "GetOpenAPIUserPlans",
    ...(typeof input?.isTeam === "boolean" ? { IsTeam: input.isTeam } : {}),
  })
  const selectedCode = selectedKeyCode()
  const filterAudience = (plans: CompShareUserPlan[]) =>
    typeof input?.isTeam === "boolean"
      ? plans.filter((plan) => plan.isTeam === input.isTeam)
      : plans
  const userPlans = filterAudience(
    asRecords(response.UserPlans).map((plan) =>
      adaptUserPlan(plan, selectedCode)
    )
  )
  const invalidUserPlans = filterAudience(
    asRecords(response.InvalidUserPlans).map((plan) =>
      adaptUserPlan(plan, selectedCode)
    )
  )

  return {
    totalCount:
      typeof input?.isTeam === "boolean"
        ? userPlans.length
        : asNumber(response.TotalCount),
    userPlans,
    invalidUserPlans,
  }
}

export async function getCompShareUserPlanByKey(keyCode: string) {
  const response = await callPackageAction({
    Action: "GetOpenAPIUserPlanByKey",
    KeyCode: keyCode,
  })
  const selectedCode = selectedKeyCode()
  const key = asRecord(response.Key)
  const userPlan = asRecord(response.UserPlan)
  return {
    key: key ? adaptKey(key, selectedCode, false) : null,
    userPlan: userPlan ? adaptUserPlan(userPlan, selectedCode) : null,
  }
}

export async function getCompShareBalance(): Promise<CompShareBalance> {
  const response = await callPackageAction({ Action: "GetBalance" })
  const accountInfo = asRecord(response.AccountInfo)

  if (!accountInfo) {
    throw new CompSharePackageError({
      message: "CompShare did not return account balance information.",
      code: "COMPSHARE_BALANCE_UNAVAILABLE",
      status: 502,
    })
  }

  return {
    amount: asDecimal(accountInfo.Amount),
    amountFree: asDecimal(accountInfo.AmountFree),
    amountFreeze: asDecimal(accountInfo.AmountFreeze),
    amountCredit: asDecimal(accountInfo.AmountCredit),
    amountAvailable: asDecimal(accountInfo.AmountAvailable),
  }
}

export async function getCompShareRechargeQuote(
  userPlanCode: string
): Promise<CompShareRechargeQuote> {
  const [{ plans }, { userPlans }, balance] = await Promise.all([
    listCompSharePlans(),
    listCompShareUserPlans(),
    getCompShareBalance(),
  ])
  const userPlan = userPlans.find(
    (candidate) => candidate.code === userPlanCode
  )

  if (!userPlan) {
    throw new CompSharePackageError({
      message: "The active CompShare package was not found.",
      code: "COMPSHARE_USER_PLAN_NOT_FOUND",
      status: 404,
    })
  }

  const plan = plans.find((candidate) => candidate.code === userPlan.planCode)

  if (!plan || plan.price <= 0) {
    throw new CompSharePackageError({
      message: "The current renewal price is unavailable.",
      code: "COMPSHARE_RECHARGE_PRICE_UNAVAILABLE",
      status: 503,
    })
  }

  return {
    userPlanCode,
    planCode: plan.code,
    planName: userPlan.planName || plan.name,
    price: plan.price,
    originalPrice: plan.originalPrice,
    currentExpireAt: userPlan.expireAt,
    balance,
    sufficientBalance: balance.amountAvailable >= plan.price,
  }
}

export async function getCompSharePlanUpgradeQuote(input: {
  userPlanCode: string
  newPlanCode: string
}) {
  const response = await callPackageAction({
    Action: "GetOpenAPIPlanUpgradePrice",
    UserPlanCode: input.userPlanCode,
    NewPlanCode: input.newPlanCode,
  })
  return {
    price: asNumber(response.Price),
    originalPrice: asNumber(response.OriginalPrice),
    newPlanPrice: asNumber(response.NewPlanPrice),
    newPlanOriginalPrice: asNumber(response.NewPlanOriginalPrice),
  }
}

function pricesMatch(left: number, right: number) {
  return Math.abs(left - right) < 0.000_001
}

export async function upgradeCompShareUserPlan(input: {
  userPlanCode: string
  newPlanCode: string
}) {
  const response = await callPackageAction({
    Action: "UpgradeOpenAPIUserPlan",
    UserPlanCode: input.userPlanCode,
    NewPlanCode: input.newPlanCode,
  })
  finishMutation()
  const userPlan = asRecord(response.UserPlan)
  return {
    userPlan: userPlan ? adaptUserPlan(userPlan, selectedKeyCode()) : null,
    orderNo: asString(response.OrderNo) || null,
  }
}

export async function rechargeCompShareUserPlan(input: {
  userPlanCode: string
  expectedPrice: number
}) {
  const quote = await getCompShareRechargeQuote(input.userPlanCode)

  if (!pricesMatch(quote.price, input.expectedPrice)) {
    throw new CompSharePackageError({
      message:
        "The renewal price changed. Review the latest quote and confirm again.",
      code: "COMPSHARE_RECHARGE_PRICE_CHANGED",
      status: 409,
    })
  }

  if (!quote.sufficientBalance) {
    throw new CompSharePackageError({
      message: "The CompShare account balance is insufficient.",
      code: "COMPSHARE_INSUFFICIENT_BALANCE",
      status: 409,
    })
  }

  const response = await callPackageAction({
    Action: "CreateOpenAPIUserPlanRecharge",
    UserPlanCode: input.userPlanCode,
  })
  finishMutation()
  return { orderNo: asString(response.OrderNo) || null }
}

export async function deleteCompShareUserPlan(userPlanCode: string) {
  const plansResponse = await callPackageAction({
    Action: "GetOpenAPIUserPlans",
  })
  const matchingPlan = [
    ...asRecords(plansResponse.UserPlans),
    ...asRecords(plansResponse.InvalidUserPlans),
  ].find((plan) => asString(plan.Code) === userPlanCode)
  const keyCodes = asRecords(matchingPlan?.Keys)
    .map((key) => asString(key.Code))
    .filter(Boolean)

  await callPackageAction({
    Action: "DeleteOpenAPIUserPlan",
    UserPlanCode: userPlanCode,
  })
  for (const keyCode of keyCodes) {
    removeCompShareApiKey(keyCode)
  }
  if (getCompShareSelectedApiKey()?.userPlanCode === userPlanCode) {
    clearCompShareSelectedApiKey()
  }
  finishMutation()
  return { userPlanCode }
}

export async function renameCompShareUserPlan(
  userPlanCode: string,
  displayName: string
) {
  const response = await callPackageAction({
    Action: "UpdateOpenAPIUserPlanDisplayName",
    UserPlanCode: userPlanCode,
    DisplayName: displayName,
  })
  finishMutation()
  return {
    userPlanCode: asString(response.UserPlanCode) || userPlanCode,
    displayName: asString(response.DisplayName) || displayName,
  }
}
