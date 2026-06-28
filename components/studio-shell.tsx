"use client"

import * as React from "react"
import {
  RiAddLine,
  RiChat3Line,
  RiImageLine,
  RiMicLine,
  RiTimeLine,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"
import type { Locale } from "@/lib/i18n"

type StudioMode = "chat" | "image" | "video" | "audio"

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

type LocalizedText = Record<Locale, string>

type StudioSession = {
  id: string
  mode: StudioMode
  title: LocalizedText
  description: LocalizedText
  time: LocalizedText
}

const studioModes: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

const studioSessions: StudioSession[] = [
  {
    id: "chat-market-copy",
    mode: "chat",
    title: {
      en: "Model launch talking points",
      zh: "模型发布沟通要点",
    },
    description: {
      en: "8 messages · Drafting",
      zh: "8 条消息 · 草稿中",
    },
    time: {
      en: "Just now",
      zh: "刚刚",
    },
  },
  {
    id: "image-hero-visual",
    mode: "image",
    title: {
      en: "Landing hero visual",
      zh: "首页主视觉",
    },
    description: {
      en: "4 images · 16:9",
      zh: "4 张图像 · 16:9",
    },
    time: {
      en: "12 min",
      zh: "12 分钟",
    },
  },
  {
    id: "video-product-demo",
    mode: "video",
    title: {
      en: "Product demo sequence",
      zh: "产品演示分镜",
    },
    description: {
      en: "2 clips · 6 seconds",
      zh: "2 段视频 · 6 秒",
    },
    time: {
      en: "Today",
      zh: "今天",
    },
  },
  {
    id: "audio-narration",
    mode: "audio",
    title: {
      en: "Narration voiceover",
      zh: "旁白配音",
    },
    description: {
      en: "3 takes · Mandarin",
      zh: "3 个版本 · 中文",
    },
    time: {
      en: "Today",
      zh: "今天",
    },
  },
  {
    id: "chat-eval-notes",
    mode: "chat",
    title: {
      en: "Evaluation notes",
      zh: "模型评测记录",
    },
    description: {
      en: "15 messages · Comparison",
      zh: "15 条消息 · 对比分析",
    },
    time: {
      en: "Yesterday",
      zh: "昨天",
    },
  },
  {
    id: "image-icon-set",
    mode: "image",
    title: {
      en: "Feature icon set",
      zh: "功能图标组",
    },
    description: {
      en: "12 images · Transparent",
      zh: "12 张图像 · 透明底",
    },
    time: {
      en: "Yesterday",
      zh: "昨天",
    },
  },
  {
    id: "video-social-cut",
    mode: "video",
    title: {
      en: "Social teaser cut",
      zh: "社媒预告短片",
    },
    description: {
      en: "1 clip · Vertical",
      zh: "1 段视频 · 竖屏",
    },
    time: {
      en: "Jun 26",
      zh: "6月26日",
    },
  },
  {
    id: "audio-brand-sound",
    mode: "audio",
    title: {
      en: "Brand sound mark",
      zh: "品牌提示音",
    },
    description: {
      en: "5 variants · WAV",
      zh: "5 个变体 · WAV",
    },
    time: {
      en: "Jun 25",
      zh: "6月25日",
    },
  },
]

function StudioShell() {
  const { locale, t } = useI18n()
  const [selectedMode, setSelectedMode] = React.useState<StudioMode>("chat")
  const [selectedSessionId, setSelectedSessionId] = React.useState<string>(
    studioSessions[0]?.id ?? ""
  )

  const selectedSession = studioSessions.find(
    (session) => session.id === selectedSessionId
  )
  const activeMode = selectedSession?.mode ?? selectedMode

  function getModeLabel(mode: StudioMode) {
    switch (mode) {
      case "chat":
        return t.studioModeChat
      case "image":
        return t.studioModeImage
      case "video":
        return t.studioModeVideo
      case "audio":
        return t.studioModeAudio
    }
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] min-h-0 gap-4 overflow-hidden bg-background p-4">
      <aside className="flex w-full min-w-0 flex-col gap-4 md:w-[280px] md:shrink-0 lg:w-[300px]">
        <section className="shrink-0 rounded-4xl border bg-card p-3 shadow-sm">
          <Button
            type="button"
            className="mb-3 h-10 w-full justify-start"
            onClick={() => setSelectedSessionId("")}
          >
            <RiAddLine data-icon="inline-start" aria-hidden />
            <span>{t.studioNewSession}</span>
          </Button>

          <nav aria-label={t.studioModes} className="flex flex-col gap-1">
            {studioModes.map((mode) => {
              const Icon = mode.icon
              const isActive = mode.id === activeMode

              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  className="h-10 justify-start gap-2 px-3 text-base font-normal"
                  aria-pressed={isActive}
                  onClick={() => {
                    setSelectedMode(mode.id)
                    setSelectedSessionId("")
                  }}
                >
                  <Icon data-icon="inline-start" aria-hidden />
                  <span className="truncate">{getModeLabel(mode.id)}</span>
                </Button>
              )
            })}
          </nav>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-4xl border bg-card p-3 shadow-sm">
          <div className="mb-3 pl-3 text-sm font-medium">
            {t.studioSessions}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-1">
              {studioSessions.map((session) => {
                const mode = studioModes.find(
                  (item) => item.id === session.mode
                )
                const Icon = mode?.icon ?? RiChat3Line
                const isActive = session.id === selectedSessionId

                return (
                  <button
                    key={session.id}
                    type="button"
                    className={cn(
                      "flex h-11 w-full items-center gap-2 rounded-4xl px-3 text-left text-base transition-colors hover:bg-muted hover:text-foreground",
                      isActive && "bg-secondary text-secondary-foreground"
                    )}
                    onClick={() => {
                      setSelectedSessionId(session.id)
                      setSelectedMode(session.mode)
                    }}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                      <Icon data-icon="inline-start" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {session.title[locale]}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {session.time[locale]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col rounded-4xl border bg-card shadow-sm md:flex">
        <div className="flex h-full min-h-0 items-center justify-center px-10">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <RiTimeLine aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-2xl font-semibold">
                {selectedSession?.title[locale] ?? t.studioWorkspace}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t.studioWorkspaceHint}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export { StudioShell }
