import localFont from "next/font/local"
import { Suspense } from "react"

import "./globals.css"
import "@xterm/xterm/css/xterm.css"
import { AppShell } from "@/components/app-shell"
import { AnalyticsProvider } from "@/components/analytics-provider"
import { ChannelConfigProvider } from "@/components/channel-config-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/components/i18n-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getChannelRuntimeConfig } from "@/lib/channel-config"

const interHeading = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-heading",
  display: "swap",
  weight: "100 900",
})

const roboto = localFont({
  src: "./fonts/roboto-latin.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
})

const fontMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 900",
})

const isElectronRenderer = process.env.ASTRAFLOW_ELECTRON === "1"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const channelConfig = await getChannelRuntimeConfig()

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-astraflow-desktop={isElectronRenderer ? "true" : undefined}
      data-astraflow-platform={
        isElectronRenderer ? process.platform : undefined
      }
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        roboto.variable,
        interHeading.variable
      )}
    >
      <body>
        <ThemeProvider>
          <AnalyticsProvider>
            <I18nProvider>
              <TooltipProvider>
                <Suspense fallback={null}>
                  <ChannelConfigProvider config={channelConfig}>
                    <AppShell>{children}</AppShell>
                  </ChannelConfigProvider>
                </Suspense>
              </TooltipProvider>
              <Toaster />
            </I18nProvider>
          </AnalyticsProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
