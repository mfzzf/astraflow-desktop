"use client"

import Image from "next/image"
import compShareLogoDarkEn from "@/public/compshare/brand-dark-en.png"
import compShareLogoDarkZh from "@/public/compshare/brand-dark-zh.png"
import compShareLogoLightEn from "@/public/compshare/brand-light-en.png"
import compShareLogoLightZh from "@/public/compshare/brand-light-zh.png"

import { useI18n } from "@/components/i18n-provider"
import { useChannelConfig } from "@/components/channel-config-provider"
import { COMPSHARE_PRODUCT_NAME } from "@/lib/channel-config-shared"
import { cn } from "@/lib/utils"

type AstraFlowLogoProps = {
  className?: string
  fetchPriority?: "high" | "low" | "auto"
  loading?: "eager" | "lazy"
}

const logos = {
  en: {
    light: { src: "/logo/en-logo.png", width: 530, height: 160 },
    dark: { src: "/logo/en-logo-白.png", width: 530, height: 160 },
  },
  zh: {
    light: { src: "/logo/logo.png", width: 700, height: 160 },
    dark: { src: "/logo/logo-白.png", width: 700, height: 160 },
  },
} as const

const compShareLogos = {
  en: {
    light: compShareLogoLightEn,
    dark: compShareLogoDarkEn,
  },
  zh: {
    light: compShareLogoLightZh,
    dark: compShareLogoDarkZh,
  },
} as const

function AstraFlowLogo({
  className,
  fetchPriority,
  loading,
}: AstraFlowLogoProps) {
  const { locale } = useI18n()
  const channel = useChannelConfig()
  const isCompShare = channel.slug.trim().toLowerCase() === "compshare"
  const logo = isCompShare ? compShareLogos[locale] : logos[locale]
  const alt = isCompShare ? COMPSHARE_PRODUCT_NAME : "AstraFlow"
  return (
    <>
      <Image
        src={logo.light.src}
        alt={alt}
        width={logo.light.width}
        height={logo.light.height}
        className={cn("block h-8 w-auto dark:hidden", className)}
        fetchPriority={fetchPriority}
        loading={loading}
      />
      <Image
        src={logo.dark.src}
        alt={alt}
        width={logo.dark.width}
        height={logo.dark.height}
        className={cn("hidden h-8 w-auto dark:block", className)}
        fetchPriority={fetchPriority}
        loading={loading}
      />
    </>
  )
}

export { AstraFlowLogo }
