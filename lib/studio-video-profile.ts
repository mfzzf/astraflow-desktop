import type {
  StudioVideoConstraint,
  StudioVideoInputMode,
  StudioVideoLocalizedText,
  StudioVideoMediaRoleStrategy,
  StudioVideoModeMediaField,
  StudioVideoModelProfile,
} from "@/lib/studio-video-types"

export const STUDIO_VIDEO_INPUT_MODE_PARAM = "__astraflow_input_mode"

export function videoFieldPathKey(path: string[]) {
  return path.join(".")
}

export function videoModeMediaKey(field: StudioVideoModeMediaField) {
  return field.id
}

export function localizeVideoText(
  value: StudioVideoLocalizedText,
  locale: string
) {
  return locale === "zh" ? value.zh : value.en
}

export function getVideoInputMode(
  profile: StudioVideoModelProfile,
  modeId: string | null | undefined
): StudioVideoInputMode | null {
  if (profile.modes.length === 0) {
    return null
  }

  const requested = modeId?.trim()
  if (requested) {
    const matched = profile.modes.find((mode) => mode.id === requested)

    if (matched) {
      return matched
    }
  }

  if (profile.defaultMode) {
    const fallback = profile.modes.find(
      (mode) => mode.id === profile.defaultMode
    )

    if (fallback) {
      return fallback
    }
  }

  return profile.modes.find((mode) => mode.available !== false) ?? null
}

export function getVideoModeMediaField(
  mode: StudioVideoInputMode | null,
  fieldPath: string[]
): StudioVideoModeMediaField | null {
  if (!mode) {
    return null
  }

  const key = videoFieldPathKey(fieldPath)

  return (
    mode.media.find((mediaField) => videoFieldPathKey(mediaField.fieldPath) === key) ??
    null
  )
}

export function getVideoMediaRoles(
  strategy: StudioVideoMediaRoleStrategy | undefined,
  itemCount: number
) {
  if (!strategy || strategy.kind === "none") {
    return Array.from({ length: itemCount }, () => undefined)
  }

  if (strategy.kind === "repeat") {
    return Array.from({ length: itemCount }, () => strategy.value)
  }

  if (strategy.values.length !== itemCount) {
    throw new Error(
      `The selected video mode expects ${strategy.values.length} media item roles, but received ${itemCount}.`
    )
  }

  return [...strategy.values]
}

export type StudioVideoModeValidationError = {
  fieldPath: string[]
  message: string
}

function hasVideoConstraintValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return false
  }

  return !Array.isArray(value) || value.length > 0
}

function getVideoConstraintMediaCount({
  mode,
  mediaCounts,
  fieldPath,
}: {
  mode: StudioVideoInputMode | null
  mediaCounts: Record<string, number>
  fieldPath: string[]
}) {
  if (!mode) {
    return 0
  }

  const pathKey = videoFieldPathKey(fieldPath)
  const directCount = mediaCounts[pathKey]
  if (directCount !== undefined) {
    return directCount
  }

  return mode.media
    .filter((field) => videoFieldPathKey(field.fieldPath) === pathKey)
    .reduce((count, field) => count + (mediaCounts[field.id] ?? 0), 0)
}

function hasVideoConstraintField({
  mode,
  mediaCounts,
  params,
  context,
  fieldPath,
}: {
  mode: StudioVideoInputMode | null
  mediaCounts: Record<string, number>
  params: Record<string, unknown>
  context: Record<string, unknown>
  fieldPath: string[]
}) {
  if (getVideoConstraintMediaCount({ mode, mediaCounts, fieldPath }) > 0) {
    return true
  }

  return hasVideoConstraintValue(
    parameterValue(context, fieldPath) ?? parameterValue(params, fieldPath)
  )
}

