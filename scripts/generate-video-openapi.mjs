#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative, sep } from "node:path"

import { dereference } from "@readme/openapi-parser"

const root = process.cwd()
const openapiDir = join(root, "openapi/video")
const generatedDir = join(root, "lib/generated")
const generatedTypesDir = join(generatedDir, "openapi/video")
const metadataFile = join(generatedDir, "video-openapi-fields.ts")
const openapiTypescriptBin = join(
  root,
  "node_modules/.bin/openapi-typescript"
)

const ADVANCED_FIELDS = new Set([
  "negative_prompt",
  "seed",
  "guidance_scale",
  "prompt_optimizer",
  "prompt_extend",
  "watermark",
  "bgm",
  "generate_audio",
  "camera_control",
  "movement_amplitude",
  "audio_url",
  "video_url",
  "reference_audio",
  "reference_video",
  "webhook_url",
  "webhook_secret",
])

const IMAGE_INPUT_FIELDS = new Set([
  "image",
  "images",
  "img_url",
  "image_list",
  "image_url",
  "first_frame_image",
  "first_frame_url",
  "last_frame_image",
  "last_frame_url",
  "last_frame",
  "face_image",
  "input_reference",
  "reference_image",
  "reference_images",
  "subject_reference",
  "subject_references",
])

const VIDEO_INPUT_FIELDS = new Set([
  "video",
  "video_list",
  "video_url",
  "videos",
  "reference_video",
])

const AUDIO_INPUT_FIELDS = new Set([
  "audio",
  "audio_url",
  "reference_audio",
])

function toProjectPath(absolutePath) {
  return relative(root, absolutePath).split(sep).join("/")
}

function toGeneratedTypeName(file) {
  return basename(file, ".yaml").replace(/[^A-Za-z0-9_-]/g, "-")
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function inferType(schema) {
  if (Array.isArray(schema?.type)) {
    return schema.type.find((value) => value !== "null") ?? "string"
  }

  return schema?.type ?? "string"
}

function optionFromValue(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null
  }

  return {
    value: String(value),
    label: String(value),
  }
}

function uniqueOptions(values) {
  const seen = new Set()
  const options = []

  for (const value of values) {
    const option = optionFromValue(value)

    if (!option || seen.has(option.value)) {
      continue
    }

    seen.add(option.value)
    options.push(option)
  }

  return options.length > 0 ? options : undefined
}

function cleanDescription(value) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function getEnumOptions(schema) {
  if (Array.isArray(schema?.enum)) {
    return uniqueOptions(schema.enum)
  }

  if (Array.isArray(schema?.oneOf)) {
    const values = []

    for (const child of schema.oneOf) {
      if (Array.isArray(child?.enum)) {
        values.push(...child.enum)
      }
      if (child?.const !== undefined) {
        values.push(child.const)
      }
    }

    return uniqueOptions(values)
  }

  return undefined
}

function getModelValues(schema) {
  if (!isRecord(schema)) {
    return []
  }

  if (schema.const !== undefined) {
    const option = optionFromValue(schema.const)
    return option ? [option.value] : []
  }

  const options = getEnumOptions(schema)
  return options?.map((option) => option.value) ?? []
}

function getSuggestedOptions(schema) {
  const values = schema?.["x-recommended-values"] ?? schema?.examples

  return Array.isArray(values) ? uniqueOptions(values) : undefined
}

function getArrayEnum(schema) {
  if (inferType(schema) !== "array") {
    return undefined
  }

  const items = Array.isArray(schema.items) ? schema.items[0] : schema.items

  if (!isRecord(items)) {
    return undefined
  }

  const directOptions = getEnumOptions(items)
  if (directOptions) {
    return { options: directOptions }
  }

  return undefined
}

function normalizedFieldName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
}

function schemaVariants(schema) {
  if (!isRecord(schema)) {
    return []
  }

  const variants = [schema]

  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (!Array.isArray(schema[key])) {
      continue
    }

    for (const child of schema[key]) {
      variants.push(...schemaVariants(child))
    }
  }

  return variants
}

function arrayLikeSchema(schema) {
  for (const variant of schemaVariants(schema)) {
    if (inferType(variant) === "array") {
      return variant
    }
  }

  return null
}

