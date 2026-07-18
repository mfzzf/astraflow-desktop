"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiQuestionLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import {
  moveStudioFormDraft,
  useStudioFormDraftField,
  useStudioFormDraftReady,
  useStudioPromptDraft,
} from "@/hooks/use-studio-prompt-draft"
import {
  MediaOutputActions,
  MediaStatusBadge,
} from "@/components/studio-media-output-actions"
import {
  studioMediaEmptyStateClassName,
  studioMediaWorkbenchCanvasClassName,
  studioMediaWorkbenchShellClassName,
  studioMediaWorkbenchSidebarClassName,
} from "@/components/studio-media-workbench-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { VideoPlayer } from "@/components/ui/video-player"
import {
  fetchStudioModelsWithCache,
  getPreferredStudioModelId,
  saveSelectedStudioModel,
} from "@/lib/studio-model-cache"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { coerceFieldValue } from "@/lib/studio-generation-shared"
import { cn, createClientId } from "@/lib/utils"
import type { StudioSession } from "@/lib/studio-types"
import type {
  StudioVideoGeneration,
  StudioVideoModelOption,
  StudioVideoOutput,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"
import {
  STUDIO_VIDEO_INPUT_MODE_PARAM,
  evaluateVideoParameterRules,
  getVideoInputMode,
  getVideoModeMediaField,
  localizeVideoText,
  validateVideoConstraints,
  validateVideoModeMedia,
} from "@/lib/studio-video-profile"
import type { StudioVideoModeMediaField } from "@/lib/studio-video-types"
import { serializeVideoStructuredFields } from "@/lib/studio-video-serialization"

type StudioVideoWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; error?: unknown; message?: string }
type ApiResponse<T> = ApiOk<T> | ApiErr

const MAX_REFERENCE_IMAGES = 8
const MAX_REFERENCE_BYTES = 100 * 1024 * 1024
const VIDEO_FALLBACK_TITLE = "New video"

function getVideoCopy(locale: string) {
  if (locale === "zh") {
    return {
      model: "模型",
      modelPlaceholder: "选择模型",
      modelsLoading: "正在加载模型...",
      modelsFailed: "加载视频模型失败。",
      prompt: "提示词",
      promptPlaceholder: "描述要生成的视频",
      inputMode: "生成模式",
      operation: "任务类型",
      references: "参考媒体",
      referenceUrl: "媒体链接",
      addUrl: "添加链接",
      attach: "添加文件",
      advanced: "高级选项",
      advancedHide: "收起高级选项",
      generate: "生成",
      submitFailed: "生成失败。",
      empty: "暂无视频",
      download: "下载",
      save: "保存",
      saved: "已保存",
      queued: "排队中",
      running: "生成中",
      generatingTitle: "正在生成视频",
      generatingHint: "完成后会自动保存到文件库",
      complete: "已完成",
      failed: "失败",
      errorTitle: "视频生成失败",
      errorFallback: "Provider 没有返回错误详情。",
      mediaFailed: "视频加载失败",
    }
  }

  return {
    model: "Model",
    modelPlaceholder: "Select a model",
    modelsLoading: "Loading models...",
    modelsFailed: "Failed to load video models.",
    prompt: "Prompt",
    promptPlaceholder: "Describe the video",
    inputMode: "Generation mode",
    operation: "Capability",
    references: "Reference media",
    referenceUrl: "Media URL",
    addUrl: "Add URL",
    attach: "Add file",
    advanced: "Advanced",
    advancedHide: "Hide advanced",
    generate: "Generate",
    submitFailed: "Failed to generate.",
    empty: "No videos",
    download: "Download",
    save: "Save",
    saved: "Saved",
    queued: "Queued",
    running: "Running",
    generatingTitle: "Generating video",
    generatingHint: "It will be saved to Files when ready",
    complete: "Complete",
    failed: "Failed",
    errorTitle: "Video generation failed",
    errorFallback: "The provider did not return error details.",
    mediaFailed: "Failed to load video",
  }
}

function isOk<T>(payload: ApiResponse<T>): payload is ApiOk<T> {
  return payload.ok === true
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>

  if (!response.ok || !isOk(payload)) {
    const message =
      (!isOk(payload) &&
        (payload.message ||
          (typeof payload.error === "string" ? payload.error : ""))) ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload.data
}

async function fetchVideoModels() {
  const response = await fetch("/api/studio/video/models")
  return readJson<{
    supported: StudioVideoModelOption[]
    disabled: StudioVideoModelOption[]
  }>(response)
}

async function fetchVideoGenerations(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/video-generations`
  )
  return readJson<StudioVideoGeneration[]>(response)
}

function getFallbackVideoTitle(prompt: string) {
  const normalized = prompt.trim()
  return normalized ? normalized.slice(0, 120) : VIDEO_FALLBACK_TITLE
}

async function createVideoSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "video", title }),
  })
  return readJson<StudioSession>(response)
}

async function generateSessionTitle(sessionId: string, prompt: string) {
  await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
}

async function submitVideoGeneration({
  sessionId,
  modelId,
  modelName,
  prompt,
  inputMode,
  params,
  openapi,
  mediaByField,
}: {
  sessionId: string
  modelId: string
  modelName: string
  prompt: string
  inputMode?: string
  params: Record<string, unknown>
  openapi: NonNullable<StudioVideoModelOption["openapi"]>
  mediaByField: Record<string, PendingReferenceImage[]>
}) {
  const media = Object.fromEntries(
    Object.entries(mediaByField).map(([key, attachments]) => [
      key,
      attachments.map(serializeReferenceImage),
    ])
  )

  const response = await fetch(
    `/api/studio/sessions/${sessionId}/video-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        modelName,
        prompt,
        inputMode,
        params,
        openapi,
        media,
      }),
    }
  )
  return readJson<StudioVideoGeneration>(response)
}

type PendingReferenceImage = {
  id: string
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
}