export function validateVideoConstraints({
  profile,
  modeId,
  params,
  mediaCounts,
  context = {},
  locale = "en",
}: {
  profile: StudioVideoModelProfile
  modeId?: string | null
  params: Record<string, unknown>
  mediaCounts: Record<string, number>
  context?: Record<string, unknown>
  locale?: string
}): StudioVideoModeValidationError[] {
  const mode = getVideoInputMode(profile, modeId)
  const errors: StudioVideoModeValidationError[] = []
  const hasField = (fieldPath: string[]) =>
    hasVideoConstraintField({
      mode,
      mediaCounts,
      params,
      context,
      fieldPath,
    })

  for (const constraint of profile.constraints) {
    if (constraint.kind === "parameter-rule") {
      continue
    }

    const message = constraint.message
      ? localizeVideoText(constraint.message, locale)
      : locale === "zh"
        ? "当前输入不满足模型约束。"
        : "The current input does not satisfy the model constraints."

    if (
      constraint.kind === "required-any" &&
      !constraint.fieldPaths.some(hasField)
    ) {
      errors.push({ fieldPath: constraint.fieldPaths[0] ?? [], message })
      continue
    }

    if (
      constraint.kind === "requires" &&
      hasField(constraint.fieldPath) &&
      !constraint.requires.every(hasField)
    ) {
      errors.push({ fieldPath: constraint.fieldPath, message })
      continue
    }

    if (constraint.kind === "mutually-exclusive-media-roles") {
      const pathKey = videoFieldPathKey(constraint.fieldPath)
      const activeRoles = new Set<string>()

      for (const field of mode?.media ?? []) {
        const fieldCount =
          mediaCounts[field.id] ??
          mediaCounts[videoFieldPathKey(field.fieldPath)] ??
          0
        if (
          videoFieldPathKey(field.fieldPath) !== pathKey ||
          fieldCount === 0
        ) {
          continue
        }

        if (field.roles?.kind === "repeat") {
          activeRoles.add(field.roles.value)
        } else if (field.roles?.kind === "sequence") {
          for (const role of field.roles.values) {
            activeRoles.add(role)
          }
        }
      }

      if (constraint.roles.filter((role) => activeRoles.has(role)).length > 1) {
        errors.push({ fieldPath: constraint.fieldPath, message })
      }
    }
  }

  return errors
}

function parameterValue(params: Record<string, unknown>, path: string[]) {
  const key = videoFieldPathKey(path)
  return params[key] ?? params[path.at(-1) ?? ""]
}

function setParameterValue(
  params: Record<string, unknown>,
  path: string[],
  value: unknown
) {
  params[videoFieldPathKey(path)] = value
}

function deleteParameterValue(params: Record<string, unknown>, path: string[]) {
  delete params[videoFieldPathKey(path)]
  delete params[path.at(-1) ?? ""]
}

function parameterRuleApplies(
  constraint: Extract<StudioVideoConstraint, { kind: "parameter-rule" }>,
  modeId: string | null | undefined,
  params: Record<string, unknown>,
  context: Record<string, unknown>
) {
  if (constraint.modes && !constraint.modes.includes(modeId ?? "")) {
    return false
  }

  if (!constraint.when) {
    return true
  }

  return (
    parameterValue(context, constraint.when.fieldPath) ??
    parameterValue(params, constraint.when.fieldPath)
  ) === constraint.when.equals
}

export type StudioVideoParameterRuleResult = {
  params: Record<string, unknown>
  omittedFields: Set<string>
  fixedFields: Set<string>
  requiredFields: Set<string>
  allowedValues: Map<string, Array<string | number | boolean>>
  ranges: Map<string, { min?: number; max?: number }>
  errors: string[]
}

export function evaluateVideoParameterRules({
  profile,
  modeId,
  params,
  context = {},
  locale = "en",
}: {
  profile: StudioVideoModelProfile
  modeId?: string | null
  params: Record<string, unknown>
  context?: Record<string, unknown>
  locale?: string
}): StudioVideoParameterRuleResult {
  const nextParams = { ...params }
  const omittedFields = new Set<string>()
  const fixedFields = new Set<string>()
  const requiredFields = new Set<string>()
  const allowedValues = new Map<
    string,
    Array<string | number | boolean>
  >()
  const ranges = new Map<string, { min?: number; max?: number }>()
  const errors: string[] = []

  for (const constraint of profile.constraints) {
    if (
      constraint.kind !== "parameter-rule" ||
      !parameterRuleApplies(constraint, modeId, nextParams, context)
    ) {
      continue
    }

    for (const action of constraint.actions) {
      const key = videoFieldPathKey(action.fieldPath)

      if (action.kind === "set") {
        setParameterValue(nextParams, action.fieldPath, action.value)
        fixedFields.add(key)
        continue
      }

      if (action.kind === "omit") {
        deleteParameterValue(nextParams, action.fieldPath)
        omittedFields.add(key)
        continue
      }

      if (action.kind === "required") {
        requiredFields.add(key)
        continue
      }

      if (action.kind === "range") {
        ranges.set(key, { min: action.min, max: action.max })
        const value = parameterValue(nextParams, action.fieldPath)
        const numeric = typeof value === "number" ? value : Number(value)
        if (
          value !== undefined &&
          value !== null &&
          value !== "" &&
          (!Number.isFinite(numeric) ||
            (action.min !== undefined && numeric < action.min) ||
            (action.max !== undefined && numeric > action.max))
        ) {
          errors.push(
            constraint.message
              ? localizeVideoText(constraint.message, locale)
              : locale === "zh"
                ? `${key} 超出当前模式允许的范围。`
                : `${key} is outside the range allowed by the current mode.`
          )
        }
        continue
      }

      allowedValues.set(key, action.values)
      const value = parameterValue(nextParams, action.fieldPath)
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !action.values.some((allowed) => String(allowed) === String(value))
      ) {
        errors.push(
          constraint.message
            ? localizeVideoText(constraint.message, locale)
            : locale === "zh"
              ? `${key} 的值不适用于当前模式。`
              : `${key} is not valid for the current mode.`
        )
      }
    }
  }

  for (const key of requiredFields) {
    const value = nextParams[key] ?? nextParams[key.split(".").at(-1) ?? ""]
    if (value === undefined || value === null || value === "") {
      errors.push(
        locale === "zh" ? `${key} 为必填项。` : `${key} is required.`
      )
    }
  }

  return {
    params: nextParams,
    omittedFields,
    fixedFields,
    requiredFields,
    allowedValues,
    ranges,
    errors,
  }
}

