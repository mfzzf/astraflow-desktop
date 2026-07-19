"use client"

import * as React from "react"
import {
  RiArchiveStackLine,
  RiBrainLine,
  RiChat1Line,
  RiEraserLine,
  RiExportLine,
  RiFocus2Line,
  RiGitForkLine,
  RiHistoryLine,
  RiInformationLine,
  RiListCheck,
  RiLogoutBoxRLine,
  RiPlugLine,
  RiRefreshLine,
  RiRobotLine,
  RiSearchEyeLine,
  RiShieldCheckLine,
  RiStackLine,
  RiToolsLine,
} from "@remixicon/react"

import type { useI18n } from "@/components/i18n-provider"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"
import { cn } from "@/lib/utils"

import {
  getComposerMcpLabel,
  getComposerSkillDescription,
  getComposerSkillLabel,
} from "./composer-utils"
import type { ComposerPopupPlacement } from "./types"

type SlashCommandMenuProps = {
  activeIndex: number
  commands: SlashCommandDescriptor[]
  locale: string
  mcpServers: InstalledMcpServer[]
  onAcceptCommand: (command: SlashCommandDescriptor) => void
  onAcceptMcp: () => void
  onAcceptSkill: (skill: InstalledSkill) => void
  onSelectIndex: React.Dispatch<React.SetStateAction<number>>
  placement: ComposerPopupPlacement
  scrollRef: React.RefObject<HTMLDivElement | null>
  skills: InstalledSkill[]
  t: ReturnType<typeof useI18n>["t"]
}

function getCommandIcon(name: string): React.ElementType {
  switch (name.toLowerCase()) {
    case "clear":
      return RiEraserLine
    case "model":
    case "reasoning":
      return RiBrainLine
    case "plan":
      return RiListCheck
    case "fork":
      return RiGitForkLine
    case "status":
    case "session":
      return RiInformationLine
    case "subagents":
      return RiRobotLine
    case "export":
      return RiExportLine
    case "compact":
      return RiArchiveStackLine
    case "approve":
    case "always":
    case "deny":
      return RiShieldCheckLine
    case "review":
    case "review-branch":
    case "review-commit":
      return RiSearchEyeLine
    case "goal":
    case "checkpoint":
      return RiFocus2Line
    case "mcp":
      return RiPlugLine
    case "skills":
    case "packages":
      return RiStackLine
    case "tools":
      return RiToolsLine
    case "reload":
      return RiRefreshLine
    case "undo":
    case "redo":
    case "tree":
    case "rewind":
      return RiHistoryLine
    case "logout":
      return RiLogoutBoxRLine
    default:
      return RiChat1Line
  }
}

function formatCommandTitle(name: string) {
  if (name.toLowerCase() === "plan") {
    return "Plan Mode"
  }

  return name
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function formatRuntimeLabel(runtimeId?: string) {
  switch (runtimeId) {
    case "codex":
      return "Codex"
    case "claude-code":
      return "Claude Code"
    case "opencode":
      return "OpenCode"
    case "astraflow":
      return "AstraFlow"
    default:
      return runtimeId?.trim() || "Agent"
  }
}

function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[12px] font-medium text-muted-foreground/80">
      {children}
    </div>
  )
}

function MenuRow({
  canonicalName,
  description,
  icon: Icon,
  label,
  onAccept,
  onSelect,
  selected,
}: {
  canonicalName: string
  description?: string | null
  icon: React.ElementType
  label: string
  onAccept: () => void
  onSelect: () => void
  selected: boolean
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-active={selected ? "true" : undefined}
      className={cn(
        "grid min-h-10 w-full min-w-0 grid-cols-[1.125rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors",
        selected
          ? "bg-muted/80 text-foreground"
          : "text-foreground hover:bg-muted/55"
      )}
      onMouseEnter={onSelect}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onAccept()
      }}
    >
      <Icon
        aria-hidden
        className="size-[17px] shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-[13px] font-medium">{label}</span>
        {description ? (
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[12px] text-muted-foreground/70">
        {canonicalName}
      </span>
    </button>
  )
}

