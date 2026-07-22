import { z } from "zod"
import { isCompShareChannel } from "@/lib/compshare/config"
import { listCompShareEntitledModels } from "@/lib/compshare/entitlements"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import {
  IMAGE_MODEL_REGISTRY,
  getImageModelDisplayName,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import { loadImageModelOperationFields } from "@/lib/image-openapi"
import { VIDEO_OPENAPI_MODELS } from "@/lib/generated/video-openapi-fields"
import {
  getGeneratedMediaSessionFileId,
  getStudioSessionFile,
  listStudioImageGenerations,
} from "@/lib/studio-db"
import {
  formatMediaGenerationResult,
  generateStudioImage,
  scheduleStudioVideoGenerationResumesForSession,
  submitStudioVideoGeneration,
} from "@/lib/studio-media-generation-service"
import type { StudioMediaReference } from "@/lib/studio-media-generation-service"
import type {
  StudioImageGeneration,
  StudioImageParameterField,
} from "@/lib/studio-types"
import { listStudioVideoGenerations } from "@/lib/studio-video-db"
import { loadVideoModelFields } from "@/lib/video-openapi"
import type {
  StudioVideoGeneration,
  StudioVideoModelProfile,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"

type StudioMediaToolOptions = {
  sessionId: string
  apiKey: string
}

type StudioMediaReadToolOptions = {
  sessionId: string
  apiKey?: string | null
}

const paramsSchema = z.record(z.string(), z.unknown())

// Media tool outputs go straight into the model's context; keep them compact
// (no pretty-printing) and turn thrown provider errors into actionable text
// instead of letting the run fail with a bare stack trace.
function toMediaToolJson(value: unknown) {
  return JSON.stringify(value)
}

function formatMediaToolError(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  return toMediaToolJson({
    error: `${action} failed: ${message}`,
    note: "Check the model name and params against studio_get_media_model_schema, adjust the failing field, and retry once. If the error persists, report it to the user instead of retrying again.",
  })
}

const PARAMETER_SUMMARY_LIMIT = 18
const PARAMETER_SCHEMA_LIMIT = 120
const OPTION_SUMMARY_LIMIT = 12
const DESCRIPTION_SUMMARY_MAX_CHARS = 180
const LOW_VALUE_PARAMETER_NAMES = new Set([
  "model",
  "prompt",
  "text",
  "content",
])
const PARAMETER_PRIORITY = [
  "size",
  "aspectratio",
  "ratio",
  "resolution",
  "quality",
  "imagesize",
  "duration",
  "n",
  "num_images",
  "output_format",
  "response_format",
  "width",
  "height",
  "watermark",
  "seed",
]

const imageAttachmentSchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    mimeType: z.string().trim().max(120).optional(),
    dataUrl: z
      .string()
      .trim()
      .regex(/^data:image\//i)
      .max(80_000_000)
      .optional(),
    url: z.string().trim().url().max(4_000).optional(),
  })
  .refine((value) => Boolean(value.dataUrl || value.url), {
    message: "Each attachment needs either dataUrl or url.",
  })

const mediaAttachmentSchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    mimeType: z.string().trim().max(120).optional(),
    dataUrl: z
      .string()
      .trim()
      .regex(/^data:(?:image|video|audio)\//i)
      .max(160_000_000)
      .optional(),
    url: z.string().trim().url().max(4_000).optional(),
  })
  .refine((value) => Boolean(value.dataUrl || value.url), {
    message: "Each attachment needs either dataUrl or url.",
  })

const mediaReferenceSchema: z.ZodType<StudioMediaReference> =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session_file"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("image_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("video_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("url"),
      url: z.string().trim().url().max(4_000),
      name: z.string().trim().max(255).optional(),
      mimeType: z.string().trim().max(120).optional(),
    }),
  ])

function normalizeModelQuery(query: string | undefined) {
  return query?.trim().toLowerCase() ?? ""
}
async function loadCompShareModelAliases() {
  const models = await listCompShareEntitledModels()

  return models
    ? new Set(
        models.flatMap((model) => [
          normalizeModelQuery(model.code),
          normalizeModelQuery(model.name),
        ])
      )
    : null
}

function truncateDescription(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim()

  if (!normalized) {
    return undefined
  }

  if (normalized.length <= DESCRIPTION_SUMMARY_MAX_CHARS) {
    return normalized
  }

  return `${normalized.slice(0, DESCRIPTION_SUMMARY_MAX_CHARS - 3)}...`
}

