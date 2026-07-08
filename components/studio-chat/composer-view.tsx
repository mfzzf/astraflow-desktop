"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiAddLine,
  RiArrowUpLine,
  RiBrainLine,
  RiCloseLine,
  RiLoader4Line,
  RiStopFill,
} from "@remixicon/react"
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  Feather,
  File,
  Folder,
  Link2,
  MessageSquare,
  Paperclip,
  Wrench,
} from "lucide-react"

import { AgentRuntimeIcon } from "@/components/agent-runtime-icons"
import type { useI18n } from "@/components/i18n-provider"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"
import type {
  StudioLocalProjectWithGitInfo,
  StudioPermissionMode,
  StudioSession,
  StudioTokenUsage,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { ContextUsageIndicator } from "./context-usage"
import { ComposerSessionScopeControls } from "./composer-session-scope"
import { getAgentChatModelLabel, getChatRuntimeLabel } from "./chat-preferences"
import {
  ChatComposerPluginsDialog,
  FileAttachmentChip,
  SelectOptionRow,
} from "./composer-parts"
import {
  formatComposerSessionUpdatedAt,
  getComposerMcpLabel,
  getComposerSkillDescription,
  getComposerSkillLabel,
  getRuntimeGuideDescription,
} from "./composer-utils"
import { useComposerPopupPlacement } from "./layout-hooks"
import type {
  ChatRunEnvironment,
  ChatRuntimeOption,
  ComposerSelectedExpert,
  ComposerMention,
  ComposerPopupPlacement,
  PendingAttachment,
  SlashComposerMenuEntry,
  WorkspaceFileCandidate,
} from "./types"

type ComposerPermissionOption = {
  value: StudioPermissionMode
  label: string
  icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>
  description: string
}

type ComposerReasoningOption = {
  value: ChatReasoningEffort
  label: string
  description: string
}

type ComposerActionMenuItemProps = {
  icon: React.ElementType
  label: string
  active?: boolean
  disabled?: boolean
  onSelect?: () => void
  onPreview?: () => void
}

type ComposerActionMenuSection = "experts" | "skills" | "connectors" | null

function ComposerActionMenuItem({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onSelect,
  onPreview,
}: ComposerActionMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none",
        active
          ? "bg-token-list-hover-background"
          : "hover:bg-token-list-hover-background",
        disabled && "cursor-default text-token-description-foreground"
      )}
      onMouseEnter={onPreview}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!disabled) {
          onSelect?.()
        }
      }}
    >
      <Icon
        aria-hidden
        className="size-3 shrink-0 text-token-description-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight
        aria-hidden
        className="size-3 shrink-0 text-token-description-foreground"
      />
    </button>
  )
}

function readExpertLabel(expert: ComposerSelectedExpert) {
  return expert.displayName.trim() || expert.expertId.trim()
}

function readExpertMeta(expert: ComposerSelectedExpert) {
  return expert.profession.trim() || expert.expertType.trim()
}

