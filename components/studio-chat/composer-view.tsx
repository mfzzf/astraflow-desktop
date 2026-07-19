"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiAddLine,
  RiArrowUpLine,
  RiCloseLine,
  RiLoader4Line,
  RiStackLine,
  RiStopFill,
} from "@remixicon/react"
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  Download,
  Feather,
  Folder,
  Link2,
  MessageSquare,
  Paperclip,
  TriangleAlert,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { AgentRuntimeIcon } from "@/components/agent-runtime-icons"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
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
  StudioWorkspace,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"
import {
  isDownloadableAgentRuntimeId,
  resolveAgentRuntimeSelectionAction,
  useAgentRuntimeInstallations,
  type DownloadableAgentRuntimeId,
} from "@/hooks/use-agent-runtime-installations"

import { ContextUsageIndicator } from "./context-usage"
import { ComposerVoiceButton } from "./composer-voice-button"
import { ComposerVoiceRecorderBar } from "./composer-voice-recorder-bar"
import { ComposerSessionScopeControls } from "./composer-session-scope"
import { DEFAULT_CHAT_RUNTIME_ID } from "./constants"
import { getAgentChatModelLabel, getChatRuntimeLabel } from "./chat-preferences"
import { ModelEffortPicker } from "./model-effort-picker"
import { SlashCommandMenu } from "./slash-command-menu"
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
  ChatRuntimeOption,
  ComposerSelectedExpert,
  ComposerMention,
  ComposerPopupPlacement,
  PendingAttachment,
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

