"use client"

import * as React from "react"
import {
  Bot,
  Brain,
  Bug,
  Clock,
  Download,
  Eraser,
  Focus,
  GitFork,
  History,
  Info,
  ListTodo,
  LogOut,
  MessageCircle,
  Minimize2,
  Package,
  Plug,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react"

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

type ComposerCommandMenuProps = {
  activeIndex: number
  commands: SlashCommandDescriptor[]
  locale: string
  mcpServers: InstalledMcpServer[]
  onAcceptCommand: (command: SlashCommandDescriptor) => void
  onAcceptMcp: () => void
  onAcceptSkill: (skill: InstalledSkill) => void
  onSelectIndex: React.Dispatch<React.SetStateAction<number>>
  scrollRef: React.RefObject<HTMLDivElement | null>
  skills: InstalledSkill[]
  t: ReturnType<typeof useI18n>["t"]
}

type ComposerCommandMenuGroup = {
  id: string
  label: string
  items: React.ReactNode
}

const COMMAND_MENU_SURFACE_CLASS_NAME =
  "relative overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
const COMMAND_MENU_GROUP_LABEL_CLASS_NAME =
  "px-2 pt-1.5 pb-1 text-[11px] font-normal text-muted-foreground/60"
const COMMAND_MENU_ITEM_CLASS_NAME =
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1 text-left outline-none transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
const COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME =
  "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]"
const COMMAND_MENU_ITEM_ICON_SLOT_CLASS_NAME =
  "flex size-4 shrink-0 items-center justify-center text-muted-foreground/60"
const COMMAND_MENU_ITEM_GLYPH_CLASS_NAME = "size-3.5"

function humanizeCommandName(command: string) {
  return command
    .split(/[-_:]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function commandMenuTitle(command: string) {
  switch (command.toLowerCase()) {
    case "clear":
      return "Clear"
    case "compact":
      return "Compact Context"
    case "model":
      return "Model"
    case "fast":
      return "Fast Mode"
    case "plan":
      return "Plan Mode"
    case "default":
      return "Default Mode"
    case "review":
      return "Code Review"
    case "fork":
      return "Fork"
    case "side":
      return "Sidechat"
    case "status":
    case "session":
      return "Status"
    case "subagents":
      return "Subagents"
    case "feedback":
      return "Feedback AstraFlow"
    case "automation":
      return "Automation"
    default:
      return humanizeCommandName(command)
  }
}

function formatRuntimeLabel(runtimeId?: string) {
  switch (runtimeId) {
    case "codex":
    case "codex-direct":
      return "Codex"
    case "claude-code":
    case "claude-native":
      return "Claude Code"
    case "opencode":
    case "opencode-native":
      return "OpenCode"
    case "astraflow":
      return "AstraFlow"
    default:
      return runtimeId?.trim() || "Agent"
  }
}

function getCommandIcon(name: string): React.ElementType {
  switch (name.toLowerCase()) {
    case "clear":
      return Eraser
    case "compact":
      return Minimize2
    case "model":
    case "reasoning":
      return Brain
    case "fast":
      return Focus
    case "plan":
      return ListTodo
    case "default":
      return MessageCircle
    case "review":
    case "review-branch":
    case "review-commit":
      return Bug
    case "fork":
      return GitFork
    case "status":
    case "session":
      return Info
    case "subagents":
      return Bot
    case "feedback":
      return Bug
    case "automation":
      return Clock
    case "export":
      return Download
    case "approve":
    case "always":
    case "deny":
      return ShieldCheck
    case "goal":
    case "checkpoint":
      return Focus
    case "mcp":
      return Plug
    case "skills":
    case "packages":
      return Package
    case "tools":
      return Wrench
    case "reload":
      return RefreshCw
    case "undo":
    case "redo":
    case "tree":
    case "rewind":
      return History
    case "logout":
      return LogOut
    default:
      return Terminal
  }
}

function ComposerCommandMenuItem({
  description,
  icon,
  isActive,
  label,
  onSelect,
  onHighlight,
  trailingMeta,
}: {
  description?: string | null
  icon: React.ElementType
  isActive: boolean
  label: string
  onSelect: () => void
  onHighlight: () => void
  trailingMeta?: string | null
}) {
  const Icon = icon

  return (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? "true" : undefined}
      className={cn(
        COMMAND_MENU_ITEM_CLASS_NAME,
        isActive && COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME
      )}
      onMouseMove={() => {
        if (!isActive) {
          onHighlight()
        }
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={onSelect}
    >
      <span
        className={cn(
          COMMAND_MENU_ITEM_ICON_SLOT_CLASS_NAME,
          isActive && "text-foreground/70"
        )}
      >
        <Icon aria-hidden className={COMMAND_MENU_ITEM_GLYPH_CLASS_NAME} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 text-[11.5px] font-medium text-foreground/80">
            {label}
          </span>
          {description ? (
            <span className="truncate text-[11px] text-muted-foreground/55">
              {description}
            </span>
          ) : null}
        </span>
        {trailingMeta ? (
          <span className="shrink-0 pl-2 text-right text-[10.5px] text-muted-foreground/42">
            {trailingMeta}
          </span>
        ) : null}
      </span>
    </button>
  )
}

export function ComposerCommandMenu({
  activeIndex,
  commands,
  locale,
  mcpServers,
  onAcceptCommand,
  onAcceptMcp,
  onAcceptSkill,
  onSelectIndex,
  scrollRef,
  skills,
  t,
}: ComposerCommandMenuProps) {
  const builtinCommands = commands.filter(
    (command) => command.source === "builtin"
  )
  const runtimeCommands = commands.filter(
    (command) => command.source === "runtime"
  )
  const groups: ComposerCommandMenuGroup[] = []

  const renderCommandItems = (items: SlashCommandDescriptor[]) =>
    items.map((command) => {
      const index = skills.length + commands.indexOf(command)
      const description = [command.description, command.inputHint]
        .filter(Boolean)
        .join(" ")

      return (
        <ComposerCommandMenuItem
          key={`${command.source}:${command.runtimeId ?? "local"}:${command.name}`}
          description={description || t.studioCommandNoDescription}
          icon={getCommandIcon(command.name)}
          isActive={index === activeIndex}
          label={commandMenuTitle(command.name)}
          trailingMeta={`/${command.name}`}
          onHighlight={() => onSelectIndex(index)}
          onSelect={() => onAcceptCommand(command)}
        />
      )
    })

  if (skills.length > 0) {
    groups.push({
      id: "skills",
      label: t.studioSlashMenuSkills,
      items: skills.map((skill, index) => {
        return (
          <ComposerCommandMenuItem
            key={skill.slug}
            description={getComposerSkillDescription(skill, locale)}
            icon={Package}
            isActive={index === activeIndex}
            label={getComposerSkillLabel(skill)}
            trailingMeta={`/${skill.slug}`}
            onHighlight={() => onSelectIndex(index)}
            onSelect={() => onAcceptSkill(skill)}
          />
        )
      }),
    })
  }

  if (builtinCommands.length > 0) {
    groups.push({
      id: "built-in",
      label: t.studioSlashMenuBuiltIn,
      items: renderCommandItems(builtinCommands),
    })
  }

  if (runtimeCommands.length > 0) {
    groups.push({
      id: "runtime",
      label: formatRuntimeLabel(runtimeCommands[0]?.runtimeId),
      items: renderCommandItems(runtimeCommands),
    })
  }

  if (mcpServers.length > 0) {
    groups.push({
      id: "mcp",
      label: t.studioSlashMenuMcp,
      items: mcpServers.map((server, index) => {
        const menuIndex = skills.length + commands.length + index

        return (
          <ComposerCommandMenuItem
            key={server.id}
            description={server.description}
            icon={Plug}
            isActive={menuIndex === activeIndex}
            label={getComposerMcpLabel(server)}
            trailingMeta="MCP"
            onHighlight={() => onSelectIndex(menuIndex)}
            onSelect={onAcceptMcp}
          />
        )
      }),
    })
  }

  return (
    <div
      role="listbox"
      aria-label={t.studioCommandMenuTitle}
      className="pointer-events-auto absolute inset-x-0 bottom-full z-50 mb-2 overflow-visible px-1 pt-2"
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className={COMMAND_MENU_SURFACE_CLASS_NAME}>
        <div
          ref={scrollRef}
          className="max-h-72 scroll-py-1 overflow-y-auto p-1"
        >
          {groups.length > 0 ? (
            groups.map((group, groupIndex) => (
              <React.Fragment key={group.id}>
                {groupIndex > 0 ? (
                  <div className="mx-2 my-0.5 h-px bg-border last:hidden" />
                ) : null}
                <section role="group" aria-label={group.label}>
                  <div className={COMMAND_MENU_GROUP_LABEL_CLASS_NAME}>
                    {group.label}
                  </div>
                  {group.items}
                </section>
              </React.Fragment>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground/50">
              {t.studioCommandMenuEmpty}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
