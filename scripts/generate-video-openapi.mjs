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

function requiredString(value, context) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context} must be a non-empty string.`)
  }

  return value.trim()
}

function parsePath(value, context) {
  if (typeof value === "string") {
    const path = value
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean)

    if (path.length > 0) {
      return path
    }
  }

  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part) => typeof part === "string" && part.trim())
  ) {
    return value.map((part) => part.trim())
  }

  throw new Error(`${context} must be a dotted path or string array.`)
}

function parseLocalizedText(value, context) {
  if (!isRecord(value)) {
    throw new Error(`${context} must contain zh and en labels.`)
  }

  return {
    zh: requiredString(value.zh, `${context}.zh`),
    en: requiredString(value.en, `${context}.en`),
  }
}

function parseRoleStrategy(value, context) {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`)
  }

  const kind = requiredString(value.kind, `${context}.kind`)

  if (kind === "none") {
    return { kind }
  }

  if (kind === "repeat") {
    return {
      kind,
      value: requiredString(value.value, `${context}.value`),
    }
  }

  if (kind === "sequence") {
    if (
      !Array.isArray(value.values) ||
      value.values.length === 0 ||
      !value.values.every((item) => typeof item === "string" && item.trim())
    ) {
      throw new Error(`${context}.values must be a non-empty string array.`)
    }

    return {
      kind,
      values: value.values.map((item) => item.trim()),
    }
  }

  throw new Error(`${context}.kind is not supported: ${kind}`)
}

const MEDIA_SERIALIZERS = new Set([
  "direct-url",
  "url-array",
  "tagged-content-array",
  "array-object",
  "base64-object",
  "raw-base64-or-url",
  "multipart-file",
])

const MEDIA_KINDS = new Set(["image", "video", "audio", "mixed"])
const MEDIA_SOURCES = new Set(["url", "data-url", "file"])

