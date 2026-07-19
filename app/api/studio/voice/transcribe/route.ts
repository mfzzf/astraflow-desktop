import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { MODELVERSE_BASE_URL_V1 } from "@/lib/modelverse-config"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"

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

function getProviderError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const error = (payload as { error?: { message?: unknown } }).error

  return typeof error?.message === "string" ? error.message : null
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

  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "ModelVerse API key is not configured locally." },
      { status: 400 }
    )
  }

  const formData = new FormData()
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBytes)], { type: parsed.data.mimeType }),
    "voice.wav"
  )
  formData.append("model", "gpt-4o-mini-transcribe")
  formData.append("response_format", "json")
  formData.append("temperature", "0")
  formData.append("stream", "false")

  try {
    const response = await fetch(
      `${MODELVERSE_BASE_URL_V1}/audio/transcriptions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      }
    )
    const payload = (await response.json().catch(() => null)) as {
      text?: unknown
    } | null

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            getProviderError(payload) ||
            `Voice transcription failed with status ${response.status}.`,
        },
        { status: response.status }
      )
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : ""

    if (!text) {
      return NextResponse.json(
        { ok: false, error: "The transcription response was empty." },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, data: { text } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Voice transcription failed.",
      },
      { status: 502 }
    )
  }
}