export function validateVideoModeMedia({
  profile,
  modeId,
  mediaCounts,
  locale = "en",
}: {
  profile: StudioVideoModelProfile
  modeId?: string | null
  mediaCounts: Record<string, number>
  locale?: string
}): StudioVideoModeValidationError[] {
  const mode = getVideoInputMode(profile, modeId)

  if (!mode) {
    return []
  }

  const errors: StudioVideoModeValidationError[] = []
  const activePaths = new Set(
    mode.media.map(videoModeMediaKey)
  )

  for (const mediaField of mode.media) {
    const fieldKey = videoModeMediaKey(mediaField)
    const count = mediaCounts[fieldKey] ?? 0

    if (count < mediaField.minItems) {
      errors.push({
        fieldPath: mediaField.fieldPath,
        message:
          locale === "zh"
            ? `当前模式至少需要 ${mediaField.minItems} 个媒体文件。`
            : `This mode requires at least ${mediaField.minItems} media item(s).`,
      })
    }

    if (mediaField.maxItems !== undefined && count > mediaField.maxItems) {
      errors.push({
        fieldPath: mediaField.fieldPath,
        message:
          locale === "zh"
            ? `当前模式最多允许 ${mediaField.maxItems} 个媒体文件。`
            : `This mode accepts at most ${mediaField.maxItems} media item(s).`,
      })
    }
  }

  for (const [fieldKey, count] of Object.entries(mediaCounts)) {
    if (count > 0 && !activePaths.has(fieldKey)) {
      errors.push({
        fieldPath: fieldKey.split("."),
        message:
          locale === "zh"
            ? "当前模式不允许使用这个媒体字段。"
            : "This media field is not allowed in the selected mode.",
      })
    }
  }

  return errors
}

export function validateVideoModeMediaSources({
  profile,
  modeId,
  media,
}: {
  profile: StudioVideoModelProfile
  modeId?: string | null
  media: Record<
    string,
    Array<{ dataUrl?: string; mimeType?: string; url?: string }>
  >
}): StudioVideoModeValidationError[] {
  const mode = getVideoInputMode(profile, modeId)

  if (!mode) {
    return []
  }

  const errors: StudioVideoModeValidationError[] = []
  let totalInlinePayloadBytes = 0

  for (const field of mode.media) {
    const attachments = media[field.id] ?? media[videoFieldPathKey(field.fieldPath)] ?? []

    for (const attachment of attachments) {
      if (attachment.url && !field.acceptedSources.includes("url")) {
        errors.push({
          fieldPath: field.fieldPath,
          message: `${field.id} does not accept URL media.`,
        })
      }

      if (
        attachment.dataUrl &&
        !field.acceptedSources.includes("data-url") &&
        !field.acceptedSources.includes("file")
      ) {
        errors.push({
          fieldPath: field.fieldPath,
          message: `${field.id} accepts URLs only.`,
        })
      }

      const mimeType =
        attachment.mimeType ?? attachment.dataUrl?.match(/^data:([^;]+)/)?.[1]
      if (
        mimeType &&
        !mimeType.endsWith("/url") &&
        field.mimeTypes?.length &&
        !field.mimeTypes.includes(mimeType)
      ) {
        errors.push({
          fieldPath: field.fieldPath,
          message: `${field.id} does not accept ${mimeType}.`,
        })
      }

      if (attachment.dataUrl && field.maxBytes) {
        totalInlinePayloadBytes += attachment.dataUrl.length
        const base64 = attachment.dataUrl.split(",", 2)[1] ?? ""
        const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
        const approximateBytes = Math.max(
          0,
          Math.floor((base64.length * 3) / 4) - padding
        )
        if (approximateBytes > field.maxBytes) {
          errors.push({
            fieldPath: field.fieldPath,
            message: `${field.id} exceeds the maximum file size.`,
          })
        }
      } else if (attachment.dataUrl) {
        totalInlinePayloadBytes += attachment.dataUrl.length
      }
    }
  }

  if (
    mode.maxInlinePayloadBytes &&
    totalInlinePayloadBytes > mode.maxInlinePayloadBytes
  ) {
    errors.push({
      fieldPath: [],
      message: `The combined local media exceeds this mode's payload limit.`,
    })
  }

  return errors
}
