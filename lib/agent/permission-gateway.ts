import { randomUUID } from "node:crypto"

import type { StructuredToolInterface } from "@langchain/core/tools"

import type { AgentEvent } from "@/lib/agent/events"
import {
  hasPermissionRule,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import {
  getPermissionToolKind as getPolicyPermissionToolKind,
  isHighRiskPermissionRequest,
  isReadOnlyPermissionTool,
  isSensitiveSecretPermissionRequest,
  shouldAutoApprovePermission,
} from "@/lib/agent/permission-policy"
import type { StudioPermissionMode } from "@/lib/studio-types"

const PERMISSION_DENIED_READONLY =
  "Permission denied: this session is in read-only mode, so write and execute actions are blocked. Continue with read-only tools, or tell the user what change you would make and let them switch the permission mode."
const PERMISSION_DENIED_REJECTED =
  "Permission denied: the user declined this tool call. Do not retry the same call. Continue with a different approach, or briefly explain what you wanted to do and let the user decide."
const PERMISSION_DENIED_CANCELLED =
  "Permission request cancelled before the user answered. Do not assume approval; stop this approach or ask the user how to proceed."
const PERMISSION_INPUT_PREVIEW_MAX_CHARS = 12_000

const DEFAULT_PERMISSION_OPTIONS: PermissionOption[] = [
  {
    optionId: "allow_once",
    name: "Allow once",
    kind: "allow_once",
  },
  {
    optionId: "allow_always",
    name: "Allow always",
    kind: "allow_always",
  },
  {
    optionId: "reject_once",
    name: "Reject",
    kind: "reject_once",
  },
]

export type PermissionGatewayContext = {
  sessionId: string
  permissionMode: StudioPermissionMode
  projectId: string | null
  emit: (event: AgentEvent) => void
  signal: AbortSignal
}

type PermissionCheckResult =
  { allowed: true } | { allowed: false; message: string }

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function stringifyPermissionInput(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncatePermissionInput(input: string) {
  if (input.length <= PERMISSION_INPUT_PREVIEW_MAX_CHARS) {
    return input
  }

  return `${input.slice(
    0,
    PERMISSION_INPUT_PREVIEW_MAX_CHARS
  )}\n...[truncated ${input.length - PERMISSION_INPUT_PREVIEW_MAX_CHARS} chars]`
}

function getPermissionInputStrings(input: unknown) {
  const record = getRecord(input)
  const previewInput =
    record?.type === "tool_call" && "args" in record ? record.args : input
  const full = stringifyPermissionInput(previewInput)

  return { full, preview: truncatePermissionInput(full) }
}

export function getPermissionToolKind(toolName: string) {
  return getPolicyPermissionToolKind(toolName)
}

function isReadOnlyToolName(toolName: string) {
  return isReadOnlyPermissionTool(toolName)
}

export async function requestToolPermission({
  context,
  input,
  toolName,
}: {
  context: PermissionGatewayContext
  input: unknown
  toolName: string
}): Promise<PermissionCheckResult> {
  const { full: policyInput, preview: inputPreview } =
    getPermissionInputStrings(input)
  const sensitiveSecret = isSensitiveSecretPermissionRequest({
    inputPreview: policyInput,
    toolName,
  })
  const highRiskInAutoMode =
    context.permissionMode === "auto" &&
    isHighRiskPermissionRequest({
      inputPreview: policyInput,
      toolName,
    })

  if (!sensitiveSecret && isReadOnlyToolName(toolName)) {
    return { allowed: true }
  }

  if (context.permissionMode === "readonly") {
    return { allowed: false, message: PERMISSION_DENIED_READONLY }
  }

  if (
    shouldAutoApprovePermission({
      inputPreview: policyInput,
      mode: context.permissionMode,
      toolName,
    })
  ) {
    return { allowed: true }
  }

  if (
    !sensitiveSecret &&
    !highRiskInAutoMode &&
    hasPermissionRule({
      projectId: context.projectId,
      sessionId: context.sessionId,
      toolName,
    })
  ) {
    return { allowed: true }
  }

  if (context.signal.aborted) {
    return { allowed: false, message: PERMISSION_DENIED_CANCELLED }
  }

  const requestId = randomUUID()
  const options = DEFAULT_PERMISSION_OPTIONS.map((option) => ({ ...option }))

  context.emit({
    type: "permission_request",
    requestId,
    toolName,
    input: inputPreview,
    options,
    status: "pending",
    selectedOptionId: null,
    decisions: [],
  })

  const decision = await requestPermission({
    sessionId: context.sessionId,
    requestId,
    toolName,
    inputPreview,
    policyInput,
    options,
    signal: context.signal,
  })

  if ("cancelled" in decision) {
    context.emit({
      type: "permission_request",
      requestId,
      toolName,
      input: inputPreview,
      options,
      status: "resolved",
      selectedOptionId: null,
      decisions: ["cancelled"],
    })

    return { allowed: false, message: PERMISSION_DENIED_CANCELLED }
  }

  const selectedOption =
    options.find((option) => option.optionId === decision.optionId) ?? null
  const decisionLabel =
    decision.feedback || selectedOption?.name || decision.optionId

  context.emit({
    type: "permission_request",
    requestId,
    toolName,
    input: inputPreview,
    options,
    status: "resolved",
    selectedOptionId: decision.optionId,
    decisions: [decisionLabel],
  })

  if (selectedOption?.kind.startsWith("allow")) {
    return { allowed: true }
  }

  return {
    allowed: false,
    message: decision.feedback || PERMISSION_DENIED_REJECTED,
  }
}

export function wrapToolsWithPermissionGateway(
  tools: StructuredToolInterface[],
  context: PermissionGatewayContext
) {
  return tools.map((agentTool) => {
    const invoke = agentTool.invoke.bind(agentTool) as (
      input: unknown,
      config?: unknown
    ) => Promise<unknown>
    const call = agentTool.call.bind(agentTool) as (
      input: unknown,
      config?: unknown,
      tags?: string[]
    ) => Promise<unknown>

    return new Proxy(agentTool, {
      get(target, property, receiver) {
        if (property === "invoke") {
          return async (input: unknown, config?: unknown) => {
            const permission = await requestToolPermission({
              context,
              input,
              toolName: target.name,
            })

            if (!permission.allowed) {
              return permission.message
            }

            return invoke(input, config)
          }
        }

        if (property === "call") {
          return async (input: unknown, config?: unknown, tags?: string[]) => {
            const permission = await requestToolPermission({
              context,
              input,
              toolName: target.name,
            })

            if (!permission.allowed) {
              return permission.message
            }

            return call(input, config, tags)
          }
        }

        return Reflect.get(target, property, receiver)
      },
    })
  })
}