function parseModeMedia(value, context) {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`)
  }

  const serializer = requiredString(value.serializer, `${context}.serializer`)
  if (!MEDIA_SERIALIZERS.has(serializer)) {
    throw new Error(`${context}.serializer is not supported: ${serializer}`)
  }
  const valueEncoding = value.valueEncoding
  if (valueEncoding !== undefined && valueEncoding !== "raw-base64") {
    throw new Error(`${context}.valueEncoding is not supported: ${valueEncoding}`)
  }

  const fieldPath = parsePath(value.field, `${context}.field`)
  const id =
    value.id === undefined
      ? fieldPath.join(".")
      : requiredString(value.id, `${context}.id`)
  const mediaKind = value.mediaKind ?? "image"
  if (!MEDIA_KINDS.has(mediaKind)) {
    throw new Error(`${context}.mediaKind is not supported: ${mediaKind}`)
  }

  const rawSources =
    value.acceptedSources ??
    (serializer === "multipart-file" ? ["file"] : ["url", "data-url", "file"])
  if (
    !Array.isArray(rawSources) ||
    rawSources.length === 0 ||
    !rawSources.every((source) => MEDIA_SOURCES.has(source))
  ) {
    throw new Error(`${context}.acceptedSources contains an unsupported source.`)
  }

  if (
    value.mimeTypes !== undefined &&
    (!Array.isArray(value.mimeTypes) ||
      !value.mimeTypes.every((mimeType) =>
        typeof mimeType === "string" && mimeType.trim()
      ))
  ) {
    throw new Error(`${context}.mimeTypes must be a string array.`)
  }

  if (
    value.maxBytes !== undefined &&
    (!Number.isInteger(value.maxBytes) || value.maxBytes <= 0)
  ) {
    throw new Error(`${context}.maxBytes must be a positive integer.`)
  }

  const minItems = value.minItems ?? 0
  if (!Number.isInteger(minItems) || minItems < 0) {
    throw new Error(`${context}.minItems must be a non-negative integer.`)
  }

  if (
    value.maxItems !== undefined &&
    (!Number.isInteger(value.maxItems) || value.maxItems < minItems)
  ) {
    throw new Error(`${context}.maxItems must be an integer >= minItems.`)
  }
  const roles =
    value.roles === undefined
      ? undefined
      : parseRoleStrategy(value.roles, `${context}.roles`)
  if (
    roles?.kind === "sequence" &&
    (minItems !== roles.values.length || value.maxItems !== roles.values.length)
  ) {
    throw new Error(
      `${context}.sequence roles require minItems and maxItems to equal the role count.`
    )
  }
  if (
    (serializer === "base64-object" || serializer === "multipart-file") &&
    value.maxItems !== 1
  ) {
    throw new Error(`${context}.${serializer} requires maxItems: 1.`)
  }

  return {
    id,
    fieldPath,
    ...(value.label === undefined
      ? {}
      : { label: parseLocalizedText(value.label, `${context}.label`) }),
    mediaKind,
    serializer,
    ...(valueEncoding === undefined ? {} : { valueEncoding }),
    acceptedSources: [...new Set(rawSources)],
    ...(value.mimeTypes === undefined
      ? {}
      : {
          mimeTypes: value.mimeTypes.map((mimeType) => mimeType.trim()),
        }),
    ...(value.maxBytes === undefined ? {} : { maxBytes: value.maxBytes }),
    ...(value.contentType === undefined
      ? {}
      : {
          contentType: requiredString(
            value.contentType,
            `${context}.contentType`
          ),
        }),
    ...(value.contentPayloadKey === undefined
      ? {}
      : {
          contentPayloadKey: requiredString(
            value.contentPayloadKey,
            `${context}.contentPayloadKey`
          ),
        }),
    ...(value.contentRoleKey === undefined
      ? {}
      : {
          contentRoleKey: requiredString(
            value.contentRoleKey,
            `${context}.contentRoleKey`
          ),
        }),
    ...(value.itemConstants === undefined
      ? {}
      : isRecord(value.itemConstants) &&
          Object.values(value.itemConstants).every(
            (item) =>
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean"
          )
        ? { itemConstants: value.itemConstants }
        : (() => {
            throw new Error(
              `${context}.itemConstants must contain primitive values.`
            )
          })()),
    minItems,
    ...(value.maxItems === undefined ? {} : { maxItems: value.maxItems }),
    ...(roles === undefined ? {} : { roles }),
  }
}

function parseConstraint(value, context) {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`)
  }

  const kind = requiredString(value.kind, `${context}.kind`)
  const message =
    value.message === undefined
      ? undefined
      : parseLocalizedText(value.message, `${context}.message`)

  if (kind === "mutually-exclusive-media-roles") {
    if (
      !Array.isArray(value.roles) ||
      value.roles.length < 2 ||
      !value.roles.every((role) => typeof role === "string" && role.trim())
    ) {
      throw new Error(`${context}.roles must contain at least two roles.`)
    }

    return {
      kind,
      fieldPath: parsePath(value.field, `${context}.field`),
      roles: value.roles.map((role) => role.trim()),
      ...(message ? { message } : {}),
    }
  }

  if (kind === "required-any") {
    if (!Array.isArray(value.fields) || value.fields.length < 2) {
      throw new Error(`${context}.fields must contain at least two paths.`)
    }

    return {
      kind,
      fieldPaths: value.fields.map((field, index) =>
        parsePath(field, `${context}.fields[${index}]`)
      ),
      ...(message ? { message } : {}),
    }
  }

  if (kind === "requires") {
    if (!Array.isArray(value.requires) || value.requires.length === 0) {
      throw new Error(`${context}.requires must contain at least one path.`)
    }

    return {
      kind,
      fieldPath: parsePath(value.field, `${context}.field`),
      requires: value.requires.map((field, index) =>
        parsePath(field, `${context}.requires[${index}]`)
      ),
      ...(message ? { message } : {}),
    }
  }

  if (kind === "parameter-rule") {
    const modes = value.modes
    if (
      modes !== undefined &&
      (!Array.isArray(modes) ||
        modes.length === 0 ||
        !modes.every((mode) => typeof mode === "string" && mode.trim()))
    ) {
      throw new Error(`${context}.modes must be a non-empty string array.`)
    }

    let when
    if (value.when !== undefined) {
      if (!isRecord(value.when)) {
        throw new Error(`${context}.when must be an object.`)
      }
      const equals = value.when.equals
      if (
        typeof equals !== "string" &&
        typeof equals !== "number" &&
        typeof equals !== "boolean"
      ) {
        throw new Error(`${context}.when.equals must be a primitive value.`)
      }
      when = {
        fieldPath: parsePath(value.when.field, `${context}.when.field`),
        equals,
      }
    }

    if (!Array.isArray(value.actions) || value.actions.length === 0) {
      throw new Error(`${context}.actions must be a non-empty array.`)
    }

    const actions = value.actions.map((action, index) => {
      const actionContext = `${context}.actions[${index}]`
      if (!isRecord(action)) {
        throw new Error(`${actionContext} must be an object.`)
      }
      const actionKind = requiredString(action.kind, `${actionContext}.kind`)
      const fieldPath = parsePath(action.field, `${actionContext}.field`)

      if (actionKind === "omit" || actionKind === "required") {
        return { kind: actionKind, fieldPath }
      }

      if (actionKind === "set") {
        if (
          typeof action.value !== "string" &&
          typeof action.value !== "number" &&
          typeof action.value !== "boolean"
        ) {
          throw new Error(`${actionContext}.value must be a primitive value.`)
        }
        return { kind: actionKind, fieldPath, value: action.value }
      }

      if (actionKind === "allowed-values") {
        if (
          !Array.isArray(action.values) ||
          action.values.length === 0 ||
          !action.values.every(
            (item) =>
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean"
          )
        ) {
          throw new Error(`${actionContext}.values must contain primitives.`)
        }
        return { kind: actionKind, fieldPath, values: action.values }
      }

      if (actionKind === "range") {
        if (
          action.min !== undefined &&
          (typeof action.min !== "number" || !Number.isFinite(action.min))
        ) {
          throw new Error(`${actionContext}.min must be a finite number.`)
        }
        if (
          action.max !== undefined &&
          (typeof action.max !== "number" || !Number.isFinite(action.max))
        ) {
          throw new Error(`${actionContext}.max must be a finite number.`)
        }
        if (action.min === undefined && action.max === undefined) {
          throw new Error(`${actionContext} requires min or max.`)
        }
        return {
          kind: actionKind,
          fieldPath,
          ...(action.min === undefined ? {} : { min: action.min }),
          ...(action.max === undefined ? {} : { max: action.max }),
        }
      }

      throw new Error(`${actionContext}.kind is not supported: ${actionKind}`)
    })

    return {
      kind,
      ...(modes === undefined
        ? {}
        : { modes: modes.map((mode) => mode.trim()) }),
      ...(when ? { when } : {}),
      actions,
      ...(message ? { message } : {}),
    }
  }

  throw new Error(`${context}.kind is not supported: ${kind}`)
}

