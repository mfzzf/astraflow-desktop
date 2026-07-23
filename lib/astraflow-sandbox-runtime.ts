import type { SandboxOpts } from "@e2b/code-interpreter"

export const ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN =
  "cn-wlcb.sandbox.ucloudai.com"
export const ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS = 30_000

export const ASTRAFLOW_SANDBOX_ENV = {
  domain: "ASTRAFLOW_SANDBOX_DOMAIN",
  apiUrl: "ASTRAFLOW_SANDBOX_API_URL",
  sandboxUrl: "ASTRAFLOW_SANDBOX_URL",
} as const

const LEGACY_SANDBOX_ENV: Record<
  keyof typeof ASTRAFLOW_SANDBOX_ENV,
  string
> = {
  domain: "E2B_DOMAIN",
  apiUrl: "E2B_API_URL",
  sandboxUrl: "E2B_SANDBOX_URL",
}

export type AstraFlowSandboxConnectionOptions = Pick<
  SandboxOpts,
  | "apiKey"
  | "validateApiKey"
  | "domain"
  | "apiUrl"
  | "sandboxUrl"
  | "requestTimeoutMs"
>

function normalizeDomain(value: string | undefined) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function readAstraFlowSandboxEnv(
  name: keyof typeof ASTRAFLOW_SANDBOX_ENV
) {
  const value =
    process.env[ASTRAFLOW_SANDBOX_ENV[name]] ??
    process.env[LEGACY_SANDBOX_ENV[name]]
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function getAstraFlowSandboxConnectionOptions(
  apiKey: string
): AstraFlowSandboxConnectionOptions {
  const options: AstraFlowSandboxConnectionOptions = {
    apiKey,
    validateApiKey: false,
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  }
  const domain = normalizeDomain(
    readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN
  )
  const apiUrl = normalizeUrl(readAstraFlowSandboxEnv("apiUrl"))
  const sandboxUrl = normalizeUrl(readAstraFlowSandboxEnv("sandboxUrl"))

  if (domain) {
    options.domain = domain
  }

  if (apiUrl) {
    options.apiUrl = apiUrl
  }

  if (sandboxUrl) {
    options.sandboxUrl = sandboxUrl
  }

  return options
}
