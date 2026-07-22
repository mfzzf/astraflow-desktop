"use client"

import Image from "next/image"

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

function AstraFlowLogo({
  className,
  fetchPriority,
  loading,
}: AstraFlowLogoProps) {
  const { locale } = useI18n()
  const channel = useChannelConfig()
  const isCompShare = channel.slug.trim().toLowerCase() === "compshare"
  const logo = isCompShare
    ? locale === "zh"
      ? {
          light: {
            src: "/compshare/logo-浅色底-中英-cn@4x.png",
            width: 856,
            height: 231,
          },
          dark: {
            src: "/compshare/logo-深色底-中英-cn@4x.png",
            width: 856,
            height: 231,
          },
        }
      : {
          light: {
            src: "/compshare/logo-浅色底-英@4x.png",
            width: 1234,
            height: 231,
          },
          dark: {
            src: "/compshare/logo-深色底-英@4x.png",
            width: 1234,
            height: 231,
          },
        }
    : logos[locale]
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