function normalizedFieldName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase()
}

function fieldPriority(field: StudioImageParameterField) {
  const normalized = normalizedFieldName(field.name)
  const index = PARAMETER_PRIORITY.findIndex((name) => normalized === name)

  if (index >= 0) {
    return index
  }

  return field.advanced ? 100 : 50
}

function fieldOptions(options: StudioImageParameterField["options"]) {
  if (!options?.length) {
    return undefined
  }

  return options.slice(0, OPTION_SUMMARY_LIMIT).map((option) => option.value)
}

function fieldSuggestedValues(
  suggestedValues: StudioImageParameterField["suggestedValues"]
) {
  if (!suggestedValues?.length) {
    return undefined
  }

  return suggestedValues
    .slice(0, OPTION_SUMMARY_LIMIT)
    .map((option) => option.value)
}

function isVideoField(
  field: StudioImageParameterField | StudioVideoParameterField
): field is StudioVideoParameterField {
  return "payloadPath" in field && Array.isArray(field.payloadPath)
}

function fieldParamKey(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  if (isVideoField(field)) {
    return field.payloadPath.join(".") || field.name
  }

  return field.name
}

function summarizeParameterField(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  return {
    name: field.name,
    key: fieldParamKey(field),
    kind: field.kind,
    required: field.required,
    advanced: field.advanced,
    ...(field.defaultValue !== undefined
      ? { defaultValue: field.defaultValue }
      : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
    ...(field.multipleOf !== undefined ? { multipleOf: field.multipleOf } : {}),
    ...(fieldOptions(field.options)
      ? { options: fieldOptions(field.options) }
      : {}),
    ...(fieldSuggestedValues(field.suggestedValues)
      ? { suggestedValues: fieldSuggestedValues(field.suggestedValues) }
      : {}),
    ...(truncateDescription(field.description)
      ? { description: truncateDescription(field.description) }
      : {}),
  }
}

function summarizeMediaField(field: StudioImageParameterField) {
  const videoField = isVideoField(field) ? field : null

  return {
    name: field.name,
    key: fieldParamKey(field),
    required: field.required,
    acceptMultiple: Boolean(field.acceptMultiple),
    acceptUrl: Boolean(field.acceptUrl),
    ...(videoField?.mediaShape ? { mediaShape: videoField.mediaShape } : {}),
    ...(videoField?.mediaRoleValues?.length
      ? { mediaRoles: videoField.mediaRoleValues }
      : {}),
    ...(truncateDescription(field.description)
      ? { description: truncateDescription(field.description) }
      : {}),
  }
}

function summarizeParameterSchema(
  fields: Array<StudioImageParameterField | StudioVideoParameterField>,
  parameterLimit = PARAMETER_SUMMARY_LIMIT,
  includeMediaFields = true
) {
  const visibleFields = fields.filter((field) => !field.hidden)
  const parameterFields = visibleFields
    .filter(
      (field) =>
        field.kind !== "image" &&
        !LOW_VALUE_PARAMETER_NAMES.has(field.name.toLowerCase())
    )
    .sort((left, right) => {
      const priority = fieldPriority(left) - fieldPriority(right)

      return priority || left.name.localeCompare(right.name)
    })
  const summarizedParameters = parameterFields
    .slice(0, parameterLimit)
    .map(summarizeParameterField)
  const defaultParams = Object.fromEntries(
    parameterFields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [fieldParamKey(field), field.defaultValue])
  )
  const mediaFields = visibleFields
    .filter((field) => field.kind === "image")
    .map(summarizeMediaField)

  return {
    paramsKey:
      "Pass these under params by key; for video, payload-path keys such as parameters.resolution also work.",
    parameters: summarizedParameters,
    ...(parameterFields.length > summarizedParameters.length
      ? {
          moreParameters: parameterFields.length - summarizedParameters.length,
        }
      : {}),
    ...(Object.keys(defaultParams).length ? { defaultParams } : {}),
    ...(includeMediaFields && mediaFields.length ? { mediaFields } : {}),
  }
}

function parameterDetailLimit(detail: "summary" | "schema") {
  return detail === "schema" ? PARAMETER_SCHEMA_LIMIT : PARAMETER_SUMMARY_LIMIT
}