function itemVariants(schema) {
  const arraySchema = arrayLikeSchema(schema)
  const items = Array.isArray(arraySchema?.items)
    ? arraySchema.items[0]
    : arraySchema?.items

  return schemaVariants(items)
}

function collectPropertyEntries(schema) {
  const entries = []
  const seen = new Set()

  for (const variant of schemaVariants(schema)) {
    if (!isRecord(variant.properties)) {
      continue
    }

    const required = new Set(
      Array.isArray(variant.required) ? variant.required : []
    )

    for (const [name, propertySchema] of Object.entries(variant.properties)) {
      const key = `${name}:${required.has(name) ? "required" : "optional"}`

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      entries.push({
        name,
        schema: propertySchema,
        required: required.has(name),
      })
    }
  }

  return entries
}

function objectPropertyMap(schema) {
  for (const variant of schemaVariants(schema)) {
    if (isRecord(variant.properties)) {
      return variant.properties
    }
  }

  return null
}

function schemaDescriptionIncludes(schema, value) {
  return (
    typeof schema?.description === "string" &&
    schema.description.toLowerCase().includes(value)
  )
}

function isImageField(name, schema) {
  const normalized = normalizedFieldName(name)

  return (
    IMAGE_INPUT_FIELDS.has(name) ||
    schema?.contentEncoding === "base64" ||
    schema?.format === "binary" ||
    normalized === "image" ||
    normalized === "images" ||
    normalized.endsWith("_image") ||
    normalized.endsWith("_images") ||
    normalized.endsWith("_image_url") ||
    normalized.includes("frame_image") ||
    normalized.includes("reference_image") ||
    schema?.format === "uri" && normalized.includes("image") ||
    schemaDescriptionIncludes(schema, "image url") ||
    schemaDescriptionIncludes(schema, "base64-encoded image") ||
    schemaDescriptionIncludes(schema, "base64 image")
  )
}

function isVideoField(name, schema) {
  const normalized = normalizedFieldName(name)

  return (
    VIDEO_INPUT_FIELDS.has(name) ||
    normalized.endsWith("_video") ||
    normalized.endsWith("_video_url") ||
    schema?.format === "uri" && normalized.includes("video")
  )
}

function isAudioField(name, schema) {
  const normalized = normalizedFieldName(name)

  return (
    AUDIO_INPUT_FIELDS.has(name) ||
    normalized.endsWith("_audio") ||
    normalized.endsWith("_audio_url") ||
    schema?.format === "uri" && normalized.includes("audio")
  )
}

function isMediaObject(schema) {
  const properties = objectPropertyMap(schema)

  if (!isRecord(properties)) {
    return false
  }

  const propertyNames = new Set(Object.keys(properties))

  return (
    propertyNames.has("bytesBase64Encoded") ||
    propertyNames.has("url") ||
    propertyNames.has("uri")
  )
}

function getContentImageMediaField(path, schema) {
  if (fieldNameFromPath(path) !== "content") {
    return null
  }

  const arraySchema = arrayLikeSchema(schema)

  if (!arraySchema) {
    return null
  }

  const hasImageContent = itemVariants(schema).some((variant) => {
    const properties = objectPropertyMap(variant)

    return (
      isRecord(properties) &&
      properties.type?.const === "image_url" &&
      isRecord(properties.image_url)
    )
  })

  if (!hasImageContent) {
    return null
  }

  const description = cleanDescription(schema.description)

  return {
    name: "content_images",
    label: "content_images",
    ...(description ? { description } : {}),
    kind: "image",
    required: false,
    advanced: false,
    hidden: false,
    payloadPath: path,
    acceptMultiple: true,
    acceptUrl: true,
    mediaKind: "image",
    mediaShape: "content-item",
    mediaPayloadKey: "image_url",
    mediaRoleKey: "role",
    mediaRoleValues: ["first_frame", "last_frame", "reference_image"],
    ...(typeof arraySchema.minItems === "number"
      ? { minItems: arraySchema.minItems }
      : {}),
    ...(typeof arraySchema.maxItems === "number"
      ? { maxItems: arraySchema.maxItems }
      : {}),
  }
}

