import "server-only"

import type { CompShareCredentials } from "@/lib/compshare/control-plane"
import {
  COMPSHARE_CHANNEL_SLUG,
  isCompShareChannel,
} from "@/lib/compshare/config"

import {
  deleteStudioSetting,
  readSecretSetting,
  writeSecretSetting,
} from "./helpers"

const COMPSHARE_CREDENTIALS_SETTING = "compshare_control_credentials"
const COMPSHARE_SELECTED_API_KEY_SETTING = "compshare_selected_api_key"
const COMPSHARE_API_KEYRING_SETTING = "compshare_api_keyring"
const COMPSHARE_LAST_PUBLIC_KEY_SETTING = "compshare_last_public_key"
const COMPSHARE_STORAGE_VERSION = 1

export type CompShareCredentialStatus = {
  configured: boolean
  publicKeyPreview: string | null
  updatedAt: string | null
}

export type CompShareSelectedApiKey = {
  keyCode: string
  apiKey: string
  userPlanCode: string
  planCode?: string
  name?: string
  updatedAt: string
}

export type CompShareApiKeyRecord = Omit<
  CompShareSelectedApiKey,
  "updatedAt" | "userPlanCode"
> & {
  userPlanCode?: string
}

type StoredCompShareCredentials = CompShareCredentials & {
  channelSlug: typeof COMPSHARE_CHANNEL_SLUG
  version: typeof COMPSHARE_STORAGE_VERSION
}

type StoredCompShareLastAccount = {
  channelSlug: typeof COMPSHARE_CHANNEL_SLUG
  version: typeof COMPSHARE_STORAGE_VERSION
  publicKey: string
}

type StoredCompShareSelectedApiKey = {
  channelSlug: typeof COMPSHARE_CHANNEL_SLUG
  version: typeof COMPSHARE_STORAGE_VERSION
  keyCode: string
}

type StoredCompShareApiKeyring = {
  channelSlug: typeof COMPSHARE_CHANNEL_SLUG
  version: typeof COMPSHARE_STORAGE_VERSION
  keys: Record<string, CompShareApiKeyRecord>
}

function parseStoredObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isCurrentCompShareRecord(parsed: Record<string, unknown>) {
  return (
    parsed.version === COMPSHARE_STORAGE_VERSION &&
    parsed.channelSlug === COMPSHARE_CHANNEL_SLUG
  )
}

