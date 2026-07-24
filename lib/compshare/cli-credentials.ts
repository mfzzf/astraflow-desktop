import "server-only"

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"

import { callCompShareAction } from "@/lib/compshare/control-plane"
import { isCompShareChannel } from "@/lib/compshare/config"

const COMPSHARE_CLI_PROFILE = "default"

type CompShareAccessKey = {
  AccessKeyID?: unknown
  AccessKeySecret?: unknown
  Status?: unknown
  ExpiredAt?: unknown
  CreatedAt?: unknown
  UpdatedAt?: unknown
  LastUsedAt?: unknown
}

type ListUserAccessKeysResponse = {
  AccessKey?: unknown
  RetCode?: number
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function asTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function isUsableAccessKey(
  value: CompShareAccessKey,
  nowSeconds: number
) {
  const expiredAt = asTimestamp(value.ExpiredAt)

  return Boolean(
    asTrimmedString(value.AccessKeyID) &&
    asTrimmedString(value.AccessKeySecret) &&
    asTrimmedString(value.Status).toLowerCase() === "active" &&
    (expiredAt === 0 || expiredAt > nowSeconds)
  )
}

export function selectCompShareCliAccessKey(
  values: unknown,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (!Array.isArray(values)) {
    return null
  }

  const candidates = values
    .filter(
      (value): value is CompShareAccessKey =>
        Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        isUsableAccessKey(value as CompShareAccessKey, nowSeconds)
    )
    .sort((left, right) => {
      const leftActivity = Math.max(
        asTimestamp(left.LastUsedAt),
        asTimestamp(left.UpdatedAt),
        asTimestamp(left.CreatedAt)
      )
      const rightActivity = Math.max(
        asTimestamp(right.LastUsedAt),
        asTimestamp(right.UpdatedAt),
        asTimestamp(right.CreatedAt)
      )
      return rightActivity - leftActivity
    })

  const selected = candidates[0]
  if (!selected) {
    return null
  }

  return {
    publicKey: asTrimmedString(selected.AccessKeyID),
    privateKey: asTrimmedString(selected.AccessKeySecret),
  }
}

export function getCompShareCliConfigPath() {
  const configured = process.env.COMPSHARE_CONFIG_FILE?.trim()
  if (configured) {
    return resolve(configured)
  }

  const userDataRoot = process.env.ASTRAFLOW_USER_DATA_PATH?.trim()
  return userDataRoot
    ? join(resolve(userDataRoot), "compshare-cli", "config.json")
    : null
}

function writePrivateCliConfig(
  path: string,
  credentials: { publicKey: string; privateKey: string }
) {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)

  const temporaryPath = join(directory, `.${randomUUID()}.tmp`)
  const contents = `${JSON.stringify(
    {
      current_profile: COMPSHARE_CLI_PROFILE,
      profiles: {
        [COMPSHARE_CLI_PROFILE]: {
          public_key: credentials.publicKey,
          private_key: credentials.privateKey,
        },
      },
    },
    null,
    2
  )}\n`

  try {
    writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function hasUsableCliConfig(path: string) {
  if (!existsSync(path)) {
    return false
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      current_profile?: unknown
      profiles?: Record<string, { public_key?: unknown; private_key?: unknown }>
    }
    const profileName = asTrimmedString(parsed.current_profile)
    const profile = profileName ? parsed.profiles?.[profileName] : null

    return Boolean(
      profile &&
      asTrimmedString(profile.public_key) &&
      asTrimmedString(profile.private_key)
    )
  } catch {
    return false
  }
}

export function clearCompShareCliCredentials() {
  const path = getCompShareCliConfigPath()
  if (!path) {
    return
  }

  rmSync(path, { force: true })
}

export async function syncCompShareCliCredentials(accessToken: string) {
  if (!isCompShareChannel()) {
    return false
  }

  const path = getCompShareCliConfigPath()
  if (!path) {
    return false
  }

  const response =
    await callCompShareAction<ListUserAccessKeysResponse>({
      credentials: { accessToken },
      params: {
        Action: "ListUserAccessKeys",
        UserName: "root",
      },
    })
  const credentials = selectCompShareCliAccessKey(response.AccessKey)

  if (!credentials) {
    clearCompShareCliCredentials()
    throw new Error("CompShare did not return an active, unexpired access key.")
  }

  writePrivateCliConfig(path, credentials)
  return true
}

export async function ensureCompShareCliCredentials(accessToken: string) {
  const path = getCompShareCliConfigPath()

  if (!isCompShareChannel() || !path) {
    return false
  }

  return hasUsableCliConfig(path)
    ? true
    : syncCompShareCliCredentials(accessToken)
}