type StudioVideoMediaControl = {
  key: string
  field: StudioVideoParameterField
  modeMedia: StudioVideoModeMediaField | null
}

function serializeReferenceImage(attachment: PendingReferenceImage) {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    dataUrl: attachment.dataUrl,
    url: attachment.url,
  }
}

function getVideoFieldKey(field: StudioVideoParameterField) {
  return field.payloadPath.join(".") || field.name
}

function getMaxReferenceImages(
  field: StudioVideoParameterField,
  modeMedia?: StudioVideoModeMediaField | null
) {
  if (!field.acceptMultiple) {
    return 1
  }

  return modeMedia?.maxItems ?? field.maxItems ?? MAX_REFERENCE_IMAGES
}

function buildVideoMediaControls({
  fields,
  inputMode,
  explicit,
  locale,
}: {
  fields: StudioVideoParameterField[]
  inputMode: ReturnType<typeof getVideoInputMode>
  explicit: boolean
  locale: string
}): StudioVideoMediaControl[] {
  if (!explicit || !inputMode) {
    return fields
      .filter((field) => field.kind === "image" && !field.hidden)
      .map((field) => ({
        key: getVideoFieldKey(field),
        field,
        modeMedia: null,
      }))
  }

  return inputMode.media.map((modeMedia) => {
    const matchingField = fields.find(
      (field) =>
        field.payloadPath.join(".") === modeMedia.fieldPath.join(".")
    )
    const field: StudioVideoParameterField = {
      ...(matchingField ?? {
        name: modeMedia.id,
        label: modeMedia.id,
        kind: "image",
        required: modeMedia.minItems > 0,
        advanced: false,
        hidden: false,
        payloadPath: modeMedia.fieldPath,
      }),
      name: modeMedia.id,
      label: modeMedia.label
        ? localizeVideoText(modeMedia.label, locale)
        : (matchingField?.label ?? modeMedia.id),
      required: modeMedia.minItems > 0,
      hidden: false,
      acceptMultiple: modeMedia.maxItems !== 1,
      acceptUrl: modeMedia.acceptedSources.includes("url"),
      mediaKind: modeMedia.mediaKind,
      minItems: modeMedia.minItems,
      maxItems: modeMedia.maxItems,
    }

    return { key: modeMedia.id, field, modeMedia }
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getInitialParamsForFields(fields: StudioVideoParameterField[]) {
  const initial: Record<string, unknown> = {}

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      initial[getVideoFieldKey(field)] = field.defaultValue
    }
  }

  return initial
}

function getStoredModelId(supported: StudioVideoModelOption[]) {
  return getPreferredStudioModelId("video", supported)
}

function isVideoGenerationPending(generation: StudioVideoGeneration) {
  return (
    generation.id.startsWith("pending-") ||
    generation.status === "queued" ||
    generation.status === "running" ||
    generation.status === "polling" ||
    (generation.status !== "error" && generation.outputs.length === 0)
  )
}

function getVideoOutputContentUrl(outputId: string, download = false) {
  const suffix = download ? "?download=1" : ""
  return `/api/studio/video-outputs/${encodeURIComponent(outputId)}/content${suffix}`
}

function getVideoOutputSrc(output: StudioVideoOutput) {
  return output.dataUrl ?? getVideoOutputContentUrl(output.id)
}

function StudioVideoWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioVideoWorkbenchProps) {
  const { locale } = useI18n()
  const copy = React.useMemo(() => getVideoCopy(locale), [locale])
  const [models, setModels] = React.useState<{
    supported: StudioVideoModelOption[]
    disabled: StudioVideoModelOption[]
  }>({ supported: [], disabled: [] })
  const [modelsLoading, setModelsLoading] = React.useState(true)
  const [modelsError, setModelsError] = React.useState("")
  const [modelRefreshNonce, setModelRefreshNonce] = React.useState(0)
  const [selectedModelId, setSelectedModelId] = useStudioFormDraftField(
    "video",
    sessionId,
    "model-id",
    ""
  )
  const [selectedOperationId, setSelectedOperationId] = useStudioFormDraftField(
    "video",
    sessionId,
    "operation-id",
    ""
  )
  const [prompt, setPrompt] = useStudioPromptDraft("video", sessionId)
  const [inputModeId, setInputModeId] = useStudioFormDraftField(
    "video",
    sessionId,
    "input-mode-id",
    ""
  )
  const [paramValues, setParamValues] = useStudioFormDraftField<
    Record<string, unknown>
  >("video", sessionId, "parameters", {})
  const [mediaByField, setMediaByField] = useStudioFormDraftField<
    Record<string, PendingReferenceImage[]>
  >("video", sessionId, "media-by-field", {}, { persist: false })
  const [referenceUrlByField, setReferenceUrlByField] = useStudioFormDraftField<
    Record<string, string>
  >("video", sessionId, "reference-url-by-field", {})
  const [showAdvanced, setShowAdvanced] = useStudioFormDraftField(
    "video",
    sessionId,
    "show-advanced",
    false
  )
  const [formContext, setFormContext] = useStudioFormDraftField(
    "video",
    sessionId,
    "form-context",
    ""
  )
  const formDraftReady = useStudioFormDraftReady(sessionId)
  const [submitError, setSubmitError] = React.useState("")
  const [generations, setGenerations] = React.useState<StudioVideoGeneration[]>(
    []
  )
  const generationsRef = React.useRef(generations)
  const pendingFormHydrationRef = React.useRef<StudioVideoGeneration | null>(
    null
  )
  const hasPendingGeneration = generations.some(isVideoGenerationPending)

  React.useEffect(() => {
    pendingFormHydrationRef.current = null
  }, [sessionId])

  React.useEffect(() => {
    generationsRef.current = generations
  }, [generations])

  const selectedModel = React.useMemo(
    () => models.supported.find((option) => option.id === selectedModelId),
    [models.supported, selectedModelId]
  )

  const selectedOperation = React.useMemo(() => {
    const operations = selectedModel?.operations ?? []
    const matched = operations.find(
      (operation) => operation.id === selectedOperationId
    )

    if (matched) {
      return matched
    }

    if (operations[0]) {
      return operations[0]
    }

    if (selectedModel?.openapi) {
      return {
        id: `${selectedModel.openapi.file}#${selectedModel.openapi.operationId}`,
        label: selectedModel.label,
        openapi: selectedModel.openapi,
        fields: selectedModel.fields,
      }
    }

    return null
  }, [selectedModel, selectedOperationId])

  const fields = selectedOperation?.fields ?? []
  const selectedOpenapi = selectedOperation?.openapi ?? null
  const profile = selectedOpenapi?.profile ?? null
  const inputMode = profile ? getVideoInputMode(profile, inputModeId) : null
  const promptField = fields.find(
    (field) => field.name === "prompt" || field.name === "text"
  )
  const mediaControls = buildVideoMediaControls({
    fields,
    inputMode,
    explicit: Boolean(profile?.explicit),
    locale,
  })
  const missingRequiredImageField = mediaControls.some(
    ({ field, key }) => field.required && !mediaByField[key]?.length
  )
  const promptRequired =
    inputMode?.promptRequired ?? Boolean(promptField?.required)
  const promptAllowed = inputMode?.promptAllowed !== false
  const parameterRuleResult = profile
    ? evaluateVideoParameterRules({
        profile,
        modeId: inputMode?.id,
        params: paramValues,
        context: { model: selectedOpenapi?.modelConstant },
        locale,
      })
    : {
        params: paramValues,
        omittedFields: new Set<string>(),
        fixedFields: new Set<string>(),
        requiredFields: new Set<string>(),
        allowedValues: new Map<string, Array<string | number | boolean>>(),
        ranges: new Map<string, { min?: number; max?: number }>(),
        errors: [],
      }
  const effectiveParamValues = parameterRuleResult.params
  const isParameterFieldOmitted = (field: StudioVideoParameterField) =>
    parameterRuleResult.omittedFields.has(getVideoFieldKey(field))
  const effectiveParameterField = (field: StudioVideoParameterField) => {
    const allowed = parameterRuleResult.allowedValues.get(getVideoFieldKey(field))
    const range = parameterRuleResult.ranges.get(getVideoFieldKey(field))

    if ((!allowed || !field.options) && !range) {
      return field
    }

    return {
      ...field,
      ...(allowed && field.options
        ? {
            options: field.options.filter((option) =>
              allowed.some((value) => String(value) === option.value)
            ),
          }
        : {}),
      ...(range?.min === undefined ? {} : { min: range.min }),
      ...(range?.max === undefined ? {} : { max: range.max }),
    }
  }
  const missingRequiredParamField = fields.some((field) => {
    if (
      (!field.required &&
        !parameterRuleResult.requiredFields.has(getVideoFieldKey(field))) ||
      field.hidden ||
      isParameterFieldOmitted(field) ||
      field.kind === "image" ||
      field.name === "prompt" ||
      field.name === "text" ||
      field.name === "model"
    ) {
      return false
    }

    const value = effectiveParamValues[getVideoFieldKey(field)]
    return value === undefined || value === null || value === ""
  })
  const modeValidationError = profile
    ? validateVideoModeMedia({
        profile,
        modeId: inputMode?.id,
        mediaCounts: Object.fromEntries(
          Object.entries(mediaByField).map(([key, values]) => [key, values.length])
        ),
        locale,
      })[0] ?? null
    : null
  const parameterValidationError = parameterRuleResult.errors[0] ?? null
  const constraintValidationError = profile
    ? validateVideoConstraints({
        profile,
        modeId: inputMode?.id,
        params: effectiveParamValues,
        mediaCounts: Object.fromEntries(
          Object.entries(mediaByField).map(([key, values]) => [key, values.length])
        ),
        context: {
          model: selectedOpenapi?.modelConstant,
          "input.prompt": prompt.trim(),
          "input.text": prompt.trim(),
        },
        locale,
      })[0] ?? null
    : null
  let structuredValidationError: string | null = null
  if (inputMode) {
    try {
      serializeVideoStructuredFields({
        inputMode,
        params: effectiveParamValues,
      })
    } catch (error) {
      structuredValidationError =
        error instanceof Error ? error.message : copy.submitFailed
    }
  }

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setModelsLoading(true)
      setModelsError("")

      fetchStudioModelsWithCache("video", fetchVideoModels, {
        force: modelRefreshNonce > 0,
      })
        .then((data) => {
          if (cancelled) return
          setModels(data)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setModelsError(
            error instanceof Error ? error.message : copy.modelsFailed
          )
        })
        .finally(() => {
          if (!cancelled) {
            setModelsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [copy.modelsFailed, modelRefreshNonce])

  React.useEffect(() => {
    if (models.supported.length === 0) return

    setSelectedModelId((current) =>
      models.supported.some((option) => option.id === current)
        ? current
        : getStoredModelId(models.supported)
    )
  }, [models.supported, setSelectedModelId])

  React.useEffect(() => {
    function handleProjectChanged() {
      setModelRefreshNonce((value) => value + 1)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [])

  React.useEffect(() => {
    const operations = selectedModel?.operations ?? []
    queueMicrotask(() => {
      setSelectedOperationId((current) =>
        operations.some((operation) => operation.id === current)
          ? current
          : (operations[0]?.id ?? "")
      )
    })
  }, [selectedModel, setSelectedOperationId])

  React.useEffect(() => {
    if (!formDraftReady || !selectedOperation) return

    const nextContext = `${selectedModel?.id ?? ""}:${selectedOperation.id}`
    const pendingHydration = pendingFormHydrationRef.current
    const pendingOperationId =
      pendingHydration?.openapiFile && pendingHydration.operationId
        ? `${pendingHydration.openapiFile}#${pendingHydration.operationId}`
        : null

    if (
      pendingHydration &&
      pendingHydration.modelSquareId === selectedModel?.id &&
      pendingOperationId === selectedOperation.id
    ) {
      pendingFormHydrationRef.current = null
      const storedInputMode =
        pendingHydration.params?.[STUDIO_VIDEO_INPUT_MODE_PARAM]
      queueMicrotask(() => {
        setPrompt(pendingHydration.prompt)
        setParamValues(pendingHydration.params ?? {})
        setInputModeId(
          typeof storedInputMode === "string" ? storedInputMode : ""
        )
        setMediaByField({})
        setReferenceUrlByField({})
        setFormContext(nextContext)
      })
      return
    }

    if (formContext === nextContext) return

    const next = getInitialParamsForFields(selectedOperation.fields)
    const nextMode = getVideoInputMode(
      selectedOperation.openapi.profile,
      undefined
    )
    queueMicrotask(() => {
      setParamValues(next)
      setInputModeId(nextMode?.id ?? "")
      setMediaByField({})
      setReferenceUrlByField({})
      setFormContext(nextContext)
    })
  }, [
    formContext,
    formDraftReady,
    selectedModel?.id,
    selectedOperation,
    setFormContext,
    setInputModeId,
    setMediaByField,
    setParamValues,
    setPrompt,
    setReferenceUrlByField,
  ])

  React.useEffect(() => {
    if (typeof window === "undefined" || !selectedModelId) return
    saveSelectedStudioModel("video", selectedModelId)
  }, [selectedModelId])

  const reloadGenerations = React.useCallback(
    async (
      activeSessionId: string,
      options: { clearOnError?: boolean } = {}
    ) => {
      try {
        const next = await fetchVideoGenerations(activeSessionId)
        setGenerations(next)
      } catch {
        if (options.clearOnError ?? true) {
          setGenerations([])
        }
      }
    },
    []
  )

  React.useEffect(() => {
    if (!sessionId) {
      queueMicrotask(() => setGenerations([]))
      return
    }
    queueMicrotask(() => {
      void reloadGenerations(sessionId)
    })
  }, [sessionId, reloadGenerations])

  React.useEffect(() => {
    if (!sessionId || !hasPendingGeneration) {
      return
    }

    const interval = window.setInterval(() => {
      if (!generationsRef.current.some(isVideoGenerationPending)) {
        return
      }
      void reloadGenerations(sessionId, { clearOnError: false })
    }, 5_000)

    return () => window.clearInterval(interval)
  }, [hasPendingGeneration, sessionId, reloadGenerations])

  function updateParam(field: StudioVideoParameterField, value: unknown) {
    const coercedValue = coerceFieldValue(field, value)
    setParamValues((current) => ({
      ...current,
      [getVideoFieldKey(field)]: coercedValue ?? value,
    }))
  }

  async function addLocalFiles(
    field: StudioVideoParameterField,
    files: FileList | null,
    fieldKey = getVideoFieldKey(field),
    modeMedia?: StudioVideoModeMediaField | null
  ) {
    if (!files || files.length === 0) return
    const maxFiles = getMaxReferenceImages(
      field,
      modeMedia ?? getVideoModeMediaField(inputMode, field.payloadPath)
    )
    const maxBytes = modeMedia?.maxBytes ?? MAX_REFERENCE_BYTES
    const mediaKind = modeMedia?.mediaKind ?? field.mediaKind ?? "image"
    const acceptsFile = modeMedia?.acceptedSources.includes("file") ?? true
    if (!acceptsFile) return
    const imageFiles = Array.from(files).filter(
      (file) => {
        const matchesKind =
          mediaKind === "mixed" || file.type.startsWith(`${mediaKind}/`)
        const matchesMime =
          !modeMedia?.mimeTypes?.length ||
          modeMedia.mimeTypes.includes(file.type)

        return matchesKind && matchesMime && file.size <= maxBytes
      }
    ).slice(0, maxFiles)

    if (imageFiles.length === 0) return

    const next: PendingReferenceImage[] = await Promise.all(
      imageFiles.map(async (file) => ({
        id: createClientId(),
        name: file.name,
        mimeType: file.type,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )

    setMediaByField((current) =>
      {
        const existing = current[fieldKey] ?? []
        return {
          ...current,
          [fieldKey]: [...existing, ...next].slice(0, maxFiles),
        }
      }
    )
  }

  function addUrlAttachment(
    field: StudioVideoParameterField,
    fieldKey = getVideoFieldKey(field),
    modeMedia?: StudioVideoModeMediaField | null
  ) {
    if (modeMedia && !modeMedia.acceptedSources.includes("url")) return
    const trimmed = referenceUrlByField[fieldKey]?.trim() ?? ""
    if (!trimmed) return
    setMediaByField((current) => {
      const existing = current[fieldKey] ?? []
      return {
        ...current,
        [fieldKey]: [
          ...existing,
          {
            id: createClientId(),
            name: trimmed,
            mimeType: `${modeMedia?.mediaKind ?? field.mediaKind ?? "mixed"}/url`,
            url: trimmed,
          },
        ].slice(
          0,
          getMaxReferenceImages(
            field,
            modeMedia ?? getVideoModeMediaField(inputMode, field.payloadPath)
          )
        ),
      }
    })
    setReferenceUrlByField((current) => ({ ...current, [fieldKey]: "" }))
  }

  function removeAttachment(
    field: StudioVideoParameterField,
    id: string,
    fieldKey = getVideoFieldKey(field)
  ) {
    setMediaByField((current) => ({
      ...current,
      [fieldKey]: (current[fieldKey] ?? []).filter(
        (attachment) => attachment.id !== id
      ),
    }))
  }

  async function handleSubmit() {
    if (
      !selectedModel ||
      !selectedOpenapi ||
      (promptRequired && !prompt.trim()) ||
      missingRequiredImageField ||
      missingRequiredParamField ||
      modeValidationError ||
      parameterValidationError ||
      constraintValidationError ||
      structuredValidationError
    ) {
      return
    }

    setSubmitError("")

    const optimisticId = `pending-${createClientId()}`
    const promptText = prompt.trim()
    const promptInputMode = inputMode?.id
    const promptModel = selectedModel
    const promptOpenapi = selectedOpenapi
    const promptParams = effectiveParamValues
    const promptMediaByField = mediaByField
    const isNewSession = !sessionId

    const optimistic: StudioVideoGeneration = {
      id: optimisticId,
      sessionId,
      modelSquareId: promptModel.id,
      modelName: promptModel.name,
      manufacturer: promptModel.manufacturer,
      openapiFile: promptOpenapi.file,
      operationId: promptOpenapi.operationId,
      providerTaskId: null,
      providerRequestId: null,
      prompt: promptText,
      params: promptParams,
      status: "running",
      phase: "submitting",
      progress: 0,
      rawStatus: null,
      attempt: 0,
      lastPolledAt: null,
      nextPollAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      outputs: [],
    }

    setGenerations((current) => [...current, optimistic])
    setMediaByField({})
    setReferenceUrlByField({})

    void (async () => {
      try {
        let activeSessionId = sessionId
        if (!activeSessionId) {
          const session = await createVideoSession(
            getFallbackVideoTitle(promptText)
          )
          activeSessionId = session.id
          moveStudioFormDraft("video", "", activeSessionId)
          onSessionChange(activeSessionId)
          onSessionsChange()
        }

        if (isNewSession) {
          void generateSessionTitle(activeSessionId, promptText)
            .then(() => onSessionsChange())
            .catch(() => {
              // Keep the prompt-based fallback title on failure.
            })
        }

        const result = await submitVideoGeneration({
          sessionId: activeSessionId,
          modelId: promptModel.id,
          modelName: promptModel.name,
          prompt: promptText,
          inputMode: promptInputMode,
          params: promptParams,
          openapi: promptOpenapi,
          mediaByField: promptMediaByField,
        })

        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId ? result : generation
          )
        )
        onSessionsChange()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : copy.submitFailed
        setSubmitError(message)
        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId
              ? { ...generation, status: "error", errorMessage: message }
              : generation
          )
        )
      }
    })()
  }

  function loadOutputIntoForm(generation: StudioVideoGeneration) {
    if (
      !models.supported.some((option) => option.id === generation.modelSquareId)
    ) {
      return
    }
    const nextOperationId =
      generation.openapiFile && generation.operationId
        ? `${generation.openapiFile}#${generation.operationId}`
        : null

    if (
      generation.modelSquareId === selectedModel?.id &&
      nextOperationId === selectedOperation?.id
    ) {
      const storedInputMode = generation.params?.[STUDIO_VIDEO_INPUT_MODE_PARAM]
      setPrompt(generation.prompt)
      setParamValues(generation.params ?? {})
      setInputModeId(typeof storedInputMode === "string" ? storedInputMode : "")
      return
    }

    pendingFormHydrationRef.current = generation
    setSelectedModelId(generation.modelSquareId)
    if (nextOperationId) {
      setSelectedOperationId(nextOperationId)
    }
  }

  function downloadOutput(output: StudioVideoOutput) {
    const href = output.dataUrl ?? getVideoOutputContentUrl(output.id, true)
    if (!href) return
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `video-${output.id}.mp4`
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  return (
    <section className={studioMediaWorkbenchShellClassName}>
      <aside className={studioMediaWorkbenchSidebarClassName}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {copy.model}
          </label>
          <Select
            value={selectedModelId}
            onValueChange={(value) => setSelectedModelId(value)}
            disabled={modelsLoading || models.supported.length === 0}
          >
            <SelectTrigger className="w-full rounded-2xl">
              <SelectValue
                placeholder={
                  modelsLoading
                    ? copy.modelsLoading
                    : copy.modelPlaceholder
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {models.supported.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : null}
        </div>

        {selectedModel && (selectedModel.operations?.length ?? 0) > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {copy.operation}
            </span>
            <Select
              value={selectedOperation?.id ?? ""}
              onValueChange={setSelectedOperationId}
            >
              <SelectTrigger className="w-full rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {selectedModel.operations.map((operation) => (
                    <SelectItem key={operation.id} value={operation.id}>
                      {operation.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {profile && profile.modes.length > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {copy.inputMode}
            </span>
            <Select
              value={inputMode?.id ?? ""}
              onValueChange={(value) => {
                setInputModeId(value)
                setMediaByField({})
                setReferenceUrlByField({})
                const nextMode = getVideoInputMode(profile, value)
                if (nextMode?.promptAllowed === false) {
                  setPrompt("")
                }
              }}
            >
              <SelectTrigger className="w-full rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {profile.modes.map((mode) => (
                    <SelectItem
                      key={mode.id}
                      value={mode.id}
                      disabled={mode.available === false}
                    >
                      {localizeVideoText(mode.label, locale)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {inputMode?.description ? (
              <p className="text-xs text-muted-foreground">
                {localizeVideoText(inputMode.description, locale)}
              </p>
            ) : null}
          </div>
        ) : null}

        {promptAllowed ? (
        <div className="mt-4 flex flex-col gap-1.5">
          {promptField ? (
            <ParameterLabel field={promptField} label={copy.prompt} />
          ) : (
            <label className="text-xs font-medium text-muted-foreground">
              {copy.prompt}
            </label>
          )}
          <Textarea
            id="studio-video-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={copy.promptPlaceholder}
            className="min-h-24 resize-none rounded-2xl"
          />
        </div>
        ) : null}

        {mediaControls.map(({ field, key: fieldKey, modeMedia }) => {
          return (
            <ReferenceImagesField
              key={fieldKey}
              attachments={mediaByField[fieldKey] ?? []}
              referenceUrl={referenceUrlByField[fieldKey] ?? ""}
              onUrlChange={(value) =>
                setReferenceUrlByField((current) => ({
                  ...current,
                  [fieldKey]: value,
                }))
              }
              onAddUrl={() => addUrlAttachment(field, fieldKey, modeMedia)}
              onAddFiles={(files) =>
                addLocalFiles(field, files, fieldKey, modeMedia)
              }
              onRemove={(id) => removeAttachment(field, id, fieldKey)}
              field={field}
              modeMedia={modeMedia}
            />
          )
        })}

        {inputMode?.structuredFields.map((field) => {
          const fieldKey = field.fieldPath.join(".")
          return (
            <div key={field.id} className="mt-4 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {localizeVideoText(field.label, locale)}
              </span>
              <Textarea
                value={
                  typeof effectiveParamValues[fieldKey] === "string"
                    ? effectiveParamValues[fieldKey]
                    : ""
                }
                onChange={(event) =>
                  setParamValues((current) => ({
                    ...current,
                    [fieldKey]: event.target.value,
                  }))
                }
                placeholder={field.placeholder}
                className="min-h-28 resize-y rounded-2xl font-mono text-xs"
              />
              {field.description ? (
                <p className="text-xs text-muted-foreground">
                  {localizeVideoText(field.description, locale)}
                </p>
              ) : null}
            </div>
          )
        })}

        <div className="mt-4 flex flex-col gap-3">
          {fields
            .filter((field) => !field.advanced && !field.hidden)
            .filter((field) => !isParameterFieldOmitted(field))
            .filter(
              (field) =>
                field.name !== "prompt" &&
                field.name !== "text" &&
                field.name !== "model" &&
                field.kind !== "image"
            )
            .map((field) => (
              <ParameterControl
                key={getVideoFieldKey(field)}
                field={effectiveParameterField(field)}
                value={effectiveParamValues[getVideoFieldKey(field)]}
                onChange={(value) => updateParam(field, value)}
                disabled={parameterRuleResult.fixedFields.has(
                  getVideoFieldKey(field)
                )}
              />
            ))}
        </div>

        {fields.some((field) => field.advanced && !field.hidden) ? (
          <div className="mt-3 flex flex-col gap-3 border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? copy.advancedHide : copy.advanced}
            </button>
            {showAdvanced
              ? fields
                  .filter((field) => field.advanced && !field.hidden)
                  .filter((field) => !isParameterFieldOmitted(field))
                  .filter((field) => field.kind !== "image")
                  .map((field) => (
                    <ParameterControl
                      key={getVideoFieldKey(field)}
                      field={effectiveParameterField(field)}
                      value={effectiveParamValues[getVideoFieldKey(field)]}
                      onChange={(value) => updateParam(field, value)}
                      disabled={parameterRuleResult.fixedFields.has(
                        getVideoFieldKey(field)
                      )}
                    />
                  ))
              : null}
          </div>
        ) : null}

        {submitError ? (
          <p className="mt-3 text-xs text-destructive">{submitError}</p>
        ) : null}

        {modeValidationError ? (
          <p className="mt-3 text-xs text-destructive">
            {modeValidationError.message}
          </p>
        ) : null}
        {constraintValidationError ? (
          <p className="text-destructive text-sm">
            {constraintValidationError.message}
          </p>
        ) : null}

        {parameterValidationError ? (
          <p className="mt-3 text-xs text-destructive">
            {parameterValidationError}
          </p>
        ) : null}

        {structuredValidationError ? (
          <p className="mt-3 text-xs text-destructive">
            {structuredValidationError}
          </p>
        ) : null}

        <Button
          type="button"
          className="mt-4 h-10 rounded-2xl"
          onClick={handleSubmit}
          disabled={
            !selectedModel ||
            !selectedOpenapi ||
            (promptRequired && !prompt.trim()) ||
            missingRequiredImageField ||
            missingRequiredParamField ||
            Boolean(modeValidationError) ||
            Boolean(parameterValidationError) ||
            Boolean(constraintValidationError) ||
            Boolean(structuredValidationError) ||
            models.supported.length === 0
          }
        >
          <span>{copy.generate}</span>
        </Button>
      </aside>

      <div className={studioMediaWorkbenchCanvasClassName}>
        <OutputCanvas
          generations={generations}
          onSelectGeneration={loadOutputIntoForm}
          onDownloadOutput={downloadOutput}
        />
      </div>
    </section>
  )
}

type ParameterControlProps = {
  field: StudioVideoParameterField
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

type ParameterLabelProps = {
  field: StudioVideoParameterField
  label?: string
  className?: string
}

function ParameterLabel({ field, label, className }: ParameterLabelProps) {
  const description = field.description?.trim()

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate text-xs font-medium text-muted-foreground">
        {label ?? field.label}
      </span>
      {description ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3"
              aria-label={`${label ?? field.label} description`}
            >
              <RiQuestionLine aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="max-h-[min(60vh,22rem)] w-72 gap-2 overflow-y-auto rounded-2xl p-3 text-xs leading-relaxed"
          >
            <p className="font-medium text-foreground">
              {label ?? field.label}
            </p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {description}
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

function ParameterControl({
  field,
  value,
  onChange,
  disabled,
}: ParameterControlProps) {
  if (field.kind === "boolean") {
    const next = Boolean(value)
    return (
      <div className="flex items-center justify-between gap-2">
        <ParameterLabel field={field} />
        <Toggle
          pressed={next}
          onPressedChange={(pressed) => onChange(pressed)}
          disabled={disabled}
          className="rounded-2xl"
        >
          {next ? "ON" : "OFF"}
        </Toggle>
      </div>
    )
  }

  if (field.kind === "select" && field.options && field.options.length > 0) {
    const noneSentinel = "__none__"
    const selected =
      value !== undefined && value !== null && value !== ""
        ? String(value)
        : noneSentinel
    const canClear = !field.required
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Select
          value={selected}
          onValueChange={(next) => onChange(next === noneSentinel ? "" : next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full rounded-2xl">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            {canClear ? (
              <SelectItem value={noneSentinel}>—</SelectItem>
            ) : null}
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.kind === "slider") {
    const min = field.min ?? 0
    const max = field.max ?? 100
    const step = field.step ?? 1
    const numeric =
      typeof value === "number"
        ? value
        : Number(value ?? field.defaultValue ?? min)
    const safe = Number.isFinite(numeric) ? numeric : min
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <ParameterLabel field={field} />
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={safe}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-7 w-20 rounded-xl text-xs"
            disabled={disabled}
          />
        </div>
        <Slider
          min={min}
          max={max}
          step={step}
          value={[safe]}
          onValueChange={(next) => onChange(next[0])}
          disabled={disabled}
        />
      </div>
    )
  }

  if (field.kind === "number") {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? value : ""
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Input
          type="number"
          value={numeric as number | string}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="h-9 rounded-2xl"
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ParameterLabel field={field} />
      <SuggestedTextInput
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        suggestions={field.suggestedValues}
        disabled={disabled}
      />
    </div>
  )
}

function SuggestedTextInput({
  disabled,
  onChange,
  suggestions,
  value,
}: {
  disabled?: boolean
  onChange: (value: string) => void
  suggestions?: StudioVideoParameterField["suggestedValues"]
  value: string
}) {
  const [open, setOpen] = React.useState(false)
  const options = suggestions ?? []

  if (options.length === 0) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-2xl"
        disabled={disabled}
      />
    )
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-2xl pr-10"
        disabled={disabled}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            aria-label="Show suggested values"
            disabled={disabled}
          >
            <RiArrowDownSLine aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-48 overflow-hidden rounded-2xl p-1"
        >
          <div className="max-h-56 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex h-8 w-full items-center rounded-xl px-2 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  value === option.value && "bg-muted font-medium"
                )}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

type ReferenceImagesFieldProps = {
  attachments: PendingReferenceImage[]
  referenceUrl: string
  onUrlChange: (value: string) => void
  onAddUrl: () => void
  onAddFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
  field?: StudioVideoParameterField
  modeMedia?: StudioVideoModeMediaField | null
  disabled?: boolean
}

function ReferenceImagesField({
  attachments,
  referenceUrl,
  onUrlChange,
  onAddUrl,
  onAddFiles,
  onRemove,
  field,
  modeMedia,
  disabled,
}: ReferenceImagesFieldProps) {
  const { locale, t } = useI18n()
  const copy = getVideoCopy(locale)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const maxFiles = field
    ? getMaxReferenceImages(field, modeMedia)
    : MAX_REFERENCE_IMAGES
  const acceptUrl = modeMedia
    ? modeMedia.acceptedSources.includes("url")
    : field?.acceptUrl !== false
  const acceptFiles = modeMedia
    ? modeMedia.acceptedSources.includes("file")
    : true
  const fileAccept = modeMedia?.mimeTypes?.length
    ? modeMedia.mimeTypes.join(",")
    : modeMedia?.mediaKind && modeMedia.mediaKind !== "mixed"
      ? `${modeMedia.mediaKind}/*`
      : "image/*,video/*,audio/*"

  return (
    <div className="mt-4 flex flex-col gap-2">
      {field ? (
        <ParameterLabel field={field} />
      ) : (
        <span className="text-xs font-medium text-muted-foreground">
          {copy.references}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="group relative size-16 overflow-hidden rounded-2xl border bg-muted"
          >
            {attachment.dataUrl && attachment.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex h-full items-center justify-center px-1 text-[10px] text-muted-foreground">
                URL
              </span>
            )}
            <button
              type="button"
              className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition group-hover:opacity-100 [&_svg]:size-3.5"
              onClick={() => onRemove(attachment.id)}
              aria-label={t.studioRemoveAttachment}
              disabled={disabled}
            >
              <RiCloseLine aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {acceptFiles ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={fileAccept}
              multiple={field?.acceptMultiple ?? true}
              className="hidden"
              onChange={(event) => {
                onAddFiles(event.target.files)
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-2xl"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attachments.length >= maxFiles}
            >
              <RiAddLine aria-hidden />
              <span>{copy.attach}</span>
            </Button>
          </>
        ) : null}
      </div>
      {acceptUrl ? (
        <div className="flex gap-2">
          <Input
            value={referenceUrl}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder={copy.referenceUrl}
            className="h-9 rounded-2xl"
            disabled={disabled || attachments.length >= maxFiles}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-2xl"
            onClick={onAddUrl}
            disabled={
              disabled ||
              !referenceUrl.trim() ||
              attachments.length >= maxFiles
            }
          >
            {copy.addUrl}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

type CanvasTile =
  | {
      kind: "output"
      key: string
      generation: StudioVideoGeneration
      output: StudioVideoOutput
    }
  | {
      kind: "pending"
      key: string
      generation: StudioVideoGeneration
    }
  | {
      kind: "error"
      key: string
      generation: StudioVideoGeneration
    }

function buildCanvasTiles(generations: StudioVideoGeneration[]): CanvasTile[] {
  const tiles: CanvasTile[] = []

  for (const generation of generations) {
    if (generation.outputs.length === 0) {
      if (
        generation.status === "queued" ||
        generation.status === "running" ||
        generation.status === "polling"
      ) {
        tiles.push({
          kind: "pending",
          key: `pending-${generation.id}`,
          generation,
        })
      } else if (generation.status === "error") {
        tiles.push({
          kind: "error",
          key: `error-${generation.id}`,
          generation,
        })
      }
      continue
    }

    for (const output of generation.outputs) {
      tiles.push({
        kind: "output",
        key: output.id,
        generation,
        output,
      })
    }
  }

  return tiles
}

function getOutputGridClassName(count: number) {
  if (count <= 1) {
    return "max-w-5xl grid-cols-1"
  }

  if (count === 2) {
    return "max-w-6xl grid-cols-1 xl:grid-cols-2"
  }

  return "max-w-7xl grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3"
}

type OutputCanvasProps = {
  generations: StudioVideoGeneration[]
  onSelectGeneration: (generation: StudioVideoGeneration) => void
  onDownloadOutput: (output: StudioVideoOutput) => void
}

function OutputCanvas({
  generations,
  onSelectGeneration,
  onDownloadOutput,
}: OutputCanvasProps) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const tiles = React.useMemo(
    () => buildCanvasTiles(generations),
    [generations]
  )

  if (tiles.length === 0) {
    return (
      <div className={studioMediaEmptyStateClassName}>
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto grid w-full gap-4 pb-4",
          getOutputGridClassName(tiles.length)
        )}
      >
        {tiles.map((tile) =>
          tile.kind === "output" ? (
            <CanvasOutputTile
              key={tile.key}
              generation={tile.generation}
              output={tile.output}
              onSelect={() => onSelectGeneration(tile.generation)}
              onDownload={() => onDownloadOutput(tile.output)}
            />
          ) : tile.kind === "error" ? (
            <CanvasErrorTile
              key={tile.key}
              generation={tile.generation}
              onSelect={() => onSelectGeneration(tile.generation)}
            />
          ) : (
            <CanvasPendingTile
              key={tile.key}
              generation={tile.generation}
            />
          )
        )}
      </div>
    </div>
  )
}

type CanvasOutputTileProps = {
  generation: StudioVideoGeneration
  output: StudioVideoOutput
  onSelect: () => void
  onDownload: () => void
}

function CanvasOutputTile({
  generation,
  output,
  onSelect,
  onDownload,
}: CanvasOutputTileProps) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const src = getVideoOutputSrc(output)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const loaded = loadedSrc === src
  const failed = failedSrc === src

  return (
    <div className="group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-muted shadow-sm">
      <div
        onDoubleClick={onSelect}
        className="relative aspect-video min-h-64 overflow-hidden bg-black"
      >
        {!loaded && !failed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
              <div className="size-10 animate-pulse rounded-full border bg-background" />
              <p className="max-w-48 truncate font-mono text-[10px]">
                {output.id}
              </p>
            </div>
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
            <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
              <RiErrorWarningLine
                className="size-8 text-destructive"
                aria-hidden
              />
              <p className="text-xs">{copy.mediaFailed}</p>
            </div>
          </div>
        ) : null}
        {src && !failed ? (
          <VideoPlayer
            src={src}
            aria-label={generation.prompt}
            autoHide={false}
            className={cn(
              "size-full rounded-none transition-opacity",
              loaded ? "opacity-100" : "opacity-0"
            )}
            onLoadedData={() => setLoadedSrc(src)}
            onLoadedMetadata={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
            playsInline
            preload="metadata"
            size="full"
          />
        ) : null}
      </div>

      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-2 text-white">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-xs font-medium">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-white/75">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>

      <MediaOutputActions
        tone="overlay"
        className="absolute top-12 right-2"
        downloadLabel={copy.download}
        stopPropagation
        onDownload={onDownload}
      />
    </div>
  )
}

function CanvasPendingTile({
  generation,
}: {
  generation: StudioVideoGeneration
}) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)

  return (
    <div className="relative flex aspect-video min-h-64 flex-col overflow-hidden rounded-2xl border border-primary/20 bg-card text-foreground shadow-sm">
      <div className="absolute inset-0 animate-pulse bg-muted/50" />
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full border bg-background shadow-sm">
            <RiLoader4Line
              className="size-9 animate-spin text-primary"
              aria-hidden
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium">{copy.generatingTitle}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {generation.prompt}
            </p>
            <p className="text-xs text-muted-foreground">
              {copy.generatingHint}
            </p>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/30 to-transparent p-2 text-xs">
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-medium text-foreground">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>
    </div>
  )
}

function CanvasErrorTile({
  generation,
  onSelect,
}: {
  generation: StudioVideoGeneration
  onSelect: () => void
}) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const message = generation.errorMessage?.trim() || copy.errorFallback

  return (
    <div
      onDoubleClick={onSelect}
      className="relative flex aspect-video min-h-64 flex-col overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5 text-foreground shadow-sm"
    >
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full border border-destructive/30 bg-background text-destructive shadow-sm">
            <RiErrorWarningLine className="size-9" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2">
            <p className="text-sm font-medium text-destructive">
              {copy.errorTitle}
            </p>
            <p className="line-clamp-2 max-w-full text-xs text-muted-foreground">
              {generation.prompt}
            </p>
            <p className="max-h-28 max-w-full overflow-y-auto break-words rounded-xl border border-destructive/20 bg-background/80 px-3 py-2 text-xs leading-relaxed text-destructive">
              {message}
            </p>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 bg-gradient-to-b from-background/90 to-transparent p-2 text-xs">
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-medium text-foreground">
            {generation.prompt}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {generation.modelName}
          </p>
        </div>
        <StatusBadge generation={generation} />
      </div>
    </div>
  )
}

function StatusBadge({ generation }: { generation: StudioVideoGeneration }) {
  const { locale } = useI18n()
  const copy = getVideoCopy(locale)
  const labelMap: Record<StudioVideoGeneration["status"], string> = {
    queued: copy.queued,
    running: copy.running,
    polling: copy.running,
    complete: copy.complete,
    partial: copy.complete,
    error: copy.failed,
    cancelled: copy.failed,
  }
  return (
    <MediaStatusBadge
      status={generation.status}
      label={labelMap[generation.status]}
    />
  )
}

export { StudioVideoWorkbench }