type ChatComposerViewProps = {
  composerRef: React.RefObject<HTMLDivElement | null>
  menuAnchorRef: React.RefObject<HTMLDivElement | null>
  slashMenuScrollRef: React.RefObject<HTMLDivElement | null>
  mentionMenuScrollRef: React.RefObject<HTMLDivElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  t: ReturnType<typeof useI18n>["t"]
  locale: string
  composerMenuPlacement: ComposerPopupPlacement
  showSlashCommandMenu: boolean
  slashMenuEntries: SlashComposerMenuEntry[]
  filteredSlashCommands: SlashCommandDescriptor[]
  filteredSlashSkills: InstalledSkill[]
  filteredSlashMcpServers: InstalledMcpServer[]
  installedSkills: InstalledSkill[]
  installedMcpServers: InstalledMcpServer[]
  availableExperts: ComposerSelectedExpert[]
  expertsLoading: boolean
  summoningExpertId: string
  selectedExpert: ComposerSelectedExpert | null
  onSummonExpert: (expert: ComposerSelectedExpert) => void
  onClearSelectedExpert: () => void
  activeCommandIndex: number
  setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>
  acceptSlashCommand: (command: SlashCommandDescriptor) => void
  acceptSlashSkill: (skill: InstalledSkill) => void
  acceptSlashMcp: () => void
  showMentionMenu: boolean
  selectedProjectId: string | null
  workspaceFilesLoading: boolean
  filteredWorkspaceFiles: WorkspaceFileCandidate[]
  activeMentionIndex: number
  setSelectedMentionIndex: React.Dispatch<React.SetStateAction<number>>
  acceptMentionFile: (file: WorkspaceFileCandidate) => void
  mentionSessionsLoading: boolean
  filteredMentionSessions: StudioSession[]
  acceptMentionSession: (session: StudioSession) => void
  addLocalMentionIndex: number
  acceptAddLocalFile: () => void
  value: string
  handleComposerValueChange: (value: string) => void
  onSubmit: () => void
  isBusy: boolean
  mentions: ComposerMention[]
  removeMention: (mention: ComposerMention) => void
  attachments: PendingAttachment[]
  onRemoveAttachment: (id: string) => void
  showCustomCaret: boolean
  setIsTextareaFocused: React.Dispatch<React.SetStateAction<boolean>>
  setCursorPosition: React.Dispatch<React.SetStateAction<number | null>>
  syncCursorPosition: (textarea?: HTMLTextAreaElement | null) => void
  handleComposerKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => void
  handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onAddFiles: (files: FileList | null) => void
  showPermissionMode: boolean
  permissionMode: StudioPermissionMode
  onPermissionModeChange: (permissionMode: StudioPermissionMode) => void
  iconOnlyControls: boolean
  permissionModeOption: ComposerPermissionOption
  PermissionModeIcon: React.ComponentType<{
    "aria-hidden"?: boolean
    className?: string
  }>
  permissionOptions: ComposerPermissionOption[]
  runtimeId: string
  onRuntimeChange: (runtimeId: string) => void
  runtimeDescription: string
  runtimeInfos: ChatRuntimeOption[]
  contextWindow: number
  contextUsage: StudioTokenUsage | null
  modelSelectOpen: boolean
  onModelSelectOpenChange: (open: boolean) => void
  model: SupportedChatModel
  onModelChange: (model: SupportedChatModel) => void
  modelOptions: AgentModelDefinition[]
  reasoningSelectOpen: boolean
  onReasoningSelectOpenChange: (open: boolean) => void
  resolvedReasoningEffort: ChatReasoningEffort
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void
  reasoningOptions: ComposerReasoningOption[]
  reasoningEffortLabel: string
  canSubmit: boolean
  onStop: () => void
  showSessionScopeControls: boolean
  selectedProjectValue: string
  handleProjectValueChange: (value: string) => void
  selectedProject: StudioLocalProjectWithGitInfo | null
  projectSearch: string
  setProjectSearch: React.Dispatch<React.SetStateAction<string>>
  isAddingProject: boolean
  onAddProject: () => void
  filteredLocalProjects: StudioLocalProjectWithGitInfo[]
  localProjects: StudioLocalProjectWithGitInfo[]
  runtimeEnvironment: ChatRunEnvironment
  handleEnvironmentChange: (value: string) => void
  hasAstraflowRuntime: boolean
  isAstraflowRuntime: boolean
}

