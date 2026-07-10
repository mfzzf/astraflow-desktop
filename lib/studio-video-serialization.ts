import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"

import { parseDataUrl } from "@/lib/studio-generation-shared"
import { getVideoMediaRoles } from "@/lib/studio-video-profile"
import type {
  StudioVideoInputMode,
  StudioVideoModeMediaField,
} from "@/lib/studio-video-types"

const structuredFieldAjv = new Ajv2020({
  allErrors: true,
  strict: false,
})
addFormats(structuredFieldAjv)
const structuredFieldValidators = new WeakMap<
  object,
  ReturnType<typeof structuredFieldAjv.compile>
>()

function valueAtPath(value: unknown, path: string[]) {
  let current = value

  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

export type StudioVideoSerializableAttachment = {
  dataUrl?: string
  url?: string
}

function attachmentsForField(
  media: Record<string, StudioVideoSerializableAttachment[]>,
  field: StudioVideoModeMediaField
) {
  return (
    media[field.id] ??
    media[field.fieldPath.join(".")] ??
    media[field.fieldPath.at(-1) ?? ""] ??
    []
  )
}

function valuesForField(
  media: Record<string, StudioVideoSerializableAttachment[]>,
  field: StudioVideoModeMediaField
) {
  return attachmentsForField(media, field)
    .map((attachment) => attachment.url ?? attachment.dataUrl ?? null)
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      if (field.valueEncoding !== "raw-base64") {
        return value
      }

      return parseDataUrl(value)?.base64 ?? value
    })
}

function serializePath({
  prompt,
  media,
  fields,
}: {
  prompt: string
  media: Record<string, StudioVideoSerializableAttachment[]>
  fields: StudioVideoModeMediaField[]
}) {
  const serializer = fields[0]?.serializer

  if (!serializer) {
    return undefined
  }

  if (fields.some((field) => field.serializer !== serializer)) {
    throw new Error("Media fields sharing a payload path must use one serializer.")
  }

  if (serializer === "tagged-content-array") {
    const content: Array<Record<string, unknown>> = prompt
      ? [{ type: "text", text: prompt }]
      : []

    for (const field of fields) {
      const values = valuesForField(media, field)
      const roles = getVideoMediaRoles(field.roles, values.length)
      const contentType =
        field.contentType ??
        (field.mediaKind === "video"
          ? "video_url"
          : field.mediaKind === "audio"
            ? "audio_url"
            : "image_url")
      const payloadKey = field.contentPayloadKey ?? contentType
      const roleKey = field.contentRoleKey ?? "role"

      values.forEach((value, index) => {
        content.push({
          type: contentType,
          [payloadKey]: { url: value },
          ...(roles[index] ? { [roleKey]: roles[index] } : {}),
        })
      })
    }

    return content
  }

  if (fields.length !== 1) {
    throw new Error(
      `The ${serializer} serializer accepts one media field per payload path.`
    )
  }

  const field = fields[0]
  const values = valuesForField(media, field)

  if (values.length === 0) {
    return undefined
  }

  if (serializer === "url-array") {
    return values
  }

  if (serializer === "direct-url") {
    return field.maxItems === 1 ? values[0] : values
  }

  if (serializer === "base64-object") {
    const parsed = parseDataUrl(values[0])

    if (!parsed) {
      throw new Error(`${field.id} requires a local Base64 media file.`)
    }

    return {
      bytesBase64Encoded: parsed.base64,
      mimeType: parsed.mimeType,
    }
  }

  if (serializer === "raw-base64-or-url") {
    const normalized = values.map((value) => {
      const parsed = parseDataUrl(value)
      return parsed?.base64 ?? value
    })

    return field.maxItems === 1 ? normalized[0] : normalized
  }

  if (serializer === "array-object") {
    const roles = getVideoMediaRoles(field.roles, values.length)
    const payloadKey = field.contentPayloadKey ?? "url"
    const roleKey = field.contentRoleKey ?? "role"

    return values.map((value, index) => ({
      [payloadKey]: value,
      ...(roles[index] ? { [roleKey]: roles[index] } : {}),
      ...(field.itemConstants ?? {}),
    }))
  }

  if (serializer === "multipart-file") {
    return undefined
  }

  throw new Error(`Unsupported video media serializer: ${serializer}`)
}

export function serializeVideoProfileMedia({
  prompt,
  media,
  inputMode,
}: {
  prompt: string
  media: Record<string, StudioVideoSerializableAttachment[]>
  inputMode: StudioVideoInputMode
}) {
  const fieldsByPath = new Map<string, StudioVideoModeMediaField[]>()

  for (const field of inputMode.media) {
    const key = field.fieldPath.join(".")
    const current = fieldsByPath.get(key) ?? []
    current.push(field)
    fieldsByPath.set(key, current)
  }

  const entries: Array<{ path: string[]; value: unknown }> = []

  for (const fields of fieldsByPath.values()) {
    const value = serializePath({ prompt, media, fields })

    if (value !== undefined) {
      entries.push({ path: fields[0].fieldPath, value })
    }
  }

  return entries
}

export function serializeVideoStructuredFields({
  inputMode,
  params,
}: {
  inputMode: StudioVideoInputMode
  params: Record<string, unknown>
}) {
  return inputMode.structuredFields.flatMap((field) => {
    const key = field.fieldPath.join(".")
    const value = params[key] ?? params[field.id]

    if (value === undefined || value === null || value === "") {
      if (field.required) {
        throw new Error(`${field.id} is required.`)
      }

      return []
    }

    if (field.kind === "json") {
      let parsedValue = value

      if (typeof value === "string") {
        try {
          parsedValue = JSON.parse(value)
        } catch {
          throw new Error(`${field.id} must be valid JSON.`)
        }
      }

      if (field.schema) {
        let validate = structuredFieldValidators.get(field.schema)

        if (!validate) {
          validate = structuredFieldAjv.compile(field.schema)
          structuredFieldValidators.set(field.schema, validate)
        }

        if (!validate(parsedValue)) {
          const issue = validate.errors?.[0]
          const location = issue?.instancePath || ""
          throw new Error(
            `${field.id}${location} ${issue?.message ?? "does not match the OpenAPI schema."}`
          )
        }
      }

      if (field.sum) {
        if (!Array.isArray(parsedValue)) {
          throw new Error(`${field.id} must be an array to evaluate its sum.`)
        }

        const expectedValue =
          params[field.sum.equalsFieldPath.join(".")] ??
          params[field.sum.equalsFieldPath.at(-1) ?? ""]
        const expected = Number(expectedValue)
        const total = parsedValue.reduce((sum, item) => {
          const itemValue = Number(valueAtPath(item, field.sum!.itemFieldPath))
          return sum + itemValue
        }, 0)

        if (!Number.isFinite(expected) || !Number.isFinite(total) || total !== expected) {
          throw new Error(
            `${field.id} item durations must sum to ${field.sum.equalsFieldPath.join(".")}.`
          )
        }
      }

      return [{ path: field.fieldPath, value: parsedValue }]
    }

    return []
  })
}
