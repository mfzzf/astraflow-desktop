import type {
  StudioImageFieldOption,
  StudioImageParameterField,
} from "@/lib/studio-types"

export type StudioVideoAdapter = "async-task" | "openai-video"

export type StudioVideoLocalizedText = {
  en: string
  zh: string
}

export type StudioVideoPrimitive = string | number | boolean

export type StudioVideoParameterRuleAction =
  | {
      kind: "set"
      fieldPath: string[]
      value: StudioVideoPrimitive
    }
  | {
      kind: "omit"
      fieldPath: string[]
    }
  | {
      kind: "required"
      fieldPath: string[]
    }
  | {
      kind: "allowed-values"
      fieldPath: string[]
      values: StudioVideoPrimitive[]
    }
  | {
      kind: "range"
      fieldPath: string[]
      min?: number
      max?: number
    }

export type StudioVideoMediaSerializer =
  | "direct-url"
  | "url-array"
  | "tagged-content-array"
  | "array-object"
  | "base64-object"
  | "raw-base64-or-url"
  | "multipart-file"

export type StudioVideoMediaRoleStrategy =
  | { kind: "none" }
  | { kind: "repeat"; value: string }
  | { kind: "sequence"; values: string[] }

export type StudioVideoModeMediaField = {
  id: string
  fieldPath: string[]
  label?: StudioVideoLocalizedText
  mediaKind: "image" | "video" | "audio" | "mixed"
  serializer: StudioVideoMediaSerializer
  valueEncoding?: "raw-base64"
  acceptedSources: Array<"url" | "data-url" | "file">
  mimeTypes?: string[]
  maxBytes?: number
  contentType?: string
  contentPayloadKey?: string
  contentRoleKey?: string
  itemConstants?: Record<string, string | number | boolean>
  minItems: number
  maxItems?: number
  roles?: StudioVideoMediaRoleStrategy
}

export type StudioVideoStructuredField = {
  id: string
  fieldPath: string[]
  label: StudioVideoLocalizedText
  description?: StudioVideoLocalizedText
  required: boolean
  kind: "json"
  placeholder?: string
  schema?: Record<string, unknown>
  sum?: {
    itemFieldPath: string[]
    equalsFieldPath: string[]
  }
}

export type StudioVideoInputMode = {
  id: string
  label: StudioVideoLocalizedText
  description?: StudioVideoLocalizedText
  promptRequired?: boolean
  promptAllowed?: boolean
  available?: boolean
  unavailableReason?: StudioVideoLocalizedText
  maxInlinePayloadBytes?: number
  media: StudioVideoModeMediaField[]
  structuredFields: StudioVideoStructuredField[]
}

export type StudioVideoConstraint =
  | {
      kind: "mutually-exclusive-media-roles"
      fieldPath: string[]
      roles: string[]
      message?: StudioVideoLocalizedText
    }
  | {
      kind: "required-any"
      fieldPaths: string[][]
      message?: StudioVideoLocalizedText
    }
  | {
      kind: "requires"
      fieldPath: string[]
      requires: string[][]
      message?: StudioVideoLocalizedText
    }
  | {
      kind: "parameter-rule"
      modes?: string[]
      when?: {
        fieldPath: string[]
        equals: StudioVideoPrimitive
      }
      actions: StudioVideoParameterRuleAction[]
      message?: StudioVideoLocalizedText
    }

export type StudioVideoSubmitProtocol = {
  method: "POST"
  path: string
  contentType: "application/json" | "multipart/form-data"
  taskIdPath: string[]
  headers?: Record<string, string>
}

export type StudioVideoPollingProtocol = {
  method: "GET"
  path: string
  taskIdPlacement: "path" | "query"
  taskIdParameter: string
  statusPath: string[]
  successStatuses: string[]
  failureStatuses: string[]
  resultUrlsPath?: string[]
  contentPath?: string
}

export type StudioVideoModelProfile = {
  version: 1
  explicit: boolean
  defaultMode?: string
  modes: StudioVideoInputMode[]
  constraints: StudioVideoConstraint[]
  submit: StudioVideoSubmitProtocol
  polling: StudioVideoPollingProtocol
}

export type StudioVideoDisabledReason =
  "missing-openapi" | "unsupported-endpoint"

export type StudioVideoParameterField = StudioImageParameterField & {
  payloadPath: string[]
  valueType?: "string" | "integer" | "number" | "boolean" | "array" | "object"
  mediaKind?: "image" | "video" | "audio" | "mixed"
  mediaShape?:
    | "direct"
    | "content-item"
    | "array-object"
    | "object-base64"
    | "multipart-binary"
  mediaPayloadKey?: string
  mediaRoleKey?: string
  mediaRoleValues?: string[]
  minItems?: number
  maxItems?: number
}

export type StudioVideoOpenapiModelEntry = {
  file: string
  title: string
  operationId: string
  method: "POST"
  path: string
  statusPath: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioVideoAdapter
  modelValues: string[]
  profile: StudioVideoModelProfile
}

export type StudioVideoModelOpenapi = StudioVideoOpenapiModelEntry & {
  modelConstant: string
}

export type StudioVideoModelOperationOption = {
  id: string
  label: string
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
}

export type StudioVideoModelOption = {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
  supported: boolean
  disabledReason?: StudioVideoDisabledReason
  openapi?: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  operations: StudioVideoModelOperationOption[]
}

export type StudioVideoStatus =
  | "queued"
  | "running"
  | "polling"
  | "complete"
  | "partial"
  | "error"
  | "cancelled"

export type StudioVideoOutput = {
  id: string
  generationId: string
  index: number
  src: string
  url: string | null
  dataUrl: string | null
  storagePath: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  savedAt: string | null
  createdAt: string
}

export type StudioVideoGeneration = {
  id: string
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer: string | null
  openapiFile: string | null
  operationId: string | null
  providerTaskId: string | null
  providerRequestId: string | null
  prompt: string
  params: Record<string, unknown>
  status: StudioVideoStatus
  phase: string | null
  progress: number | null
  rawStatus: string | null
  attempt: number
  lastPolledAt: string | null
  nextPollAt: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  outputs: StudioVideoOutput[]
}

export type StudioSavedVideoOutput = {
  id: string
  generationId: string
  sessionId: string
  index: number
  prompt: string
  modelName: string
  manufacturer: string | null
  providerTaskId: string | null
  providerRequestId: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  storagePath: string | null
  savedAt: string
  createdAt: string
}

export type StudioVideoLibraryFile = StudioSavedVideoOutput & {
  kind: "video"
  src: string
  downloadUrl: string
  canOpenFolder: boolean
}

export type StudioVideoFieldOption = StudioImageFieldOption