function imageModelRows(
  query: string,
  maxResults: number,
  detail: "summary" | "schema" = "summary",
  entitledModelAliases: ReadonlySet<string> | null = null
) {
  const parameterLimit = parameterDetailLimit(detail)
  const rows = Object.entries(IMAGE_MODEL_REGISTRY)
    .filter(([, entry]) => entry.supported && entry.openapi)
    .map(([modelName, entry]) => ({
      kind: "image",
      modelName,
      label: getImageModelDisplayName(modelName),
      operations: [entry.openapi, entry.editOpenapi]
        .filter((operation): operation is ImageOpenapiRegistryEntry =>
          Boolean(operation)
        )
        .map((operation) => ({
          operationId: operation.operationId,
          openapiFile: operation.file,
          adapter: operation.adapter,
          requiresReferenceImage: operation.adapter === "openai-images-edit",
          parameterSchema: summarizeParameterSchema(
            loadImageModelOperationFields(modelName, operation.operationId),
            parameterLimit
          ),
        })),
    }))

  return rows
    .filter((row) => {
      if (
        entitledModelAliases &&
        !entitledModelAliases.has(normalizeModelQuery(row.modelName))
      ) {
        return false
      }

      if (!query) return true

      return (
        row.modelName.toLowerCase().includes(query) ||
        row.label.toLowerCase().includes(query) ||
        row.operations.some((operation) =>
          operation.operationId.toLowerCase().includes(query)
        )
      )
    })
    .slice(0, maxResults)
}

function videoModelRows(
  query: string,
  maxResults: number,
  detail: "summary" | "schema" = "summary",
  entitledModelAliases: ReadonlySet<string> | null = null
) {
  const parameterLimit = parameterDetailLimit(detail)
  const rows = VIDEO_OPENAPI_MODELS.map((entry) => {
    const profile = entry.profile as StudioVideoModelProfile

    return {
    kind: "video",
    title: entry.title,
    modelNames: entry.modelValues,
    operationId: entry.operationId,
    openapiFile: entry.file,
    adapter: entry.adapter,
    contentType: entry.contentType,
    defaultInputMode: profile.defaultMode,
    inputModes: profile.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      promptRequired: mode.promptRequired ?? false,
      promptAllowed: mode.promptAllowed !== false,
      available: mode.available !== false,
      mediaFields: mode.media.map((field) => ({
        key: field.id,
        payloadPath: field.fieldPath.join("."),
        mediaKind: field.mediaKind,
        minItems: field.minItems,
        maxItems: field.maxItems,
        acceptedSources: field.acceptedSources,
      })),
      structuredFields: mode.structuredFields.map((field) => ({
        key: field.id,
        payloadPath: field.fieldPath.join("."),
        required: field.required,
        placeholder: field.placeholder,
      })),
    })),
    ...(detail === "schema" ? { constraints: profile.constraints } : {}),
    parameterSchema: summarizeParameterSchema(
      loadVideoModelFields(entry),
      parameterLimit,
      false
    ),
    }
  })

  return rows
    .filter((row) => {
      if (
        entitledModelAliases &&
        !row.modelNames.some((modelName) =>
          entitledModelAliases.has(normalizeModelQuery(modelName))
        )
      ) {
        return false
      }

      if (!query) return true

      return (
        row.title.toLowerCase().includes(query) ||
        row.operationId.toLowerCase().includes(query) ||
        row.modelNames.some((modelName) =>
          modelName.toLowerCase().includes(query)
        )
      )
    })
    .slice(0, maxResults)
}

function findImageModelEntry(modelName: string) {
  const normalized = modelName.trim().toLowerCase()
  const match = Object.entries(IMAGE_MODEL_REGISTRY).find(
    ([candidate]) => candidate.toLowerCase() === normalized
  )

  if (!match) {
    return null
  }

  const [resolvedModelName, entry] = match

  return { modelName: resolvedModelName, entry }
}

function getImageModelSchema({
  modelName,
  operationId,
}: {
  modelName: string
  operationId?: string
}) {
  const model = findImageModelEntry(modelName)

  if (!model || !model.entry.supported || !model.entry.openapi) {
    return null
  }

  const operations = [model.entry.openapi, model.entry.editOpenapi]
    .filter((operation): operation is ImageOpenapiRegistryEntry =>
      Boolean(operation)
    )
    .filter(
      (operation) => !operationId || operation.operationId === operationId
    )
    .map((operation) => ({
      operationId: operation.operationId,
      openapiFile: operation.file,
      adapter: operation.adapter,
      requiresReferenceImage: operation.adapter === "openai-images-edit",
      parameterSchema: summarizeParameterSchema(
        loadImageModelOperationFields(model.modelName, operation.operationId),
        PARAMETER_SCHEMA_LIMIT
      ),
    }))

  if (!operations.length) {
    return null
  }

  return {
    kind: "image",
    modelName: model.modelName,
    label: getImageModelDisplayName(model.modelName),
    operations,
  }
}

