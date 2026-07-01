"use client"

import Image from "next/image"

import enLogoDark from "@/static/logo/en-logo-白.png"
import enLogoLight from "@/static/logo/en-logo.png"
import zhLogoDark from "@/static/logo/logo-白.png"
import zhLogoLight from "@/static/logo/logo.png"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

type AstraFlowLogoProps = {
  className?: string
  fetchPriority?: "high" | "low" | "auto"
}

const logos = {
  en: {
    light: enLogoLight,
    dark: enLogoDark,
  },
  zh: {
    light: zhLogoLight,
    dark: zhLogoDark,
  },
} as const

function AstraFlowLogo({ className, fetchPriority }: AstraFlowLogoProps) {
  const { locale } = useI18n()
  const logo = logos[locale]

  return (
    <>
      <Image
        src={logo.light}
        alt="AstraFlow"
        className={cn("block h-8 w-auto dark:hidden", className)}
        fetchPriority={fetchPriority}
      />
      <Image
        src={logo.dark}
        alt="AstraFlow"
        className={cn("hidden h-8 w-auto dark:block", className)}
        fetchPriority={fetchPriority}
      />
    </>
  )
}

export { AstraFlowLogo }
