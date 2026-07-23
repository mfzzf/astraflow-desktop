import "server-only"

import { getCompShareAccount } from "@/lib/compshare/account"
import {
  callCompShareAction,
  type CompShareCredentials,
} from "@/lib/compshare/control-plane"
import { getCompShareControlCredentials } from "@/lib/studio-db"

const DESCRIBE_SANDBOX_PAGE_SIZE = 100
const SANDBOX_NOT_FOUND_RET_CODE = 8039

export type CompShareSandboxRecord = {
  sandboxId: string
  templateId: string
  status: "Created" | "Deleted" | string
  envdAccessToken: string | null
  userEmail: string | null
  createTime: number | null
  updateTime: number | null
  endAt: number | null
}

type CreateSandboxResponse = {
  SandboxId?: unknown
  Status?: unknown
  EnvdAccessToken?: unknown
}

type DeleteSandboxResponse = {
  SandboxId?: unknown
  Status?: unknown
}

type SetSandboxTimeoutResponse = {
  SandboxId?: unknown
}

type DescribeSandboxResponse = {
  TotalCount?: unknown
  SandboxSet?: unknown
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function requirePositiveInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`CompShare ${field} is unavailable.`)
  }

  return value
}

function parseSandboxRecord(value: unknown): CompShareSandboxRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const sandboxId = asString(record.SandboxId)

  if (!sandboxId) {
    return null
  }

  return {
    sandboxId,
    templateId: asString(record.TemplateId),
    status: asString(record.Status) || "Created",
    envdAccessToken: asString(record.EnvdAccessToken) || null,
    userEmail: asString(record.UserEmail) || null,
    createTime: asNumber(record.CreateTime),
    updateTime: asNumber(record.UpdateTime),
    endAt: asNumber(record.EndAt),
  }
}

async function resolveSandboxControlContext(): Promise<{
  credentials: CompShareCredentials
  topOrganizationId: number
}> {
  const credentials = getCompShareControlCredentials()

  if (!credentials) {
    throw new Error("CompShare credentials are not configured.")
  }

  const account = await getCompShareAccount(credentials)

  return {
    credentials,
    topOrganizationId: requirePositiveInteger(account.companyId, "company ID"),
  }
}

export async function createCompShareSandbox({
  templateId,
  userEmail,
}: {
  templateId: string
  userEmail?: string | null
}) {
  const normalizedTemplateId = templateId.trim()

  if (!normalizedTemplateId) {
    throw new Error("CompShare Sandbox template ID is required.")
  }

  const { credentials, topOrganizationId } =
    await resolveSandboxControlContext()
  const normalizedUserEmail = userEmail?.trim()
  const response = await callCompShareAction<CreateSandboxResponse>({
    credentials,
    params: {
      Action: "CreateSandbox",
      top_organization_id: topOrganizationId,
      TemplateId: normalizedTemplateId,
      ...(normalizedUserEmail ? { user_email: normalizedUserEmail } : {}),
    },
  })
  const sandboxId = asString(response.SandboxId)

  if (!sandboxId) {
    throw new Error("CompShare CreateSandbox returned no SandboxId.")
  }

  return {
    sandboxId,
    status: asString(response.Status) || "Created",
    envdAccessToken: asString(response.EnvdAccessToken) || null,
  }
}

export async function deleteCompShareSandbox(sandboxId: string) {
  const normalizedSandboxId = sandboxId.trim()

  if (!normalizedSandboxId) {
    throw new Error("CompShare Sandbox ID is required.")
  }

  const { credentials, topOrganizationId } =
    await resolveSandboxControlContext()

  try {
    const response = await callCompShareAction<DeleteSandboxResponse>({
      credentials,
      params: {
        Action: "DeleteSandbox",
        top_organization_id: topOrganizationId,
        SandboxId: normalizedSandboxId,
      },
    })

    return {
      deleted: asString(response.Status).toLowerCase() === "deleted",
      sandboxId: asString(response.SandboxId) || normalizedSandboxId,
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "retCode" in error &&
      error.retCode === SANDBOX_NOT_FOUND_RET_CODE
    ) {
      return { deleted: false, sandboxId: normalizedSandboxId }
    }

    throw error
  }
}

export async function describeCompShareSandboxes({
  sandboxId,
}: {
  sandboxId?: string
} = {}) {
  const { credentials, topOrganizationId } =
    await resolveSandboxControlContext()
  const normalizedSandboxId = sandboxId?.trim()
  const sandboxes: CompShareSandboxRecord[] = []
  let offset = 0
  let totalCount = Number.POSITIVE_INFINITY

  while (offset < totalCount) {
    const response = await callCompShareAction<DescribeSandboxResponse>({
      credentials,
      params: {
        Action: "DescribeSandbox",
        top_organization_id: topOrganizationId,
        ...(normalizedSandboxId ? { SandboxId: normalizedSandboxId } : {}),
        Offset: offset,
        Limit: DESCRIBE_SANDBOX_PAGE_SIZE,
      },
    })
    const page = Array.isArray(response.SandboxSet)
      ? response.SandboxSet.map(parseSandboxRecord).filter(
          (record): record is CompShareSandboxRecord => Boolean(record)
        )
      : []
    const responseTotal = asNumber(response.TotalCount)

    totalCount = responseTotal === null ? offset + page.length : responseTotal
    sandboxes.push(...page)

    if (page.length === 0 || page.length < DESCRIBE_SANDBOX_PAGE_SIZE) {
      break
    }

    offset += page.length
  }

  return sandboxes
}

export async function describeCompShareSandbox(sandboxId: string) {
  const normalizedSandboxId = sandboxId.trim()
  if (!normalizedSandboxId) {
    throw new Error("CompShare Sandbox ID is required.")
  }

  const sandboxes = await describeCompShareSandboxes({
    sandboxId: normalizedSandboxId,
  })
  return (
    sandboxes.find((sandbox) => sandbox.sandboxId === normalizedSandboxId) ??
    null
  )
}

export async function setCompShareSandboxTimeout(
  sandboxId: string,
  timeoutSeconds: number
) {
  const normalizedSandboxId = sandboxId.trim()
  if (!normalizedSandboxId) {
    throw new Error("CompShare Sandbox ID is required.")
  }
  if (
    !Number.isInteger(timeoutSeconds) ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0
  ) {
    throw new Error("CompShare Sandbox timeout must be a positive integer.")
  }

  const { credentials, topOrganizationId } =
    await resolveSandboxControlContext()
  const response = await callCompShareAction<SetSandboxTimeoutResponse>({
    credentials,
    params: {
      Action: "SetSandboxTimeout",
      top_organization_id: topOrganizationId,
      SandboxId: normalizedSandboxId,
      TimeoutSeconds: timeoutSeconds,
    },
  })

  return {
    sandboxId: asString(response.SandboxId) || normalizedSandboxId,
    timeoutSeconds,
  }
}
