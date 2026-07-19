"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import {
  getDefaultChannelRoute,
  isChannelFeatureEnabled,
  type ChannelFeature,
  type ChannelRuntimeConfig,
} from "@/lib/channel-config-shared"

const ChannelConfigContext = React.createContext<ChannelRuntimeConfig | null>(
  null
)

function getRequiredFeature(pathname: string, mode: string | null) {
  if (pathname.startsWith("/explore")) return "models"
  if (pathname.startsWith("/skills")) return "skills"
  if (pathname.startsWith("/automations")) return "automations"
  if (pathname.startsWith("/mobile")) return "mobile"
  if (pathname.startsWith("/codebox")) return "codebox"
  if (pathname.startsWith("/files")) return "files"
  if (!pathname.startsWith("/studio")) return null

  const pathMode = pathname.split("/")[2]
  const studioMode = pathMode || mode || "chat"
  return (["chat", "image", "video", "audio"] as const).includes(
    studioMode as "chat" | "image" | "video" | "audio"
  )
    ? (studioMode as ChannelFeature)
    : "chat"
}

export function ChannelConfigProvider({
  config,
  children,
}: {
  config: ChannelRuntimeConfig
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const requiredFeature = getRequiredFeature(pathname, searchParams.get("mode"))
  const allowed =
    !requiredFeature || isChannelFeatureEnabled(config, requiredFeature)

  React.useEffect(() => {
    if (!allowed && pathname !== "/login") {
      router.replace(getDefaultChannelRoute(config))
    }
  }, [allowed, config, pathname, router])

  return (
    <ChannelConfigContext.Provider value={config}>
      {allowed ? children : null}
    </ChannelConfigContext.Provider>
  )
}

export function useChannelConfig() {
  const config = React.useContext(ChannelConfigContext)
  if (!config) {
    throw new Error(
      "useChannelConfig must be used inside ChannelConfigProvider"
    )
  }
  return config
}
