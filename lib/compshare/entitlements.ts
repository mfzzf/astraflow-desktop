import type {
  AgentModelDefinition,
  AgentRuntimeId,
} from "@/lib/agent-model-settings-shared"
import { getChannelRuntimeConfig } from "@/lib/channel-config"
import { CHAT_MODEL_OPTIONS } from "@/lib/chat-models"
import {
  COMPSHARE_CHANNEL_SLUG,
  isCompShareChannel,
} from "@/lib/compshare/config"
import {
  callCompShareAction,
  type CompShareCredentials,
} from "@/lib/compshare/control-plane"
import {
  getCompShareControlCredentials,
  getCompShareSelectedApiKey,
  type CompShareSelectedApiKey,
} from "@/lib/studio-db/compshare"

const ENTITLEMENT_CACHE_TTL_MS = 30_000
const OPENAI_CHAT_RUNTIME_IDS = [
  "astraflow",
  "codex",
  "codex-direct",
  "opencode",
] as const satisfies readonly AgentRuntimeId[]

export const COMPSHARE_MODEL_NOT_ENTITLED_CODE = "COMPSHARE_MODEL_NOT_ENTITLED"

export type CompSharePlanModel = {
  code: string
  name: string
  ratio: number | null
}

export type CompShareEntitlements = {
  keyCode: string
  userPlanCode: string
  planCode: string
  planName: string
  planPrice: number
  planOriginalPrice: number
  models: readonly CompSharePlanModel[]
}

export type CompShareSelectedPlan = {
  code: string
  name: string
  price: number
  originalPrice: number
}

type CompShareKeyItem = {
  Code?: unknown
  Status?: unknown
  UserPlanCode?: unknown
}

type CompShareUserPlanItem = {
  Code?: unknown
  PlanCode?: unknown
  Status?: unknown
  ExpireAt?: unknown
}

type GetUserPlanByKeyResponse = {
  Key?: CompShareKeyItem | null
  UserPlan?: CompShareUserPlanItem | null
}

type GetUserPlansResponse = {
  UserPlans?:
    CompShareUserPlanItem[] | Record<string, CompShareUserPlanItem> | null
}

type CompSharePlanModelResponse = {
  Code?: unknown
  Name?: unknown
  Ratio?: unknown
}

type CompSharePlanResponse = {
  Code?: unknown
  Name?: unknown
  Price?: unknown
  OriginalPrice?: unknown
  Status?: unknown
  Models?:
    | CompSharePlanModelResponse[]
    | Record<string, CompSharePlanModelResponse>
}

type ListPlansResponse = {
  Plans?: CompSharePlanResponse[] | Record<string, CompSharePlanResponse>
}

type EntitlementCacheEntry = {
  expiresAt: number
  entitlements: CompShareEntitlements
}

type CachedAgentModelDefinition = {
  expiresAt: number
  model: AgentModelDefinition
}

const entitlementCache = new Map<string, EntitlementCacheEntry>()
const selectedCacheKeys = new Map<string, string>()
const pendingEntitlementRequests = new Map<
  string,
  Promise<CompShareEntitlements>
>()
const cachedAgentModelDefinitions = new Map<
  string,
  CachedAgentModelDefinition
>()
let entitlementCacheGeneration = 0

export class CompShareEntitlementError extends Error {
  readonly code = COMPSHARE_MODEL_NOT_ENTITLED_CODE
  readonly status = 403

  constructor() {
    super("The selected CompShare package does not include this model.")
    this.name = "CompShareEntitlementError"
  }
}

function normalizeModelAlias(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ""
}
function getCompShareModelAliases(model: CompSharePlanModel) {
  const modelAliases = [model.code, model.name]
  const normalizedAliases = new Set(modelAliases.map(normalizeModelAlias))

  for (const option of CHAT_MODEL_OPTIONS) {
    if (
      normalizedAliases.has(normalizeModelAlias(option.value)) ||
      normalizedAliases.has(normalizeModelAlias(option.providerModel))
    ) {
      modelAliases.push(option.value, option.providerModel)
    }
  }

  return Array.from(new Set(modelAliases))
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function isActiveStatus(value: unknown) {
  return value === 1 || value === "1"
}

function isUnexpired(value: unknown) {
  const expireAt = readNumber(value)
  return expireAt !== null && (expireAt <= 0 || expireAt > Date.now() / 1_000)
}

function normalizeList<T>(value: T[] | Record<string, T> | null | undefined) {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === "object") {
    return Object.values(value)
  }

  return []
}

