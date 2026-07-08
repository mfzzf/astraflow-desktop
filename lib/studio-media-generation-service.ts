export type {
  StudioMediaAttachment,
  StudioMediaReference,
  StudioMediaOutputResult,
  GenerateStudioImageInput,
  GenerateStudioVideoInput,
} from "@/lib/studio-media-generation/shared"
export type { StudioImageGenerationResult } from "@/lib/studio-media-generation/image"
export type { StudioVideoGenerationResult } from "@/lib/studio-media-generation/video"
export { generateStudioImage } from "@/lib/studio-media-generation/image"
export {
  resumeStudioVideoGeneration,
  scheduleStudioVideoGenerationResume,
  scheduleStudioVideoGenerationResumesForSession,
  submitStudioVideoGeneration,
} from "@/lib/studio-media-generation/video"
export { formatMediaGenerationResult } from "@/lib/studio-media-generation/image"
