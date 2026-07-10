const MAX_SCALAR_LENGTH = 240
const MAX_JSON_DEPTH = 3
const DEFAULT_PAYLOAD_LIMIT = 40_000
const PRIMARY_TEXT_KEYS = [
  "formatted_output",
  "formattedOutput",
  "stdout",
  "output",
  "result",
  "text",
  "message",
  "content",
] as const

export type ToolPayloadScalar = {
  key: string
  label: string
  value: string
}

export type ToolPayloadCollection = {
  key: string
  label: string
  kind: "array" | "object"
  count: number
}

export type ToolPayloadPreviewItem = {
  key: string
  title: string
  subtitle: string
}

export type NormalizedToolPayload = {
  value: unknown
  json: string | null
  primaryText: string
  scalars: ToolPayloadScalar[]
  collections: ToolPayloadCollection[]
  previewItems: ToolPayloadPreviewItem[]
  summary: {
    count: number
    kind: "fields" | "items"
    label?: string
  } | null
}

export type NormalizedCommandToolResult = {
  output: string
  stdout: string
  stderr: string
  exitCode: number | null
  interrupted: boolean
  failed: boolean
  isProcessResult: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonValue(value: string, depth = 0): unknown | null {
  const trimmed = value.trim()

  if (
    !trimmed ||
    depth >= MAX_JSON_DEPTH ||
    (!trimmed.startsWith("{") &&
      !trimmed.startsWith("[") &&
      !trimmed.startsWith('"'))
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown

    if (typeof parsed === "string") {
      return parseJsonValue(parsed, depth + 1) ?? parsed
    }

    return parsed
  } catch {
    return null
  }
}

function stringifyJson(value: unknown) {
  try {
    const json = JSON.stringify(value, null, 2)

    return typeof json === "string" ? json : null
  } catch {
    return null
  }
}

function boundPayloadValue(
  value: unknown,
  budget: { remaining: number },
  seen: WeakSet<object>,
  depth = 0
): unknown {
  if (typeof value === "string") {
    const available = Math.max(0, Math.min(budget.remaining, 20_000))
    const truncated = value.length > available
    const result = truncated ? `${value.slice(0, available)}… (truncated)` : value

    budget.remaining = Math.max(0, budget.remaining - result.length)
    return result
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value
  }

  if (typeof value !== "object") {
    return String(value)
  }

  if (seen.has(value)) {
    return "[Circular]"
  }

  if (depth >= 8 || budget.remaining <= 0) {
    return "… (truncated)"
  }

  seen.add(value)

  if (Array.isArray(value)) {
    const itemLimit = Math.min(value.length, 100)
    const result = value
      .slice(0, itemLimit)
      .map((item) => boundPayloadValue(item, budget, seen, depth + 1))

    if (itemLimit < value.length) {
      result.push(`… ${value.length - itemLimit} more items`)
    }

    return result
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const result: Record<string, unknown> = {}

  for (const [index, [key, entry]] of entries.entries()) {
    if (index >= 100 || budget.remaining <= 0) {
      result.__truncated__ = `${entries.length - index} more fields`
      break
    }

    result[key] = boundPayloadValue(entry, budget, seen, depth + 1)
  }

  return result
}

export function stringifyToolPayload(
  value: unknown,
  maxCharacters = DEFAULT_PAYLOAD_LIMIT
) {
  if (typeof value === "string") {
    return value.length > maxCharacters
      ? `${value.slice(0, maxCharacters)}… (truncated)`
      : value
  }

  if (value === null || value === undefined) {
    return ""
  }

  const bounded = boundPayloadValue(
    value,
    { remaining: Math.max(0, maxCharacters) },
    new WeakSet()
  )

  return stringifyJson(bounded) ?? String(bounded)
}

function formatLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase())
}

function formatScalar(value: string | number | boolean | null) {
  const text = value === null ? "null" : String(value)

  return text.length > MAX_SCALAR_LENGTH
    ? `${text.slice(0, MAX_SCALAR_LENGTH - 1)}…`
    : text
}

function getContentBlockText(value: unknown): string {
  if (!Array.isArray(value)) {
    return ""
  }

  return value
    .flatMap((item) => {
      if (typeof item === "string") {
        return [item]
      }

      if (!isRecord(item)) {
        return []
      }

      const text = item.text ?? item.content

      return typeof text === "string" ? [text] : []
    })
    .filter((text) => text.trim())
    .join("\n")
    .trim()
}

function getValueText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return getContentBlockText(value)
  }

  return ""
}

function getPrimaryText(value: unknown) {
  if (typeof value === "string") {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return getContentBlockText(value)
  }

  if (!isRecord(value)) {
    return ""
  }

  for (const key of PRIMARY_TEXT_KEYS) {
    const text = getValueText(value[key])

    if (text) {
      return text
    }
  }

  const structuredContent = getContentBlockText(value.structuredContent)

  return structuredContent
}

function getSummary(value: unknown) {
  if (Array.isArray(value)) {
    return { count: value.length, kind: "items" as const }
  }

  if (!isRecord(value)) {
    return null
  }

  const keys = Object.keys(value)

  if (keys.length === 1) {
    const key = keys[0]
    const nestedValue = value[key]

    if (Array.isArray(nestedValue)) {
      return {
        count: nestedValue.length,
        kind: "items" as const,
        label: formatLabel(key),
      }
    }

    if (isRecord(nestedValue)) {
      return {
        count: Object.keys(nestedValue).length,
        kind: "fields" as const,
        label: formatLabel(key),
      }
    }
  }

  return { count: keys.length, kind: "fields" as const }
}

