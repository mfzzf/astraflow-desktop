import { z } from "zod"

export type AstraFlowToolInvokeOptions = {
  signal?: AbortSignal
}

export type AstraFlowTool = {
  name: string
  description: string
  schema: z.ZodType
  inputJsonSchema?: Record<string, unknown>
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
  return {
    name: definition.name,
    description: definition.description,
    schema: definition.schema,
    ...(definition.inputJsonSchema
      ? { inputJsonSchema: definition.inputJsonSchema }
      : {}),
    async invoke(input, options = {}) {
      const parsed = await definition.schema.parseAsync(input)

      return execute(parsed, options)
    },
  }
}