type ComposerActionMenuSection =
  "mode" | "experts" | "skills" | "connectors" | null

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
      onMouseEnter={() => {
        if (!disabled) {
          onPreview?.()
        }
      }}
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
  filteredSlashCommands: SlashCommandDescriptor[]
  filteredSlashSkills: InstalledSkill[]
  filteredSlashMcpServers: InstalledMcpServer[]
  installedSkills: InstalledSkill[]
  installedMcpServers: InstalledMcpServer[]
  availableExperts: ComposerSelectedExpert[]
  expertsLoading: boolean
  summoningExpertId: string
  selectedExpert: ComposerSelectedExpert | null
  selectedSlashSkills: InstalledSkill[]
  onSummonExpert: (expert: ComposerSelectedExpert) => void
  onClearSelectedExpert: () => void
  removeSlashSkill: (skillSlug: string) => void
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
  isVoiceRecording: boolean
  isVoiceTranscribing: boolean
  voiceDurationLabel: string
  voiceLabels: {
    input: string
    stop: string
    submit: string
    transcribing: string
  }
  voiceWaveformLevels: readonly number[]
  onVoiceCancel: () => void
  onVoiceSubmit: () => void
  onVoiceToggle: () => void
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
  denseControls: boolean
  agentModeControls: React.ReactNode
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
  workspace: StudioWorkspace | null
  workspaces: StudioWorkspace[]
  workspacesLoading: boolean
  onWorkspaceChange: (workspaceId: string | null) => void
  onAddWorkspace: () => void
  selectedProject: StudioLocalProjectWithGitInfo | null
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
  filteredSlashCommands,
  filteredSlashSkills,
  filteredSlashMcpServers,
  installedSkills,
  installedMcpServers,
  availableExperts,
  expertsLoading,
  summoningExpertId,
  selectedExpert,
  selectedSlashSkills,
  onSummonExpert,
  onClearSelectedExpert,
  removeSlashSkill,
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
  isVoiceRecording,
  isVoiceTranscribing,
  voiceDurationLabel,
  voiceLabels,
  voiceWaveformLevels,
  onVoiceCancel,
  onVoiceSubmit,
  onVoiceToggle,
  showPermissionMode,
  permissionMode,
  onPermissionModeChange,
  iconOnlyControls,
  permissionModeOption,
  PermissionModeIcon,
  permissionOptions,
  denseControls,
  agentModeControls,
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
  workspace,
  workspaces,
  workspacesLoading,
  onWorkspaceChange,
  onAddWorkspace,
  selectedProject,
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
  const selectedModelLabel = getAgentChatModelLabel(model, modelOptions)
  const {
    desktopAvailable: runtimeInstallerAvailable,
    installRuntime,
    loading: runtimeInstallationsLoading,
    statuses: runtimeInstallationStatuses,
  } = useAgentRuntimeInstallations()
  const [runtimeSelectOpen, setRuntimeSelectOpen] = React.useState(false)
  const runtimeInstallRequestsRef = React.useRef(
    new Set<DownloadableAgentRuntimeId>()
  )
  const pendingRuntimeSelectionRef =
    React.useRef<DownloadableAgentRuntimeId | null>(null)
  const runtimeInstallerMountedRef = React.useRef(true)

  React.useEffect(() => {
    runtimeInstallerMountedRef.current = true

    return () => {
      runtimeInstallerMountedRef.current = false
      pendingRuntimeSelectionRef.current = null
    }
  }, [])

  const handleRuntimeInstall = React.useCallback(
    async (runtimeId: DownloadableAgentRuntimeId) => {
      if (runtimeInstallRequestsRef.current.has(runtimeId)) {
        return
      }

      if (!runtimeInstallerAvailable) {
        toast.error(t.studioAgentRuntimeDesktopOnly)
        return
      }

      runtimeInstallRequestsRef.current.add(runtimeId)
      pendingRuntimeSelectionRef.current = runtimeId

      try {
        const status = await installRuntime(runtimeId)

        if (
          status.ready &&
          runtimeInstallerMountedRef.current &&
          pendingRuntimeSelectionRef.current === runtimeId
        ) {
          pendingRuntimeSelectionRef.current = null
          onRuntimeChange(runtimeId)
          setRuntimeSelectOpen(false)
        }
      } catch (error) {
        toast.error(t.studioAgentRuntimeInstallFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        runtimeInstallRequestsRef.current.delete(runtimeId)
        if (pendingRuntimeSelectionRef.current === runtimeId) {
          pendingRuntimeSelectionRef.current = null
        }
      }
    },
    [
      installRuntime,
      onRuntimeChange,
      runtimeInstallerAvailable,
      setRuntimeSelectOpen,
      t,
    ]
  )

  const handleRuntimeSelection = React.useCallback(
    (nextRuntimeId: string) => {
      const downloadableRuntimeId = isDownloadableAgentRuntimeId(nextRuntimeId)
        ? nextRuntimeId
        : null
      const action = resolveAgentRuntimeSelectionAction({
        desktopAvailable: runtimeInstallerAvailable,
        loading: runtimeInstallationsLoading,
        runtimeId: nextRuntimeId,
        status: downloadableRuntimeId
          ? runtimeInstallationStatuses[downloadableRuntimeId]
          : undefined,
      })

      if (action === "select") {
        pendingRuntimeSelectionRef.current = null
        onRuntimeChange(nextRuntimeId)
      } else if (action === "install" && downloadableRuntimeId) {
        void handleRuntimeInstall(downloadableRuntimeId)
      } else if (action === "unavailable") {
        toast.error(t.studioAgentRuntimeDesktopOnly)
      }
    },
    [
      handleRuntimeInstall,
      onRuntimeChange,
      runtimeInstallationStatuses,
      runtimeInstallationsLoading,
      runtimeInstallerAvailable,
      t,
    ]
  )

  React.useEffect(() => {
    if (
      !runtimeInstallerAvailable ||
      runtimeInstallationsLoading ||
      !isDownloadableAgentRuntimeId(runtimeId)
    ) {
      return
    }

    const status = runtimeInstallationStatuses[runtimeId]

    if (status && !status.ready) {
      onRuntimeChange(DEFAULT_CHAT_RUNTIME_ID)
    }
  }, [
    onRuntimeChange,
    runtimeId,
    runtimeInstallationStatuses,
    runtimeInstallationsLoading,
    runtimeInstallerAvailable,
  ])

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
    [closeComposerActionMenu, composerActionMenuOpen, handleComposerValueChange]
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
    [closeComposerActionMenu, composerActionMenuOpen, handleComposerKeyDown]
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

  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false)
  const dragDepthRef = React.useRef(0)

  const hasDraggedFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files")

  const handleComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }

    event.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingFiles(true)
  }

  const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }

  const handleComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false)
    }
  }

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }

    event.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)

    const files = event.dataTransfer?.files

    if (files && files.length > 0) {
      onAddFiles(files)
    }
  }

  return (
    <div
      ref={composerRef}
      data-tour-id="studio-composer"
      className="relative flex w-full flex-col overflow-visible rounded-[1.875rem] bg-muted/40 p-0.5 shadow-lg shadow-foreground/5"
      onDragEnter={handleComposerDragEnter}
      onDragOver={handleComposerDragOver}
      onDragLeave={handleComposerDragLeave}
      onDrop={handleComposerDrop}
    >
      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center rounded-[1.875rem] border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm">
          <span className="text-sm font-medium text-foreground">
            {t.studioComposerDropFiles}
          </span>
        </div>
      ) : null}
      <div ref={menuAnchorRef} className="relative w-full">
        {showSlashCommandMenu ? (
          <SlashCommandMenu
            activeIndex={activeCommandIndex}
            commands={filteredSlashCommands}
            locale={locale}
            mcpServers={filteredSlashMcpServers}
            onAcceptCommand={acceptSlashCommand}
            onAcceptMcp={acceptSlashMcp}
            onAcceptSkill={acceptSlashSkill}
            onSelectIndex={setSelectedCommandIndex}
            placement={composerMenuPlacement}
            scrollRef={slashMenuScrollRef}
            skills={filteredSlashSkills}
            t={t}
          />
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
                      {file.kind === "folder" ? (
                        <Folder
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <StudioFileTypeIcon
                          path={file.path}
                          size="small"
                          className="size-4 rounded-[4px] text-[8px]"
                        />
                      )}
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
          className={cn(
            "w-full rounded-[1.625rem] border bg-background/95 px-3.5 py-3 shadow-sm",
            denseControls && "px-2 py-2.5"
          )}
        >
          {selectedSlashSkills.length > 0 || mentions.length > 0 ? (
            <div
              className="mb-2 flex min-h-7 flex-wrap items-center gap-1.5 px-1"
              onClick={(event) => event.stopPropagation()}
            >
              {selectedSlashSkills.map((skill) => (
                <span
                  key={skill.slug}
                  title={getComposerSkillDescription(skill, locale)}
                  className="group/skill inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-[var(--color-accent-blue)]"
                >
                  <RiStackLine
                    aria-hidden
                    className="size-4 shrink-0"
                  />
                  <span className="max-w-44 min-w-0 truncate">
                    {getComposerSkillLabel(skill)}
                  </span>
                  <button
                    type="button"
                    aria-label={t.studioMentionRemove}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/skill:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeSlashSkill(skill.slug)
                    }}
                  >
                    <RiCloseLine aria-hidden className="size-3.5" />
                  </button>
                </span>
              ))}
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
                    <StudioFileTypeIcon
                      path={mention.path}
                      size="small"
                      className="size-3.5 rounded-[3px] text-[7px]"
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
              disabled={isVoiceRecording || isVoiceTranscribing}
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

          <div
            className={cn(
              "mt-2 flex min-w-0 items-center justify-between gap-1.5 overflow-visible",
              denseControls && "gap-0.5"
            )}
          >
            {isVoiceRecording || isVoiceTranscribing ? (
              <ComposerVoiceRecorderBar
                disabled={isBusy}
                durationLabel={voiceDurationLabel}
                isTranscribing={isVoiceTranscribing}
                labels={voiceLabels}
                waveformLevels={voiceWaveformLevels}
                onStop={onVoiceCancel}
                onSubmit={onVoiceSubmit}
              />
            ) : (
              <>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 overflow-visible",
                    denseControls && "gap-0.5"
                  )}
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
                          denseControls && "size-6 [&_svg]:size-3.5",
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
                          "absolute left-0 z-50 max-w-[calc(100vw-2rem)]",
                          composerActionMenuPlacement === "top"
                            ? "bottom-full mb-1"
                            : "top-full mt-1"
                        )}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                      >
                        <div className="relative w-40">
                          <div
                            role="menu"
                            aria-label={t.studioAttach}
                            className="w-40 rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm"
                          >
                            <ComposerActionMenuItem
                              icon={Paperclip}
                              label={t.studioComposerActionAddFile}
                              onPreview={() =>
                                setComposerActionMenuSection(null)
                              }
                              onSelect={openComposerFilePicker}
                            />
                            <div className="mx-3 my-1 h-px bg-token-menu-border" />
                            <ComposerActionMenuItem
                              icon={Feather}
                              label={t.studioComposerActionMode}
                              active={composerActionMenuSection === "mode"}
                              disabled={!showPermissionMode}
                              onPreview={() =>
                                setComposerActionMenuSection("mode")
                              }
                              onSelect={() =>
                                setComposerActionMenuSection("mode")
                              }
                            />
                            <ComposerActionMenuItem
                              icon={Bot}
                              label={t.studioComposerActionExperts}
                              active={composerActionMenuSection === "experts"}
                              onPreview={() =>
                                setComposerActionMenuSection("experts")
                              }
                              onSelect={() =>
                                setComposerActionMenuSection("experts")
                              }
                            />
                            <ComposerActionMenuItem
                              icon={Wrench}
                              label={t.studioComposerActionSkills}
                              active={composerActionMenuSection === "skills"}
                              onPreview={() =>
                                setComposerActionMenuSection("skills")
                              }
                              onSelect={() =>
                                setComposerActionMenuSection("skills")
                              }
                            />
                            <ComposerActionMenuItem
                              icon={Link2}
                              label={t.studioComposerActionConnectors}
                              active={
                                composerActionMenuSection === "connectors"
                              }
                              onPreview={() =>
                                setComposerActionMenuSection("connectors")
                              }
                              onSelect={() =>
                                setComposerActionMenuSection("connectors")
                              }
                            />
                          </div>

                          {composerActionMenuSection === "mode" ? (
                            <div
                              role="menu"
                              aria-label={t.studioComposerActionMode}
                              className="mt-1.5 w-44 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:absolute sm:top-[2.5rem] sm:left-[calc(100%+0.375rem)] sm:mt-0"
                            >
                              {permissionOptions.map((option) => {
                                const Icon = option.icon
                                const active = option.value === permissionMode

                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={active}
                                    className={cn(
                                      "flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background",
                                      active && "bg-token-list-hover-background"
                                    )}
                                    title={option.description}
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      closeComposerActionMenu()
                                      onPermissionModeChange(option.value)
                                    }}
                                  >
                                    <Icon
                                      aria-hidden
                                      className="size-3 shrink-0 text-token-description-foreground"
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {option.label}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          ) : null}

                          {composerActionMenuSection === "experts" ? (
                            <div
                              role="menu"
                              aria-label={t.studioComposerActionExperts}
                              className="mt-1.5 w-40 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:absolute sm:top-[4.25rem] sm:left-[calc(100%+0.375rem)] sm:mt-0"
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
                                  const summoning =
                                    summoningExpertId === expertId

                                  return (
                                    <button
                                      key={expertId || label}
                                      type="button"
                                      role="menuitem"
                                      disabled={summoning || !expertId}
                                      className="flex h-7 w-full min-w-0 items-center gap-1 rounded-(--radius-lg) px-2 text-left text-xs text-token-foreground transition-colors outline-none hover:bg-token-list-hover-background disabled:cursor-default disabled:text-token-description-foreground"
                                      title={[label, meta]
                                        .filter(Boolean)
                                        .join(" · ")}
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
                              className="mt-1.5 w-44 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:absolute sm:top-[6rem] sm:left-[calc(100%+0.375rem)] sm:mt-0"
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
                              className="mt-1.5 w-44 overflow-hidden rounded-(--radius-xl) bg-token-dropdown-background/90 p-1 text-token-foreground shadow-[0_0_0_0.5px_var(--color-token-border),var(--shadow-xl)] backdrop-blur-sm sm:absolute sm:top-[7.75rem] sm:left-[calc(100%+0.375rem)] sm:mt-0"
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
                      </div>
                    ) : null}
                  </div>
                  <PromptInputAction tooltip={t.studioComposerPlugins}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={isBusy}
                      aria-label={t.studioComposerPlugins}
                      className={cn(
                        "size-6 rounded-full p-0 transition-colors hover:bg-muted/60 [&_svg]:size-3.5",
                        denseControls && "size-5 [&_svg]:size-3"
                      )}
                      onClick={(event) => {
                        event.stopPropagation()
                        openComposerPlugins()
                      }}
                    >
                      <Wrench aria-hidden />
                    </Button>
                  </PromptInputAction>
                  {selectedExpert ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-7 max-w-48 min-w-0 shrink items-center gap-1.5 rounded-full bg-muted/60 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted",
                        iconOnlyControls && "max-w-24",
                        denseControls &&
                          "h-6 max-w-[3.6rem] gap-1 px-1.5 text-[11px]"
                      )}
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
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground",
                          denseControls && "size-3"
                        )}
                      />
                      <Bot
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground",
                          denseControls && "hidden"
                        )}
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
                        onPermissionModeChange(
                          nextValue as StudioPermissionMode
                        )
                      }
                      disabled={isBusy}
                    >
                      <SelectTrigger
                        data-tour-id="studio-composer-permission"
                        size="sm"
                        className={cn(
                          "h-7 max-w-40 rounded-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 sm:max-w-44",
                          iconOnlyControls &&
                            !denseControls &&
                            "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden",
                          denseControls &&
                            "h-6 w-6 max-w-6 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                        )}
                        aria-label={t.studioPermissionMode}
                        title={permissionModeOption.description}
                      >
                        <PermissionModeIcon aria-hidden className="size-3.5" />
                        <span
                          className={cn(
                            "truncate",
                            iconOnlyControls && "sr-only"
                          )}
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
                  {agentModeControls}
                </div>

                <PromptInputActions
                  className={cn(
                    "ml-auto flex shrink-0 items-center justify-end gap-1.5",
                    denseControls && "gap-0.5"
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Select
                    value={runtimeId}
                    onValueChange={handleRuntimeSelection}
                    open={runtimeSelectOpen}
                    onOpenChange={setRuntimeSelectOpen}
                    disabled={isBusy}
                  >
                    <SelectTrigger
                      data-tour-id="studio-composer-runtime"
                      size="sm"
                      className={cn(
                        "h-7 max-w-40 rounded-full bg-background px-2.5 text-xs sm:max-w-48",
                        iconOnlyControls &&
                          !denseControls &&
                          "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden",
                        denseControls &&
                          "h-6 w-6 max-w-6 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                      )}
                      aria-label={t.studioAgentRuntime}
                      title={runtimeDescription}
                    >
                      <AgentRuntimeIcon
                        runtimeId={runtimeId}
                        className="size-3.5"
                      />
                      <span
                        className={cn(
                          "truncate",
                          iconOnlyControls && "sr-only"
                        )}
                      >
                        {getChatRuntimeLabel(runtimeId, runtimeInfos)}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="top"
                      align="end"
                      className="min-w-72"
                    >
                      <SelectGroup>
                        {runtimeInfos.map((runtime) => {
                          const downloadableRuntimeId =
                            isDownloadableAgentRuntimeId(runtime.id)
                              ? runtime.id
                              : null
                          const status = downloadableRuntimeId
                            ? runtimeInstallationStatuses[downloadableRuntimeId]
                            : null
                          const installerStateKnown =
                            runtimeInstallerAvailable &&
                            !runtimeInstallationsLoading &&
                            Boolean(status)
                          const needsInstall =
                            Boolean(downloadableRuntimeId) &&
                            installerStateKnown &&
                            !status?.ready
                          const installing =
                            status?.phase === "downloading" ||
                            status?.phase === "installing"
                          const progress = Math.max(
                            0,
                            Math.min(100, status?.percent ?? 0)
                          )
                          const installMeta =
                            !needsInstall ? undefined : status?.phase ===
                              "downloading" ? (
                              <span className="flex items-center gap-1 text-primary">
                                <RiLoader4Line className="size-3 animate-spin" />
                                {t.studioAgentRuntimeDownloading(
                                  Math.round(progress)
                                )}
                              </span>
                            ) : status?.phase === "installing" ? (
                              <span className="flex items-center gap-1 text-primary">
                                <RiLoader4Line className="size-3 animate-spin" />
                                {t.studioAgentRuntimeInstalling}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-primary">
                                <Download className="size-3" />
                                {t.studioAgentRuntimeInstall}
                              </span>
                            )

                          return (
                            <SelectItem
                              key={runtime.id}
                              value={runtime.id}
                              textValue={runtime.label}
                              title={
                                status?.message ||
                                getRuntimeGuideDescription(
                                  runtime.id,
                                  runtime.description,
                                  t
                                )
                              }
                              className={cn(
                                "min-h-9 pr-10",
                                needsInstall && !installing && "cursor-pointer",
                                installing && "pb-3"
                              )}
                              onSelect={(event) => {
                                if (!downloadableRuntimeId) {
                                  return
                                }

                                const action =
                                  resolveAgentRuntimeSelectionAction({
                                    desktopAvailable: runtimeInstallerAvailable,
                                    loading: runtimeInstallationsLoading,
                                    runtimeId: downloadableRuntimeId,
                                    status: status ?? undefined,
                                  })

                                if (action !== "select") {
                                  event.preventDefault()
                                  handleRuntimeSelection(downloadableRuntimeId)
                                }
                              }}
                            >
                              <span className="relative flex w-full min-w-0 flex-col">
                                <SelectOptionRow
                                  description={getRuntimeGuideDescription(
                                    runtime.id,
                                    runtime.description,
                                    t
                                  )}
                                  icon={
                                    status?.phase === "error" ? (
                                      <TriangleAlert className="size-4 text-destructive" />
                                    ) : (
                                      <AgentRuntimeIcon
                                        runtimeId={runtime.id}
                                      />
                                    )
                                  }
                                  label={runtime.label}
                                  meta={installMeta}
                                />
                                {installing ? (
                                  <span className="absolute inset-x-0 -bottom-1.5 h-0.5 overflow-hidden rounded-full bg-border/70">
                                    <span
                                      className={cn(
                                        "block h-full rounded-full bg-primary transition-[width] duration-200",
                                        status?.phase === "installing" &&
                                          "animate-pulse"
                                      )}
                                      style={{
                                        width: `${progress > 0 ? progress : 12}%`,
                                      }}
                                    />
                                  </span>
                                ) : null}
                              </span>
                            </SelectItem>
                          )
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <ContextUsageIndicator
                    contextWindow={contextWindow}
                    usage={contextUsage}
                    compact={iconOnlyControls}
                    dense={denseControls}
                  />

                  <ModelEffortPicker
                    copy={{
                      advanced: t.studioModelPickerAdvanced,
                      effort: t.studioModelPickerEffort,
                      maxUsage: t.studioReasoningMaxUsage,
                      model: t.studioChatModel,
                    }}
                    dense={denseControls}
                    disabled={isBusy}
                    effort={resolvedReasoningEffort}
                    effortLabel={reasoningEffortLabel}
                    iconOnly={iconOnlyControls}
                    model={model}
                    modelLabel={selectedModelLabel}
                    modelOptions={modelOptions}
                    modelSelectOpen={modelSelectOpen}
                    onEffortChange={onReasoningEffortChange}
                    onModelChange={onModelChange}
                    onModelSelectOpenChange={onModelSelectOpenChange}
                    onReasoningSelectOpenChange={onReasoningSelectOpenChange}
                    reasoningOptions={reasoningOptions}
                    reasoningSelectOpen={reasoningSelectOpen}
                    title={t.studioChatModelDescription}
                  />

                  <ComposerVoiceButton
                    disabled={isBusy}
                    isTranscribing={isVoiceTranscribing}
                    label={voiceLabels.input}
                    onClick={() => {
                      closeComposerActionMenu()
                      onVoiceToggle()
                    }}
                  />

                  <Button
                    type="button"
                    size="icon-sm"
                    className={cn(
                      "size-7 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 [&_svg]:size-3.5",
                      denseControls && "size-6 [&_svg]:size-3"
                    )}
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
              </>
            )}
          </div>
        </PromptInput>
        <ChatComposerPluginsDialog />
      </div>

      <ComposerSessionScopeControls
        showSessionScopeControls={showSessionScopeControls}
        workspace={workspace}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        onWorkspaceChange={onWorkspaceChange}
        onAddWorkspace={onAddWorkspace}
        isBusy={isBusy}
        selectedProject={selectedProject}
        t={t}
      />
    </div>
  )
}
