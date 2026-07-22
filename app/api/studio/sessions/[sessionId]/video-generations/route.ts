import { NextResponse } from "next/server"
import { z } from "zod"

import { CompShareEntitlementError } from "@/lib/compshare/entitlements"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { resolveModelProviderDataPlane } from "@/lib/model-provider-config"
import { getStudioSession } from "@/lib/studio-db"
import {
  scheduleStudioVideoGenerationResumesForSession,
  submitStudioVideoGeneration,
  type StudioMediaReference,
} from "@/lib/studio-media-generation-service"
import {
  listStudioVideoGenerations,
} from "@/lib/studio-video-db"
import type { StudioVideoGeneration } from "@/lib/studio-video-types"

export const runtime = "nodejs"
export const maxDuration = 3600

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

const paramsSchema = z.record(z.string(), z.unknown())

const mediaAttachmentSchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    mimeType: z.string().trim().max(120).optional(),
    dataUrl: z
      .string()
      .trim()
      .regex(/^data:(?:image|video|audio)\//i)
      .max(160_000_000)
      .optional(),
    url: z.string().trim().url().max(4_000).optional(),
  })
  .refine((value) => Boolean(value.dataUrl || value.url), {
    message: "Each attachment needs either dataUrl or url.",
  })

const mediaReferenceSchema: z.ZodType<StudioMediaReference> =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session_file"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("image_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("video_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("url"),
      url: z.string().trim().url().max(4_000),
      name: z.string().trim().max(255).optional(),
      mimeType: z.string().trim().max(120).optional(),
    }),
  ])

const openapiMetadataSchema = z
  .object({
    file: z.string().trim().min(1).optional(),
    operationId: z.string().trim().min(1).optional(),
  })
  .passthrough()

const submitSchema = z.object({
  modelId: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().max(8_000),
  inputMode: z.string().trim().min(1).max(120).optional(),
  params: paramsSchema.default({}),
  openapi: openapiMetadataSchema.optional(),
  media: z.record(z.string(), z.array(mediaAttachmentSchema)).default({}),
  attachments: z.array(mediaAttachmentSchema).default([]),
  references: z.array(mediaReferenceSchema).default([]),
  mediaReferences: z
    .record(z.string(), z.array(mediaReferenceSchema))
    .default({}),
})

function getVideoOutputContentUrl(outputId: string) {
  return `/api/studio/video-outputs/${encodeURIComponent(outputId)}/content`
}

function toLightVideoGeneration(
  generation: StudioVideoGeneration
): StudioVideoGeneration {
  return {
    ...generation,
    outputs: generation.outputs.map((output) => ({
      ...output,
      src: getVideoOutputContentUrl(output.id),
      dataUrl: null,
    })),
  }
}

function findVideoGeneration(sessionId: string, generationId: string) {
  return (
    listStudioVideoGenerations(sessionId).find(
      (generation) => generation.id === generationId
    ) ?? null
  )
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  scheduleStudioVideoGenerationResumesForSession({ sessionId })

  return NextResponse.json({
    ok: true,
    data: listStudioVideoGenerations(sessionId).map(toLightVideoGeneration),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  if (session.mode !== "video") {
    return NextResponse.json(
      { ok: false, error: "Session is not a video session." },
      { status: 400 }
    )
  }

  const parsed = submitSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const provider = resolveModelProviderDataPlane()

  if (!provider.apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: `${provider.providerName} API key is not configured locally.`,
      },
      { status: 400 }
    )
  }

  try {
    const result = await submitStudioVideoGeneration({
      ...parsed.data,
      apiKey: provider.apiKey,
      openapiFile: parsed.data.openapi?.file,
      operationId:
        parsed.data.operationId ?? parsed.data.openapi?.operationId,
      sessionId,
    })
    const generation = findVideoGeneration(sessionId, result.generationId)

    if (result.status === "error") {
      return NextResponse.json(
        {
          ok: false,
          error: result.errorMessage ?? "Video generation failed.",
          data: generation ? toLightVideoGeneration(generation) : result,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        data: generation ? toLightVideoGeneration(generation) : result,
      },
      { status: 202 }
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."
    const status =
      error instanceof CompShareEntitlementError ? error.status : 500

    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(error instanceof CompShareEntitlementError
          ? { code: error.code }
          : {}),
      },
      { status }
    )
  }
}