function getArrayObjectMediaField(path, schema, required) {
  const arraySchema = arrayLikeSchema(schema)

  if (!arraySchema) {
    return null
  }

  const name = fieldNameFromPath(path)
  const variants = itemVariants(schema)
  const mediaEntry = variants
    .flatMap((variant) => {
      const properties = objectPropertyMap(variant)

      return isRecord(properties) ? Object.entries(properties) : []
    })
    .find(
      ([propertyName, propertySchema]) =>
        inferType(propertySchema) !== "array" &&
        (isImageField(propertyName, propertySchema) ||
          isVideoField(propertyName, propertySchema) ||
          isAudioField(propertyName, propertySchema))
    )

  if (!mediaEntry) {
    return null
  }

  const [mediaPayloadKey, mediaSchema] = mediaEntry
  const mediaKind = isImageField(mediaPayloadKey, mediaSchema)
    ? "image"
    : isVideoField(mediaPayloadKey, mediaSchema)
      ? "video"
      : "audio"

  if (mediaKind !== "image") {
    return null
  }

  const roleEntry = variants
    .flatMap((variant) => {
      const properties = objectPropertyMap(variant)

      return isRecord(properties) ? Object.entries(properties) : []
    })
    .find(([propertyName, propertySchema]) => {
      if (propertyName === mediaPayloadKey) {
        return false
      }

      return Boolean(getEnumOptions(propertySchema))
    })
  const roleOptions = roleEntry ? getEnumOptions(roleEntry[1]) : undefined
  const description = cleanDescription(schema.description)

  return {
    name,
    label: name,
    ...(description ? { description } : {}),
    kind: "image",
    required,
    advanced: ADVANCED_FIELDS.has(name),
    hidden: false,
    payloadPath: path,
    acceptMultiple: true,
    acceptUrl: true,
    mediaKind,
    mediaShape: "array-object",
    mediaPayloadKey,
    ...(roleEntry ? { mediaRoleKey: roleEntry[0] } : {}),
    ...(roleOptions
      ? { mediaRoleValues: roleOptions.map((option) => option.value) }
      : {}),
    ...(typeof arraySchema.minItems === "number"
      ? { minItems: arraySchema.minItems }
      : {}),
    ...(typeof arraySchema.maxItems === "number"
      ? { maxItems: arraySchema.maxItems }
      : {}),
  }
}

function fieldKindFromSchema(name, schema, options) {
  if (name === "prompt" || name === "text") {
    return "prompt"
  }

  if (isImageField(name, schema) || isMediaObject(schema)) {
    return "image"
  }

  if (isVideoField(name, schema) || isAudioField(name, schema)) {
    return "text"
  }

  const type = inferType(schema)

  if (type === "boolean") {
    return "boolean"
  }

  if (options?.length) {
    return "select"
  }

  if (type === "integer" || type === "number") {
    if (
      typeof schema.minimum === "number" &&
      typeof schema.maximum === "number"
    ) {
      return "slider"
    }

    return "number"
  }

  return "text"
}

function fieldNameFromPath(path) {
  return path[path.length - 1]
}

