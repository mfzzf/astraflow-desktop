import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { speechServiceTranscribe } from "@/lib/generated/astraflow-api"

export const runtime = "nodejs"

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_BASE64_CHARACTERS = 14_000_000

const voiceTranscriptionSchema = z.object({
  audioBase64: z
    .string()
    .min(1)
    .max(MAX_AUDIO_BASE64_CHARACTERS)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.literal("audio/wav"),
  sampleRateHz: z.number().int().positive(),
  durationMs: z.number().int().positive(),
})

function toTranscribeErrorResponse(error: unknown, elapsedMs: number) {
  if (error instanceof AstraFlowApiError) {
    console.error("[voice-transcribe] request_failed", {
      status: error.status,
      error: error.message,
      elapsedMs,
    })
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status }
    )
  }

  console.error("[voice-transcribe] request_error", {
    elapsedMs,
    error: error instanceof Error ? error.message : String(error),
  })
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error ? error.message : "Voice transcription failed.",
    },
    { status: 502 }
  )
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = voiceTranscriptionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid voice recording payload." },
      { status: 400 }
    )
  }

  const audioBytes = Buffer.from(parsed.data.audioBase64, "base64")

  if (audioBytes.length === 0 || audioBytes.length > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Voice recording is empty or too large." },
      { status: 413 }
    )
  }

  const startedAt = Date.now()
  console.info("[voice-transcribe] request_started", {
    audioBytes: audioBytes.length,
    sampleRateHz: parsed.data.sampleRateHz,
    durationMs: parsed.data.durationMs,
  })

  try {
    const result = await speechServiceTranscribe({
      body: {
        audio: parsed.data.audioBase64,
        mimeType: parsed.data.mimeType,
      },
    })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Voice transcription failed."
    )
    const text = (payload.transcript ?? "").trim()

    if (!text) {
      console.error("[voice-transcribe] empty_response", {
        elapsedMs: Date.now() - startedAt,
      })
      return NextResponse.json(
        { ok: false, error: "The transcription response was empty." },
        { status: 502 }
      )
    }

    console.info("[voice-transcribe] request_completed", {
      elapsedMs: Date.now() - startedAt,
      transcriptLength: text.length,
      model: payload.model,
      detectedLanguage: payload.detectedLanguage,
    })

    return NextResponse.json({ ok: true, data: { text } })
  } catch (error) {
    return toTranscribeErrorResponse(error, Date.now() - startedAt)
  }
}
