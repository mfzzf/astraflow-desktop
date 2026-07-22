import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  listAgentModelsAvailableInModelSquare,
  repairAgentModelRuntimeDefaults,
} from "@/lib/agent-model-catalog"
import {
  AGENT_MODEL_PROTOCOLS,
  AGENT_RUNTIME_IDS,
} from "@/lib/agent-model-settings-shared"
import {
  deleteCustomAgentModel,
  getAgentModelSettings,
  listAgentModels,
  upsertCustomAgentModel,
} from "@/lib/agent-model-settings"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import { isCompShareChannel } from "@/lib/compshare/config"
import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"

export const runtime = "nodejs"

type AgentModelRouteContext = {
  params: Promise<{
    modelId: string
  }>
}

const customModelPatchSchema = z.object({
  label: z.string().trim().min(1).max(128),
  providerModel: z.string().trim().min(1).max(128),
  protocol: z.enum(AGENT_MODEL_PROTOCOLS),
  baseUrl: z.string().trim().max(256).nullable().optional(),
  supportedRuntimeIds: z.array(z.enum(AGENT_RUNTIME_IDS)).min(1),
  reasoningEfforts: z.array(z.enum(SUPPORTED_CHAT_REASONING_EFFORTS)).min(1),
  defaultReasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS),
  enabled: z.boolean().optional(),
})

async function readModelId(context: AgentModelRouteContext) {
  const { modelId } = await context.params
  const normalizedModelId = decodeURIComponent(modelId).trim()

  if (!normalizedModelId) {
    throw new Error("Model id is required.")
  }

  return normalizedModelId
}

async function toPayload() {
  const settings = getAgentModelSettings()
  const models = await listAgentModelsAvailableInModelSquare(
    listAgentModels(settings)
  )

  return {
    ...settings,
    runtimes: repairAgentModelRuntimeDefaults(settings.runtimes, models),
    models,
    hasModelverseApiKey: Boolean(
      isCompShareChannel()
        ? getStoredModelverseApiKey()
        : getStudioModelverseApiKey()?.key
    ),
  }
}

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to update agent model.",
    },
    { status: 400 }
  )
}

export async function PATCH(
  request: Request,
  context: AgentModelRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const modelId = await readModelId(context)
    const input = customModelPatchSchema.parse(await request.json())

    upsertCustomAgentModel({
      ...input,
      id: modelId,
      baseUrl: input.baseUrl?.trim() || null,
    })

    return NextResponse.json({
      ok: true,
      data: await toPayload(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  request: Request,
  context: AgentModelRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const modelId = await readModelId(context)

    if (!deleteCustomAgentModel(modelId)) {
      return NextResponse.json(
        { ok: false, message: "Custom model was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: await toPayload(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
