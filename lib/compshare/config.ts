import "server-only"

import { getDistributionChannelSlug } from "@/lib/channel-config"

export const COMPSHARE_CHANNEL_SLUG = "compshare"
export const COMPSHARE_CONTROL_PLANE_URL = "https://api.compshare.cn/"
export const COMPSHARE_MODEL_API_BASE_URL = "https://cp.compshare.cn/v1"
export const COMPSHARE_DEFAULT_MODEL = "deepseek-v4-flash"

export const COMPSHARE_CAPABILITIES = Object.freeze({
  controlPlaneAuth: "ucloud-signature",
  modelAuth: "bearer",
  oauthRefresh: false,
  streaming: true,
} as const)

export function isCompShareChannelSlug(slug: string | null | undefined) {
  return slug?.trim().toLowerCase() === COMPSHARE_CHANNEL_SLUG
}

export function isCompShareChannel() {
  return isCompShareChannelSlug(getDistributionChannelSlug())
}