export function ChatComposerView({
  composerRef,
  menuAnchorRef,
  slashMenuScrollRef,
  mentionMenuScrollRef,
  fileInputRef,
  textareaRef,
  t,
  locale,
  composerMenuPlacement,
  showSlashCommandMenu,
  slashMenuEntries,
  filteredSlashCommands,
  filteredSlashSkills,
  filteredSlashMcpServers,
  installedSkills,
  installedMcpServers,
  availableExperts,
  expertsLoading,
  summoningExpertId,
  selectedExpert,
  onSummonExpert,
  onClearSelectedExpert,
  activeCommandIndex,
  setSelectedCommandIndex,
  acceptSlashCommand,
  acceptSlashSkill,
  acceptSlashMcp,
  showMentionMenu,
  selectedProjectId,
  workspaceFilesLoading,
  filteredWorkspaceFiles,
  activeMentionIndex,
  setSelectedMentionIndex,
  acceptMentionFile,
  mentionSessionsLoading,
  filteredMentionSessions,
  acceptMentionSession,
  addLocalMentionIndex,
  acceptAddLocalFile,
  value,
  handleComposerValueChange,
  onSubmit,
  isBusy,
  mentions,
  removeMention,
  attachments,
  onRemoveAttachment,
  showCustomCaret,
  setIsTextareaFocused,
  setCursorPosition,
  syncCursorPosition,
  handleComposerKeyDown,
  handlePaste,
  onAddFiles,
  showPermissionMode,
  permissionMode,
  onPermissionModeChange,
  iconOnlyControls,
  permissionModeOption,
  PermissionModeIcon,
  permissionOptions,
  runtimeId,
  onRuntimeChange,
  runtimeDescription,
  runtimeInfos,
  contextWindow,
  contextUsage,
  modelSelectOpen,
  onModelSelectOpenChange,
  model,
  onModelChange,
  modelOptions,
  reasoningSelectOpen,
  onReasoningSelectOpenChange,
  resolvedReasoningEffort,
  onReasoningEffortChange,
  reasoningOptions,
  reasoningEffortLabel,
  canSubmit,
  onStop,
  showSessionScopeControls,
  selectedProjectValue,
  handleProjectValueChange,
  selectedProject,
  projectSearch,
  setProjectSearch,
  isAddingProject,
  onAddProject,
  filteredLocalProjects,
  localProjects,
  runtimeEnvironment,
  handleEnvironmentChange,
  hasAstraflowRuntime,
  isAstraflowRuntime,
}: ChatComposerViewProps) {
  const router = useRouter()
  const composerActionMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [composerActionMenuOpen, setComposerActionMenuOpen] =
    React.useState(false)
  const [composerActionMenuSection, setComposerActionMenuSection] =
    React.useState<ComposerActionMenuSection>("experts")
  const composerActionMenuPlacement = useComposerPopupPlacement(
    menuAnchorRef,
    composerActionMenuOpen
  )
  const enabledSkills = installedSkills.filter((skill) => skill.enabled)
  const enabledMcpServers = installedMcpServers.filter(
    (server) => server.enabled
  )
  const visibleComposerExperts = availableExperts.slice(0, 4)
  const visibleEnabledSkills = enabledSkills.slice(0, 3)
  const visibleEnabledMcpServers = enabledMcpServers.slice(0, 3)

  const closeComposerActionMenu = React.useCallback(() => {
    setComposerActionMenuOpen(false)
  }, [])

  const toggleComposerActionMenu = React.useCallback(() => {
    if (isBusy) {
      return
    }

    setComposerActionMenuOpen((current) => {
      const nextOpen = !current

      if (nextOpen) {
        setComposerActionMenuSection("experts")
      }

      return nextOpen
    })
  }, [isBusy])

  const openComposerFilePicker = React.useCallback(() => {
    closeComposerActionMenu()

    window.setTimeout(() => {
      fileInputRef.current?.click()
    }, 0)
  }, [closeComposerActionMenu, fileInputRef])

  const openComposerPlugins = React.useCallback(() => {
    closeComposerActionMenu()
    window.dispatchEvent(new CustomEvent("astraflow:open-composer-plugins"))
  }, [closeComposerActionMenu])

  const openComposerExperts = React.useCallback(() => {
    closeComposerActionMenu()
    router.push("/skills?tab=experts")
  }, [closeComposerActionMenu, router])

  const handleComposerInputValueChange = React.useCallback(
    (nextValue: string) => {
      if (composerActionMenuOpen) {
        closeComposerActionMenu()
      }

      handleComposerValueChange(nextValue)
    },
    [
      closeComposerActionMenu,
      composerActionMenuOpen,
      handleComposerValueChange,
    ]
  )

  const handleTextareaKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (composerActionMenuOpen && event.key === "Escape") {
        event.preventDefault()
        closeComposerActionMenu()
        return
      }

      handleComposerKeyDown(event)
    },
    [
      closeComposerActionMenu,
      composerActionMenuOpen,
      handleComposerKeyDown,
    ]
  )

  React.useEffect(() => {
    if (!composerActionMenuOpen) {
      return
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target

      if (
        target instanceof Node &&
        composerActionMenuRef.current?.contains(target)
      ) {
        return
      }

      closeComposerActionMenu()
    }

    document.addEventListener("mousedown", handleDocumentMouseDown)

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown)
    }
  }, [closeComposerActionMenu, composerActionMenuOpen])

  return (
    <div
      ref={composerRef}
      data-tour-id="studio-composer"
      className="relative flex w-full flex-col overflow-visible rounded-[1.875rem] bg-muted/40 p-0.5 shadow-lg shadow-foreground/5"
    >
      <div ref={menuAnchorRef} className="relative w-full">
        {showSlashCommandMenu ? (
          <div
            role="listbox"
            aria-label={t.studioCommandMenuTitle}
            className={cn(
              "absolute inset-x-0.5 z-50 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl ring-1 shadow-foreground/10 ring-foreground/5",
              composerMenuPlacement === "top"
                ? "bottom-full mb-1"
                : "top-full mt-1"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div
              ref={slashMenuScrollRef}
              className="max-h-64 overflow-y-auto p-1.5"
            >
              {slashMenuEntries.length > 0 ? (
                <>
                  {filteredSlashCommands.map((command, index) => {
                    const selected = index === activeCommandIndex

                    return (
                      <button
                        key={`${command.source}:${command.runtimeId ?? "local"}:${command.name}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-active={selected ? "true" : undefined}
                        className={cn(
                          "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                          selected
                            ? "bg-accent text-accent-foreground"
                            : "text-popover-foreground hover:bg-accent/60"
                        )}
                        onMouseEnter={() => setSelectedCommandIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          acceptSlashCommand(command)
                        }}
                      >
                        <span className="shrink-0 text-[13px] font-medium capitalize">
                          {command.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                          {command.description || t.studioCommandNoDescription}
                          {command.inputHint ? (
                            <span className="text-muted-foreground/70">
                              {" "}
                              {command.inputHint}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}

                  {filteredSlashSkills.length > 0 ? (
                    <div
                      className={
                        filteredSlashCommands.length > 0 ? "mt-1" : undefined
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                        {t.studioSlashMenuSkills}
                      </div>
                      {filteredSlashSkills.map((skill, index) => {
                        const menuIndex = filteredSlashCommands.length + index
                        const selected = menuIndex === activeCommandIndex
                        const description = getComposerSkillDescription(
                          skill,
                          locale
                        )

                        return (
                          <button
                            key={skill.slug}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-active={selected ? "true" : undefined}
                            className={cn(
                              "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                              selected
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent/60"
                            )}
                            onMouseEnter={() =>
                              setSelectedCommandIndex(menuIndex)
                            }
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              acceptSlashSkill(skill)
                            }}
                          >
                            <span className="shrink-0 text-[13px] font-medium">
                              {getComposerSkillLabel(skill)}
                            </span>
                            {description ? (
                              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                                {description}
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1" />
                            )}
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              /{skill.slug}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  {filteredSlashMcpServers.length > 0 ? (
                    <div
                      className={
                        filteredSlashCommands.length > 0 ||
                        filteredSlashSkills.length > 0
                          ? "mt-1"
                          : undefined
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                        {t.studioSlashMenuMcp}
                      </div>
                      {filteredSlashMcpServers.map((server, index) => {
                        const menuIndex =
                          filteredSlashCommands.length +
                          filteredSlashSkills.length +
                          index
                        const selected = menuIndex === activeCommandIndex

                        return (
                          <button
                            key={server.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-active={selected ? "true" : undefined}
                            className={cn(
                              "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                              selected
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent/60"
                            )}
                            onMouseEnter={() =>
                              setSelectedCommandIndex(menuIndex)
                            }
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              acceptSlashMcp()
                            }}
                          >
                            <span className="shrink-0 text-[13px] font-medium">
                              {getComposerMcpLabel(server)}
                            </span>
                            {server.description ? (
                              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                                {server.description}
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1" />
                            )}
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              MCP
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="px-3 py-3 text-[13px] text-muted-foreground">
                  {t.studioCommandMenuEmpty}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {showMentionMenu ? (
          <div
            role="listbox"
            aria-label={t.studioMentionMenuTitle}
            className={cn(
              "absolute inset-x-0.5 z-50 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl ring-1 shadow-foreground/10 ring-foreground/5",
              composerMenuPlacement === "top"
                ? "bottom-full mb-1"
                : "top-full mt-1"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div
              ref={mentionMenuScrollRef}
              className="max-h-72 overflow-y-auto p-1.5"
            >
              <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                {t.studioMentionFilesTitle}
              </div>

              {!selectedProjectId ? (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionProjectRequired}
                </div>
              ) : workspaceFilesLoading &&
                filteredWorkspaceFiles.length === 0 ? (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionFilesLoading}
                </div>
              ) : filteredWorkspaceFiles.length > 0 ? (
                filteredWorkspaceFiles.map((file, index) => {
                  const selected = index === activeMentionIndex
                  const MentionIcon = file.kind === "folder" ? Folder : File

                  return (
                    <button
                      key={`${file.kind}:${file.path}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={selected ? "true" : undefined}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "text-popover-foreground hover:bg-accent/60"
                      )}
                      onMouseEnter={() => setSelectedMentionIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        acceptMentionFile(file)
                      }}
                    >
                      <MentionIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="shrink-0 text-[13px] font-medium">
                        {file.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {file.relativePath}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionFilesEmpty}
                </div>
              )}

              <div className="mt-1 border-t pt-1">
                <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                  {t.studioMentionSessionsTitle}
                </div>

                {mentionSessionsLoading &&
                filteredMentionSessions.length === 0 ? (
                  <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {t.studioMentionSessionsLoading}
                  </div>
                ) : filteredMentionSessions.length > 0 ? (
                  filteredMentionSessions.map((session, index) => {
                    const menuIndex = filteredWorkspaceFiles.length + index
                    const selected = menuIndex === activeMentionIndex

                    return (
                      <button
                        key={session.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-active={selected ? "true" : undefined}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                          selected
                            ? "bg-accent text-accent-foreground"
                            : "text-popover-foreground hover:bg-accent/60"
                        )}
                        onMouseEnter={() => setSelectedMentionIndex(menuIndex)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          acceptMentionSession(session)
                        }}
                      >
                        <MessageSquare
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {session.title}
                        </span>
                        <span className="shrink-0 text-[13px] text-muted-foreground">
                          {formatComposerSessionUpdatedAt(session.updatedAt)}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {t.studioMentionSessionsEmpty}
                  </div>
                )}
              </div>

              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeMentionIndex === addLocalMentionIndex}
                  data-active={
                    activeMentionIndex === addLocalMentionIndex
                      ? "true"
                      : undefined
                  }
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                    activeMentionIndex === addLocalMentionIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground hover:bg-accent/60"
                  )}
                  onMouseEnter={() =>
                    setSelectedMentionIndex(addLocalMentionIndex)
                  }
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    acceptAddLocalFile()
                  }}
                >
                  <RiAddLine
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {t.studioMentionAddLocalFile}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <PromptInput
          value={value}
          onValueChange={handleComposerInputValueChange}
          onSubmit={onSubmit}
          isLoading={isBusy}
          className="w-full rounded-[1.625rem] border bg-background/95 px-3.5 py-3 shadow-sm"
        >
          {mentions.length > 0 ? (
            <div
              className="mb-2 flex flex-wrap gap-1.5 px-1"
              onClick={(event) => event.stopPropagation()}
            >
              {mentions.map((mention) => (
                <span
                  key={
                    mention.kind === "session"
                      ? `session:${mention.sessionId}`
                      : `${mention.kind}:${mention.path}`
                  }
                  title={
                    mention.kind === "session"
                      ? mention.title
                      : mention.relativePath
                  }
                  className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 text-xs font-medium text-foreground"
                >
                  {mention.kind === "session" ? (
                    <MessageSquare
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : mention.kind === "folder" ? (
                    <Folder
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <File
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="max-w-44 min-w-0 truncate">
                    {mention.kind === "session" ? mention.title : mention.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t.studioMentionRemove}
                    className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeMention(mention)
                    }}
                  >
                    <RiCloseLine aria-hidden className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div
              className="mb-2 flex flex-wrap gap-2 px-1"
              onClick={(event) => event.stopPropagation()}
            >
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border bg-muted",
                    attachment.type === "image"
                      ? "size-16"
                      : "h-16 w-52 max-w-full"
                  )}
                >
                  {attachment.type === "image" && attachment.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <FileAttachmentChip attachment={attachment} compact />
                  )}
                  <button
                    type="button"
                    aria-label={t.studioRemoveAttachment}
                    className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition group-hover:opacity-100 [&_svg]:size-3.5"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveAttachment(attachment.id)
                    }}
                  >
                    <RiCloseLine aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative min-w-0 px-1">
            {showCustomCaret ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-2 left-1 z-10 h-5 w-px animate-[studio-caret-blink_1.05s_steps(1,end)_infinite] rounded-full bg-foreground"
              />
            ) : null}

            <PromptInputTextarea
              textareaRef={textareaRef}
              placeholder={t.studioPromptPlaceholder}
              onFocus={(event) => {
                closeComposerActionMenu()
                setIsTextareaFocused(true)
                syncCursorPosition(event.currentTarget)
              }}
              onBlur={() => {
                setIsTextareaFocused(false)
                setCursorPosition(null)
              }}
              onClick={(event) => syncCursorPosition(event.currentTarget)}
              onKeyDown={handleTextareaKeyDown}
              onKeyUp={(event) => syncCursorPosition(event.currentTarget)}
              onPaste={handlePaste}
              onSelect={(event) => syncCursorPosition(event.currentTarget)}
              className={cn(
                "max-h-40 min-h-9 w-full px-0 py-1.5 text-base text-foreground placeholder:text-muted-foreground md:text-base",
                showCustomCaret && "caret-transparent"
              )}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            <div
              className="flex shrink-0 items-center gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  onAddFiles(event.target.files)
                  event.target.value = ""
                }}
              />
              <div ref={composerActionMenuRef} className="relative flex">
                <PromptInputAction tooltip={t.studioAttach}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isBusy}
                    aria-expanded={composerActionMenuOpen}
                    aria-haspopup="menu"
                    className={cn(
                      "size-7 rounded-full p-0 transition-colors hover:bg-muted/60 [&_svg]:size-4",
                      composerActionMenuOpen && "bg-muted/60"
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleComposerActionMenu()
                    }}
                  >
                    <RiAddLine aria-hidden />
                  </Button>
                </PromptInputAction>

                {composerActionMenuOpen ? (
                  <div
                    className={cn(
                      "absolute left-0 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-1.5 sm:flex-row sm:items-start",
                      composerActionMenuPlacement === "top"
                        ? "bottom-full mb-1"
                        : "top-full mt-1"
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  >
                    <div
                      role="menu"
                      aria-label={t.studioAttach}
                      className="w-40 rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm"
                    >
                      <ComposerActionMenuItem
                        icon={Paperclip}
                        label={t.studioComposerActionAddFile}
                        onPreview={() => setComposerActionMenuSection(null)}
                        onSelect={openComposerFilePicker}
                      />
                      <div className="mx-3 my-1 h-px bg-token-menu-border" />
                      <ComposerActionMenuItem
                        icon={Feather}
                        label={t.studioComposerActionMode}
                        onPreview={() => setComposerActionMenuSection(null)}
                      />
                      <ComposerActionMenuItem
                        icon={Bot}
                        label={t.studioComposerActionExperts}
                        active={composerActionMenuSection === "experts"}
                        onPreview={() => setComposerActionMenuSection("experts")}
                      />
                      <ComposerActionMenuItem
                        icon={Wrench}
                        label={t.studioComposerActionSkills}
                        active={composerActionMenuSection === "skills"}
                        onPreview={() => setComposerActionMenuSection("skills")}
                        onSelect={openComposerPlugins}
                      />
                      <ComposerActionMenuItem
                        icon={Link2}
                        label={t.studioComposerActionConnectors}
                        active={composerActionMenuSection === "connectors"}
                        onPreview={() =>
                          setComposerActionMenuSection("connectors")
                        }
                        onSelect={openComposerPlugins}
                      />
                    </div>

                    {composerActionMenuSection === "experts" ? (
                      <div
                        role="menu"
                        aria-label={t.studioComposerActionExperts}
                        className="w-40 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:mt-[4.25rem]"
                      >
                        {expertsLoading ? (
                          <div className="flex h-7 items-center justify-center gap-1.5 px-2 text-center text-xs text-token-description-foreground">
                            <RiLoader4Line
                              aria-hidden
                              className="size-3 animate-spin"
                            />
                            <span>{t.studioComposerExpertsLoading}</span>
                          </div>
                        ) : visibleComposerExperts.length > 0 ? (
                          visibleComposerExperts.map((expert) => {
                            const expertId = expert.expertId.trim()
                            const label = readExpertLabel(expert)
                            const meta = readExpertMeta(expert)
                            const summoning = summoningExpertId === expertId

                            return (
                              <button
                                key={expertId || label}
                                type="button"
                                role="menuitem"
                                disabled={summoning || !expertId}
                                className="flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background disabled:cursor-default disabled:text-token-description-foreground"
                                title={[label, meta].filter(Boolean).join(" · ")}
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  closeComposerActionMenu()
                                  onSummonExpert(expert)
                                }}
                              >
                                <Bot
                                  aria-hidden
                                  className="size-3 shrink-0 text-token-description-foreground"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {label || expertId}
                                </span>
                                {summoning ? (
                                  <RiLoader4Line
                                    aria-hidden
                                    className="size-3 shrink-0 animate-spin text-token-description-foreground"
                                  />
                                ) : meta ? (
                                  <span className="max-w-10 shrink-0 truncate text-token-description-foreground">
                                    {meta}
                                  </span>
                                ) : null}
                              </button>
                            )
                          })
                        ) : (
                          <div className="flex h-7 items-center justify-center px-2 text-center text-xs text-token-description-foreground">
                            {t.studioComposerExpertsEmpty}
                          </div>
                        )}
                        <div className="mx-3 my-1 h-px bg-token-menu-border" />
                        <button
                          type="button"
                          role="menuitem"
                          className="flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openComposerExperts()
                          }}
                        >
                          <ArrowUpRight
                            aria-hidden
                            className="size-3 shrink-0 text-token-description-foreground"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.studioComposerExpertsMore}
                          </span>
                        </button>
                      </div>
                    ) : null}

                    {composerActionMenuSection === "skills" ? (
                      <div
                        role="menu"
                        aria-label={t.studioComposerActionSkills}
                        className="w-44 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:mt-[6rem]"
                      >
                        <div className="px-2 py-1 text-xs text-token-description-foreground">
                          {t.studioComposerPluginsAppliedSummary(
                            enabledSkills.length,
                            installedSkills.length
                          )}
                        </div>
                        {visibleEnabledSkills.length > 0 ? (
                          visibleEnabledSkills.map((skill) => (
                            <div
                              key={skill.slug}
                              className="flex h-7 min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-xs text-token-foreground"
                              title={skill.installPath}
                            >
                              <Wrench
                                aria-hidden
                                className="size-3 shrink-0 text-token-description-foreground"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {getComposerSkillLabel(skill)}
                              </span>
                              <span className="shrink-0 text-token-description-foreground">
                                {t.studioComposerPluginApplied}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="flex h-7 items-center px-2 text-xs text-token-description-foreground">
                            {t.studioComposerSkillsEmpty}
                          </div>
                        )}
                        <div className="mx-3 my-1 h-px bg-token-menu-border" />
                        <button
                          type="button"
                          role="menuitem"
                          className="flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openComposerPlugins()
                          }}
                        >
                          <ArrowUpRight
                            aria-hidden
                            className="size-3 shrink-0 text-token-description-foreground"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.studioComposerPluginsOpenMarket}
                          </span>
                        </button>
                      </div>
                    ) : null}

                    {composerActionMenuSection === "connectors" ? (
                      <div
                        role="menu"
                        aria-label={t.studioComposerActionConnectors}
                        className="w-44 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:mt-[7.75rem]"
                      >
                        <div className="px-2 py-1 text-xs text-token-description-foreground">
                          {t.studioComposerPluginsAppliedSummary(
                            enabledMcpServers.length,
                            installedMcpServers.length
                          )}
                        </div>
                        {visibleEnabledMcpServers.length > 0 ? (
                          visibleEnabledMcpServers.map((server) => (
                            <div
                              key={server.id}
                              className="flex h-7 min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-xs text-token-foreground"
                              title={server.description || server.name}
                            >
                              <Link2
                                aria-hidden
                                className="size-3 shrink-0 text-token-description-foreground"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {getComposerMcpLabel(server)}
                              </span>
                              <span className="shrink-0 text-token-description-foreground">
                                MCP
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="flex h-7 items-center px-2 text-xs text-token-description-foreground">
                            {t.studioComposerConnectorsEmpty}
                          </div>
                        )}
                        <div className="mx-3 my-1 h-px bg-token-menu-border" />
                        <button
                          type="button"
                          role="menuitem"
                          className="flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openComposerPlugins()
                          }}
                        >
                          <ArrowUpRight
                            aria-hidden
                            className="size-3 shrink-0 text-token-description-foreground"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.studioComposerPluginsOpenMarket}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selectedExpert ? (
                <button
                  type="button"
                  className="inline-flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-full bg-muted/60 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  title={[
                    selectedExpert.displayName,
                    selectedExpert.profession,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  aria-label={t.studioComposerSelectedExpertRemove(
                    selectedExpert.displayName
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClearSelectedExpert()
                  }}
                >
                  <RiCloseLine
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <Bot
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate">
                    {selectedExpert.displayName}
                  </span>
                </button>
              ) : null}
              {showPermissionMode ? (
                <Select
                  value={permissionMode}
                  onValueChange={(nextValue) =>
                    onPermissionModeChange(nextValue as StudioPermissionMode)
                  }
                  disabled={isBusy}
                >
                  <SelectTrigger
                    data-tour-id="studio-composer-permission"
                    size="sm"
                    className={cn(
                      "h-7 max-w-40 rounded-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 sm:max-w-44",
                      iconOnlyControls &&
                        "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                    )}
                    aria-label={t.studioPermissionMode}
                    title={permissionModeOption.description}
                  >
                    <PermissionModeIcon aria-hidden className="size-3.5" />
                    <span
                      className={cn("truncate", iconOnlyControls && "sr-only")}
                    >
                      {permissionModeOption.label}
                    </span>
                  </SelectTrigger>
                  <SelectContent position="popper" side="top" align="start">
                    <SelectGroup>
                      {permissionOptions.map((option) => {
                        const Icon = option.icon

                        return (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="pr-10"
                          >
                            <SelectOptionRow
                              description={option.description}
                              icon={
                                <Icon
                                  aria-hidden
                                  className="size-4 text-muted-foreground"
                                />
                              }
                              label={option.label}
                            />
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <PromptInputActions
              className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <Select
                value={runtimeId}
                onValueChange={onRuntimeChange}
                disabled={isBusy}
              >
                <SelectTrigger
                  data-tour-id="studio-composer-runtime"
                  size="sm"
                  className={cn(
                    "h-7 max-w-40 rounded-full bg-background px-2.5 text-xs sm:max-w-48",
                    iconOnlyControls &&
                      "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                  )}
                  aria-label={t.studioAgentRuntime}
                  title={runtimeDescription}
                >
                  <AgentRuntimeIcon
                    runtimeId={runtimeId}
                    className="size-3.5"
                  />
                  <span
                    className={cn("truncate", iconOnlyControls && "sr-only")}
                  >
                    {getChatRuntimeLabel(runtimeId, runtimeInfos)}
                  </span>
                </SelectTrigger>
                <SelectContent position="popper" side="top" align="end">
                  <SelectGroup>
                    {runtimeInfos.map((runtime) => (
                      <SelectItem
                        key={runtime.id}
                        value={runtime.id}
                        textValue={runtime.label}
                        title={getRuntimeGuideDescription(
                          runtime.id,
                          runtime.description,
                          t
                        )}
                        className="pr-10"
                      >
                        <SelectOptionRow
                          description={getRuntimeGuideDescription(
                            runtime.id,
                            runtime.description,
                            t
                          )}
                          icon={<AgentRuntimeIcon runtimeId={runtime.id} />}
                          label={runtime.label}
                        />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <ContextUsageIndicator
                contextWindow={contextWindow}
                usage={contextUsage}
              />

              <Select
                open={modelSelectOpen}
                onOpenChange={onModelSelectOpenChange}
                value={model}
                onValueChange={(nextValue) =>
                  onModelChange(nextValue as SupportedChatModel)
                }
                disabled={isBusy}
              >
                <SelectTrigger
                  data-tour-id="studio-composer-model"
                  size="sm"
                  className="h-7 max-w-36 rounded-full bg-background px-2.5 text-xs sm:max-w-44"
                  aria-label={t.studioChatModel}
                  title={t.studioChatModelDescription}
                >
                  <span className="truncate">
                    {getAgentChatModelLabel(model, modelOptions)}
                  </span>
                </SelectTrigger>
                <SelectContent position="popper" side="top" align="end">
                  <SelectGroup>
                    {modelOptions.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        className="pr-10"
                      >
                        <SelectOptionRow
                          description={t.studioChatModelDescription}
                          label={option.label}
                        />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Select
                open={reasoningSelectOpen}
                onOpenChange={onReasoningSelectOpenChange}
                value={resolvedReasoningEffort}
                onValueChange={(nextValue) =>
                  onReasoningEffortChange(nextValue as ChatReasoningEffort)
                }
                disabled={isBusy || reasoningOptions.length <= 1}
              >
                <SelectTrigger
                  size="sm"
                  className={cn(
                    "h-7 rounded-full bg-background px-2.5 text-xs",
                    iconOnlyControls &&
                      "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                  )}
                  aria-label={t.studioReasoningEffort}
                  title={
                    reasoningOptions.find(
                      (option) => option.value === resolvedReasoningEffort
                    )?.description
                  }
                >
                  <RiBrainLine aria-hidden className="size-3.5" />
                  <span className={cn(iconOnlyControls && "sr-only")}>
                    {reasoningEffortLabel}
                  </span>
                </SelectTrigger>
                <SelectContent position="popper" side="top" align="end">
                  <SelectGroup>
                    {reasoningOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="pr-10"
                      >
                        <SelectOptionRow
                          description={option.description}
                          label={option.label}
                        />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="icon-sm"
                className="size-7 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 [&_svg]:size-3.5"
                disabled={!canSubmit && !isBusy}
                aria-label={isBusy ? t.studioStop : t.studioSend}
                onClick={(event) => {
                  event.stopPropagation()
                  if (isBusy) {
                    onStop()
                  } else {
                    onSubmit()
                  }
                }}
              >
                {isBusy ? (
                  <RiStopFill aria-hidden />
                ) : (
                  <RiArrowUpLine aria-hidden />
                )}
              </Button>
            </PromptInputActions>
          </div>
        </PromptInput>
        <ChatComposerPluginsDialog />
      </div>

      <ComposerSessionScopeControls
        showSessionScopeControls={showSessionScopeControls}
        selectedProjectValue={selectedProjectValue}
        handleProjectValueChange={handleProjectValueChange}
        isBusy={isBusy}
        selectedProject={selectedProject}
        projectSearch={projectSearch}
        setProjectSearch={setProjectSearch}
        isAddingProject={isAddingProject}
        onAddProject={onAddProject}
        filteredLocalProjects={filteredLocalProjects}
        localProjects={localProjects}
        runtimeEnvironment={runtimeEnvironment}
        handleEnvironmentChange={handleEnvironmentChange}
        hasAstraflowRuntime={hasAstraflowRuntime}
        isAstraflowRuntime={isAstraflowRuntime}
        t={t}
      />
    </div>
  )
}
