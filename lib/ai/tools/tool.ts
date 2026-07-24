import { z } from "zod"

export type AstraFlowToolInvokeOptions = {
  signal?: AbortSignal
}

export type AstraFlowStructuredToolResult = {
  content: Array<{
    type: "text"
    text: string
  }>
  structuredContent: Record<string, unknown>
  _meta: {
    "astraflow/resultSchema": string
    [key: string]: unknown
  }
  isError?: boolean
}

export function isAstraFlowStructuredToolResult(
  value: unknown
): value is AstraFlowStructuredToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const result = value as Partial<AstraFlowStructuredToolResult>

  return (
    Array.isArray(result.content) &&
    Boolean(
      result.structuredContent &&
        typeof result.structuredContent === "object"
    ) &&
    Boolean(
      result._meta &&
        typeof result._meta === "object" &&
        typeof result._meta["astraflow/resultSchema"] === "string"
    )
  )
}

export const astraFlowToolEffectCategories = [
  "read_only",
  "workspace_internal",
  "important_action",
] as const

export type AstraFlowToolEffectCategory =
  (typeof astraFlowToolEffectCategories)[number]

const READ_ONLY_PRODUCT_TOOLS = new Set([
  "check_runtime_environment_health",
  "compshare_cli_query",
  "get_runtime_environment_status",
  "list_installed_skills",
  "list_installed_mcp_servers",
  "load_skill",
  "read_skill_file",
  "studio_get_media_generation",
  "studio_get_media_model_schema",
  "studio_list_image_models",
  "studio_list_media_generation_models",
  "studio_list_media_generations",
  "studio_list_video_models",
  "web_fetch",
  "web_search",
])

const WORKSPACE_INTERNAL_PRODUCT_TOOLS = new Set([
  "download_file",
  "prepare_skill_sandbox",
  "sandbox_start_service",
  "upload_file",
])

export function getAstraFlowToolEffectCategory(
  toolName: string
): AstraFlowToolEffectCategory {
  if (READ_ONLY_PRODUCT_TOOLS.has(toolName)) {
    return "read_only"
  }

  if (WORKSPACE_INTERNAL_PRODUCT_TOOLS.has(toolName)) {
    return "workspace_internal"
  }

  // Unknown and outward-facing product tools fail closed. This includes
  // billable media generation and sending files to a mobile conversation.
  return "important_action"
}

export type AstraFlowTool = {
  name: string
  description: string
  schema: z.ZodType
  inputJsonSchema?: Record<string, unknown>
  effectCategory: AstraFlowToolEffectCategory
  allowInSubagent: boolean
  isAvailable?: () => boolean | Promise<boolean>
  unavailableMessage?: string
  invoke: (
    input: unknown,
    options?: AstraFlowToolInvokeOptions
  ) => Promise<unknown>
}

type AstraFlowToolDefinition<TSchema extends z.ZodType> = {
  name: string
  description: string
  schema: TSchema
  inputJsonSchema?: Record<string, unknown>
  effectCategory?: AstraFlowToolEffectCategory
  allowInSubagent?: boolean
  isAvailable?: () => boolean | Promise<boolean>
  unavailableMessage?: string
}

/**
 * Define an AstraFlow tool without binding the product layer to an agent SDK.
 * Inputs are validated at the execution boundary so every runtime receives the
 * same parsed values and validation failures.
 */
export function createAstraFlowTool<TSchema extends z.ZodType>(
  execute: (
    input: z.output<TSchema>,
    options: AstraFlowToolInvokeOptions
  ) => unknown | Promise<unknown>,
  definition: AstraFlowToolDefinition<TSchema>
): AstraFlowTool & { schema: TSchema } {
  const effectCategory =
    definition.effectCategory ??
    getAstraFlowToolEffectCategory(definition.name)

  return {
    name: definition.name,
    description: definition.description,
    schema: definition.schema,
    effectCategory,
    allowInSubagent:
      definition.allowInSubagent ??
      (effectCategory !== "important_action" &&
        definition.name !== "sandbox_start_service"),
    ...(definition.inputJsonSchema
      ? { inputJsonSchema: definition.inputJsonSchema }
      : {}),
    ...(definition.isAvailable
      ? { isAvailable: definition.isAvailable }
      : {}),
    ...(definition.unavailableMessage
      ? { unavailableMessage: definition.unavailableMessage }
      : {}),
    async invoke(input, options = {}) {
      const parsed = await definition.schema.parseAsync(input)

      return execute(parsed, options)
    },
  }
}