function getVideoModelSchema({
  modelName,
  openapiFile,
  operationId,
}: {
  modelName: string
  openapiFile?: string
  operationId?: string
}) {
  const normalizedModelName = modelName.trim().toLowerCase()
  const rows = VIDEO_OPENAPI_MODELS.filter((entry) => {
    if (operationId && entry.operationId !== operationId) {
      return false
    }

    if (openapiFile && entry.file !== openapiFile) {
      return false
    }

    return entry.modelValues.some(
      (candidate) => candidate.toLowerCase() === normalizedModelName
    )
  }).map((entry) => {
    const profile = entry.profile as StudioVideoModelProfile

    return {
    kind: "video",
    title: entry.title,
    modelNames: entry.modelValues,
    operationId: entry.operationId,
    openapiFile: entry.file,
    adapter: entry.adapter,
    contentType: entry.contentType,
    defaultInputMode: profile.defaultMode,
    inputModes: profile.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      promptRequired: mode.promptRequired ?? false,
      promptAllowed: mode.promptAllowed !== false,
      available: mode.available !== false,
      unavailableReason: mode.unavailableReason,
      mediaFields: mode.media.map((field) => ({
        key: field.id,
        payloadPath: field.fieldPath.join("."),
        label: field.label,
        mediaKind: field.mediaKind,
        minItems: field.minItems,
        maxItems: field.maxItems,
        acceptedSources: field.acceptedSources,
        mimeTypes: field.mimeTypes,
        maxBytes: field.maxBytes,
      })),
      structuredFields: mode.structuredFields.map((field) => ({
        key: field.id,
        payloadPath: field.fieldPath.join("."),
        label: field.label,
        required: field.required,
        placeholder: field.placeholder,
      })),
    })),
    constraints: profile.constraints,
    parameterSchema: summarizeParameterSchema(
      loadVideoModelFields(entry),
      PARAMETER_SCHEMA_LIMIT,
      false
    ),
    }
  })

  return rows.length ? rows : null
}

function outputSessionFileId({
  kind,
  outputId,
  storagePath,
}: {
  kind: "image" | "video"
  outputId: string
  storagePath: string | null
}) {
  if (!storagePath) {
    return null
  }

  const fileId = getGeneratedMediaSessionFileId(kind, outputId)
  return getStudioSessionFile(fileId) ? fileId : null
}

function imageGenerationRow(generation: StudioImageGeneration) {
  return {
    kind: "image",
    generationId: generation.id,
    status: generation.status,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    modelName: generation.modelName,
    openapiFile: generation.openapiFile,
    operationId: generation.operationId,
    prompt: generation.prompt,
    errorMessage: generation.errorMessage,
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
    outputs: generation.outputs.map((output) => ({
      id: output.id,
      index: output.index,
      sessionFileId: outputSessionFileId({
        kind: "image",
        outputId: output.id,
        storagePath: output.storagePath,
      }),
      contentUrl: `/api/studio/image-outputs/${encodeURIComponent(
        output.id
      )}/content`,
      url: output.url,
      storagePath: output.storagePath,
      mimeType: output.mimeType,
      width: output.width,
      height: output.height,
    })),
  }
}

function videoGenerationRow(generation: StudioVideoGeneration) {
  return {
    kind: "video",
    generationId: generation.id,
    status: generation.status,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    modelName: generation.modelName,
    openapiFile: generation.openapiFile,
    operationId: generation.operationId,
    providerTaskId: generation.providerTaskId,
    providerRequestId: generation.providerRequestId,
    prompt: generation.prompt,
    errorMessage: generation.errorMessage,
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
    outputs: generation.outputs.map((output) => ({
      id: output.id,
      index: output.index,
      sessionFileId: outputSessionFileId({
        kind: "video",
        outputId: output.id,
        storagePath: output.storagePath,
      }),
      contentUrl: `/api/studio/video-outputs/${encodeURIComponent(
        output.id
      )}/content`,
      url: output.url,
      storagePath: output.storagePath,
      mimeType: output.mimeType,
      width: output.width,
      height: output.height,
      durationSeconds: output.durationSeconds,
    })),
  }
}