function normalizePlanModels(
  value:
    | CompSharePlanModelResponse[]
    | Record<string, CompSharePlanModelResponse>
    | null
    | undefined
) {
  const aliases = new Set<string>()
  const models: CompSharePlanModel[] = []

  for (const model of normalizeList(value)) {
    const code = readString(model.Code)
    const name = readString(model.Name)
    const codeAlias = normalizeModelAlias(code)
    const nameAlias = normalizeModelAlias(name)

    if (
      !codeAlias ||
      !nameAlias ||
      aliases.has(codeAlias) ||
      aliases.has(nameAlias)
    ) {
      continue
    }

    aliases.add(codeAlias)
    aliases.add(nameAlias)
    models.push({ code, name, ratio: readNumber(model.Ratio) })
  }

  return models
}

function createSelectionCacheKey({
  channelRevision,
  keyCode,
  planCode,
  selectedUpdatedAt,
  userPlanCode,
}: {
  channelRevision: number
  keyCode: string
  planCode?: string
  selectedUpdatedAt: string
  userPlanCode: string
}) {
  return [
    COMPSHARE_CHANNEL_SLUG,
    channelRevision,
    keyCode,
    planCode ?? "",
    userPlanCode,
    selectedUpdatedAt,
  ].join("\u0000")
}

function createEntitlementCacheKey({
  channelRevision,
  keyCode,
  planCode,
}: {
  channelRevision: number
  keyCode: string
  planCode: string
}) {
  return [COMPSHARE_CHANNEL_SLUG, channelRevision, keyCode, planCode].join(
    "\u0000"
  )
}

function createAgentModelDefinition(
  model: CompSharePlanModel
): AgentModelDefinition {
  const normalizedCode = normalizeModelAlias(model.code)
  const normalizedName = normalizeModelAlias(model.name)
  const knownModel =
    CHAT_MODEL_OPTIONS.find(
      (option) =>
        normalizeModelAlias(option.value) === normalizedCode ||
        normalizeModelAlias(option.value) === normalizedName
    ) ??
    CHAT_MODEL_OPTIONS.find(
      (option) =>
        normalizeModelAlias(option.providerModel) === normalizedCode ||
        normalizeModelAlias(option.providerModel) === normalizedName
    )

  return {
    id: model.code,
    label: knownModel?.label ?? model.name,
    providerModel: model.name,
    protocol: "openai-chat",
    baseUrl: null,
    supportedRuntimeIds: [...OPENAI_CHAT_RUNTIME_IDS],
    reasoningEfforts: knownModel ? [...knownModel.reasoningEfforts] : ["none"],
    defaultReasoningEffort: knownModel?.defaultReasoningEffort ?? "none",
    builtin: true,
    enabled: true,
  }
}

function cacheAgentModelDefinitions(
  entitlements: CompShareEntitlements,
  expiresAt: number
) {
  cachedAgentModelDefinitions.clear()

  for (const entitledModel of entitlements.models) {
    const model = createAgentModelDefinition(entitledModel)

    for (const alias of getCompShareModelAliases(entitledModel)) {
      cachedAgentModelDefinitions.set(normalizeModelAlias(alias), {
        expiresAt,
        model,
      })
    }
  }
}

function readCachedEntitlements(selectionCacheKey: string) {
  const entitlementCacheKey = selectedCacheKeys.get(selectionCacheKey)
  if (!entitlementCacheKey) {
    return null
  }

  const cached = entitlementCache.get(entitlementCacheKey)
  if (!cached || cached.expiresAt <= Date.now()) {
    selectedCacheKeys.delete(selectionCacheKey)
    if (cached) {
      entitlementCache.delete(entitlementCacheKey)
    }
    return null
  }

  cacheAgentModelDefinitions(cached.entitlements, cached.expiresAt)
  return cached.entitlements
}