function getPreviewItems(value: unknown): ToolPayloadPreviewItem[] {
  const record = isRecord(value) ? value : null
  const preferredCollectionKeys = [
    "items",
    "results",
    "matches",
    "files",
    "entries",
    "data",
  ]
  const collection = Array.isArray(value)
    ? value
    : preferredCollectionKeys
        .map((key) => record?.[key])
        .find((entry): entry is unknown[] => Array.isArray(entry))

  if (!collection) {
    return []
  }

  return collection.slice(0, 5).flatMap((item, index) => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      return [
        {
          key: String(index),
          title: formatScalar(item),
          subtitle: "",
        },
      ]
    }

    if (!isRecord(item)) {
      return []
    }

    const scalarEntries = Object.entries(item).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null ||
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean"
    )
    const titleKeys = [
      "title",
      "name",
      "path",
      "filePath",
      "url",
      "id",
      "text",
      "message",
    ]
    const titleEntry =
      titleKeys
        .map((key) => scalarEntries.find(([entryKey]) => entryKey === key))
        .find(Boolean) ?? scalarEntries[0]

    if (!titleEntry) {
      return []
    }

    const subtitleEntry = scalarEntries.find(
      ([key, entry]) => key !== titleEntry[0] && String(entry).trim()
    )

    return [
      {
        key: `${index}:${titleEntry[0]}:${String(titleEntry[1])}`,
        title: formatScalar(titleEntry[1]),
        subtitle: subtitleEntry
          ? `${formatLabel(subtitleEntry[0])}: ${formatScalar(subtitleEntry[1])}`
          : "",
      },
    ]
  })
}

export function normalizeToolPayload(raw: string): NormalizedToolPayload {
  const parsed = parseJsonValue(raw)
  const value = parsed ?? raw.trim()
  const record = isRecord(value) ? value : null
  const primaryText = getPrimaryText(value)
  const primaryKeys = new Set<string>()

  if (record && primaryText) {
    for (const key of PRIMARY_TEXT_KEYS) {
      if (getValueText(record[key]) === primaryText) {
        primaryKeys.add(key)
      }
    }
  }

  const scalars: ToolPayloadScalar[] = []
  const collections: ToolPayloadCollection[] = []

  if (record) {
    for (const [key, entry] of Object.entries(record)) {
      if (primaryKeys.has(key) || entry === undefined) {
        continue
      }

      if (
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        scalars.push({
          key,
          label: formatLabel(key),
          value: formatScalar(entry),
        })
        continue
      }

      if (Array.isArray(entry)) {
        collections.push({
          key,
          label: formatLabel(key),
          kind: "array",
          count: entry.length,
        })
        continue
      }

      if (isRecord(entry)) {
        collections.push({
          key,
          label: formatLabel(key),
          kind: "object",
          count: Object.keys(entry).length,
        })
      }
    }
  }

  return {
    value,
    json: parsed === null ? null : stringifyJson(parsed),
    primaryText,
    scalars,
    collections,
    previewItems: getPreviewItems(value),
    summary: getSummary(value),
  }
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value)
  }

  return null
}

function getCommandOutputValue(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return getContentBlockText(value) || stringifyJson(value) || ""
  }

  if (value !== undefined) {
    return stringifyJson(value) ?? String(value)
  }

  return ""
}

export function normalizeCommandToolResult(
  raw: string
): NormalizedCommandToolResult {
  const parsed = parseJsonValue(raw)
  const record = isRecord(parsed) ? parsed : null

  if (!record) {
    return {
      output: raw.trim(),
      stdout: "",
      stderr: "",
      exitCode: null,
      interrupted: false,
      failed: false,
      isProcessResult: false,
    }
  }

  const stdout = typeof record.stdout === "string" ? record.stdout : ""
  const stderr = typeof record.stderr === "string" ? record.stderr : ""
  const formattedOutput =
    typeof record.formatted_output === "string"
      ? record.formatted_output
      : typeof record.formattedOutput === "string"
        ? record.formattedOutput
        : getCommandOutputValue(record.output)
  const output =
    formattedOutput ||
    [stdout, stderr]
      .map((section) => section.trimEnd())
      .filter(Boolean)
      .join("\n")
  const exitCode = getNumber(
    record.exit_code ?? record.exitCode ?? record.exit
  )
  const interrupted = record.interrupted === true
  const failed =
    interrupted ||
    (exitCode !== null && exitCode !== 0) ||
    record.success === false ||
    record.is_error === true ||
    record.isError === true
  const isProcessResult =
    "formatted_output" in record ||
    "formattedOutput" in record ||
    "output" in record ||
    "stdout" in record ||
    "stderr" in record ||
    "exit_code" in record ||
    "exitCode" in record ||
    "exit" in record ||
    "interrupted" in record

  return {
    output,
    stdout,
    stderr,
    exitCode,
    interrupted,
    failed,
    isProcessResult,
  }
}
