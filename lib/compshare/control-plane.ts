import "server-only"

import { createHash } from "node:crypto"

import { COMPSHARE_CONTROL_PLANE_URL } from "@/lib/compshare/config"

export type CompShareCredentials = {
  publicKey: string
  privateKey: string
}

export type CompShareScalarParamValue = string | number | boolean
export type CompShareParamValue =
  | CompShareScalarParamValue
  | readonly CompShareScalarParamValue[]

type CallCompShareActionInput = {
  credentials: CompShareCredentials
  params: Record<string, CompShareParamValue>
}

type CompShareErrorPayload = {
  RetCode?: number
  Message?: string
}

export class CompShareApiError extends Error {
  readonly retCode?: number
  readonly status: number

  constructor(
    message: string,
    options?: { retCode?: number; status?: number }
  ) {
    super(message)
    this.name = "CompShareApiError"
    this.retCode = options?.retCode
    this.status = options?.status ?? 502
  }
}

function stringifyParamValue(value: CompShareScalarParamValue) {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function expandParamValues(params: Record<string, CompShareParamValue>) {
  const expanded: Record<string, CompShareScalarParamValue> = {}

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        expanded[`${key}.${index}`] = item
      })
      continue
    }

    expanded[key] = value as CompShareScalarParamValue
  }

  return expanded
}

function createCompShareSignature(
  params: Record<string, CompShareScalarParamValue>,
  privateKey: string
) {
  const canonicalString = Object.keys(params)
    .sort()
    .map((key) => `${key}${stringifyParamValue(params[key])}`)
    .join("")

  return createHash("sha1")
    .update(`${canonicalString}${privateKey}`, "utf8")
    .digest("hex")
}

function safeRemoteMessage(
  message: unknown,
  credentials: CompShareCredentials
) {
  if (typeof message !== "string") {
    return "CompShare request failed."
  }

  const normalized = message.trim().slice(0, 500)
  if (!normalized) {
    return "CompShare request failed."
  }

  return [credentials.privateKey, credentials.publicKey]
    .filter(Boolean)
    .reduce(
      (result, secret) => result.split(secret).join("[redacted]"),
      normalized
    )
}

export async function callCompShareAction<T>({
  credentials,
  params,
}: CallCompShareActionInput): Promise<T> {
  const publicKey = credentials.publicKey.trim()
  const privateKey = credentials.privateKey.trim()

  if (!publicKey || !privateKey) {
    throw new CompShareApiError("CompShare credentials are not configured.", {
      status: 401,
    })
  }

  const signedParams = expandParamValues({
    ...params,
    PublicKey: publicKey,
  })
  const body = {
    ...signedParams,
    Signature: createCompShareSignature(signedParams, privateKey),
  }

  let response: Response
  try {
    response = await fetch(COMPSHARE_CONTROL_PLANE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new CompShareApiError("Unable to reach CompShare.")
  }

  let data: T & CompShareErrorPayload
  try {
    data = (await response.json()) as T & CompShareErrorPayload
  } catch {
    throw new CompShareApiError("CompShare returned an invalid response.", {
      status: response.ok ? 502 : response.status,
    })
  }

  if (!response.ok || data.RetCode !== 0) {
    throw new CompShareApiError(
      safeRemoteMessage(data.Message, { publicKey, privateKey }),
      {
        retCode: data.RetCode,
        status: response.ok ? 400 : response.status,
      }
    )
  }

  return data
}
