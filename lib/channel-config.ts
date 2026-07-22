import "server-only"

import { channelServiceGetChannelRuntimeConfig } from "@/lib/generated/astraflow-api"
import {
  CHANNEL_FEATURES,
  COMPSHARE_PRODUCT_NAME,
  LEGACY_CHANNEL_CONFIG,
  type ChannelFeature,
  type ChannelRuntimeConfig,
} from "@/lib/channel-config-shared"

const MANAGED_FALLBACK_FEATURES: ChannelFeature[] = ["models", "skills", "chat"]
const COMPSHARE_REQUIRED_FEATURES = [
  "plans",
  "automations",
  "mobile",
] as const satisfies readonly ChannelFeature[]
const COMPSHARE_MANAGED_FALLBACK_FEATURES = resolveCompShareChannelFeatures([
  "skills",
  "chat",
])
const CACHE_TTL_MS = 60_000

let cached:
  { slug: string; expiresAt: number; config: ChannelRuntimeConfig } | undefined

export function getDistributionChannelSlug() {
  const configuredSlug = (
    process.env.ASTRAFLOW_CHANNEL_SLUG ??
    process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG ??
    ""
  )
    .trim()
    .toLowerCase()

  return configuredSlug || "compshare"
}

export function resolveCompShareChannelFeatures(
  configuredFeatures: ChannelFeature[]
) {
  return configuredFeatures
    .filter((feature) => feature !== "models")
    .concat(
      COMPSHARE_REQUIRED_FEATURES.filter(
        (feature) => !configuredFeatures.includes(feature)
      )
    )
}

export async function getChannelRuntimeConfig(): Promise<ChannelRuntimeConfig> {
  const slug = getDistributionChannelSlug()

  if (!slug) {
    return LEGACY_CHANNEL_CONFIG
  }

  if (cached?.slug === slug && cached.expiresAt > Date.now()) {
    return cached.config
  }

  try {
    const result = await channelServiceGetChannelRuntimeConfig({
      path: { slug },
      signal: AbortSignal.timeout(10_000),
    })

    if (!result.data) {
      throw new Error("Channel configuration is unavailable.")
    }

    const configuredFeatures = (result.data.enabledFeatures ?? []).filter(
      (feature): feature is ChannelFeature =>
        CHANNEL_FEATURES.includes(feature as ChannelFeature)
    )
    const features =
      slug === "compshare"
        ? resolveCompShareChannelFeatures(configuredFeatures)
        : configuredFeatures
    const config: ChannelRuntimeConfig = {
      slug: result.data.slug ?? slug,
      name:
        slug === "compshare"
          ? COMPSHARE_PRODUCT_NAME
          : (result.data.name ?? slug),
      oauthClientId: result.data.oauthClientId ?? "",
      enabledFeatures: features,
      restrictModels: result.data.restrictModels ?? false,
      allowedModelIds: result.data.allowedModelIds ?? [],
      revision: Number(result.data.revision ?? 0),
      managed: true,
    }

    cached = { slug, config, expiresAt: Date.now() + CACHE_TTL_MS }
    return config
  } catch {
    return {
      slug,
      name: slug === "compshare" ? COMPSHARE_PRODUCT_NAME : slug,
      oauthClientId: "",
      enabledFeatures:
        slug === "compshare"
          ? COMPSHARE_MANAGED_FALLBACK_FEATURES
          : MANAGED_FALLBACK_FEATURES,
      restrictModels: true,
      allowedModelIds: [],
      revision: 0,
      managed: true,
    }
  }
}
