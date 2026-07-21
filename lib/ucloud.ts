import { createHash } from "node:crypto"

import { withAstraflowClientHeaders } from "@/lib/review-client"

const UCLOUD_ENDPOINT = "https://api.ucloud.cn/"

export type UCloudScalarParamValue = string | number | boolean
export type UCloudParamValue =
  UCloudScalarParamValue | readonly UCloudScalarParamValue[]

export type UCloudCredentials = {
  mode: "signature" | "oauth"
  projectId: string
} & (
  | {
      mode: "signature"
      accessKey: string
      secretKey: string
    }
  | {
      mode: "oauth"
      accessToken: string
      tokenType: string
    }
)

type CallUCloudActionInput = {
  credentials: UCloudCredentials
  params: Record<string, UCloudParamValue>
  headers?: Record<string, string>
}

type UCloudErrorPayload = {
  RetCode?: number
  Message?: string
}


function formatUCloudErrorDetail(
  data: UCloudErrorPayload,
  httpStatus: number
) {
  const message = (data.Message || "").trim()
  const retCode = data.RetCode
  const parts: string[] = []

  if (message) {
    parts.push(message)
  } else {
    parts.push("UCloud request failed.")
  }

  if (typeof retCode === "number" && retCode !== 0) {
    parts.push(`RetCode ${retCode}`)
  }

  if (!(httpStatus >= 200 && httpStatus < 300) && httpStatus) {
    parts.push(`HTTP ${httpStatus}`)
  }

  const haystack = `${message} ${retCode ?? ""}`.toLowerCase()
  if (
    retCode === 299 ||
    /client|forbidden|not allow|denied|unauthorized|无权限|拦截|拒绝|不允许|green/.test(
      haystack
    )
  ) {
    return `请求被拦截：${parts.join(" · ")}`
  }

  return parts.join(" · ")
}

export class UCloudApiError extends Error {
  retCode?: number
  status: number

  constructor(
    message: string,
    options?: { retCode?: number; status?: number }
  ) {
    super(message)
    this.name = "UCloudApiError"
    this.retCode = options?.retCode
    this.status = options?.status ?? 502
  }
}

function stringifyParamValue(value: UCloudScalarParamValue) {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function expandParamValues(params: Record<string, UCloudParamValue>) {
  const expanded: Record<string, UCloudScalarParamValue> = {}

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        expanded[`${key}.${index}`] = item
      })
      continue
    }

    expanded[key] = value as UCloudScalarParamValue
  }

  return expanded
}

// UCloud signature: sort params by key, concatenate `key+value`, append the
// private key, then SHA1. See https://docs.ucloud.cn/api/summary/signature
function createUCloudSignature(
  params: Record<string, UCloudScalarParamValue>,
  secretKey: string
) {
  const canonicalString = Object.keys(params)
    .sort()
    .map((key) => `${key}${stringifyParamValue(params[key])}`)
    .join("")

  return createHash("sha1")
    .update(`${canonicalString}${secretKey}`, "utf8")
    .digest("hex")
}

export async function callUCloudAction<T>({
  credentials,
  params,
  headers: extraHeaders,
}: CallUCloudActionInput) {
  let headers: Record<string, string> = withAstraflowClientHeaders({
    "Content-Type": "application/json",
  })
  let body: Record<string, UCloudScalarParamValue>

  if (credentials.mode === "oauth") {
    body = expandParamValues(params)
    headers = {
      ...headers,
      Authorization: `${credentials.tokenType} ${credentials.accessToken}`,
    }
  } else {
    const signedParams = expandParamValues({
      ...params,
      PublicKey: credentials.accessKey,
    })

    body = {
      ...signedParams,
      Signature: createUCloudSignature(signedParams, credentials.secretKey),
    }
  }

  headers = {
    ...headers,
    ...(extraHeaders ?? {}),
  }

  let response: Response

  try {
    response = await fetch(UCLOUD_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new UCloudApiError("Unable to reach UCloud.")
  }

  let data: T & UCloudErrorPayload

  try {
    data = (await response.json()) as T & UCloudErrorPayload
  } catch {
    throw new UCloudApiError("UCloud returned an invalid response.", {
      status: response.ok ? 502 : response.status,
    })
  }

  if (!response.ok || data.RetCode !== 0) {
    const detail = formatUCloudErrorDetail(data, response.status)
    throw new UCloudApiError(detail, {
      retCode: data.RetCode,
      status: response.ok ? 400 : response.status,
    })
  }

  return data
}