function buildField(path, schema, required) {
  if (!isRecord(schema)) {
    return null
  }

  const name = fieldNameFromPath(path)
  const description = cleanDescription(schema.description)
  const contentImageField = getContentImageMediaField(path, schema)

  if (contentImageField) {
    return contentImageField
  }

  const arrayObjectMediaField = getArrayObjectMediaField(path, schema, required)

  if (arrayObjectMediaField) {
    return arrayObjectMediaField
  }

  if (schema.const !== undefined) {
    const value = optionFromValue(schema.const)?.value

    if (value === undefined) {
      return null
    }

    return {
      name,
      label: name,
      ...(description ? { description } : {}),
      kind: "text",
      required,
      advanced: ADVANCED_FIELDS.has(name),
      hidden: name === "model" || name.endsWith("_type"),
      constantValue: value,
      payloadPath: path,
    }
  }

  const arrayEnum = getArrayEnum(schema)
  const options = getEnumOptions(schema) ?? arrayEnum?.options
  const suggestedValues = getSuggestedOptions(schema)
  const kind = fieldKindFromSchema(name, schema, options)
  const type = inferType(schema)

  if (
    type === "object" &&
    !options &&
    !isImageField(name, schema) &&
    !isMediaObject(schema)
  ) {
    return null
  }

  if (type === "array" && !options && !isImageField(name, schema)) {
    return null
  }

  const field = {
    name,
    label: name,
    ...(description ? { description } : {}),
    kind,
    required,
    advanced: ADVANCED_FIELDS.has(name),
    hidden: name === "model",
    payloadPath: path,
  }

  if (options) {
    field.options = options
  }

  if (suggestedValues) {
    field.suggestedValues = suggestedValues
  }

  if (arrayEnum?.itemKey) {
    field.arrayItemKey = arrayEnum.itemKey
  } else if (arrayEnum) {
    field.arrayItemKey = ""
  }

  if (
    typeof schema.default === "string" ||
    typeof schema.default === "number" ||
    typeof schema.default === "boolean"
  ) {
    field.defaultValue = schema.default
  }

  if (typeof schema.minimum === "number") {
    field.min = schema.minimum
  }

  if (typeof schema.maximum === "number") {
    field.max = schema.maximum
  }

  if (typeof schema.multipleOf === "number") {
    field.multipleOf = schema.multipleOf
    field.step = schema.multipleOf
  } else if (kind === "slider" && typeof schema.minimum === "number") {
    field.step = inferType(schema) === "integer" ? 1 : 0.1
  }

  if (kind === "image") {
    field.acceptMultiple = type === "array" || name === "images"
    field.acceptUrl = schema.format !== "binary"
    field.mediaKind = "image"

    if (schema.format === "binary") {
      field.mediaShape = "multipart-binary"
    } else if (isMediaObject(schema)) {
      field.mediaShape = "object-base64"
    } else {
      field.mediaShape = "direct"
    }
  }

  if (typeof schema.minItems === "number") {
    field.minItems = schema.minItems
  }

  if (typeof schema.maxItems === "number") {
    field.maxItems = schema.maxItems
  }

  return field
}

function fieldRank(field) {
  if (field.name === "prompt" || field.name === "text") return 0
  if (field.kind === "image") return 1
  if (field.name === "aspect_ratio" || field.name === "ratio") return 2
  if (field.name === "size" || field.name === "resolution") return 3
  if (field.name === "duration" || field.name === "seconds") return 4
  if (field.advanced) return 10
  return 5
}

function sortFields(fields) {
  return [...fields].sort((left, right) => {
    const rank = fieldRank(left) - fieldRank(right)
    return rank || left.name.localeCompare(right.name)
  })
}

function addField(fields, seen, path, schema, required) {
  const field = buildField(path, schema, required)

  if (!field) {
    return
  }

  const key = field.payloadPath.join(".")
  if (seen.has(key)) {
    return
  }

  seen.add(key)
  fields.push(field)
}

function fieldsFromRequestSchema(schema) {
  if (!isRecord(schema?.properties)) {
    return []
  }

  const rootRequired = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields = []
  const seen = new Set()

  for (const [rootName, rootSchema] of Object.entries(schema.properties)) {
    if (rootName === "input" || rootName === "parameters") {
      const entries = collectPropertyEntries(rootSchema)

      if (entries.length === 0) {
        continue
      }

      for (const entry of entries) {
        addField(
          fields,
          seen,
          [rootName, entry.name],
          entry.schema,
          rootRequired.has(rootName) && entry.required
        )
      }

      continue
    }

    addField(fields, seen, [rootName], rootSchema, rootRequired.has(rootName))
  }

  return sortFields(fields)
}

function findOperations(document) {
  const operations = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!isRecord(operation) || !operation.operationId) {
        continue
      }

      operations.push({ path, method, operation })
    }
  }

  return operations
}

function firstRequestContent(operation) {
  const content = operation.requestBody?.content

  if (!isRecord(content)) {
    return null
  }

  return {
    contentType: content["application/json"]
      ? "application/json"
      : content["multipart/form-data"]
        ? "multipart/form-data"
        : Object.keys(content)[0] ?? "application/json",
    body:
      content["application/json"] ??
      content["multipart/form-data"] ??
      Object.values(content)[0] ??
      null,
  }
}