function listMediaGenerations({
  kind,
  maxResults,
  sessionId,
  status,
}: {
  kind: "image" | "video" | "all"
  maxResults: number
  sessionId: string
  status?: string
}) {
  const imageRows =
    kind === "video"
      ? []
      : listStudioImageGenerations(sessionId).map(imageGenerationRow)
  const videoRows =
    kind === "image"
      ? []
      : listStudioVideoGenerations(sessionId).map(videoGenerationRow)
  const rows = [...imageRows, ...videoRows]
    .filter((row) => !status || row.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return rows.slice(0, maxResults)
}

export function createListStudioMediaGenerationModelsTool() {
  return createAstraFlowTool(
    async ({ kind, query, maxResults, detail }) => {
      const normalizedQuery = normalizeModelQuery(query)
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)
      const schemaDetail = detail ?? "summary"
      const entitledModelAliases = await loadCompShareModelAliases()
      const models =
        kind === "image"
          ? imageModelRows(
              normalizedQuery,
              count,
              schemaDetail,
              entitledModelAliases
            )
          : kind === "video"
            ? videoModelRows(
                normalizedQuery,
                count,
                schemaDetail,
                entitledModelAliases
              )
            : [
                ...imageModelRows(
                  normalizedQuery,
                  count,
                  schemaDetail,
                  entitledModelAliases
                ),
                ...videoModelRows(
                  normalizedQuery,
                  count,
                  schemaDetail,
                  entitledModelAliases
                ),
              ].slice(0, count)

      return toMediaToolJson(
        {
          models,
          note: "Use modelName for generation and inspect the selected operation. For video, select inputMode and key media by inputModes.mediaFields.key; pass useful parameterSchema values under params.",
        }
      )
    },
    {
      name: "studio_list_media_generation_models",
      description:
        "List supported Studio image/video generation models and OpenAPI operation IDs available to chat agents.",
      schema: z.object({
        kind: z
          .enum(["image", "video", "all"])
          .optional()
          .describe("Which media model family to list."),
        query: z
          .string()
          .trim()
          .optional()
          .describe("Optional case-insensitive model or operation filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of models to return."),
        detail: z
          .enum(["summary", "schema"])
          .optional()
          .describe(
            "Use summary for model discovery; use schema only when full parameter detail is needed."
          ),
      }),
    }
  )
}

export function createListStudioImageModelsTool() {
  return createAstraFlowTool(
    async ({ query, maxResults, detail }) => {
      const normalizedQuery = normalizeModelQuery(query)
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)
      const schemaDetail = detail ?? "summary"
      const entitledModelAliases = await loadCompShareModelAliases()

      return toMediaToolJson(
        {
          models: imageModelRows(
            normalizedQuery,
            count,
            schemaDetail,
            entitledModelAliases
          ),
          note: "Use modelName for generation. Inspect operation parameterSchema and pass useful values in params, such as size, aspectRatio, imageSize, quality, output_format, or reference image fields. Pass operationId when selecting a non-default operation.",
        }
      )
    },
    {
      name: "studio_list_image_models",
      description:
        "List supported Studio image generation models and OpenAPI operation IDs available to chat agents.",
      schema: z.object({
        query: z
          .string()
          .trim()
          .optional()
          .describe("Optional case-insensitive model or operation filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of models to return."),
        detail: z
          .enum(["summary", "schema"])
          .optional()
          .describe(
            "Use summary for model discovery; use schema only when full parameter detail is needed."
          ),
      }),
    }
  )
}

export function createListStudioVideoModelsTool() {
  return createAstraFlowTool(
    async ({ query, maxResults, detail }) => {
      const normalizedQuery = normalizeModelQuery(query)
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)
      const schemaDetail = detail ?? "summary"
      const entitledModelAliases = await loadCompShareModelAliases()

      return toMediaToolJson(
        {
          models: videoModelRows(
            normalizedQuery,
            count,
            schemaDetail,
            entitledModelAliases
          ),
          note: "Use modelName for generation, choose operationId/openapiFile when needed, select inputMode, key mediaReferences by inputModes.mediaFields.key, and pass useful parameterSchema values under params.",
        }
      )
    },
    {
      name: "studio_list_video_models",
      description:
        "List supported Studio video generation models and OpenAPI operation IDs available to chat agents.",
      schema: z.object({
        query: z
          .string()
          .trim()
          .optional()
          .describe("Optional case-insensitive model or operation filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of models to return."),
        detail: z
          .enum(["summary", "schema"])
          .optional()
          .describe(
            "Use summary for model discovery; use schema only when full parameter detail is needed."
          ),
      }),
    }
  )
}

