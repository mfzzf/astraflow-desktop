import {
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"

export type MobileModelCommandOption = {
  id: string
  label: string
  reasoningEfforts: readonly ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
}

export type MobileModelSelection = {
  model: MobileModelCommandOption
  reasoningEffort: ChatReasoningEffort
  reasoningEffortExplicit: boolean
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase()
}

function findModel(
  value: string,
  models: readonly MobileModelCommandOption[]
) {
  const index = Number(value)
  if (/^\d+$/.test(value) && index >= 1 && index <= models.length) {
    return models[index - 1]
  }

  const normalized = normalize(value)
  return (
    models.find((model) => normalize(model.id) === normalized) ??
    models.find((model) => normalize(model.label) === normalized) ??
    null
  )
}

export function resolveMobileModelSelection(
  argument: string,
  models: readonly MobileModelCommandOption[]
): MobileModelSelection | null {
  const trimmed = argument.trim()
  if (!trimmed) {
    return null
  }

  const exactModel = findModel(trimmed, models)
  if (exactModel) {
    return {
      model: exactModel,
      reasoningEffort: exactModel.defaultReasoningEffort,
      reasoningEffortExplicit: false,
    }
  }

  const effortMatch = trimmed.match(/\s+(\S+)$/)
  if (!effortMatch) {
    return null
  }

  const requestedEffort = normalize(effortMatch[1]) as ChatReasoningEffort
  if (!SUPPORTED_CHAT_REASONING_EFFORTS.includes(requestedEffort)) {
    return null
  }

  const model = findModel(trimmed.slice(0, effortMatch.index).trim(), models)
  if (!model || !model.reasoningEfforts.includes(requestedEffort)) {
    return null
  }

  return {
    model,
    reasoningEffort: requestedEffort,
    reasoningEffortExplicit: true,
  }
}

export function formatMobileModelList({
  currentModel,
  currentReasoningEffort,
  models,
}: {
  currentModel: string
  currentReasoningEffort?: ChatReasoningEffort
  models: readonly MobileModelCommandOption[]
}) {
  const lines = models.map((model, index) => {
    const current = model.id === currentModel ? " ← 当前" : ""
    return `${index + 1}. ${model.label}（${model.id}）[${model.reasoningEfforts.join("/")}]${current}`
  })

  return [
    `当前模型：**${currentModel}**${currentReasoningEffort ? ` · 思考强度 **${currentReasoningEffort}**` : ""}`,
    "",
    ...lines,
    "",
    "切换：`/model 序号`，也可使用 `/model 模型ID 思考强度`。",
    "示例：`/model 2 high`",
  ].join("\n")
}