function generateTypeDefinitions(inputFile, outputFile) {
  execFileSync(openapiTypescriptBin, [inputFile, "-o", outputFile], {
    cwd: root,
    stdio: "inherit",
  })
}

async function generateMetadataForSpec(inputFile) {
  const document = await dereference(inputFile, {
    dereference: {
      circular: "ignore",
    },
  })
  const projectFile = toProjectPath(inputFile)
  const title = cleanDescription(document.info?.title)?.replace(/接口文档$/, "")
  const records = []
  const models = []

  for (const { path, method, operation } of findOperations(document)) {
    const requestContent = firstRequestContent(operation)
    const schema = requestContent?.body?.schema

    if (!schema) {
      continue
    }

    const key = `${projectFile}#${operation.operationId}`
    const fields = fieldsFromRequestSchema(schema)
    records.push([key, fields])

    if (
      method.toLowerCase() === "post" &&
      path === "/v1/tasks/submit" &&
      requestContent.contentType === "application/json" &&
      isRecord(schema.properties)
    ) {
      const modelValues = getModelValues(schema.properties.model)
      models.push({
        file: projectFile,
        title: title ?? basename(inputFile, ".yaml"),
        operationId: operation.operationId,
        method: "POST",
        path,
        statusPath: "/v1/tasks/status",
        contentType: "application/json",
        adapter: "async-task",
        modelValues,
      })
    }

    if (
      method.toLowerCase() === "post" &&
      path === "/v1/videos" &&
      requestContent.contentType === "multipart/form-data" &&
      isRecord(schema.properties)
    ) {
      const modelValues = getModelValues(schema.properties.model)
      models.push({
        file: projectFile,
        title: title ?? basename(inputFile, ".yaml"),
        operationId: operation.operationId,
        method: "POST",
        path,
        statusPath: "/v1/videos/{task_id}",
        contentType: "multipart/form-data",
        adapter: "openai-video",
        modelValues,
      })
    }
  }

  return { records, models }
}

function writeMetadata(records, models) {
  const sortedRecords = [...records].sort(([left], [right]) =>
    left.localeCompare(right)
  )
  const sortedModels = [...models].sort((left, right) =>
    `${left.file}#${left.operationId}`.localeCompare(
      `${right.file}#${right.operationId}`
    )
  )
  const fieldsBody = JSON.stringify(Object.fromEntries(sortedRecords), null, 2)
  const modelsBody = JSON.stringify(sortedModels, null, 2)

  writeFileSync(
    metadataFile,
    `// This file is generated by scripts/generate-video-openapi.mjs.\n` +
      `// Do not edit by hand. Run \`bun run codegen:video-openapi\`.\n\n` +
      `import type { StudioVideoOpenapiModelEntry, StudioVideoParameterField } from "@/lib/studio-video-types"\n\n` +
      `export const VIDEO_OPENAPI_FIELDS = ${fieldsBody} satisfies Record<string, StudioVideoParameterField[]>\n\n` +
      `export const VIDEO_OPENAPI_MODELS = ${modelsBody} satisfies StudioVideoOpenapiModelEntry[]\n`,
    "utf8"
  )
}

async function main() {
  if (!existsSync(openapiTypescriptBin)) {
    throw new Error("openapi-typescript is not installed.")
  }

  mkdirSync(generatedTypesDir, { recursive: true })

  if (existsSync(metadataFile)) {
    rmSync(metadataFile)
  }

  const openapiFiles = readdirSync(openapiDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort()
    .map((file) => join(openapiDir, file))
  const metadataRecords = []
  const modelRecords = []

  for (const inputFile of openapiFiles) {
    const typeOutputFile = join(
      generatedTypesDir,
      `${toGeneratedTypeName(inputFile)}.d.ts`
    )

    generateTypeDefinitions(inputFile, typeOutputFile)
    const metadata = await generateMetadataForSpec(inputFile)
    metadataRecords.push(...metadata.records)
    modelRecords.push(...metadata.models)
  }

  writeMetadata(metadataRecords, modelRecords)
  console.log(
    `Generated ${openapiFiles.length} OpenAPI type files, ${metadataRecords.length} field metadata entries, and ${modelRecords.length} model entries.`
  )
}

await main()
