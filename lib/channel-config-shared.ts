export const CHANNEL_FEATURES = [
  "models",
  "skills",
  "automations",
  "mobile",
  "codebox",
  "files",
  "chat",
  "image",
  "video",
  "audio",
] as const

export type ChannelFeature = (typeof CHANNEL_FEATURES)[number]

export type ChannelRuntimeConfig = {
  slug: string
  name: string
  oauthClientId: string
  enabledFeatures: ChannelFeature[]
  restrictModels: boolean
  allowedModelIds: string[]
  revision: number
  managed: boolean
}

export const LEGACY_CHANNEL_CONFIG: ChannelRuntimeConfig = {
  slug: "default",
  name: "AstraFlow",
  oauthClientId: "",
  enabledFeatures: [...CHANNEL_FEATURES],
  restrictModels: false,
  allowedModelIds: [],
  revision: 0,
  managed: false,
}

export function isChannelFeatureEnabled(
  config: ChannelRuntimeConfig,
  feature: ChannelFeature
) {
  return config.enabledFeatures.includes(feature)
}

export function isChannelModelAllowed(
  config: ChannelRuntimeConfig,
  ...modelIds: Array<string | null | undefined>
) {
  if (!config.restrictModels) {
    return true
  }

  const allowed = new Set(
    config.allowedModelIds.map((modelId) => modelId.trim().toLowerCase())
  )

  return modelIds.some((modelId) =>
    modelId ? allowed.has(modelId.trim().toLowerCase()) : false
  )
}

export function getDefaultChannelRoute(config: ChannelRuntimeConfig) {
  const routes: Array<[ChannelFeature, string]> = [
    ["models", "/explore"],
    ["skills", "/skills"],
    ["chat", "/studio"],
    ["image", "/studio?mode=image"],
    ["video", "/studio?mode=video"],
    ["audio", "/studio?mode=audio"],
    ["automations", "/automations"],
    ["mobile", "/mobile"],
    ["codebox", "/codebox"],
    ["files", "/files"],
  ]

  return (
    routes.find(([feature]) => isChannelFeatureEnabled(config, feature))?.[1] ??
    "/settings"
  )
}
