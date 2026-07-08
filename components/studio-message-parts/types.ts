import type { StudioMessagePart } from "@/lib/studio-types"

export type StudioPermissionPart = Extract<StudioMessagePart, { type: "permission" }>
export type StudioPermissionStatus = StudioPermissionPart["status"]
export type StudioUserInputPart = Extract<StudioMessagePart, { type: "user_input" }>
export type StudioUserInputStatus = StudioUserInputPart["status"]
export type StudioSubagentPart = Extract<StudioMessagePart, { type: "subagent" }>
export type StudioFilePart = Extract<StudioMessagePart, { type: "file" }>
export type StudioMediaGenerationPart = Extract<
  StudioMessagePart,
  { type: "media_generation" }
>
export type StudioFileGroupPart = {
  id: string
  type: "file_group"
  files: StudioFilePart[]
}
export type RenderableStudioMessagePart = StudioMessagePart | StudioFileGroupPart

export type MessageRenderEnvironment = "remote" | "local"