export function createGetStudioMediaModelSchemaTool() {
  return createAstraFlowTool(
    async ({ kind, modelName, operationId, openapiFile }) => {
      const entitledModelAliases = await loadCompShareModelAliases()
      const schema = entitledModelAliases?.has(normalizeModelQuery(modelName)) ===
        false
        ? null
        : kind === "image"
          ? getImageModelSchema({ modelName, operationId })
          : getVideoModelSchema({ modelName, operationId, openapiFile })

      return toMediaToolJson(
        {
          schema,
          note: schema
            ? "Use parameterSchema keys under params. For video, select inputMode and key mediaReferences by inputModes.mediaFields.key."
            : "No schema matched. Call studio_list_media_generation_models with a query first, then pass the exact modelName plus operationId/openapiFile when needed.",
        }
      )
    },
    {
      name: "studio_get_media_model_schema",
      description:
        "Get detailed provider parameter schema for one Studio image or video generation model after selecting it from the model list.",
      schema: z.object({
        kind: z
          .enum(["image", "video"])
          .describe("Whether to look up an image or video model."),
        modelName: z
          .string()
          .trim()
          .min(1)
          .describe("Exact modelName from the media model list."),
        operationId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional operationId to disambiguate an operation."),
        openapiFile: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional video OpenAPI file to disambiguate a model."),
      }),
    }
  )
}

export function createListStudioMediaGenerationsTool({
  apiKey,
  sessionId,
}: StudioMediaReadToolOptions) {
  return createAstraFlowTool(
    async ({ kind, status, maxResults }) => {
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)

      if (apiKey || isCompShareChannel()) {
        scheduleStudioVideoGenerationResumesForSession({
          sessionId,
          apiKey: apiKey ?? undefined,
        })
      }

      return toMediaToolJson(
        {
          generations: listMediaGenerations({
            kind: kind ?? "all",
            maxResults: count,
            sessionId,
            status,
          }),
        }
      )
    },
    {
      name: "studio_list_media_generations",
      description:
        "List recent Studio image and video generation jobs in the current session.",
      schema: z.object({
        kind: z
          .enum(["image", "video", "all"])
          .optional()
          .describe("Which media generation family to list."),
        status: z
          .enum([
            "queued",
            "running",
            "polling",
            "complete",
            "partial",
            "error",
            "cancelled",
          ])
          .optional()
          .describe("Optional status filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of jobs to return."),
      }),
    }
  )
}

export function createGetStudioMediaGenerationTool({
  apiKey,
  sessionId,
}: StudioMediaReadToolOptions) {
  return createAstraFlowTool(
    async ({ generationId }) => {
      if (apiKey || isCompShareChannel()) {
        scheduleStudioVideoGenerationResumesForSession({
          sessionId,
          apiKey: apiKey ?? undefined,
        })
      }

      const generations = listMediaGenerations({
        kind: "all",
        maxResults: 200,
        sessionId,
      })
      const generation =
        generations.find(
          (candidate) => candidate.generationId === generationId
        ) ?? null

      return toMediaToolJson({
        generation,
        ...(generation
          ? {}
          : {
              note: "No generation matched this id in the current session. Call studio_list_media_generations to see valid generation ids.",
            }),
      })
    },
    {
      name: "studio_get_media_generation",
      description:
        "Get one Studio image or video generation job by generation id, including status and output content URLs.",
      schema: z.object({
        generationId: z
          .string()
          .trim()
          .min(1)
          .describe("The image or video generation id."),
      }),
    }
  )
}