function schemaAtPath(schema, path) {
  let current = schema

  for (const segment of path) {
    const property = schemaVariants(current)
      .map((variant) => objectPropertyMap(variant)?.[segment])
      .find((candidate) => candidate !== undefined)

    if (!isRecord(property)) {
      return null
    }

    current = property
  }

  return isRecord(current) ? current : null
}

function buildVideoProfile({
  operation,
  requestSchema,
  adapter,
  path,
  statusPath,
  contentType,
}) {
  const extension = operation["x-astraflow-profile"]
  const explicit = extension !== undefined
  const parsedExtension = isRecord(extension) ? extension : {}

  if (explicit && !isRecord(extension)) {
    throw new Error(`${operation.operationId}.x-astraflow-profile must be an object.`)
  }

  if (explicit && parsedExtension.version !== 1) {
    throw new Error(`${operation.operationId}.x-astraflow-profile.version must be 1.`)
  }

  const rawModes = parsedExtension.modes ?? []
  if (!Array.isArray(rawModes)) {
    throw new Error(`${operation.operationId}.x-astraflow-profile.modes must be an array.`)
  }

  const modes = rawModes.map((mode, index) => {
    const context = `${operation.operationId}.x-astraflow-profile.modes[${index}]`
    if (!isRecord(mode)) {
      throw new Error(`${context} must be an object.`)
    }

    if (!Array.isArray(mode.media)) {
      throw new Error(`${context}.media must be an array.`)
    }

    const rawStructuredFields = mode.structuredFields ?? []
    if (!Array.isArray(rawStructuredFields)) {
      throw new Error(`${context}.structuredFields must be an array.`)
    }

    const media = mode.media.map((item, mediaIndex) => {
      const mediaContext = `${context}.media[${mediaIndex}]`
      const parsed = parseModeMedia(item, mediaContext)
      const fieldSchema = schemaAtPath(requestSchema, parsed.fieldPath)

      if (!fieldSchema) {
        throw new Error(
          `${mediaContext}.field must reference a request schema property.`
        )
      }

      const schemaTypes = new Set(
        schemaVariants(fieldSchema).map((variant) => inferType(variant))
      )
      const expectedTypes = {
        "direct-url": ["string", "array"],
        "url-array": ["array"],
        "tagged-content-array": ["array"],
        "array-object": ["array"],
        "base64-object": ["object"],
        "raw-base64-or-url": ["string", "array"],
        "multipart-file": ["string"],
      }[parsed.serializer]

      if (!expectedTypes.some((type) => schemaTypes.has(type))) {
        throw new Error(
          `${mediaContext}.serializer ${parsed.serializer} is incompatible with ${[...schemaTypes].join("/")} at ${parsed.fieldPath.join(".")}.`
        )
      }

      return parsed
    })
    const mediaIds = new Set(media.map((item) => item.id))
    if (mediaIds.size !== media.length) {
      throw new Error(`${context} has duplicate media ids.`)
    }
    const structuredFields = rawStructuredFields.map((field, fieldIndex) => {
      const fieldContext = `${context}.structuredFields[${fieldIndex}]`
      if (!isRecord(field)) {
        throw new Error(`${fieldContext} must be an object.`)
      }

      const kind = field.kind ?? "json"
      if (kind !== "json") {
        throw new Error(`${fieldContext}.kind is not supported: ${kind}`)
      }

      const fieldPath = parsePath(field.field, `${fieldContext}.field`)
      const fieldSchema = schemaAtPath(requestSchema, fieldPath)
      if (!fieldSchema) {
        throw new Error(
          `${fieldContext}.field must reference a request schema property.`
        )
      }
      const rawSum = field.sum
      if (rawSum !== undefined && !isRecord(rawSum)) {
        throw new Error(`${fieldContext}.sum must be an object.`)
      }
      const sum = rawSum
        ? {
            itemFieldPath: parsePath(
              rawSum.itemField,
              `${fieldContext}.sum.itemField`
            ),
            equalsFieldPath: parsePath(
              rawSum.equalsField,
              `${fieldContext}.sum.equalsField`
            ),
          }
        : null

      return {
        id: requiredString(field.id, `${fieldContext}.id`),
        fieldPath,
        label: parseLocalizedText(field.label, `${fieldContext}.label`),
        ...(field.description === undefined
          ? {}
          : {
              description: parseLocalizedText(
                field.description,
                `${fieldContext}.description`
              ),
            }),
        required: Boolean(field.required),
        kind,
        schema: fieldSchema,
        ...(sum ? { sum } : {}),
        ...(field.placeholder === undefined
          ? {}
          : {
              placeholder: requiredString(
                field.placeholder,
                `${fieldContext}.placeholder`
              ),
            }),
      }
    })
    if (
      mode.maxInlinePayloadBytes !== undefined &&
      (typeof mode.maxInlinePayloadBytes !== "number" ||
        !Number.isFinite(mode.maxInlinePayloadBytes) ||
        mode.maxInlinePayloadBytes <= 0)
    ) {
      throw new Error(
        `${context}.maxInlinePayloadBytes must be a positive number.`
      )
    }

    return {
      id: requiredString(mode.id, `${context}.id`),
      label: parseLocalizedText(mode.label, `${context}.label`),
      ...(mode.promptRequired === undefined
        ? {}
        : { promptRequired: Boolean(mode.promptRequired) }),
      ...(mode.promptAllowed === undefined
        ? {}
        : { promptAllowed: Boolean(mode.promptAllowed) }),
      ...(mode.available === undefined
        ? {}
        : { available: Boolean(mode.available) }),
      ...(mode.maxInlinePayloadBytes === undefined
        ? {}
        : { maxInlinePayloadBytes: mode.maxInlinePayloadBytes }),
      ...(mode.unavailableReason === undefined
        ? {}
        : {
            unavailableReason: parseLocalizedText(
              mode.unavailableReason,
              `${context}.unavailableReason`
            ),
          }),
      ...(mode.description === undefined
        ? {}
        : {
            description: parseLocalizedText(
              mode.description,
              `${context}.description`
            ),
          }),
      media,
      structuredFields,
    }
  })
  const modeIds = new Set(modes.map((mode) => mode.id))
  if (modeIds.size !== modes.length) {
    throw new Error(`${operation.operationId} has duplicate AstraFlow mode ids.`)
  }

  const defaultMode = parsedExtension.defaultMode
  if (
    defaultMode !== undefined &&
    (!modeIds.has(defaultMode) || typeof defaultMode !== "string")
  ) {
    throw new Error(`${operation.operationId}.defaultMode must reference a declared mode.`)
  }
  if (
    defaultMode !== undefined &&
    modes.find((mode) => mode.id === defaultMode)?.available === false
  ) {
    throw new Error(`${operation.operationId}.defaultMode cannot be unavailable.`)
  }

  const rawConstraints = parsedExtension.constraints ?? []
  if (!Array.isArray(rawConstraints)) {
    throw new Error(`${operation.operationId}.constraints must be an array.`)
  }

  const constraints = rawConstraints.map((constraint, index) =>
    parseConstraint(
      constraint,
      `${operation.operationId}.x-astraflow-profile.constraints[${index}]`
    )
  )
  const constraintPaths = constraints.flatMap((constraint) => {
    if (constraint.kind === "parameter-rule") {
      return [
        ...(constraint.when ? [constraint.when.fieldPath] : []),
        ...constraint.actions.map((action) => action.fieldPath),
      ]
    }

    if (constraint.kind === "required-any") {
      return constraint.fieldPaths
    }

    if (constraint.kind === "requires") {
      return [constraint.fieldPath, ...constraint.requires]
    }

    return [constraint.fieldPath]
  })

  for (const fieldPath of constraintPaths) {
    if (!schemaAtPath(requestSchema, fieldPath)) {
      throw new Error(
        `${operation.operationId} constraint references unknown request field ${fieldPath.join(".")}.`
      )
    }
  }

  const isOpenAiVideo = adapter === "openai-video"
  const submitHeaders = parsedExtension.submitHeaders
  if (
    submitHeaders !== undefined &&
    (!isRecord(submitHeaders) ||
      !Object.values(submitHeaders).every(
        (value) => typeof value === "string" && value.trim()
      ))
  ) {
    throw new Error(`${operation.operationId}.submitHeaders must be a string map.`)
  }

  return {
    version: 1,
    explicit,
    ...(defaultMode === undefined ? {} : { defaultMode }),
    modes,
    constraints,
    submit: {
      method: "POST",
      path,
      contentType,
      taskIdPath: isOpenAiVideo ? ["id"] : ["output", "task_id"],
      ...(submitHeaders === undefined ? {} : { headers: submitHeaders }),
    },
    polling: {
      method: "GET",
      path: statusPath,
      taskIdPlacement: isOpenAiVideo ? "path" : "query",
      taskIdParameter: isOpenAiVideo ? "task_id" : "task_id",
      statusPath: isOpenAiVideo ? ["status"] : ["output", "task_status"],
      successStatuses: isOpenAiVideo ? ["completed"] : ["Success"],
      failureStatuses: isOpenAiVideo
        ? ["failed", "cancelled", "expired"]
        : ["Failure", "Expired"],
      ...(isOpenAiVideo
        ? { contentPath: "/v1/videos/{task_id}/content" }
        : { resultUrlsPath: ["output", "urls"] }),
    },
  }
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

  const imageContentVariant = itemVariants(schema).find((variant) => {
    const properties = objectPropertyMap(variant)

    return (
      isRecord(properties) &&
      properties.type?.const === "image_url" &&
      isRecord(properties.image_url)
    )
  })

  if (!imageContentVariant) {
    return null
  }

  const imageProperties = objectPropertyMap(imageContentVariant)
  const roleOptions = isRecord(imageProperties)
    ? getEnumOptions(imageProperties.role)
    : undefined

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

  const type = inferType(schema)

  if (type === "boolean") {
    return "boolean"
  }

  if (
    ["string", "object", "array"].includes(type) &&
    (isImageField(name, schema) ||
      isVideoField(name, schema) ||
      isAudioField(name, schema) ||
      isMediaObject(schema))
  ) {
    return "image"
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
    !isVideoField(name, schema) &&
    !isAudioField(name, schema) &&
    !isMediaObject(schema)
  ) {
    return null
  }

  if (
    type === "array" &&
    !options &&
    !isImageField(name, schema) &&
    !isVideoField(name, schema) &&
    !isAudioField(name, schema)
  ) {
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
    valueType: type,
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
    field.mediaKind = isImageField(name, schema)
      ? "image"
      : isVideoField(name, schema)
        ? "video"
        : "audio"

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
      const statusPath = "/v1/tasks/status"
      models.push({
        file: projectFile,
        title: title ?? basename(inputFile, ".yaml"),
        operationId: operation.operationId,
        method: "POST",
        path,
        statusPath,
        contentType: "application/json",
        adapter: "async-task",
        modelValues,
        profile: buildVideoProfile({
          operation,
          requestSchema: schema,
          adapter: "async-task",
          path,
          statusPath,
          contentType: "application/json",
        }),
      })
    }

    if (
      method.toLowerCase() === "post" &&
      path === "/v1/videos" &&
      requestContent.contentType === "multipart/form-data" &&
      isRecord(schema.properties)
    ) {
      const modelValues = getModelValues(schema.properties.model)
      const statusPath = "/v1/videos/{task_id}"
      models.push({
        file: projectFile,
        title: title ?? basename(inputFile, ".yaml"),
        operationId: operation.operationId,
        method: "POST",
        path,
        statusPath,
        contentType: "multipart/form-data",
        adapter: "openai-video",
        modelValues,
        profile: buildVideoProfile({
          operation,
          requestSchema: schema,
          adapter: "openai-video",
          path,
          statusPath,
          contentType: "multipart/form-data",
        }),
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