function readRequiredString(
  parsed: Record<string, unknown>,
  key: string
): string | null {
  const value = parsed[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function maskPublicKey(publicKey: string) {
  return publicKey.length > 4 ? `••••${publicKey.slice(-4)}` : "••••"
}

function getRememberedCompSharePublicKey() {
  const row = readSecretSetting(COMPSHARE_LAST_PUBLIC_KEY_SETTING)
  if (!row?.value) {
    return null
  }

  const parsed = parseStoredObject(row.value)
  return parsed && isCurrentCompShareRecord(parsed)
    ? readRequiredString(parsed, "publicKey")
    : null
}

function rememberCompSharePublicKey(publicKey: string) {
  writeSecretSetting(
    COMPSHARE_LAST_PUBLIC_KEY_SETTING,
    JSON.stringify({
      version: COMPSHARE_STORAGE_VERSION,
      channelSlug: COMPSHARE_CHANNEL_SLUG,
      publicKey,
    } satisfies StoredCompShareLastAccount)
  )
}

export function getCompShareControlCredentials(): CompShareCredentials | null {
  if (!isCompShareChannel()) {
    return null
  }

  const row = readSecretSetting(COMPSHARE_CREDENTIALS_SETTING)
  if (!row?.value) {
    return null
  }

  const parsed = parseStoredObject(row.value)
  if (!parsed || !isCurrentCompShareRecord(parsed)) {
    return null
  }

  const publicKey = readRequiredString(parsed, "publicKey")
  const privateKey = readRequiredString(parsed, "privateKey")
  return publicKey && privateKey ? { publicKey, privateKey } : null
}

export function getCompShareCredentialStatus(): CompShareCredentialStatus {
  const credentials = getCompShareControlCredentials()
  if (!credentials) {
    return {
      configured: false,
      publicKeyPreview: null,
      updatedAt: null,
    }
  }

  const row = readSecretSetting(COMPSHARE_CREDENTIALS_SETTING)
  return {
    configured: true,
    publicKeyPreview: maskPublicKey(credentials.publicKey),
    updatedAt: row?.updated_at ?? null,
  }
}

export function saveCompShareCredentials(credentials: CompShareCredentials) {
  const publicKey = credentials.publicKey.trim()
  const privateKey = credentials.privateKey.trim()
  if (!publicKey || !privateKey) {
    throw new Error("PublicKey and PrivateKey are required.")
  }

  const previousPublicKey =
    getCompShareControlCredentials()?.publicKey ??
    getRememberedCompSharePublicKey()
  const updatedAt = writeSecretSetting(
    COMPSHARE_CREDENTIALS_SETTING,
    JSON.stringify({
      version: COMPSHARE_STORAGE_VERSION,
      channelSlug: COMPSHARE_CHANNEL_SLUG,
      publicKey,
      privateKey,
    } satisfies StoredCompShareCredentials)
  )

  if (previousPublicKey && previousPublicKey !== publicKey) {
    clearCompShareSelectedApiKey()
    deleteStudioSetting(COMPSHARE_API_KEYRING_SETTING)
  }
  rememberCompSharePublicKey(publicKey)

  return {
    configured: true,
    publicKeyPreview: maskPublicKey(publicKey),
    updatedAt,
  } satisfies CompShareCredentialStatus
}

export function clearCompShareCredentials() {
  const credentials = getCompShareControlCredentials()
  if (credentials) {
    rememberCompSharePublicKey(credentials.publicKey)
  }
  deleteStudioSetting(COMPSHARE_CREDENTIALS_SETTING)
}

function getCompShareApiKeyring(): Record<string, CompShareApiKeyRecord> {
  const row = readSecretSetting(COMPSHARE_API_KEYRING_SETTING)
  if (!row?.value) {
    return {}
  }

  const parsed = parseStoredObject(row.value)
  if (
    !parsed ||
    !isCurrentCompShareRecord(parsed) ||
    !parsed.keys ||
    typeof parsed.keys !== "object" ||
    Array.isArray(parsed.keys)
  ) {
    return {}
  }

  const keys: Record<string, CompShareApiKeyRecord> = {}
  for (const [keyCode, value] of Object.entries(
    parsed.keys as Record<string, unknown>
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue
    }
    const record = value as Record<string, unknown>
    const apiKey = readRequiredString(record, "apiKey")
    if (!apiKey) {
      continue
    }
    const userPlanCode = readRequiredString(record, "userPlanCode") ?? undefined
    const planCode = readRequiredString(record, "planCode") ?? undefined
    const name = readRequiredString(record, "name") ?? undefined
    keys[keyCode] = {
      keyCode,
      apiKey,
      ...(userPlanCode ? { userPlanCode } : {}),
      ...(planCode ? { planCode } : {}),
      ...(name ? { name } : {}),
    }
  }

  return keys
}

export function getCompShareApiKeyByCode(keyCode: string): string | null {
  const normalized = keyCode.trim()
  return normalized
    ? (getCompShareApiKeyring()[normalized]?.apiKey ?? null)
    : null
}

export function upsertCompShareApiKey(input: CompShareApiKeyRecord) {
  const keyCode = input.keyCode.trim()
  const apiKey = input.apiKey.trim()
  const userPlanCode = input.userPlanCode?.trim()
  const planCode = input.planCode?.trim()
  const name = input.name?.trim()
  if (!keyCode || !apiKey) {
    throw new Error("KeyCode and API key are required.")
  }

  const keys = getCompShareApiKeyring()
  keys[keyCode] = {
    keyCode,
    apiKey,
    ...(userPlanCode ? { userPlanCode } : {}),
    ...(planCode ? { planCode } : {}),
    ...(name ? { name } : {}),
  }
  return writeSecretSetting(
    COMPSHARE_API_KEYRING_SETTING,
    JSON.stringify({
      version: COMPSHARE_STORAGE_VERSION,
      channelSlug: COMPSHARE_CHANNEL_SLUG,
      keys,
    } satisfies StoredCompShareApiKeyring)
  )
}

export function removeCompShareApiKey(keyCode: string) {
  const normalized = keyCode.trim()
  if (!normalized) {
    return
  }

  const keys = getCompShareApiKeyring()
  if (!(normalized in keys)) {
    return
  }
  delete keys[normalized]
  writeSecretSetting(
    COMPSHARE_API_KEYRING_SETTING,
    JSON.stringify({
      version: COMPSHARE_STORAGE_VERSION,
      channelSlug: COMPSHARE_CHANNEL_SLUG,
      keys,
    } satisfies StoredCompShareApiKeyring)
  )

  const selectedRow = readSecretSetting(COMPSHARE_SELECTED_API_KEY_SETTING)
  const selected = selectedRow?.value
    ? parseStoredObject(selectedRow.value)
    : null
  if (selected && readRequiredString(selected, "keyCode") === normalized) {
    clearCompShareSelectedApiKey()
  }
}

export function getCompShareSelectedApiKey(): CompShareSelectedApiKey | null {
  if (!isCompShareChannel()) {
    return null
  }
  if (!getCompShareControlCredentials()) {
    return null
  }

  const row = readSecretSetting(COMPSHARE_SELECTED_API_KEY_SETTING)
  if (!row?.value) {
    return null
  }

  const parsed = parseStoredObject(row.value)
  if (!parsed || !isCurrentCompShareRecord(parsed)) {
    return null
  }

  const keyCode = readRequiredString(parsed, "keyCode")
  const record = keyCode ? getCompShareApiKeyring()[keyCode] : null
  if (!record?.userPlanCode) {
    return null
  }

  return {
    keyCode: record.keyCode,
    apiKey: record.apiKey,
    userPlanCode: record.userPlanCode,
    ...(record.planCode ? { planCode: record.planCode } : {}),
    ...(record.name ? { name: record.name } : {}),
    updatedAt: row.updated_at,
  }
}

export function saveCompShareSelectedApiKey(
  selected: Omit<CompShareSelectedApiKey, "updatedAt">
) {
  const keyCode = selected.keyCode.trim()
  const apiKey = selected.apiKey.trim()
  const userPlanCode = selected.userPlanCode.trim()
  const planCode = selected.planCode?.trim()
  const name = selected.name?.trim()
  if (!keyCode || !apiKey || !userPlanCode) {
    throw new Error("KeyCode, API key, and UserPlanCode are required.")
  }

  upsertCompShareApiKey({
    keyCode,
    apiKey,
    userPlanCode,
    ...(planCode ? { planCode } : {}),
    ...(name ? { name } : {}),
  })
  const updatedAt = writeSecretSetting(
    COMPSHARE_SELECTED_API_KEY_SETTING,
    JSON.stringify({
      version: COMPSHARE_STORAGE_VERSION,
      channelSlug: COMPSHARE_CHANNEL_SLUG,
      keyCode,
    } satisfies StoredCompShareSelectedApiKey)
  )

  return {
    keyCode,
    apiKey,
    userPlanCode,
    ...(planCode ? { planCode } : {}),
    ...(name ? { name } : {}),
    updatedAt,
  } satisfies CompShareSelectedApiKey
}

export function clearCompShareSelectedApiKey() {
  deleteStudioSetting(COMPSHARE_SELECTED_API_KEY_SETTING)
}
