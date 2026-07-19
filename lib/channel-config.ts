import "server-only"

import { channelServiceGetChannelRuntimeConfig } from "@/lib/generated/astraflow-api"
import {
  CHANNEL_FEATURES,
  LEGACY_CHANNEL_CONFIG,
  type ChannelFeature,
  type ChannelRuntimeConfig,
} from "@/lib/channel-config-shared"

const MANAGED_FALLBACK_FEATURES: ChannelFeature[] = ["models", "skills", "chat"]
const CACHE_TTL_MS = 60_000

let cached:
  { slug: string; expiresAt: number; config: ChannelRuntimeConfig } | undefined

export function getDistributionChannelSlug() {
  return (
    process.env.ASTRAFLOW_CHANNEL_SLUG ??
    process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG ??
    ""
  )
    .trim()
    .toLowerCase()
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

    const features = (result.data.enabledFeatures ?? []).filter(
      (feature): feature is ChannelFeature =>
        CHANNEL_FEATURES.includes(feature as ChannelFeature)
    )
    const config: ChannelRuntimeConfig = {
      slug: result.data.slug ?? slug,
      name: result.data.name ?? slug,
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
      name: slug,
      oauthClientId: "",
      enabledFeatures: MANAGED_FALLBACK_FEATURES,
      restrictModels: true,
      allowedModelIds: [],
      revision: 0,
      managed: true,
    }
  }
}