async function fetchCompShareEntitlements({
  channelRevision,
  credentials,
  selected,
}: {
  channelRevision: number
  credentials: CompShareCredentials
  selected: CompShareSelectedApiKey
}) {
  const userPlanResponse = await callCompShareAction<GetUserPlanByKeyResponse>({
    credentials,
    params: {
      Action: "GetOpenAPIUserPlanByKey",
      KeyCode: selected.keyCode,
    },
  })
  const key = userPlanResponse.Key
  const userPlan = userPlanResponse.UserPlan
  const keyCode = readString(key?.Code)
  const keyUserPlanCode =
    readString(key?.UserPlanCode) || readString(userPlan?.Code)
  const userPlanCode = readString(userPlan?.Code)
  const planCode = readString(userPlan?.PlanCode)

  if (
    !key ||
    !userPlan ||
    normalizeModelAlias(keyCode) !== normalizeModelAlias(selected.keyCode) ||
    normalizeModelAlias(keyUserPlanCode) !==
      normalizeModelAlias(userPlanCode) ||
    normalizeModelAlias(userPlanCode) !==
      normalizeModelAlias(selected.userPlanCode) ||
    !planCode ||
    !isActiveStatus(key.Status) ||
    !isActiveStatus(userPlan.Status) ||
    !isUnexpired(userPlan.ExpireAt)
  ) {
    throw new CompShareEntitlementError()
  }

  const plansResponse = await callCompShareAction<ListPlansResponse>({
    credentials,
    params: { Action: "ListOpenAPIPlans" },
  })
  const plan = normalizeList(plansResponse.Plans).find(
    (candidate) =>
      normalizeModelAlias(readString(candidate.Code)) ===
      normalizeModelAlias(planCode)
  )

  if (!plan || !isActiveStatus(plan.Status)) {
    throw new CompShareEntitlementError()
  }

  const models = normalizePlanModels(plan.Models)
  const entitlements: CompShareEntitlements = {
    keyCode,
    userPlanCode,
    planCode,
    planName: readString(plan.Name) || planCode,
    planPrice: readNumber(plan.Price) ?? 0,
    planOriginalPrice: readNumber(plan.OriginalPrice) ?? 0,
    models,
  }
  const cacheKey = createEntitlementCacheKey({
    channelRevision,
    keyCode,
    planCode,
  })

  return { cacheKey, entitlements }
}

async function listCompShareOwnedPlanModels(credentials: CompShareCredentials) {
  const [userPlansResponse, plansResponse] = await Promise.all([
    callCompShareAction<GetUserPlansResponse>({
      credentials,
      params: { Action: "GetOpenAPIUserPlans" },
    }),
    callCompShareAction<ListPlansResponse>({
      credentials,
      params: { Action: "ListOpenAPIPlans" },
    }),
  ])
  const activePlanCodes = new Set(
    normalizeList(userPlansResponse.UserPlans)
      .filter(
        (plan) => isActiveStatus(plan.Status) && isUnexpired(plan.ExpireAt)
      )
      .map((plan) => normalizeModelAlias(readString(plan.PlanCode)))
      .filter(Boolean)
  )
  const aliases = new Set<string>()
  const models: CompSharePlanModel[] = []

  for (const plan of normalizeList(plansResponse.Plans)) {
    if (
      !isActiveStatus(plan.Status) ||
      !activePlanCodes.has(normalizeModelAlias(readString(plan.Code)))
    ) {
      continue
    }

    for (const model of normalizePlanModels(plan.Models)) {
      const modelAliases = [model.code, model.name].map(normalizeModelAlias)
      if (modelAliases.some((alias) => aliases.has(alias))) {
        continue
      }

      modelAliases.forEach((alias) => aliases.add(alias))
      models.push(model)
    }
  }

  return models
}

