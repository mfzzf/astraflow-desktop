import { Template, defaultBuildLogger } from "e2b"

const TEMPLATE_NAME = "astraflow-desktop"
const BASE_TEMPLATE = "code-interpreter-v1"
const DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"

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

const apiKey = process.env.E2B_API_KEY
const domain = normalizeDomain(
  process.env.E2B_DOMAIN ??
    process.env.ASTRAFLOW_SANDBOX_DOMAIN ??
    DEFAULT_DOMAIN
)
const apiUrl = normalizeUrl(
  process.env.E2B_API_URL ?? process.env.ASTRAFLOW_SANDBOX_API_URL
)
const sandboxUrl = normalizeUrl(
  process.env.E2B_SANDBOX_URL ?? process.env.ASTRAFLOW_SANDBOX_URL
)
const validateApiKey = process.env.E2B_VALIDATE_API_KEY === "true"

const template = Template()
  .fromTemplate(BASE_TEMPLATE)
  .aptInstall(["tmux"], { noInstallRecommends: true })

const result = await Template.build(template, TEMPLATE_NAME, {
  apiKey,
  domain,
  apiUrl,
  sandboxUrl,
  validateApiKey,
  tags: ["latest"],
  onBuildLogs: defaultBuildLogger({ minLevel: "info" }),
})

console.log(
  JSON.stringify(
    {
      name: result.name,
      alias: result.alias,
      templateId: result.templateId,
      buildId: result.buildId,
      tags: result.tags,
    },
    null,
    2
  )
)