export function createStudioGenerateImageTool({
  sessionId,
  apiKey,
}: StudioMediaToolOptions) {
  return createAstraFlowTool(
    async ({
      modelName,
      modelId,
      operationId,
      prompt,
      params,
      attachments,
      references,
    }) => {
      try {
        const result = await generateStudioImage({
          sessionId,
          apiKey,
          modelName,
          modelId,
          operationId,
          prompt,
          params: params ?? {},
          attachments: attachments ?? [],
          references: references ?? [],
        })

        return formatMediaGenerationResult(result)
      } catch (error) {
        return formatMediaToolError(`Image generation with ${modelName}`, error)
      }
    },
    {
      name: "studio_generate_image",
      description:
        "Generate or edit an image with Studio ModelVerse image models. Use studio_list_image_models first when you need model-specific params; actively fill useful params such as size, aspectRatio, imageSize, quality, output_format, response_format, n, seed, or watermark based on the user's intent and the model's parameterSchema. Prefer references over data URLs for current-session files or prior image outputs. Returns a generation id, status, prompt, model, and output content/storage URLs when available.",
      schema: z.object({
        modelName: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Model name, such as gpt-image-2, doubao-seedream-4.5, or gemini-3-pro-image."
          ),
        modelId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional Model Square id. Defaults to modelName."),
        operationId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Optional OpenAPI operation id for edit or alternate modes."
          ),
        prompt: z.string().trim().min(1).max(4_000).describe("Image prompt."),
        params: paramsSchema
          .optional()
          .describe(
            "Provider-specific parameter values keyed by field name from the model parameterSchema, for example size, aspectRatio, imageSize, quality, output_format, response_format, n, seed, or watermark."
          ),
        attachments: z
          .array(imageAttachmentSchema)
          .optional()
          .describe("Optional reference images as public URLs or data URLs."),
        references: z
          .array(mediaReferenceSchema)
          .optional()
          .describe(
            "Optional reusable references to session_file, image_output, or URL records. Use this instead of embedding dataUrl when possible."
          ),
      }),
    }
  )
}

export function createStudioGenerateVideoTool({
  sessionId,
  apiKey,
}: StudioMediaToolOptions) {
  return createAstraFlowTool(
    async ({
      modelName,
      modelId,
      operationId,
      openapiFile,
      prompt,
      inputMode,
      params,
      media,
      attachments,
      references,
      mediaReferences,
    }) => {
      try {
        const result = await submitStudioVideoGeneration({
          sessionId,
          apiKey,
          modelName,
          modelId,
          operationId,
          openapiFile,
          prompt,
          inputMode,
          params: params ?? {},
          media: media ?? {},
          attachments: attachments ?? [],
          references: references ?? [],
          mediaReferences: mediaReferences ?? {},
        })

        return formatMediaGenerationResult(result)
      } catch (error) {
        return formatMediaToolError(`Video generation with ${modelName}`, error)
      }
    },
    {
      name: "studio_generate_video",
      description:
        "Submit a Studio ModelVerse video generation task. Use studio_list_video_models first, select an inputMode, and key media/mediaReferences by that mode's mediaFields.key. Fill useful model parameters from parameterSchema. Returns the generation id, status, provider task id, prompt, model, and available outputs.",
      schema: z.object({
        modelName: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Video model name from studio_list_media_generation_models, such as OpenAI-Sora2-T2V or Wan-AI/Wan2.6-T2V."
          ),
        modelId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional Model Square id. Defaults to modelName."),
        operationId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional OpenAPI operation id."),
        openapiFile: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional OpenAPI file when disambiguating video models."),
        prompt: z
          .string()
          .trim()
          .max(8_000)
          .describe(
            "Video prompt. It may be empty only when the selected inputMode allows or requires no prompt."
          ),
        inputMode: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Input mode id from the selected model operation's inputModes list."
          ),
        params: paramsSchema
          .optional()
          .describe(
            "Provider-specific parameter values keyed by field name or payload path from parameterSchema, for example ratio, resolution, duration, quality, seed, or parameters.resolution."
          ),
        media: z
          .record(z.string(), z.array(mediaAttachmentSchema))
          .optional()
          .describe(
            "Optional media attachments keyed by field name or payload path."
          ),
        attachments: z
          .array(mediaAttachmentSchema)
          .optional()
          .describe(
            "Optional unkeyed media, allowed only for an inputMode with exactly one media field. Prefer media."
          ),
        references: z
          .array(mediaReferenceSchema)
          .optional()
          .describe(
            "Optional unkeyed reusable references, allowed only for an inputMode with exactly one media field. Prefer mediaReferences."
          ),
        mediaReferences: z
          .record(z.string(), z.array(mediaReferenceSchema))
          .optional()
          .describe(
            "Optional reusable references keyed by inputModes.mediaFields.key (preferred) or payloadPath."
          ),
      }),
    }
  )
}