async function loadCompShareEntitlementsStrict() {
  if (!isCompShareChannel()) {
    return null
  }

  const credentials = getCompShareControlCredentials()
  const selected = getCompShareSelectedApiKey()
  if (!credentials || !selected) {
    throw new CompShareEntitlementError()
  }

  const channelConfig = await getChannelRuntimeConfig()
  const selectionCacheKey = createSelectionCacheKey({
    channelRevision: channelConfig.revision,
    keyCode: selected.keyCode,
    planCode: selected.planCode,
    selectedUpdatedAt: selected.updatedAt,
    userPlanCode: selected.userPlanCode,
  })
  const cached = readCachedEntitlements(selectionCacheKey)
  if (cached) {
    return cached
  }

  let pending = pendingEntitlementRequests.get(selectionCacheKey)
  if (!pending) {
    const generation = entitlementCacheGeneration
    pending = fetchCompShareEntitlements({
      channelRevision: channelConfig.revision,
      credentials,
      selected,
    }).then(({ cacheKey, entitlements }) => {
      if (generation === entitlementCacheGeneration) {
        const expiresAt = Date.now() + ENTITLEMENT_CACHE_TTL_MS
        entitlementCache.set(cacheKey, { expiresAt, entitlements })
        selectedCacheKeys.set(selectionCacheKey, cacheKey)
        cacheAgentModelDefinitions(entitlements, expiresAt)
      }
      return entitlements
    })
    pendingEntitlementRequests.set(selectionCacheKey, pending)
    void pending.then(
      () => {
        if (pendingEntitlementRequests.get(selectionCacheKey) === pending) {
          pendingEntitlementRequests.delete(selectionCacheKey)
        }
      },
      () => {
        if (pendingEntitlementRequests.get(selectionCacheKey) === pending) {
          pendingEntitlementRequests.delete(selectionCacheKey)
        }
      }
    )
  }

  return pending
}

export async function resolveCompShareSelectedPlan(): Promise<CompShareSelectedPlan | null> {
  const entitlements = await loadCompShareEntitlementsStrict()
  return entitlements
    ? {
        code: entitlements.planCode,
        name: entitlements.planName,
        price: entitlements.planPrice,
        originalPrice: entitlements.planOriginalPrice,
      }
    : null
}

export function invalidateCompShareEntitlements() {
  entitlementCacheGeneration += 1
  entitlementCache.clear()
  selectedCacheKeys.clear()
  pendingEntitlementRequests.clear()
  cachedAgentModelDefinitions.clear()
}

export async function listCompShareEntitledModels() {
  if (!isCompShareChannel()) {
    return null
  }

  const credentials = getCompShareControlCredentials()
  const selected = getCompShareSelectedApiKey()
  if (!credentials) {
    return []
  }

  if (!selected) {
    try {
      return await listCompShareOwnedPlanModels(credentials)
    } catch {
      return []
    }
  }

  try {
    return (await loadCompShareEntitlementsStrict())?.models ?? []
  } catch {
    return []
  }
}

export async function listCompShareAgentModelDefinitions() {
  const models = await listCompShareEntitledModels()
  return models?.map(createAgentModelDefinition) ?? null
}

export function getCachedCompShareAgentModelDefinition(
  modelId: string,
  runtimeId?: string
) {
  if (!isCompShareChannel()) {
    return null
  }

  const alias = normalizeModelAlias(modelId)
  const cached = cachedAgentModelDefinitions.get(alias)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    cachedAgentModelDefinitions.delete(alias)
    return null
  }

  if (
    runtimeId &&
    !cached.model.supportedRuntimeIds.some(
      (candidate) => candidate === runtimeId
    )
  ) {
    return null
  }

  return cached.model
}

export async function resolveCompShareEntitledModel(requestedModel: string) {
  const normalizedRequestedModel = normalizeModelAlias(requestedModel)
  if (!isCompShareChannel()) {
    return requestedModel.trim()
  }

  if (!normalizedRequestedModel) {
    throw new CompShareEntitlementError()
  }

  try {
    const entitlements = await loadCompShareEntitlementsStrict()
    const model = entitlements?.models.find((candidate) =>
      getCompShareModelAliases(candidate).some(
        (alias) => normalizeModelAlias(alias) === normalizedRequestedModel
      )
    )

    if (!model) {
      throw new CompShareEntitlementError()
    }

    return model.name
  } catch (error) {
    if (error instanceof CompShareEntitlementError) {
      throw error
    }

    throw new CompShareEntitlementError()
  }
}
