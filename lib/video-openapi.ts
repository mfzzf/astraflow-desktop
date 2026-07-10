import { VIDEO_OPENAPI_FIELDS, VIDEO_OPENAPI_MODELS } from "@/lib/generated/video-openapi-fields"
import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"
import type {
  StudioVideoModelOption,
  StudioVideoOpenapiModelEntry,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"

const generatedFields = VIDEO_OPENAPI_FIELDS as Record<
  string,
  StudioVideoParameterField[]
>

function normalizeModelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^publishers\/[^/]+\/models\//, "")
    .replace(/接口文档$/, "")
    .replace(/[^a-z0-9]+/g, "")
}

function cloneFields(fields: StudioVideoParameterField[]) {
  return fields.map((field) => ({
    ...field,
    payloadPath: [...field.payloadPath],
    options: field.options?.map((option) => ({ ...option })),
    suggestedValues: field.suggestedValues?.map((option) => ({ ...option })),
  }))
}

function scoreEntry({
  entry,
  modelId,
  modelName,
}: {
  entry: StudioVideoOpenapiModelEntry
  modelId: string
  modelName: string
}) {
  const normalizedModelId = normalizeModelKey(modelId)
  const normalizedModelName = normalizeModelKey(modelName)
  const fileName = entry.file.split("/").at(-1)?.replace(/\.ya?ml$/, "") ?? ""
  const titleAliases = [entry.title, fileName].map(normalizeModelKey)
  const modelAliases = entry.modelValues
    .flatMap((value) => [value, value.split("/").at(-1) ?? value])
    .map(normalizeModelKey)
  const aliases = [...titleAliases, ...modelAliases]

  if (aliases.includes(normalizedModelId)) {
    return 200
  }

  if (aliases.includes(normalizedModelName)) {
    return 100
  }

  return 0
}

function findVideoOpenapiEntries({
  modelId,
  modelName,
}: {
  modelId: string
  modelName: string
}) {
  const candidates = VIDEO_OPENAPI_MODELS.map((entry, index) => ({
    entry,
    index,
    score: scoreEntry({ entry, modelId, modelName }),
  }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      const score = right.score - left.score

      return score || left.index - right.index
    })

  const bestScore = candidates[0]?.score

  return candidates
    .filter((candidate) => candidate.score === bestScore)
    .map((candidate) => candidate.entry)
}

function selectModelConstant(
  entry: StudioVideoOpenapiModelEntry,
  modelId: string,
  modelName: string
) {
  const candidates = [modelId, modelName]
  const normalizedCandidates = candidates.map(normalizeModelKey)
  const exact = entry.modelValues.find((value) =>
    normalizedCandidates.includes(normalizeModelKey(value))
  )

  return exact ?? entry.modelValues[0] ?? modelName
}

function getGeneratedFieldsKey(entry: StudioVideoOpenapiModelEntry) {
  return `${entry.file}#${entry.operationId}`
}

function splitVideoOperationId(value: string | null | undefined) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return { file: null, operationId: null }
  }

  const separator = trimmed.lastIndexOf("#")

  if (separator <= 0) {
    return { file: null, operationId: trimmed }
  }

  return {
    file: trimmed.slice(0, separator),
    operationId: trimmed.slice(separator + 1),
  }
}

export function loadVideoModelFields(
  entry: StudioVideoOpenapiModelEntry
): StudioVideoParameterField[] {
  return cloneFields(generatedFields[getGeneratedFieldsKey(entry)] ?? [])
}

export function resolveVideoModelOperation({
  modelId,
  modelName,
  file,
  operationId,
}: {
  modelId: string
  modelName: string
  file?: string | null
  operationId?: string | null
}) {
  const entries = findVideoOpenapiEntries({ modelId, modelName })

  if (entries.length === 0) {
    return null
  }

  const operationMetadata = splitVideoOperationId(operationId)
  const requestedFile = file?.trim() || operationMetadata.file
  const requestedOperationId = operationMetadata.operationId

  if (
    file?.trim() &&
    operationMetadata.file &&
    file.trim() !== operationMetadata.file
  ) {
    return null
  }

  const entry = requestedOperationId
    ? (entries.find(
        (candidate) =>
          candidate.operationId === requestedOperationId &&
          (!requestedFile || candidate.file === requestedFile)
      ) ?? null)
    : requestedFile
      ? (entries.find((candidate) => candidate.file === requestedFile) ?? null)
      : entries[0]

  if (!entry) {
    return null
  }

  const modelConstant = selectModelConstant(entry, modelId, modelName)

  return {
    openapi: {
      ...entry,
      modelConstant,
    },
    fields: loadVideoModelFields(entry),
  }
}

export function buildVideoModelOption({
  id,
  name,
  label,
  manufacturer,
  inputModalities,
  outputModalities,
  coverUrl,
}: {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
}): StudioVideoModelOption {
  const fallbackDisplayLabel = label.trim() || name.trim() || id
  const entry =
    findVideoOpenapiEntries({
      modelId: id,
      modelName: name,
    })[0] ?? null

  if (!entry) {
    return {
      id,
      name,
      label: fallbackDisplayLabel,
      manufacturer,
      inputModalities,
      outputModalities,
      coverUrl,
      supported: false,
      disabledReason: "missing-openapi",
      fields: [],
      operations: [],
    }
  }

  const modelConstant = selectModelConstant(entry, id, name)
  const operationEntries = findVideoOpenapiEntries({ modelId: id, modelName: name })
  const operations = operationEntries.map((operationEntry) => {
    const operationModelConstant = selectModelConstant(operationEntry, id, name)

    return {
      id: `${operationEntry.file}#${operationEntry.operationId}`,
      label: operationEntry.title,
      openapi: {
        ...operationEntry,
        modelConstant: operationModelConstant,
      },
      fields: loadVideoModelFields(operationEntry),
    }
  })
  const displayLabel = label.trim() || name.trim() || modelConstant || entry.title

  return {
    id,
    name,
    label: displayLabel,
    manufacturer,
    inputModalities,
    outputModalities,
    coverUrl,
    supported: true,
    openapi: {
      ...entry,
      modelConstant,
    },
    fields: loadVideoModelFields(entry),
    operations,
  }
}

export function getVideoModelEndpoint(entry: StudioVideoOpenapiModelEntry) {
  return `${MODELVERSE_BASE_URL}${entry.path}`
}

export function getVideoTaskStatusEndpoint(entry: StudioVideoOpenapiModelEntry) {
  return `${MODELVERSE_BASE_URL}${entry.statusPath}`
}

export function getVideoOpenapiEntry(
  file: string | null | undefined,
  operationId: string | null | undefined
) {
  if (!file || !operationId) {
    return null
  }

  return (
    VIDEO_OPENAPI_MODELS.find(
      (entry) => entry.file === file && entry.operationId === operationId
    ) ?? null
  )
}
