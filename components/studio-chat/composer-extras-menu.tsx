"use client"

import * as React from "react"
import { RiAddLine, RiListCheck } from "@remixicon/react"
import {
  ArrowUpRight,
  Bot,
  Link2,
  LoaderCircle,
  Paperclip,
  Wrench,
} from "lucide-react"

import type { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"

import {
  getComposerMcpLabel,
  getComposerSkillDescription,
  getComposerSkillLabel,
} from "./composer-utils"
import type { ComposerSelectedExpert, ComposerToggleControl } from "./types"

type ComposerExtrasMenuProps = {
  dense: boolean
  disabled: boolean
  availableExperts: ComposerSelectedExpert[]
  expertsLoading: boolean
  fastControl: ComposerToggleControl | null
  installedMcpServers: InstalledMcpServer[]
  installedSkills: InstalledSkill[]
  locale: string
  onAddFiles: (files: FileList | null) => void
  onOpenExperts: () => void
  onOpenPlugins: () => void
  onSummonExpert: (expert: ComposerSelectedExpert) => void
  planControl: ComposerToggleControl | null
  summoningExpertId: string
  t: ReturnType<typeof useI18n>["t"]
}

export function ComposerExtrasMenu({
  dense,
  disabled,
  availableExperts,
  expertsLoading,
  fastControl,
  installedMcpServers,
  installedSkills,
  locale,
  onAddFiles,
  onOpenExperts,
  onOpenPlugins,
  onSummonExpert,
  planControl,
  summoningExpertId,
  t,
}: ComposerExtrasMenuProps) {
  const imageInputRef = React.useRef<HTMLInputElement | null>(null)
  const enabledSkills = installedSkills.filter((skill) => skill.enabled)
  const enabledMcpServers = installedMcpServers.filter(
    (server) => server.enabled
  )

  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          onAddFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={t.studioComposerExtras}
            data-analytics-event="composer.extras.open"
            data-analytics-label={t.studioComposerExtras}
            className={cn(
              "size-7 rounded-lg p-0 transition-colors hover:bg-muted/60 [&_svg]:size-4",
              dense && "size-6 [&_svg]:size-3.5"
            )}
          >
            <RiAddLine aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          className="min-w-48 p-1.5"
        >
          <DropdownMenuItem
            className="h-8 gap-2 px-2 text-sm"
            onSelect={() => imageInputRef.current?.click()}
          >
            <Paperclip aria-hidden className="size-4" />
            {t.studioImageAttach}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8 gap-2 px-2 text-sm">
              <Bot aria-hidden className="size-4" />
              {t.studioComposerActionExperts}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56 p-1.5">
              {expertsLoading ? (
                <div className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                  {t.studioComposerExpertsLoading}
                </div>
              ) : availableExperts.length > 0 ? (
                availableExperts.slice(0, 4).map((expert) => {
                  const expertId = expert.expertId.trim()
                  const label = expert.displayName.trim() || expertId
                  const meta =
                    expert.profession.trim() || expert.expertType.trim()

                  return (
                    <DropdownMenuItem
                      key={expertId || label}
                      disabled={!expertId || summoningExpertId === expertId}
                      className="h-8 gap-2 px-2 text-sm"
                      title={[label, meta].filter(Boolean).join(" · ")}
                      onSelect={() => onSummonExpert(expert)}
                    >
                      <Bot aria-hidden className="size-4" />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {summoningExpertId === expertId ? (
                        <LoaderCircle
                          aria-hidden
                          className="size-3.5 animate-spin"
                        />
                      ) : meta ? (
                        <span className="max-w-20 truncate text-xs text-muted-foreground">
                          {meta}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  )
                })
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {t.studioComposerExpertsEmpty}
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-8 gap-2 px-2 text-sm"
                onSelect={onOpenExperts}
              >
                <ArrowUpRight aria-hidden className="size-4" />
                {t.studioComposerExpertsMore}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8 gap-2 px-2 text-sm">
              <Wrench aria-hidden className="size-4" />
              {t.studioComposerActionSkills}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-64 p-1.5">
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t.studioComposerPluginsAppliedSummary(
                  enabledSkills.length,
                  installedSkills.length
                )}
              </div>
              {enabledSkills.length > 0 ? (
                enabledSkills.slice(0, 4).map((skill) => (
                  <div
                    key={skill.slug}
                    className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
                    title={getComposerSkillDescription(skill, locale)}
                  >
                    <Wrench
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {getComposerSkillLabel(skill)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.studioComposerPluginApplied}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {t.studioComposerSkillsEmpty}
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-8 gap-2 px-2 text-sm"
                onSelect={onOpenPlugins}
              >
                <ArrowUpRight aria-hidden className="size-4" />
                {t.studioComposerPluginsOpenMarket}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8 gap-2 px-2 text-sm">
              <Link2 aria-hidden className="size-4" />
              {t.studioComposerActionConnectors}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-64 p-1.5">
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t.studioComposerPluginsAppliedSummary(
                  enabledMcpServers.length,
                  installedMcpServers.length
                )}
              </div>
              {enabledMcpServers.length > 0 ? (
                enabledMcpServers.slice(0, 4).map((server) => (
                  <div
                    key={server.id}
                    className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
                    title={server.description || server.name}
                  >
                    <Link2
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {getComposerMcpLabel(server)}
                    </span>
                    <span className="text-xs text-muted-foreground">MCP</span>
                  </div>
                ))
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {t.studioComposerConnectorsEmpty}
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-8 gap-2 px-2 text-sm"
                onSelect={onOpenPlugins}
              >
                <ArrowUpRight aria-hidden className="size-4" />
                {t.studioComposerPluginsOpenMarket}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {planControl ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={planControl.disabled || !planControl.available}
                className="h-9 justify-between gap-4 px-2 text-sm"
                onSelect={(event) => {
                  event.preventDefault()
                  planControl.onToggle()
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <RiListCheck aria-hidden className="size-4" />
                  {t.studioComposerPlanMode}
                </span>
                <Switch
                  checked={planControl.active}
                  disabled={planControl.disabled || !planControl.available}
                  aria-label={t.studioComposerPlanMode}
                  tabIndex={-1}
                  className="pointer-events-none"
                />
              </DropdownMenuItem>
            </>
          ) : null}

          {fastControl?.available ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={fastControl.disabled}
                  className="h-8 px-2 text-sm"
                >
                  {t.studioComposerFast}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-36 p-1.5">
                  <DropdownMenuRadioGroup
                    value={fastControl.active ? "fast" : "default"}
                    onValueChange={(value) => {
                      const shouldEnable = value === "fast"

                      if (shouldEnable !== fastControl.active) {
                        fastControl.onToggle()
                      }
                    }}
                  >
                    <DropdownMenuRadioItem
                      value="default"
                      className="h-8 px-2 text-sm"
                    >
                      {t.studioComposerFastDefault}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="fast"
                      className="h-8 px-2 text-sm"
                    >
                      {t.studioComposerFast}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