export function SlashCommandMenu({
  activeIndex,
  commands,
  locale,
  mcpServers,
  onAcceptCommand,
  onAcceptMcp,
  onAcceptSkill,
  onSelectIndex,
  placement,
  scrollRef,
  skills,
  t,
}: SlashCommandMenuProps) {
  const builtinCommands = commands.filter(
    (command) => command.source === "builtin"
  )
  const runtimeCommands = commands.filter(
    (command) => command.source === "runtime"
  )
  const hasEntries =
    commands.length > 0 || skills.length > 0 || mcpServers.length > 0

  const renderCommandRows = (items: SlashCommandDescriptor[]) =>
    items.map((command) => {
      const index = commands.indexOf(command)
      const Icon = getCommandIcon(command.name)
      const description = [command.description, command.inputHint]
        .filter(Boolean)
        .join(" ")

      return (
        <MenuRow
          key={`${command.source}:${command.runtimeId ?? "local"}:${command.name}`}
          canonicalName={`/${command.name}`}
          description={description || t.studioCommandNoDescription}
          icon={Icon}
          label={formatCommandTitle(command.name)}
          selected={index === activeIndex}
          onSelect={() => onSelectIndex(index)}
          onAccept={() => onAcceptCommand(command)}
        />
      )
    })

  return (
    <div
      role="listbox"
      aria-label={t.studioCommandMenuTitle}
      className={cn(
        "absolute inset-x-0.5 z-50 overflow-hidden rounded-2xl border border-border/75 bg-popover/98 text-popover-foreground shadow-[0_18px_50px_-18px_color-mix(in_oklab,var(--foreground)_28%,transparent)] ring-1 ring-foreground/5 backdrop-blur-xl",
        placement === "top" ? "bottom-full mb-2" : "top-full mt-2"
      )}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div
        ref={scrollRef}
        className="max-h-[min(32rem,58vh)] overflow-y-auto p-2"
      >
        {hasEntries ? (
          <>
            {builtinCommands.length > 0 ? (
              <section>
                <MenuSectionLabel>{t.studioSlashMenuBuiltIn}</MenuSectionLabel>
                {renderCommandRows(builtinCommands)}
              </section>
            ) : null}

            {runtimeCommands.length > 0 ? (
              <section className={builtinCommands.length > 0 ? "mt-1" : undefined}>
                <MenuSectionLabel>
                  {formatRuntimeLabel(runtimeCommands[0]?.runtimeId)}
                </MenuSectionLabel>
                {renderCommandRows(runtimeCommands)}
              </section>
            ) : null}

            {skills.length > 0 ? (
              <section className={commands.length > 0 ? "mt-1" : undefined}>
                <MenuSectionLabel>{t.studioSlashMenuSkills}</MenuSectionLabel>
                {skills.map((skill, index) => {
                  const menuIndex = commands.length + index
                  return (
                    <MenuRow
                      key={skill.slug}
                      canonicalName={`/${skill.slug}`}
                      description={getComposerSkillDescription(skill, locale)}
                      icon={RiStackLine}
                      label={getComposerSkillLabel(skill)}
                      selected={menuIndex === activeIndex}
                      onSelect={() => onSelectIndex(menuIndex)}
                      onAccept={() => onAcceptSkill(skill)}
                    />
                  )
                })}
              </section>
            ) : null}

            {mcpServers.length > 0 ? (
              <section
                className={
                  commands.length > 0 || skills.length > 0 ? "mt-1" : undefined
                }
              >
                <MenuSectionLabel>{t.studioSlashMenuMcp}</MenuSectionLabel>
                {mcpServers.map((server, index) => {
                  const menuIndex = commands.length + skills.length + index
                  return (
                    <MenuRow
                      key={server.id}
                      canonicalName="MCP"
                      description={server.description}
                      icon={RiPlugLine}
                      label={getComposerMcpLabel(server)}
                      selected={menuIndex === activeIndex}
                      onSelect={() => onSelectIndex(menuIndex)}
                      onAccept={onAcceptMcp}
                    />
                  )
                })}
              </section>
            ) : null}
          </>
        ) : (
          <div className="px-3 py-4 text-[13px] text-muted-foreground">
            {t.studioCommandMenuEmpty}
          </div>
        )}
      </div>
    </div>
  )
}
