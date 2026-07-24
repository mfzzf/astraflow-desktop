"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"
import { Cloud, Folder, GitBranch } from "lucide-react"
import { toast } from "sonner"

import { CentralIcon } from "@/components/central-icon"
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { TitlebarSurface } from "@/components/titlebar"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useI18n } from "@/components/i18n-provider"
import { useAppPreference } from "@/lib/app-preferences"
import { trackClientAnalyticsEvent } from "@/lib/client-analytics"
import { StudioTerminalPanel } from "@/components/studio-terminal-panel"
import {
  PendingPermissionApprovalPanel,
  PendingUserInputPanel,
} from "@/components/studio-message-parts-renderer"
import {
  AssistantPlan,
  isAssistantPlanComplete,
} from "@/components/studio-message-parts/plan-todo"
import { PreferenceSaveCoordinator } from "@/components/studio-chat/preference-save-coordinator"
import { parseSlashCommandText } from "@/lib/agent/composer-types"
import type { AgentModelSettingsPayload } from "@/lib/agent-model-settings-shared"
import {
  isChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import {
  consumePendingProjectId,
  setPendingProjectId,
} from "@/lib/studio-pending-project"
import {
  consumePendingWorkspaceId,
  setPendingWorkspaceId,
} from "@/lib/studio-pending-workspace"
import type {
  StudioChatRunSnapshot,
  StudioChatRunLiveSnapshot,
  StudioLocalProjectWithGitInfo,
  StudioMessage,
  StudioMessagePart,
  StudioPermissionMode,
  StudioPermissionOption,
  StudioPublicPermissionMode,
  StudioTokenUsage,
  StudioUserInputAnswer,
  StudioWorkspace,
} from "@/lib/studio-types"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioRemoteWorkspaceCreateRequested,
  dispatchStudioSessionsChanged,
  dispatchStudioSlashCommandsRefresh,
  dispatchStudioWorkspacesChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
  STUDIO_WORKSPACES_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import { getStudioExpertDraftPromptStorageKey } from "@/lib/studio-expert-draft"
import { isStudioFileWorkspaceTargetForEnvironment } from "@/lib/studio-file-workspace"
import { createStudioAgentWorkspace } from "@/lib/studio-default-workspace"
import { openStudioReviewPanel } from "@/lib/studio-review-panel"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import {
  createStudioWorkspaceReviewDetail,
  loadStudioWorkspaceReviewData,
} from "@/lib/studio-review-data"
import { aggregateTurnFileChanges } from "@/components/studio-message-parts/file-change"
import type { StudioFilePart } from "@/components/studio-message-parts/types"
import { cn, createClientId } from "@/lib/utils"
import {
  createStudioSnapshotScheduler,
  useStudioChatRunLiveStream,
} from "@/hooks/use-studio-chat-run"

import {
  compactSessionRequest,
  createMessage,
  createSession,
  enableInitialPlanMode,
  generateSessionTitle,
  getAgentModelSettingsForComposer,
  getFallbackSessionTitle,
  getStudioSessionForComposer,
  getStudioWorkspaceForComposer,
  getWorkspaceHistoryRequest,
  listAgentRuntimes,
  listLocalProjectsForComposer,
  listMessages,
  listSessionSlashCommands,
  listStudioWorkspacesForComposer,
  mutateWorkspaceHistoryRequest,
  sendPermissionDecision,
  sendUserInputDecision,
  startAssistantRunRequest,
  stopAssistantRunRequest,
  updateSessionChatPreferences,
  updateSessionPermissionMode,
} from "./studio-chat/api"
import { readFileAsDataUrl } from "./studio-chat/attachment-utils"
import {
  canSynchronizeChatPreferences,
  getChatModelOptionsForRuntime,
  getSessionChatPreferences,
  getStoredChatReasoningEffort,
  hasExplicitChatPreferences,
  mergeChatPreferences,
  readStoredChatDefaults,
  resolveChatRuntimeId,
  resolveChatPreferences,
  setStoredChatReasoningEffort,
  subscribeChatDefaults,
  useChatEnvironment,
  useChatModel,
  useChatReasoningEffort,
  useChatRuntime,
  writeStoredChatDefaults,
  type ChatRuntimeCatalogStatus,
  type SessionChatPreferencesSnapshot,
} from "./studio-chat/chat-preferences"
import {
  installStudioConsoleErrorCapture,
  reportStudioRuntimeFailure,
  scheduleStudioPanelOpenVerification,
  type StudioPanelKind,
} from "./studio-chat/client-diagnostics"
import {
  FALLBACK_CHAT_RUNTIME_INFO,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from "./studio-chat/constants"
import { ChatComposer } from "./studio-chat/composer"
import { StudioPromptTips } from "./studio-chat/studio-prompt-tips"
import { getTerminalStudioAutoPreviewCandidate } from "./studio-chat/auto-preview"
import {
  ComposerSubagentStrip,
  getVisibleComposerSubagents,
} from "./studio-chat/composer-subagent-strip"
import {
  StudioFeedbackDialog,
  type StudioFeedbackTarget,
} from "./studio-chat/feedback-dialog"
import {
  formatSlashSkillPrompt,
  isBuiltinSlashCommandName,
  serializeComposerMentions,
  textHasComposerMentionToken,
} from "./studio-chat/composer-utils"
import { getSessionTitleSummarySource } from "@/lib/studio-session-title"
import {
  getPendingPermissionPart,
  getPendingUserInputPart,
  getSessionFileChanges,
  getSessionOutputFiles,
  getUserMessageHistory,
  hasActiveMediaGenerationPart,
  mergeLiveMessage,
  mergeReloadedMessages,
  useStudioGreetingPeriod,
} from "./studio-chat/message-utils"
import { ChatMessageBubble } from "./studio-chat/messages"
import { StudioMessageTrail } from "./studio-chat/message-trail"
import { StudioWorkspaceServiceIdentityContext } from "./studio-message-parts/shared"
import { StudioPerformanceProfiler } from "./studio-chat/performance-profiler"
import {
  getStoredStatusPanelOpen,
  useRightPanelMode,
  useRightPanelOpen,
  useStatusPanelOpen,
  useTerminalPanelOpen,
} from "./studio-chat/panel-storage"
import {
  StudioRightPanel,
  getStudioRightPanelLabels,
} from "./studio-chat/right-panel"
import {
  StudioStatusPanel,
  type StudioStatusPlanSummary,
  type StudioStatusSubagentSummary,
} from "./studio-chat/status-panel"
import type {
  ChatRunEnvironment,
  ChatRuntimeOption,
  ComposerMention,
  PendingAttachment,
  ResolvedChatPreferences,
  StoredChatDefaults,
  StudioChatWorkbenchProps,
  StudioRightPanelMode,
  StudioSubagentPanelItem,
  StudioSubagentPanelRequest,
} from "./studio-chat/types"

type SummaryPanelDisplayMode = "overlay" | "shift" | "gutter"

declare global {
  interface Window {
    __ASTRAFLOW_STREAM_PROFILE_PUSH__?: (
      snapshot: StudioChatRunLiveSnapshot
    ) => void
    __ASTRAFLOW_STREAM_PROFILE_FLUSH_COUNT__?: number
  }
}

const SUMMARY_PANEL_OVERLAY_MAX_WIDTH = 1096
const SUMMARY_PANEL_SHIFT_MAX_WIDTH = 1536
const SUMMARY_PANEL_WIDTH = 300
const SUMMARY_PANEL_GAP = 16
const SUMMARY_PANEL_SHIFT_X = -(SUMMARY_PANEL_WIDTH + SUMMARY_PANEL_GAP) / 2

function isTerminalStudioChatRunStatus(
  status: StudioChatRunSnapshot["status"]
) {
  return status === "complete" || status === "error" || status === "cancelled"
}

function mergeAutoPreviewRunSnapshot(
  current: StudioChatRunSnapshot | null,
  next: StudioChatRunSnapshot
) {
  if (!current) {
    return next
  }

  if (
    current.runId !== next.runId &&
    current.startedAt.localeCompare(next.startedAt) > 0
  ) {
    return current
  }

  if (
    current.runId === next.runId &&
    isTerminalStudioChatRunStatus(current.status) &&
    !isTerminalStudioChatRunStatus(next.status)
  ) {
    return current
  }

  return next
}

function getSummaryPanelDisplayMode(width: number): SummaryPanelDisplayMode {
  if (width < SUMMARY_PANEL_OVERLAY_MAX_WIDTH) {
    return "overlay"
  }

  if (width < SUMMARY_PANEL_SHIFT_MAX_WIDTH) {
    return "shift"
  }

  return "gutter"
}

function escapeDomSelectorValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }

  return value.replace(/"/g, '\\"')
}

function getLatestPlanSummary(
  messages: StudioMessage[],
  fallbackTitle: string
): StudioStatusPlanSummary | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    if (message.role !== "assistant") {
      continue
    }

    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]

      if (part.type === "plan" && part.todos.length > 0) {
        const title =
          part.content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? fallbackTitle

        return {
          messageId: message.id,
          partId: part.id,
          title,
          todos: part.todos,
        }
      }
    }
  }

  return null
}

function StudioChatWorkbench({
  sessionId,
  workspaceId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const [followLiveOutput] = useAppPreference("followLiveOutput")
  const greetingPeriod = useStudioGreetingPeriod()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedRuntimeId, setSelectedRuntimeId] = useChatRuntime()
  const [selectedReasoningEffort] = useChatReasoningEffort(selectedModel)
  const [, setSelectedEnvironment] = useChatEnvironment()
  const [runtimeInfos, setRuntimeInfos] = React.useState<ChatRuntimeOption[]>(
    () => [FALLBACK_CHAT_RUNTIME_INFO]
  )
  const [runtimeCatalogStatus, setRuntimeCatalogStatus] =
    React.useState<ChatRuntimeCatalogStatus>("loading")
  const [agentModelSettings, setAgentModelSettings] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [chatDefaultsHydrated, setChatDefaultsHydrated] = React.useState(false)
  const [chatDefaults, setChatDefaults] =
    React.useState<StoredChatDefaults | null>(null)
  const [sessionChatPreferencesSnapshot, setSessionChatPreferencesSnapshot] =
    React.useState<SessionChatPreferencesSnapshot | null>(null)
  const sessionChatPreferences = getSessionChatPreferences(
    sessionId,
    sessionChatPreferencesSnapshot
  )
  const [localProjects, setLocalProjects] = React.useState<
    StudioLocalProjectWithGitInfo[]
  >([])
  const [workspaces, setWorkspaces] = React.useState<StudioWorkspace[]>([])
  const [workspacesLoading, setWorkspacesLoading] = React.useState(true)
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    string | null
  >(null)
  const [currentWorkspace, setCurrentWorkspace] =
    React.useState<StudioWorkspace | null>(null)
  const [agentWorkspaceRoot, setAgentWorkspaceRoot] = React.useState<
    string | null
  >(null)
  const panelWorkspace = React.useMemo(
    () =>
      currentWorkspace ??
      createStudioAgentWorkspace(sessionId, agentWorkspaceRoot),
    [agentWorkspaceRoot, currentWorkspace, sessionId]
  )
  // Session metadata is refreshed in the background. Keep the transport prop
  // stable when only the containing workspace object was re-created so every
  // completed message (and its file cards) does not re-render on each poll.
  const messageWorkspaceId = panelWorkspace?.id
  const messageWorkspaceType = panelWorkspace?.type
  const messageWorkspaceRootPath = panelWorkspace?.rootPath
  const messageWorkspace = React.useMemo(
    () =>
      messageWorkspaceId && messageWorkspaceType && messageWorkspaceRootPath
        ? {
            id: messageWorkspaceId,
            type: messageWorkspaceType,
            rootPath: messageWorkspaceRootPath,
          }
        : null,
    [messageWorkspaceId, messageWorkspaceRootPath, messageWorkspaceType]
  )
  const workspaceServiceContext = React.useMemo(
    () =>
      panelWorkspace?.type === "sandbox" && sessionId
        ? {
            sessionId,
            workspaceId: panelWorkspace.id,
            sandboxId: panelWorkspace.sandboxId,
          }
        : null,
    [panelWorkspace, sessionId]
  )
  const [currentSessionTitle, setCurrentSessionTitle] = React.useState("")
  const [selectedPermissionMode, setSelectedPermissionMode] =
    React.useState<StudioPermissionMode>("default")
  const [localFullAccessConfirmed, setLocalFullAccessConfirmed] =
    React.useState(false)
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [feedbackTarget, setFeedbackTarget] =
    React.useState<StudioFeedbackTarget>({
      entryPoint: "titlebar",
      messageId: null,
    })
  const [pendingAttachments, setPendingAttachments] = React.useState<
    PendingAttachment[]
  >([])
  const [promptMentions, setPromptMentions] = React.useState<ComposerMention[]>(
    []
  )
  const [subagentStripCompact, setSubagentStripCompact] = React.useState(false)
  const [startingSessionIds, setStartingSessionIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [chatErrors, setChatErrors] = React.useState<Record<string, string>>({})
  const [liveStreamConnected, setLiveStreamConnected] = React.useState(false)
  const [autoPreviewRun, setAutoPreviewRun] =
    React.useState<StudioChatRunSnapshot | null>(null)
  const [latestRunUsage, setLatestRunUsage] =
    React.useState<StudioTokenUsage | null>(null)
  const sessionIdRef = React.useRef(sessionId)
  const autoPreviewRunRequestSequenceRef = React.useRef(0)
  const sessionProjectRequestIdRef = React.useRef(0)
  const preferenceSaveCoordinatorRef = React.useRef(
    new PreferenceSaveCoordinator()
  )
  const normalizedPreferenceSaveKeyRef = React.useRef("")
  const localProjectsRefreshPendingRef = React.useRef(false)
  const handledNotificationActionsRef = React.useRef(new Set<string>())

  const saveChatPreferences = React.useCallback(
    (
      activeSessionId: string,
      preferences: {
        chatModel?: SupportedChatModel | null
        chatRuntimeId?: string | null
        chatReasoningEffort?: ChatReasoningEffort | null
      }
    ) => {
      return preferenceSaveCoordinatorRef.current.enqueue(async () => {
        await updateSessionChatPreferences(activeSessionId, preferences)
      })
    },
    []
  )

  const resolvedRuntimeId = resolveChatRuntimeId(
    selectedRuntimeId,
    runtimeInfos
  )
  // Rows created before environment provenance was persisted are read-only.
  // Treating an unknown remote path as local could mutate the bound checkout.
  const legacyMessageEnvironment: ChatRunEnvironment = "remote"
  const visibleMessages = React.useMemo(
    () =>
      sessionId
        ? messages.filter((message) => message.sessionId === sessionId)
        : [],
    [messages, sessionId]
  )
  const outputFiles = React.useMemo(
    () => getSessionOutputFiles(visibleMessages, legacyMessageEnvironment),
    [legacyMessageEnvironment, visibleMessages]
  )
  const fileChanges = React.useMemo(
    () => getSessionFileChanges(visibleMessages, legacyMessageEnvironment),
    [legacyMessageEnvironment, visibleMessages]
  )
  const userMessageHistory = React.useMemo(
    () => getUserMessageHistory(visibleMessages),
    [visibleMessages]
  )
  const pendingPermissionPart = React.useMemo(
    () => getPendingPermissionPart(visibleMessages),
    [visibleMessages]
  )
  const pendingUserInputPart = React.useMemo(
    () => getPendingUserInputPart(visibleMessages),
    [visibleMessages]
  )
  const hasActiveMediaGeneration = React.useMemo(
    () => hasActiveMediaGenerationPart(visibleMessages),
    [visibleMessages]
  )
  const latestPlan = React.useMemo<StudioStatusPlanSummary | null>(() => {
    return getLatestPlanSummary(visibleMessages, t.studioThinking)
  }, [t.studioThinking, visibleMessages])
  const subagentSummaries = React.useMemo<StudioStatusSubagentSummary[]>(() => {
    const summaries = new Map<string, StudioStatusSubagentSummary>()

    for (const message of visibleMessages) {
      if (message.role !== "assistant") {
        continue
      }

      for (const part of message.parts) {
        if (part.type !== "subagent") {
          continue
        }

        summaries.set(part.taskId, {
          messageId: message.id,
          partId: part.id,
          taskId: part.taskId,
          name: part.nickname?.trim() || part.name,
          status: part.status,
          environment: message.environment ?? legacyMessageEnvironment,
          part,
        })
      }
    }

    return Array.from(summaries.values())
  }, [legacyMessageEnvironment, visibleMessages])
  const subagentPanelItems = React.useMemo<StudioSubagentPanelItem[]>(
    () =>
      subagentSummaries.map((subagent) => ({
        subagent: subagent.part,
        environment: subagent.environment,
      })),
    [subagentSummaries]
  )
  const composerSubagentSummaries = React.useMemo(
    () => getVisibleComposerSubagents(subagentSummaries),
    [subagentSummaries]
  )
  const modelOptions = React.useMemo(() => {
    return getChatModelOptionsForRuntime(resolvedRuntimeId, agentModelSettings)
  }, [agentModelSettings, resolvedRuntimeId])
  const commitChatDefaults = React.useCallback(
    (preferences: ResolvedChatPreferences) => {
      writeStoredChatDefaults(preferences)
    },
    []
  )
  const applyChatSelection = React.useCallback(
    (preferences: ResolvedChatPreferences) => {
      setStoredChatReasoningEffort(
        preferences.model,
        preferences.reasoningEffort
      )
      setSelectedRuntimeId(preferences.runtimeId)
      setSelectedModel(preferences.model)
    },
    [setSelectedModel, setSelectedRuntimeId]
  )
  const resolvedEnvironment: ChatRunEnvironment =
    currentWorkspace?.type === "sandbox" ? "remote" : "local"
  const effectiveEnvironment = resolvedEnvironment

  const isStarting = sessionId ? startingSessionIds.has(sessionId) : false
  const hasStreamingMessage = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
  const isBusy = isStarting || hasStreamingMessage
  const hasMessages = visibleMessages.length > 0 || isStarting
  const showFloatingPlan =
    latestPlan &&
    !isAssistantPlanComplete(latestPlan.todos) &&
    visibleMessages.some(
      (message) =>
        message.id === latestPlan.messageId && message.status === "streaming"
    )
  const floatingPlan = showFloatingPlan ? latestPlan : null
  const canSubmit =
    (input.trim().length > 0 || pendingAttachments.length > 0) && !isBusy
  const chatError = sessionId ? chatErrors[sessionId] : ""
  const error = chatError
    ? "chat-failed"
    : sessionId && loadFailed
      ? "load-failed"
      : ""
  const selectedProject = React.useMemo(
    () =>
      selectedProjectId
        ? (localProjects.find((project) => project.id === selectedProjectId) ??
          null)
        : null,
    [localProjects, selectedProjectId]
  )
  const [terminalPanelOpen, setTerminalPanelOpen] = useTerminalPanelOpen()
  const [statusPanelOpen, setStatusPanelOpen] = useStatusPanelOpen()
  const [statusPanelPopoverOpen, setStatusPanelPopoverOpen] =
    React.useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useRightPanelOpen()
  const [rightPanelMode, setRightPanelMode] = useRightPanelMode()
  const [rightPanelFocused, setRightPanelFocused] = React.useState(false)
  const [subagentPanelRequest, setSubagentPanelRequest] =
    React.useState<StudioSubagentPanelRequest | null>(null)
  const chatViewportRef = React.useRef<HTMLDivElement | null>(null)
  const [chatViewportWidth, setChatViewportWidth] = React.useState(0)
  const [loadingWorkspaceChanges, setLoadingWorkspaceChanges] =
    React.useState(false)
  const [modelSelectOpen, setModelSelectOpen] = React.useState(false)
  const [reasoningSelectOpen, setReasoningSelectOpen] = React.useState(false)
  const effectiveRightPanelFocused = rightPanelOpen && rightPanelFocused
  const panelLabels = React.useMemo(
    () => getStudioRightPanelLabels(locale),
    [locale]
  )
  const statusPanelAvailable = Boolean(sessionId)
  const statusPanelDisplayMode = React.useMemo(
    () => getSummaryPanelDisplayMode(chatViewportWidth),
    [chatViewportWidth]
  )
  const statusPanelInlineOpen =
    statusPanelOpen &&
    statusPanelAvailable &&
    statusPanelDisplayMode !== "overlay"
  const statusPanelOverlayOpen =
    statusPanelPopoverOpen &&
    statusPanelAvailable &&
    statusPanelDisplayMode === "overlay"
  const statusPanelToggleAvailable = statusPanelAvailable
  const statusPanelContentX =
    statusPanelInlineOpen && statusPanelDisplayMode === "shift"
      ? SUMMARY_PANEL_SHIFT_X
      : 0
  const statusPanelContentStyle = React.useMemo(
    () => ({ transform: `translate3d(${statusPanelContentX}px, 0, 0)` }),
    [statusPanelContentX]
  )
  const statusPanelContentClassName = "relative flex min-h-0 flex-1 flex-col"
  const statusPanelSurfaceClassName =
    "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
  const previousStatusPanelDisplayModeRef = React.useRef(statusPanelDisplayMode)
  const terminalPanelVerificationCancelRef = React.useRef<(() => void) | null>(
    null
  )
  const rightPanelVerificationCancelRef = React.useRef<(() => void) | null>(
    null
  )
  const autoPreviewSessionRef = React.useRef("")
  const dispatchedAutoPreviewRunIdsRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (autoPreviewSessionRef.current !== sessionId) {
      autoPreviewSessionRef.current = sessionId
      dispatchedAutoPreviewRunIdsRef.current = new Set()
    }

    if (
      !autoPreviewRun ||
      autoPreviewRun.sessionId !== sessionId ||
      dispatchedAutoPreviewRunIdsRef.current.has(autoPreviewRun.runId) ||
      autoPreviewRun.status === "error" ||
      autoPreviewRun.status === "cancelled"
    ) {
      return
    }

    const assistantMessage = visibleMessages.find(
      (message) => message.id === autoPreviewRun.assistantMessageId
    )
    const hasCompletedMessageFallback =
      (autoPreviewRun.status === "queued" ||
        autoPreviewRun.status === "running") &&
      !isStarting &&
      !hasStreamingMessage &&
      assistantMessage?.status === "complete"
    const terminalRun: StudioChatRunSnapshot = hasCompletedMessageFallback
      ? { ...autoPreviewRun, status: "complete" }
      : autoPreviewRun
    const candidate = getTerminalStudioAutoPreviewCandidate({
      run: terminalRun,
      message: assistantMessage,
      panelWorkspace,
    })

    if (!candidate) {
      return
    }

    // Terminal snapshots and their final message can arrive in adjacent
    // stream frames. A short settle window lets the terminal run arbitrate
    // once across all of its candidates instead of opening each one.
    const timer = window.setTimeout(() => {
      if (dispatchedAutoPreviewRunIdsRef.current.has(terminalRun.runId)) {
        return
      }

      dispatchedAutoPreviewRunIdsRef.current.add(terminalRun.runId)
      const preserveActiveWorkflow =
        rightPanelOpen &&
        (rightPanelMode === "terminal" ||
          rightPanelMode === "review" ||
          rightPanelFocused)

      window.dispatchEvent(
        new CustomEvent<StudioOpenMarkdownTargetDetail>(
          STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
          {
            detail: {
              href: candidate.href,
              source: "auto",
              intent: "preview",
              workspace: candidate.workspace,
              revision: candidate.revision,
              activate: !preserveActiveWorkflow,
              serviceId:
                candidate.kind === "service" ? candidate.serviceId : null,
              artifactKey:
                candidate.kind === "service" ? candidate.artifactKey : null,
              entryPath:
                candidate.kind === "service" ? candidate.entryPath : null,
              originatingRunId: terminalRun.runId,
            },
          }
        )
      )
    }, 250)

    return () => window.clearTimeout(timer)
  }, [
    autoPreviewRun,
    hasStreamingMessage,
    isStarting,
    panelWorkspace,
    rightPanelMode,
    rightPanelOpen,
    rightPanelFocused,
    sessionId,
    visibleMessages,
  ])

  const cancelPanelOpenVerification = React.useCallback(
    (panel: StudioPanelKind) => {
      const cancelRef =
        panel === "terminal"
          ? terminalPanelVerificationCancelRef
          : rightPanelVerificationCancelRef

      cancelRef.current?.()
      cancelRef.current = null
    },
    []
  )
  const verifyPanelOpened = React.useCallback(
    (panel: StudioPanelKind) => {
      const cancelRef =
        panel === "terminal"
          ? terminalPanelVerificationCancelRef
          : rightPanelVerificationCancelRef

      cancelRef.current?.()
      cancelRef.current = scheduleStudioPanelOpenVerification({
        panel,
        locale,
        sessionId,
        workspace: panelWorkspace,
      })
    },
    [locale, panelWorkspace, sessionId]
  )

  React.useEffect(() => {
    const uninstallConsoleCapture = installStudioConsoleErrorCapture()

    return () => {
      cancelPanelOpenVerification("terminal")
      cancelPanelOpenVerification("right")
      uninstallConsoleCapture()
    }
  }, [cancelPanelOpenVerification])

  React.useEffect(() => {
    if (!terminalPanelOpen) {
      cancelPanelOpenVerification("terminal")
    }
  }, [cancelPanelOpenVerification, terminalPanelOpen])

  React.useEffect(() => {
    if (!rightPanelOpen) {
      cancelPanelOpenVerification("right")
    }
  }, [cancelPanelOpenVerification, rightPanelOpen])

  React.useEffect(() => {
    let cancelled = false
    const previousMode = previousStatusPanelDisplayModeRef.current
    previousStatusPanelDisplayModeRef.current = statusPanelDisplayMode

    if (
      !statusPanelAvailable ||
      previousMode !== statusPanelDisplayMode ||
      statusPanelDisplayMode !== "overlay"
    ) {
      queueMicrotask(() => {
        if (!cancelled) {
          setStatusPanelPopoverOpen(false)
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [statusPanelAvailable, statusPanelDisplayMode])

  React.useEffect(() => {
    const element = chatViewportRef.current

    if (!element) {
      return
    }

    const observedElement = element

    function updateWidth() {
      setChatViewportWidth(observedElement.getBoundingClientRect().width)
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth)

      return () => window.removeEventListener("resize", updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)

    observer.observe(observedElement)

    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    function syncChatDefaults() {
      setChatDefaults(readStoredChatDefaults())
      setChatDefaultsHydrated(true)
    }

    syncChatDefaults()
    return subscribeChatDefaults(syncChatDefaults)
  }, [])

  React.useEffect(() => {
    if (
      !canSynchronizeChatPreferences({
        chatDefaultsHydrated,
        runtimeCatalogStatus,
        sessionId,
        sessionPreferences: sessionChatPreferences,
      })
    ) {
      return
    }

    const nextPreferences = resolveChatPreferences(
      mergeChatPreferences(sessionChatPreferences, chatDefaults),
      runtimeInfos,
      agentModelSettings
    )
    const preferencesChanged =
      selectedRuntimeId !== nextPreferences.runtimeId ||
      selectedModel !== nextPreferences.model ||
      selectedReasoningEffort !== nextPreferences.reasoningEffort

    if (preferencesChanged) {
      applyChatSelection(nextPreferences)
    }

    const explicitSessionPreferences = hasExplicitChatPreferences(
      sessionChatPreferences
    )
      ? sessionChatPreferences
      : null
    if (
      sessionId &&
      explicitSessionPreferences &&
      (chatDefaults?.runtimeId !== nextPreferences.runtimeId ||
        chatDefaults.model !== nextPreferences.model ||
        chatDefaults.reasoningEffort !== nextPreferences.reasoningEffort)
    ) {
      queueMicrotask(() => commitChatDefaults(nextPreferences))
    }

    if (
      sessionId &&
      explicitSessionPreferences &&
      (explicitSessionPreferences.chatRuntimeId !== nextPreferences.runtimeId ||
        explicitSessionPreferences.chatModel !== nextPreferences.model ||
        explicitSessionPreferences.chatReasoningEffort !==
          nextPreferences.reasoningEffort)
    ) {
      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      queueMicrotask(() => {
        setSessionChatPreferencesSnapshot({
          sessionId,
          preferences: nextSessionPreferences,
        })
      })
      saveChatPreferences(sessionId, nextSessionPreferences)
    }
  }, [
    agentModelSettings,
    applyChatSelection,
    chatDefaults,
    chatDefaultsHydrated,
    commitChatDefaults,
    runtimeInfos,
    runtimeCatalogStatus,
    saveChatPreferences,
    selectedModel,
    selectedReasoningEffort,
    selectedRuntimeId,
    sessionChatPreferences,
    sessionId,
  ])

  const handleRuntimeChange = React.useCallback(
    (nextRuntimeId: string) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: selectedModel,
          chatRuntimeId: nextRuntimeId,
          chatReasoningEffort: selectedReasoningEffort,
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)
      commitChatDefaults(nextPreferences)

      if (!sessionId) {
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }
      const saveKey = [
        sessionId,
        nextSessionPreferences.chatRuntimeId,
        nextSessionPreferences.chatModel,
        nextSessionPreferences.chatReasoningEffort,
      ].join(":")

      setSessionChatPreferencesSnapshot({
        sessionId,
        preferences: nextSessionPreferences,
      })

      if (normalizedPreferenceSaveKeyRef.current !== saveKey) {
        normalizedPreferenceSaveKeyRef.current = saveKey
        saveChatPreferences(sessionId, nextSessionPreferences)
      }
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      runtimeInfos,
      saveChatPreferences,
      selectedModel,
      selectedReasoningEffort,
      sessionId,
    ]
  )

  const handleModelChange = React.useCallback(
    (nextModel: SupportedChatModel) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: nextModel,
          chatRuntimeId: resolvedRuntimeId,
          chatReasoningEffort: getStoredChatReasoningEffort(nextModel),
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)
      commitChatDefaults(nextPreferences)

      if (!sessionId) {
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      setSessionChatPreferencesSnapshot({
        sessionId,
        preferences: nextSessionPreferences,
      })
      saveChatPreferences(sessionId, nextSessionPreferences)
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      resolvedRuntimeId,
      runtimeInfos,
      saveChatPreferences,
      sessionId,
    ]
  )

  const handleReasoningEffortChange = React.useCallback(
    (nextEffort: ChatReasoningEffort) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: selectedModel,
          chatRuntimeId: resolvedRuntimeId,
          chatReasoningEffort: nextEffort,
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)
      commitChatDefaults(nextPreferences)

      if (!sessionId) {
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      setSessionChatPreferencesSnapshot({
        sessionId,
        preferences: nextSessionPreferences,
      })
      saveChatPreferences(sessionId, nextSessionPreferences)
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      resolvedRuntimeId,
      runtimeInfos,
      saveChatPreferences,
      selectedModel,
      sessionId,
    ]
  )

  const toggleTerminalPanel = React.useCallback(() => {
    const nextOpen = !terminalPanelOpen

    if (nextOpen) {
      verifyPanelOpened("terminal")
    } else {
      cancelPanelOpenVerification("terminal")
    }

    setTerminalPanelOpen(nextOpen)
  }, [
    cancelPanelOpenVerification,
    setTerminalPanelOpen,
    terminalPanelOpen,
    verifyPanelOpened,
  ])
  const toggleRightPanel = React.useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelFocused(false)
      cancelPanelOpenVerification("right")
    } else {
      verifyPanelOpened("right")
    }

    setRightPanelOpen(!rightPanelOpen)
  }, [
    cancelPanelOpenVerification,
    rightPanelOpen,
    setRightPanelOpen,
    verifyPanelOpened,
  ])
  const toggleStatusPanel = React.useCallback(() => {
    setStatusPanelOpen(!getStoredStatusPanelOpen())
  }, [setStatusPanelOpen])
  const openRightPanelMode = React.useCallback(
    (mode: StudioRightPanelMode) => {
      setRightPanelMode(mode)
      setRightPanelOpen(true)
    },
    [setRightPanelMode, setRightPanelOpen]
  )
  const getSessionReviewFileChanges = React.useCallback(() => {
    const filesByEnvironment = new Map<ChatRunEnvironment, StudioFilePart[]>()

    for (const message of visibleMessages) {
      if (message.role !== "assistant") {
        continue
      }

      const environment = message.environment ?? legacyMessageEnvironment
      const files = filesByEnvironment.get(environment) ?? []

      files.push(
        ...message.parts.filter(
          (part): part is StudioFilePart => part.type === "file"
        )
      )
      filesByEnvironment.set(environment, files)
    }

    return Array.from(filesByEnvironment, ([environment, files]) => {
      const fileWorkspace =
        messageWorkspace &&
        isStudioFileWorkspaceTargetForEnvironment(messageWorkspace, environment)
          ? messageWorkspace
          : null

      return aggregateTurnFileChanges(files, environment, fileWorkspace)
    }).flat()
  }, [legacyMessageEnvironment, messageWorkspace, visibleMessages])
  const handleOpenWorkspaceChanges = React.useCallback(async () => {
    if (loadingWorkspaceChanges) {
      return
    }

    if (!currentWorkspace) {
      openStudioReviewPanel({
        scopeLabel: panelLabels.envSessionChanges,
        files: getSessionReviewFileChanges(),
        truncated: false,
        git: null,
      })
      setRightPanelMode("review")
      setRightPanelOpen(true)
      return
    }

    setLoadingWorkspaceChanges(true)

    try {
      const data = await loadStudioWorkspaceReviewData(
        currentWorkspace,
        panelLabels.envLoadChangesFailed
      )

      // Outside a git repository there is no baseline to diff against; fall
      // back to the file changes recorded in this session's messages.
      openStudioReviewPanel(
        data.gitAvailable
          ? createStudioWorkspaceReviewDetail({
              ...data,
              scopeLabel: panelLabels.envUncommittedChanges,
            })
          : {
              scopeLabel: panelLabels.envSessionChanges,
              files: getSessionReviewFileChanges(),
              truncated: false,
              git: null,
            }
      )
      setRightPanelMode("review")
      setRightPanelOpen(true)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : panelLabels.envLoadChangesFailed
      )
    } finally {
      setLoadingWorkspaceChanges(false)
    }
  }, [
    currentWorkspace,
    getSessionReviewFileChanges,
    loadingWorkspaceChanges,
    panelLabels.envLoadChangesFailed,
    panelLabels.envSessionChanges,
    panelLabels.envUncommittedChanges,
    setRightPanelMode,
    setRightPanelOpen,
  ])
  const scrollToMessagePart = React.useCallback(
    (partId: string, messageId: string) => {
      const partSelector = `[data-studio-message-part-id="${escapeDomSelectorValue(partId)}"]`
      const messageSelector = `[data-studio-message-id="${escapeDomSelectorValue(messageId)}"]`
      const target = document.querySelector<HTMLElement>(partSelector)
      const fallback = document.querySelector<HTMLElement>(messageSelector)

      ;(target ?? fallback)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    },
    []
  )
  const handleOpenPlanSummary = React.useCallback(
    (plan: StudioStatusPlanSummary) => {
      scrollToMessagePart(plan.partId, plan.messageId)
    },
    [scrollToMessagePart]
  )
  const handleOpenSubagentSummary = React.useCallback(
    (subagent: StudioStatusSubagentSummary) => {
      setSubagentPanelRequest({
        requestId: createClientId(),
        subagent: subagent.part,
        environment: subagent.environment,
      })
    },
    []
  )
  const handleRightPanelOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        setRightPanelFocused(false)
      }

      setRightPanelOpen(open)
    },
    [setRightPanelOpen]
  )
  const handleRightPanelFocusedChange = React.useCallback(
    (focused: boolean) => {
      setRightPanelFocused(focused)
    },
    []
  )

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return
      }

      const key = event.key.toLowerCase()
      const commandKey = event.metaKey || event.ctrlKey

      if (commandKey && key === "j") {
        event.preventDefault()
        toggleTerminalPanel()
        return
      }

      if (commandKey && event.altKey && key === "b") {
        event.preventDefault()
        toggleRightPanel()
        return
      }

      if (commandKey && key === "p") {
        event.preventDefault()
        openRightPanelMode("files")
        return
      }

      if (commandKey && event.altKey && key === "s") {
        event.preventDefault()
        openRightPanelMode("side-chat")
        return
      }

      if (commandKey && key === "t") {
        event.preventDefault()
        openRightPanelMode("browser")
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [openRightPanelMode, toggleRightPanel, toggleTerminalPanel])

  const addFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) {
      return
    }

    const acceptedFiles = Array.from(files)

    void Promise.all(
      acceptedFiles
        .filter((file) => file.size <= MAX_ATTACHMENT_BYTES)
        .map(async (file) => ({
          id: createClientId(),
          type: file.type.startsWith("image/")
            ? ("image" as const)
            : ("file" as const),
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        }))
    ).then((next) => {
      if (next.length === 0) {
        return
      }

      setPendingAttachments((current) =>
        [...current, ...next].slice(0, MAX_ATTACHMENTS)
      )
    })
  }, [])

  React.useEffect(() => {
    const bridge = window.astraflowDesktop

    if (!bridge?.listPendingAppSnapCaptures) return

    let active = true
    const addCapture = (capture: AstraFlowAppSnapCapture) => {
      if (!active) return

      if (capture.size > MAX_ATTACHMENT_BYTES) {
        toast.error(
          locale === "zh"
            ? "AppSnap 图片超过附件大小限制。"
            : "The AppSnap image exceeds the attachment size limit."
        )
        return
      }

      setPendingAttachments((current) => {
        if (current.some((attachment) => attachment.id === capture.id)) {
          return current
        }

        return [
          ...current,
          {
            id: capture.id,
            type: "image" as const,
            name: capture.name,
            mimeType: capture.mimeType,
            size: capture.size,
            dataUrl: capture.dataUrl,
          },
        ].slice(0, MAX_ATTACHMENTS)
      })
      void bridge.acknowledgeAppSnapCapture(capture.id)
    }

    void bridge.listPendingAppSnapCaptures().then((captures) => {
      captures.forEach(addCapture)
    })
    const dispose = bridge.onAppSnapCaptured(addCapture)

    return () => {
      active = false
      dispose()
    }
  }, [locale])

  const removeAttachment = React.useCallback((id: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
  }, [])

  React.useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  React.useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      const storageKey = getStudioExpertDraftPromptStorageKey(sessionId)
      const draftPrompt = window.localStorage.getItem(storageKey)?.trim()

      if (!draftPrompt) {
        return
      }

      window.localStorage.removeItem(storageKey)
      setInput((current) => (current.trim() ? current : draftPrompt))
    })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  React.useEffect(() => {
    let cancelled = false

    void Promise.all([listAgentRuntimes(), getAgentModelSettingsForComposer()])
      .then(([nextRuntimeInfos, nextAgentModelSettings]) => {
        if (!cancelled) {
          setRuntimeInfos(nextRuntimeInfos)
          setAgentModelSettings(nextAgentModelSettings)
          setRuntimeCatalogStatus("ready")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInfos([FALLBACK_CHAT_RUNTIME_INFO])
          setAgentModelSettings(null)
          setRuntimeCatalogStatus("error")
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const reloadLocalProjects = React.useCallback(async () => {
    if (localProjectsRefreshPendingRef.current) {
      return
    }

    localProjectsRefreshPendingRef.current = true

    try {
      setLocalProjects(await listLocalProjectsForComposer())
    } catch {
      setLocalProjects([])
    } finally {
      localProjectsRefreshPendingRef.current = false
    }
  }, [])

  const reloadWorkspaces = React.useCallback(async () => {
    setWorkspacesLoading(true)
    try {
      setWorkspaces(await listStudioWorkspacesForComposer())
    } catch {
      setWorkspaces([])
    } finally {
      setWorkspacesLoading(false)
    }
  }, [])

  const reloadSessionProject = React.useCallback(async () => {
    const requestId = sessionProjectRequestIdRef.current + 1
    sessionProjectRequestIdRef.current = requestId

    const preferenceSaveVersion =
      await preferenceSaveCoordinatorRef.current.captureIdleVersion()

    if (!sessionId) {
      const nextWorkspaceId =
        workspaceId?.trim() || consumePendingWorkspaceId() || ""
      let nextWorkspace: StudioWorkspace | null = null

      if (nextWorkspaceId) {
        try {
          nextWorkspace = await getStudioWorkspaceForComposer(nextWorkspaceId)
        } catch {
          nextWorkspace = null
        }
      }

      if (sessionProjectRequestIdRef.current !== requestId) {
        return
      }

      setCurrentWorkspace(nextWorkspace)
      setSelectedProjectId(
        nextWorkspace?.type === "local"
          ? nextWorkspace.origin === "selected_local"
            ? nextWorkspace.localProjectId
            : null
          : nextWorkspace
            ? null
            : consumePendingProjectId()
      )
      setAgentWorkspaceRoot(null)
      setCurrentSessionTitle("")
      setSelectedPermissionMode("default")
      setLocalFullAccessConfirmed(false)
      setLatestRunUsage(null)
      setSessionChatPreferencesSnapshot({
        sessionId: "",
        preferences: null,
      })
      return
    }

    const activeSessionId = sessionId

    try {
      const session = await getStudioSessionForComposer(activeSessionId)

      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId ||
        !preferenceSaveCoordinatorRef.current.isCurrent(preferenceSaveVersion)
      ) {
        return
      }

      const nextWorkspace =
        session.workspace ??
        (session.workspaceId
          ? await getStudioWorkspaceForComposer(session.workspaceId)
          : null)

      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId ||
        !preferenceSaveCoordinatorRef.current.isCurrent(preferenceSaveVersion)
      ) {
        return
      }

      setCurrentWorkspace(nextWorkspace)
      setSelectedProjectId(
        nextWorkspace?.origin === "selected_local"
          ? nextWorkspace.localProjectId
          : (session?.projectId ?? null)
      )
      setAgentWorkspaceRoot(session?.agentWorkspaceRoot ?? null)
      setCurrentSessionTitle(session?.title ?? "")
      setSelectedPermissionMode(session?.permissionMode ?? "default")
      setLocalFullAccessConfirmed(
        session?.permissionMode === "full_access" &&
          session.localFullAccessGranted
      )
      setLatestRunUsage(session?.latestRunUsage ?? null)
      setSessionChatPreferencesSnapshot({
        sessionId: activeSessionId,
        preferences: {
          chatModel: session?.chatModel ?? null,
          chatRuntimeId: session?.chatRuntimeId ?? null,
          chatReasoningEffort:
            session?.chatReasoningEffort &&
            isChatReasoningEffort(session.chatReasoningEffort)
              ? session.chatReasoningEffort
              : null,
        },
      })
    } catch {
      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId ||
        !preferenceSaveCoordinatorRef.current.isCurrent(preferenceSaveVersion)
      ) {
        return
      }

      setSelectedProjectId(null)
      setCurrentWorkspace(null)
      setAgentWorkspaceRoot(null)
      setCurrentSessionTitle("")
      setSelectedPermissionMode("default")
      setLocalFullAccessConfirmed(false)
      setLatestRunUsage(null)
      setSessionChatPreferencesSnapshot({
        sessionId: activeSessionId,
        preferences: null,
      })
    }
  }, [sessionId, workspaceId])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadLocalProjects()
    })
  }, [reloadLocalProjects])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadWorkspaces()
    })
  }, [reloadWorkspaces])

  React.useEffect(() => {
    normalizedPreferenceSaveKeyRef.current = ""
    queueMicrotask(() => {
      setSessionChatPreferencesSnapshot(null)
      void reloadSessionProject()
    })
  }, [reloadSessionProject])

  React.useEffect(() => {
    if (!sessionId) {
      return
    }

    function refreshSessionPreferences() {
      if (document.visibilityState === "visible") {
        void reloadSessionProject()
      }
    }

    const timer = window.setInterval(refreshSessionPreferences, 5_000)
    window.addEventListener("focus", refreshSessionPreferences)
    document.addEventListener("visibilitychange", refreshSessionPreferences)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshSessionPreferences)
      document.removeEventListener(
        "visibilitychange",
        refreshSessionPreferences
      )
    }
  }, [reloadSessionProject, sessionId])

  React.useEffect(() => {
    function handleLocalProjectsChanged() {
      void reloadLocalProjects()
    }

    window.addEventListener(
      STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
      handleLocalProjectsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
        handleLocalProjectsChanged
      )
    }
  }, [reloadLocalProjects])

  React.useEffect(() => {
    function handleWorkspacesChanged() {
      void reloadWorkspaces()
    }

    window.addEventListener(
      STUDIO_WORKSPACES_CHANGED_EVENT,
      handleWorkspacesChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_WORKSPACES_CHANGED_EVENT,
        handleWorkspacesChanged
      )
    }
  }, [reloadWorkspaces])

  React.useEffect(() => {
    if (!sessionId || !selectedProjectId) {
      return
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void reloadLocalProjects()
      }
    }

    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)

    return () => {
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [reloadLocalProjects, selectedProjectId, sessionId])

  React.useEffect(() => {
    function handleSessionsChanged() {
      void reloadSessionProject()
    }

    window.addEventListener(
      STUDIO_SESSIONS_CHANGED_EVENT,
      handleSessionsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_SESSIONS_CHANGED_EVENT,
        handleSessionsChanged
      )
    }
  }, [reloadSessionProject])

  const reloadMessages = React.useCallback(async (activeSessionId: string) => {
    const nextMessages = activeSessionId
      ? await listMessages(activeSessionId)
      : []

    if (sessionIdRef.current === activeSessionId) {
      setMessages((currentMessages) =>
        mergeReloadedMessages(currentMessages, nextMessages)
      )
      setLoadFailed(false)
    }

    return nextMessages
  }, [])

  React.useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => (sessionId ? reloadMessages(sessionId) : []))
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages((currentMessages) =>
            mergeReloadedMessages(currentMessages, nextMessages)
          )
          setLoadFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadMessages, sessionId])

  React.useEffect(() => {
    if (
      !sessionId ||
      (!hasStreamingMessage && !isStarting) ||
      liveStreamConnected
    ) {
      return
    }

    let cancelled = false
    const poll = () => {
      void reloadMessages(sessionId)
        .then((nextMessages) => {
          if (cancelled) {
            return
          }

          const stillStreaming = nextMessages.some(
            (message) =>
              message.role === "assistant" && message.status === "streaming"
          )

          if (!stillStreaming) {
            onSessionsChange()
            dispatchStudioLocalProjectsChanged()
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadFailed(true)
          }
        })
    }

    const timer = window.setInterval(poll, 1000)

    poll()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [
    hasStreamingMessage,
    isStarting,
    liveStreamConnected,
    onSessionsChange,
    reloadMessages,
    sessionId,
  ])

  React.useEffect(() => {
    if (!sessionId || !hasActiveMediaGeneration) {
      return
    }

    let cancelled = false
    const poll = () => {
      void reloadMessages(sessionId)
        .then((nextMessages) => {
          if (cancelled) {
            return
          }

          if (!hasActiveMediaGenerationPart(nextMessages)) {
            onSessionsChange()
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadFailed(true)
          }
        })
    }

    const timer = window.setInterval(poll, 3000)

    poll()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasActiveMediaGeneration, onSessionsChange, reloadMessages, sessionId])

  const handleLiveSnapshot = React.useCallback(
    (snapshot: StudioChatRunLiveSnapshot) => {
      if (sessionIdRef.current !== snapshot.sessionId) {
        return
      }

      setAutoPreviewRun((current) =>
        mergeAutoPreviewRunSnapshot(current, snapshot)
      )
      const snapshotError = snapshot.error?.trim()

      if (snapshotError) {
        void reportStudioRuntimeFailure({
          source: "live_snapshot",
          locale,
          sessionId: snapshot.sessionId,
          runId: snapshot.runId,
          runtimeId: resolvedRuntimeId,
          model: snapshot.message?.model ?? selectedModel,
          environment: snapshot.message?.environment ?? effectiveEnvironment,
          workspace: panelWorkspace,
          error: snapshotError,
        })
        setChatErrors((current) =>
          current[snapshot.sessionId] === snapshotError
            ? current
            : { ...current, [snapshot.sessionId]: snapshotError }
        )
      } else if (
        snapshot.status === "complete" ||
        snapshot.status === "cancelled"
      ) {
        setChatErrors((current) => {
          if (!current[snapshot.sessionId]) return current

          const next = { ...current }
          delete next[snapshot.sessionId]
          return next
        })
      }

      if (!snapshot.message) {
        return
      }

      setMessages((currentMessages) =>
        mergeLiveMessage(currentMessages, snapshot.message!)
      )
      if (snapshot.usage) {
        setLatestRunUsage(snapshot.usage)
      }
      setLoadFailed(false)
    },
    [
      effectiveEnvironment,
      locale,
      panelWorkspace,
      resolvedRuntimeId,
      selectedModel,
    ]
  )
  const handleLiveDone = React.useCallback(() => {
    if (!sessionId) {
      return
    }

    void reloadMessages(sessionId)
      .then(async () => {
        await Promise.all([reloadSessionProject(), reloadWorkspaces()])
        onSessionsChange()
        dispatchStudioLocalProjectsChanged()
        dispatchStudioWorkspacesChanged()
      })
      .catch(() => setLoadFailed(true))
  }, [
    onSessionsChange,
    reloadMessages,
    reloadSessionProject,
    reloadWorkspaces,
    sessionId,
  ])

  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return
    }

    const scheduler = createStudioSnapshotScheduler<StudioChatRunLiveSnapshot>(
      (snapshot) => {
        window.__ASTRAFLOW_STREAM_PROFILE_FLUSH_COUNT__ =
          (window.__ASTRAFLOW_STREAM_PROFILE_FLUSH_COUNT__ ?? 0) + 1
        handleLiveSnapshot(snapshot)
      }
    )
    window.__ASTRAFLOW_STREAM_PROFILE_PUSH__ = scheduler.push

    return () => {
      if (window.__ASTRAFLOW_STREAM_PROFILE_PUSH__ === scheduler.push) {
        delete window.__ASTRAFLOW_STREAM_PROFILE_PUSH__
      }

      scheduler.dispose()
    }
  }, [handleLiveSnapshot])

  useStudioChatRunLiveStream({
    enabled: Boolean(sessionId && (hasStreamingMessage || isStarting)),
    onConnectionChange: setLiveStreamConnected,
    onDone: handleLiveDone,
    onError: () => setLiveStreamConnected(false),
    onSnapshot: handleLiveSnapshot,
    sessionId,
  })

  const startAssistantRun = React.useCallback(
    (
      activeSessionId: string,
      model: SupportedChatModel,
      reasoningEffort: ChatReasoningEffort,
      runtimeId: string,
      environment?: ChatRunEnvironment,
      options: {
        retryMessageId?: string
      } = {}
    ) => {
      const runRequestSequence =
        ++autoPreviewRunRequestSequenceRef.current
      setAutoPreviewRun(null)
      setStartingSessionIds((current) => {
        const next = new Set(current)
        next.add(activeSessionId)
        return next
      })
      setChatErrors((current) => {
        if (!current[activeSessionId]) return current

        const next = { ...current }
        delete next[activeSessionId]
        return next
      })
      void startAssistantRunRequest({
        sessionId: activeSessionId,
        model,
        reasoningEffort,
        runtimeId,
        environment,
        retryMessageId: options.retryMessageId,
      })
        .then(async (snapshot) => {
          if (
            runRequestSequence ===
              autoPreviewRunRequestSequenceRef.current &&
            sessionIdRef.current === snapshot.sessionId
          ) {
            setAutoPreviewRun((current) =>
              mergeAutoPreviewRunSnapshot(current, snapshot)
            )
          }
          await reloadMessages(activeSessionId)
          await Promise.all([reloadSessionProject(), reloadWorkspaces()])
          onSessionsChange()
          dispatchStudioLocalProjectsChanged()
          dispatchStudioWorkspacesChanged()
        })
        .catch((runError) => {
          const message =
            runError instanceof Error ? runError.message : t.studioChatFailed

          void reportStudioRuntimeFailure({
            source: "start_request",
            locale,
            sessionId: activeSessionId,
            runtimeId,
            model,
            environment,
            workspace: panelWorkspace,
            error: message,
          })
          setChatErrors((current) => ({
            ...current,
            [activeSessionId]: message,
          }))
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(activeSessionId)
            return next
          })
        })
    },
    [
      locale,
      onSessionsChange,
      panelWorkspace,
      reloadMessages,
      reloadSessionProject,
      reloadWorkspaces,
      t.studioChatFailed,
    ]
  )

  const stopAssistantRun = React.useCallback(
    (activeSessionId: string) => {
      void stopAssistantRunRequest(activeSessionId)
        .then(async () => {
          await reloadMessages(activeSessionId)
          onSessionsChange()
          dispatchStudioLocalProjectsChanged()
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(activeSessionId)
            return next
          })
        })
    },
    [onSessionsChange, reloadMessages]
  )

  const appendMessageIfActive = React.useCallback(
    (activeSessionId: string, message: StudioMessage) => {
      if (sessionIdRef.current !== activeSessionId) {
        return
      }
      setMessages((current) => [...current, message])
    },
    []
  )

  const executeWorkspaceHistoryAction = React.useCallback(
    (
      action: "undo" | "redo" | "checkpoint" | "rewind",
      assistantMessageId?: string
    ) => {
      if (!sessionId) {
        toast.error(t.studioWorkspaceHistoryRequiresSession)
        return
      }

      const activeSessionId = sessionId
      setStartingSessionIds((current) => {
        const next = new Set(current)
        next.add(activeSessionId)
        return next
      })

      void mutateWorkspaceHistoryRequest({
        sessionId: activeSessionId,
        action,
        assistantMessageId,
      })
        .then(async (history) => {
          if (sessionIdRef.current === activeSessionId) {
            setMessages(history.messages)
            if (typeof history.draft === "string") {
              setInput(history.draft)
              setPromptMentions([])
            }
          }

          await reloadSessionProject()
          await reloadLocalProjects()
          onSessionsChange()
          dispatchStudioSessionsChanged()
          dispatchStudioLocalProjectsChanged()

          if (rightPanelOpen && rightPanelMode === "review") {
            window.setTimeout(() => {
              void handleOpenWorkspaceChanges()
            }, 0)
          }

          toast.success(
            action === "undo"
              ? t.studioWorkspaceHistoryUndoSuccess
              : action === "redo"
                ? t.studioWorkspaceHistoryRedoSuccess
                : action === "checkpoint"
                  ? t.studioWorkspaceHistoryCheckpointSuccess
                  : t.studioWorkspaceHistoryRewindSuccess
          )
        })
        .catch((error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t.studioWorkspaceHistoryFailed
          )
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(activeSessionId)
            return next
          })
        })
    },
    [
      handleOpenWorkspaceChanges,
      onSessionsChange,
      reloadLocalProjects,
      reloadSessionProject,
      rightPanelMode,
      rightPanelOpen,
      sessionId,
      t,
    ]
  )

  const executeBuiltinSlashCommand = React.useCallback(
    (name: string, args = "") => {
      const commandName = name.toLowerCase()

      if (!isBuiltinSlashCommandName(commandName)) {
        return false
      }

      if (
        resolvedRuntimeId !== "astraflow" &&
        [
          "tools",
          "packages",
          "reload",
          "undo",
          "redo",
          "checkpoint",
          "tree",
          "rewind",
        ].includes(commandName)
      ) {
        return false
      }

      setInput("")
      setPromptMentions([])

      if (commandName === "clear") {
        setPendingAttachments([])
        setMessages([])
        setLoadFailed(false)
        setSelectedProjectId(null)
        setCurrentSessionTitle("")
        setSelectedPermissionMode("default")
        setLocalFullAccessConfirmed(false)
        setLatestRunUsage(null)
        setPendingProjectId(null)
        setSelectedEnvironment("local")
        setModelSelectOpen(false)
        setReasoningSelectOpen(false)
        setChatErrors((current) => {
          if (!sessionId || !current[sessionId]) {
            return current
          }

          const next = { ...current }
          delete next[sessionId]
          return next
        })
        onSessionChange("")
        return true
      }

      if (commandName === "model") {
        if (args) {
          const normalized = args.toLowerCase()
          const model = modelOptions.find(
            (option) =>
              option.id.toLowerCase() === normalized ||
              option.providerModel.toLowerCase() === normalized ||
              option.label.toLowerCase() === normalized
          )

          if (!model) {
            toast.error(t.studioCommandModelNotFound(args))
            return true
          }

          handleModelChange(model.id as SupportedChatModel)
          return true
        }

        setReasoningSelectOpen(false)
        setModelSelectOpen(true)
        return true
      }

      if (commandName === "reasoning") {
        if (args) {
          const normalized = args.toLowerCase()
          const model = modelOptions.find(
            (option) => option.id === selectedModel
          )

          if (
            !isChatReasoningEffort(normalized) ||
            !model?.reasoningEfforts.includes(normalized)
          ) {
            toast.error(t.studioCommandReasoningNotFound(args))
            return true
          }

          handleReasoningEffortChange(normalized)
          return true
        }

        setModelSelectOpen(false)
        setReasoningSelectOpen(true)
        return true
      }

      if (
        commandName === "approve" ||
        commandName === "always" ||
        commandName === "deny"
      ) {
        if (!sessionId || !pendingPermissionPart) {
          toast.error(t.studioPermissionNoPending)
          return true
        }

        const wantedKind =
          commandName === "approve"
            ? "allow_once"
            : commandName === "always"
              ? "allow_always"
              : "reject_once"
        const option =
          pendingPermissionPart.options.find(
            (candidate) => candidate.kind === wantedKind
          ) ??
          pendingPermissionPart.options.find((candidate) =>
            commandName === "deny"
              ? candidate.kind.startsWith("reject")
              : candidate.kind.startsWith("allow")
          )

        if (!option) {
          toast.error(t.studioPermissionNoPending)
          return true
        }

        const requestId = pendingPermissionPart.id
        const status = option.kind.startsWith("reject") ? "denied" : "approved"
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.sessionId !== sessionId
              ? message
              : {
                  ...message,
                  parts: message.parts.map((part) =>
                    part.type === "permission" && part.id === requestId
                      ? {
                          ...part,
                          status,
                          selectedOptionId: option.optionId,
                        }
                      : part
                  ),
                }
          )
        )
        void sendPermissionDecision({
          sessionId,
          requestId,
          optionId: option.optionId,
        }).catch(() => {
          toast.error(t.studioPermissionDecisionFailed)
          void reloadMessages(sessionId)
        })
        return true
      }

      if (commandName === "tools") {
        toast.info(t.studioPiToolsSummary)
        return true
      }

      if (commandName === "packages") {
        toast.info(t.studioPiPackagesSummary)
        return true
      }

      if (commandName === "reload") {
        dispatchStudioSlashCommandsRefresh()
        toast.success(t.studioPiReloaded)
        return true
      }

      if (commandName === "session") {
        const runtimeLabel =
          runtimeInfos.find((runtime) => runtime.id === resolvedRuntimeId)
            ?.label ?? resolvedRuntimeId
        toast.info(
          t.studioSessionSummary(
            runtimeLabel,
            selectedModel,
            currentSessionTitle.trim() || t.studioUntitledSession
          )
        )
        return true
      }

      if (commandName === "export") {
        if (!sessionId) {
          toast.error(t.studioCommandExportRequiresSession)
          return true
        }

        const anchor = document.createElement("a")
        anchor.href = `/api/studio/sessions/${encodeURIComponent(sessionId)}/export`
        anchor.download = ""
        anchor.hidden = true
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        toast.success(t.studioCommandExportStarted)
        return true
      }

      if (
        commandName === "undo" ||
        commandName === "redo" ||
        commandName === "checkpoint"
      ) {
        executeWorkspaceHistoryAction(commandName)
        return true
      }

      if (commandName === "rewind") {
        if (!args) {
          toast.error(t.studioWorkspaceHistoryRewindRequiresMessageId)
          return true
        }

        executeWorkspaceHistoryAction("rewind", args)
        return true
      }

      if (commandName === "tree") {
        if (!sessionId) {
          toast.error(t.studioWorkspaceHistoryRequiresSession)
          return true
        }

        void getWorkspaceHistoryRequest(sessionId)
          .then((history) => {
            toast.info(
              t.studioWorkspaceHistoryTreeSummary(
                history.turns.length,
                history.canUndo,
                history.canRedo
              )
            )
          })
          .catch((error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : t.studioWorkspaceHistoryFailed
            )
          })
        return true
      }

      if (commandName !== "compact") {
        return false
      }

      if (!sessionId) {
        toast.error(t.studioCompactRequiresSession)
        return true
      }

      setStartingSessionIds((current) => {
        const next = new Set(current)
        next.add(sessionId)
        return next
      })
      void compactSessionRequest(sessionId, args)
        .then(async ({ usage }) => {
          if (usage) {
            setLatestRunUsage(usage)
          }

          await reloadSessionProject()
          onSessionsChange()
          dispatchStudioSessionsChanged()
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : t.studioCompactFailed
          )
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(sessionId)
            return next
          })
        })

      return true
    },
    [
      onSessionChange,
      onSessionsChange,
      currentSessionTitle,
      executeWorkspaceHistoryAction,
      handleModelChange,
      handleReasoningEffortChange,
      modelOptions,
      pendingPermissionPart,
      reloadMessages,
      reloadSessionProject,
      resolvedRuntimeId,
      runtimeInfos,
      selectedModel,
      sessionId,
      setSelectedEnvironment,
      t,
    ]
  )

  const handleRetryMessage = React.useCallback(
    (message: StudioMessage) => {
      if (!sessionId || isBusy || message.role !== "assistant") {
        return
      }

      startAssistantRun(
        sessionId,
        selectedModel,
        selectedReasoningEffort,
        resolvedRuntimeId,
        resolvedEnvironment,
        {
          retryMessageId: message.id,
        }
      )
    },
    [
      isBusy,
      resolvedEnvironment,
      resolvedRuntimeId,
      selectedModel,
      selectedReasoningEffort,
      sessionId,
      startAssistantRun,
    ]
  )

  const handleRewindMessage = React.useCallback(
    (message: StudioMessage) => {
      if (message.role === "assistant" && message.rewindAvailable) {
        executeWorkspaceHistoryAction("rewind", message.id)
      }
    },
    [executeWorkspaceHistoryAction]
  )

  const handleWorkspaceChange = React.useCallback(
    (nextWorkspaceId: string | null) => {
      if (sessionId || isBusy) {
        return
      }

      if (nextWorkspaceId === null) {
        if (!currentWorkspace && !workspaceId?.trim()) {
          return
        }

        setCurrentWorkspace(null)
        setSelectedProjectId(null)
        setPendingWorkspaceId(null)
        setPendingProjectId(null)
        setSelectedEnvironment("local")
        setLocalFullAccessConfirmed(false)
        if (selectedPermissionMode === "full_access") {
          setSelectedPermissionMode("default")
        }
        router.push("/studio", { scroll: false })
        return
      }

      const nextWorkspace = workspaces.find(
        (candidate) => candidate.id === nextWorkspaceId
      )

      if (!nextWorkspace || nextWorkspace.id === currentWorkspace?.id) {
        return
      }

      const nextProjectId =
        nextWorkspace.origin === "selected_local"
          ? nextWorkspace.localProjectId
          : null
      const nextEnvironment =
        nextWorkspace.type === "sandbox" ? "remote" : "local"

      setCurrentWorkspace(nextWorkspace)
      setSelectedProjectId(nextProjectId)
      setPendingWorkspaceId(nextWorkspace.id)
      setPendingProjectId(nextProjectId)
      setSelectedEnvironment(nextEnvironment)
      setLocalFullAccessConfirmed(false)
      if (selectedPermissionMode === "full_access") {
        setSelectedPermissionMode("default")
      }

      router.push(`/studio?workspace=${encodeURIComponent(nextWorkspace.id)}`, {
        scroll: false,
      })
    },
    [
      currentWorkspace,
      isBusy,
      router,
      selectedPermissionMode,
      sessionId,
      setSelectedEnvironment,
      workspaceId,
      workspaces,
    ]
  )

  const handleAddWorkspace = React.useCallback(() => {
    dispatchStudioRemoteWorkspaceCreateRequested()
  }, [])

  const handlePermissionModeChange = React.useCallback(
    async (permissionMode: StudioPublicPermissionMode) => {
      const previousPermissionMode = selectedPermissionMode
      const previousConfirmation = localFullAccessConfirmed
      const requiresLocalConfirmation =
        permissionMode === "full_access" && effectiveEnvironment === "local"

      if (!sessionId) {
        setSelectedPermissionMode(permissionMode)
        setLocalFullAccessConfirmed(false)
        return
      }

      const activeSessionId = sessionId

      try {
        let localFullAccessGrant: string | undefined

        if (requiresLocalConfirmation) {
          const bridge = window.astraflowDesktop

          if (!bridge?.requestLocalFullAccessGrant) {
            throw new Error(
              "Local Full Access can only be confirmed by AstraFlow Desktop."
            )
          }

          const grant = await bridge.requestLocalFullAccessGrant({
            sessionId: activeSessionId,
            workspaceId: currentWorkspace?.id ?? null,
            environment: "local",
            policyVersion: 2,
          })

          if (!grant.granted || !grant.token) {
            return
          }

          localFullAccessGrant = grant.token
        }

        setSelectedPermissionMode(permissionMode)
        setLocalFullAccessConfirmed(requiresLocalConfirmation)

        const session = await updateSessionPermissionMode(
          activeSessionId,
          permissionMode,
          {
            localFullAccessGrant,
          }
        )

        onSessionsChange()
        dispatchStudioSessionsChanged()

        if (
          session.id !== activeSessionId ||
          sessionIdRef.current !== activeSessionId
        ) {
          return
        }

        setSelectedPermissionMode(session.permissionMode)
        setLocalFullAccessConfirmed(session.localFullAccessGranted)
      } catch {
        if (sessionIdRef.current === activeSessionId) {
          setSelectedPermissionMode(previousPermissionMode)
          setLocalFullAccessConfirmed(previousConfirmation)
          toast.error(t.requestFailed)
        }
      }
    },
    [
      effectiveEnvironment,
      currentWorkspace,
      localFullAccessConfirmed,
      onSessionsChange,
      selectedPermissionMode,
      sessionId,
      t,
    ]
  )

  const handlePermissionDecision = React.useCallback(
    (
      requestId: string,
      option: StudioPermissionOption,
      status: Extract<StudioMessagePart, { type: "permission" }>["status"],
      feedback?: string
    ) => {
      if (!sessionId) {
        return
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.sessionId !== sessionId
            ? message
            : {
                ...message,
                parts: message.parts.map((part) =>
                  part.type === "permission" && part.id === requestId
                    ? {
                        ...part,
                        status,
                        selectedOptionId: option.optionId,
                      }
                    : part
                ),
              }
        )
      )

      void sendPermissionDecision({
        sessionId,
        requestId,
        optionId: option.optionId,
        feedback,
      }).catch(() => {
        toast.error(t.studioPermissionDecisionFailed)
        void reloadMessages(sessionId)
      })
    },
    [reloadMessages, sessionId, t]
  )

  React.useEffect(() => {
    handledNotificationActionsRef.current.clear()
  }, [sessionId])

  React.useEffect(() => {
    const bridge = window.astraflowDesktop

    if (!bridge?.onNotificationAction) return

    const handleAction = (action: AstraFlowDesktopNotificationAction) => {
      if (!sessionId || !pendingPermissionPart) return

      const notificationId = `permission:${sessionId}:${pendingPermissionPart.id}`
      if (
        action.notificationId !== notificationId ||
        handledNotificationActionsRef.current.has(notificationId)
      ) {
        return
      }

      const wantsDeny = action.actionId === "reject"
      const option =
        pendingPermissionPart.options.find((candidate) =>
          wantsDeny
            ? candidate.kind === "reject_once"
            : candidate.kind === "allow_once"
        ) ??
        pendingPermissionPart.options.find((candidate) =>
          wantsDeny
            ? candidate.kind.startsWith("reject")
            : candidate.kind.startsWith("allow")
        )

      if (!option) return

      handledNotificationActionsRef.current.add(notificationId)
      handlePermissionDecision(
        pendingPermissionPart.id,
        option,
        wantsDeny ? "denied" : "approved"
      )
      void bridge.acknowledgeNotificationAction(notificationId)
    }

    void bridge.listPendingNotificationActions().then((actions) => {
      actions.forEach(handleAction)
    })
    return bridge.onNotificationAction(handleAction)
  }, [handlePermissionDecision, pendingPermissionPart, sessionId])

  const handleUserInputDecision = React.useCallback(
    (
      requestId: string,
      answers: StudioUserInputAnswer[],
      status: Extract<StudioMessagePart, { type: "user_input" }>["status"]
    ) => {
      if (!sessionId) {
        return
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.sessionId !== sessionId
            ? message
            : {
                ...message,
                parts: message.parts.map((part) =>
                  part.type === "user_input" && part.id === requestId
                    ? {
                        ...part,
                        status,
                        answers,
                      }
                    : part
                ),
              }
        )
      )

      void sendUserInputDecision({
        sessionId,
        requestId,
        answers,
        cancelled: status === "cancelled",
      }).catch(() => {
        toast.error(t.requestFailed)
        void reloadMessages(sessionId)
      })
    },
    [reloadMessages, sessionId, t]
  )

  async function handleSubmit(
    skillSlugs?: string[],
    promptOverride?: string,
    options?: { preserveComposer?: boolean; planMode?: boolean }
  ) {
    const preserveComposer = options?.preserveComposer === true
    const titleSource = getSessionTitleSummarySource({
      attachmentName: preserveComposer
        ? undefined
        : pendingAttachments[0]?.name,
      prompt: promptOverride ?? input,
      skillSlugs,
    })
    const prompt = formatSlashSkillPrompt(
      skillSlugs ?? [],
      promptOverride ?? input
    )
    const attachments = preserveComposer ? [] : pendingAttachments
    const mentions = preserveComposer
      ? []
      : serializeComposerMentions(
          promptMentions.filter((mention) =>
            textHasComposerMentionToken(input, mention)
          )
        )

    if ((!prompt && attachments.length === 0) || isBusy) {
      return
    }

    const isNewSession = !sessionId
    const workspaceIdForNewSession = isNewSession
      ? currentWorkspace?.id || workspaceId?.trim() || null
      : null

    const projectIdForNewSession = isNewSession ? selectedProjectId : null

    const slashCommand = parseSlashCommandText(prompt)
    const runtimeOwnsSlashCommand =
      slashCommand && sessionId
        ? (await listSessionSlashCommands(sessionId)).some(
            (command) =>
              command.name.toLowerCase() === slashCommand.name.toLowerCase()
          )
        : false

    if (
      slashCommand &&
      !runtimeOwnsSlashCommand &&
      isBuiltinSlashCommandName(slashCommand.name) &&
      executeBuiltinSlashCommand(slashCommand.name, slashCommand.args)
    ) {
      return
    }

    if (!preserveComposer) {
      setInput("")
      setPendingAttachments([])
      setPromptMentions([])
    }

    let newSessionPersisted = false

    try {
      let activeSession =
        sessionId.length > 0
          ? { id: sessionId }
          : await createSession(getFallbackSessionTitle(titleSource), {
              chatModel: selectedModel,
              chatRuntimeId: resolvedRuntimeId,
              chatReasoningEffort: selectedReasoningEffort,
              workspaceId: workspaceIdForNewSession,
              projectId: projectIdForNewSession,
              permissionMode:
                selectedPermissionMode === "full_access" &&
                effectiveEnvironment === "remote"
                  ? "full_access"
                  : "default",
            })
      const activeSessionId = activeSession.id
      let nextPermissionMode = selectedPermissionMode

      if (
        isNewSession &&
        selectedPermissionMode === "full_access" &&
        effectiveEnvironment === "local"
      ) {
        const bridge = window.astraflowDesktop

        if (!bridge?.requestLocalFullAccessGrant) {
          throw new Error(
            "Local Full Access can only be confirmed by AstraFlow Desktop."
          )
        }

        const grant = await bridge.requestLocalFullAccessGrant({
          sessionId: activeSessionId,
          workspaceId:
            "workspaceId" in activeSession
              ? activeSession.workspaceId
              : workspaceIdForNewSession,
          environment: "local",
          policyVersion: 2,
        })

        if (!grant.granted || !grant.token) {
          throw new Error("Local Full Access was not enabled.")
        }

        const grantedSession = await updateSessionPermissionMode(
          activeSessionId,
          "full_access",
          { localFullAccessGrant: grant.token }
        )
        activeSession = grantedSession
        setLocalFullAccessConfirmed(grantedSession.localFullAccessGranted)
      }

      if ("projectId" in activeSession) {
        if (
          activeSession.workspaceId !== workspaceIdForNewSession ||
          activeSession.projectId !== projectIdForNewSession
        ) {
          throw new Error("The new session workspace binding was not saved.")
        }

        newSessionPersisted = true
        setCurrentWorkspace(activeSession.workspace ?? currentWorkspace)
        setSelectedProjectId(activeSession.projectId)
        nextPermissionMode = activeSession.permissionMode
        setPendingProjectId(null)
        setPendingWorkspaceId(null)
      }

      setSelectedPermissionMode(nextPermissionMode)

      await saveChatPreferences(activeSessionId, {
        chatModel: selectedModel,
        chatRuntimeId: resolvedRuntimeId,
        chatReasoningEffort: selectedReasoningEffort,
      })

      if (isNewSession && options?.planMode) {
        await enableInitialPlanMode(activeSessionId, resolvedRuntimeId)
      }

      const userMessage = await createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: prompt,
        environment: effectiveEnvironment,
        workspace:
          "workspace" in activeSession && activeSession.workspace
            ? {
                id: activeSession.workspace.id,
                type: activeSession.workspace.type,
                rootPath: activeSession.workspace.rootPath,
              }
            : messageWorkspace,
        mentions,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          type: attachment.type,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          dataUrl: attachment.dataUrl,
        })),
      })

      const runtimeLabel =
        runtimeInfos.find((runtime) => runtime.id === resolvedRuntimeId)
          ?.label ?? resolvedRuntimeId
      if (isNewSession) {
        trackClientAnalyticsEvent({
          eventName: "studio.session.created",
          eventType: "session",
          targetId: activeSessionId,
          targetLabel: runtimeLabel,
        })
      }
      trackClientAnalyticsEvent({
        eventName: "studio.session.active",
        eventType: "session",
        targetId: activeSessionId,
        targetLabel: runtimeLabel,
      })
      trackClientAnalyticsEvent({
        eventName: "agent.run",
        eventType: "agent",
        targetId: resolvedRuntimeId,
        targetLabel: runtimeLabel,
      })

      if (!sessionId) {
        setCurrentSessionTitle(
          "title" in activeSession ? activeSession.title : ""
        )
        setMessages([userMessage])
        onSessionChange(activeSessionId)
      } else {
        appendMessageIfActive(activeSessionId, userMessage)
      }

      onSessionsChange()

      const shouldGenerateTitle =
        Boolean(prompt) &&
        (isNewSession ||
          currentSessionTitle.trim() === t.studioNewExpertSession)

      if (shouldGenerateTitle) {
        void generateSessionTitle(activeSessionId, titleSource)
          .then((updatedSession) => {
            if (sessionIdRef.current === activeSessionId) {
              setCurrentSessionTitle(updatedSession.title)
            }
            onSessionsChange()
          })
          .catch(() => {
            // Keep the prompt-based fallback title on failure.
          })
      }

      startAssistantRun(
        activeSessionId,
        selectedModel,
        selectedReasoningEffort,
        resolvedRuntimeId,
        resolvedEnvironment
      )
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : t.studioChatFailed

      if (isNewSession && !newSessionPersisted) {
        setInput((current) => current || input)
        setPendingAttachments((current) =>
          current.length > 0 ? current : attachments
        )
        setPromptMentions((current) =>
          current.length > 0 ? current : promptMentions
        )
      }

      if (isNewSession && projectIdForNewSession && !newSessionPersisted) {
        toast.error(t.studioLocalProjectBindFailed)
      }

      if (sessionId) {
        setChatErrors((current) => ({ ...current, [sessionId]: message }))
      } else {
        setLoadFailed(true)
      }
    }
  }

  function handleStop() {
    if (sessionId) {
      stopAssistantRun(sessionId)
    }
  }

  function openTitlebarFeedback() {
    setFeedbackTarget({ entryPoint: "titlebar", messageId: null })
    setFeedbackOpen(true)
  }

  // Must stay referentially stable: it is passed to every ChatMessageBubble,
  // and an unstable reference defeats their React.memo on each streaming frame.
  const openMessageFeedback = React.useCallback((message: StudioMessage) => {
    setFeedbackTarget({
      entryPoint: "message_action",
      messageId: message.id,
    })
    setFeedbackOpen(true)
  }, [])

  const chatTitle = currentSessionTitle.trim() || t.studioUntitledSession
  const renderStatusPanel = (presentation: "inline" | "popover") => (
    <StudioStatusPanel
      open={
        presentation === "popover"
          ? statusPanelOverlayOpen
          : statusPanelInlineOpen
      }
      presentation={presentation}
      project={selectedProject}
      workspace={messageWorkspace}
      environment={effectiveEnvironment}
      permissionMode={selectedPermissionMode}
      files={outputFiles}
      changes={fileChanges}
      labels={panelLabels}
      plan={hasMessages ? latestPlan : null}
      subagents={subagentSummaries}
      usage={latestRunUsage}
      running={isBusy}
      environmentChangeDisabled
      loadingChanges={loadingWorkspaceChanges}
      onOpenChanges={handleOpenWorkspaceChanges}
      onOpenPlan={handleOpenPlanSummary}
      onOpenSubagent={handleOpenSubagentSummary}
      onOpenSources={() => openRightPanelMode("files")}
      onRefresh={reloadLocalProjects}
      onEnvironmentChange={() => undefined}
    />
  )

  return (
    <StudioWorkspaceServiceIdentityContext.Provider
      value={workspaceServiceContext}
    >
      <section
        data-testid="studio-chat-workbench"
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
      <div
        data-testid="studio-workspace-row"
        className="relative flex min-h-0 min-w-0 flex-1"
      >
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col bg-background",
            effectiveRightPanelFocused && "hidden"
          )}
        >
          <TitlebarSurface
            data-studio-chat-titlebar
            data-titlebar-avoid-collapsed-toggle
            className="px-4"
          >
            <div
              data-titlebar-control-group="content"
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
            >
              <div
                className="min-w-0 shrink truncate text-sm font-medium text-foreground"
                title={chatTitle}
              >
                {chatTitle}
              </div>
              {currentWorkspace ? (
                <span
                  className={cn(
                    "flex h-6 max-w-52 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-xs",
                    currentWorkspace.type === "sandbox"
                      ? "bg-sky-500/8 text-sky-700 dark:text-sky-300"
                      : "bg-muted/60 text-muted-foreground"
                  )}
                  title={currentWorkspace.rootPath}
                >
                  {currentWorkspace.type === "sandbox" ? (
                    <Cloud aria-hidden className="size-3 shrink-0" />
                  ) : (
                    <Folder aria-hidden className="size-3 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">
                    {currentWorkspace.name}
                  </span>
                  {currentWorkspace.type === "sandbox" ? (
                    <span className="shrink-0 rounded border border-sky-500/25 px-1 py-0.5 text-[8px] leading-none font-semibold tracking-[0.08em] uppercase">
                      {t.studioWorkspaceSandboxBadge}
                    </span>
                  ) : null}
                </span>
              ) : selectedProject ? (
                <span
                  className="flex h-6 max-w-40 min-w-0 shrink items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs text-muted-foreground"
                  title={selectedProject.path}
                >
                  <Folder aria-hidden className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">
                    {selectedProject.name}
                  </span>
                </span>
              ) : null}
              {selectedProject?.git.branch ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-6 max-w-48 min-w-0 shrink items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <GitBranch aria-hidden className="size-3 shrink-0" />
                      <span className="min-w-0 truncate font-mono">
                        {selectedProject.git.branch}
                      </span>
                      <RiArrowDownSLine
                        aria-hidden
                        className="size-3 shrink-0"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-72">
                    <DropdownMenuLabel>
                      {panelLabels.envBranches}
                    </DropdownMenuLabel>
                    {(selectedProject.git.branches ?? []).map((branch) => (
                      <DropdownMenuItem key={branch} disabled>
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            branch === selectedProject.git.branch &&
                              "font-semibold"
                          )}
                        >
                          {branch}
                        </span>
                        {branch === selectedProject.git.branch ? (
                          <RiCheckLine
                            aria-hidden
                            className="ml-auto size-3.5"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            <div
              data-titlebar-control-group="actions"
              className="no-drag ml-3 flex shrink-0 items-center gap-1"
            >
              <IconButton
                type="button"
                variant="chrome"
                size="icon-sm"
                data-testid="studio-feedback-titlebar"
                label={t.studioFeedback}
                tooltip={t.studioFeedback}
                tooltipAlign="end"
                tooltipSide="bottom"
                className="no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground"
                onClick={openTitlebarFeedback}
              >
                <CentralIcon name="bubble-alert" className="size-3.5" />
              </IconButton>

              <IconButton
                type="button"
                variant="chrome"
                size="icon-sm"
                label={panelLabels.files}
                tooltipAlign="end"
                tooltipSide="bottom"
                tooltip={
                  <span className="flex items-center gap-2">
                    <span>{panelLabels.files}</span>
                    <span
                      data-slot="kbd"
                      className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    >
                      ⌘P
                    </span>
                  </span>
                }
                className={cn(
                  "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                  rightPanelOpen &&
                    rightPanelMode === "files" &&
                    "bg-muted text-foreground"
                )}
                onClick={() => {
                  if (rightPanelOpen && rightPanelMode === "files") {
                    toggleRightPanel()
                  } else {
                    openRightPanelMode("files")
                  }
                }}
              >
                <CentralIcon name="folders" className="size-3.5" />
              </IconButton>

              <IconButton
                type="button"
                variant="chrome"
                size="icon-sm"
                label={panelLabels.envChanges}
                tooltip={panelLabels.envChanges}
                tooltipAlign="end"
                tooltipSide="bottom"
                className={cn(
                  "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                  rightPanelOpen &&
                    rightPanelMode === "review" &&
                    "bg-muted text-foreground"
                )}
                disabled={
                  (!selectedProject && fileChanges.length === 0) ||
                  loadingWorkspaceChanges
                }
                onClick={() => void handleOpenWorkspaceChanges()}
              >
                {loadingWorkspaceChanges ? (
                  <RiLoader4Line
                    aria-hidden
                    className="size-3.5 animate-spin"
                  />
                ) : (
                  <CentralIcon name="changes" className="size-3.5" />
                )}
              </IconButton>

              <IconButton
                type="button"
                variant="chrome"
                size="icon-sm"
                data-testid="studio-terminal-panel-toggle"
                label={t.studioTerminalPanelToggle}
                tooltipAlign="end"
                tooltipSide="bottom"
                tooltip={
                  <span className="flex items-center gap-2">
                    <span>{t.studioTerminalPanelToggle}</span>
                    <span
                      data-slot="kbd"
                      className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    >
                      Cmd+J
                    </span>
                  </span>
                }
                aria-pressed={terminalPanelOpen}
                className={cn(
                  "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                  terminalPanelOpen && "bg-muted text-foreground"
                )}
                onClick={toggleTerminalPanel}
              >
                <CentralIcon name="console" className="size-3.5" />
              </IconButton>

              {statusPanelToggleAvailable ? (
                statusPanelDisplayMode === "overlay" ? (
                  <Popover
                    open={statusPanelOverlayOpen}
                    onOpenChange={setStatusPanelPopoverOpen}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-testid="studio-status-panel-toggle"
                            aria-label={panelLabels.envEnvironmentInfo}
                            aria-pressed={statusPanelOverlayOpen}
                            className={cn(
                              "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                              statusPanelOverlayOpen &&
                                "bg-muted text-foreground"
                            )}
                          >
                            <RiInformationLine
                              aria-hidden
                              className="size-3.5"
                            />
                          </Button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent align="end" side="bottom">
                        <span>{panelLabels.envEnvironmentInfo}</span>
                      </TooltipContent>
                    </Tooltip>
                    <PopoverContent
                      align="end"
                      side="bottom"
                      sideOffset={8}
                      className="w-[300px] max-w-[calc(100vw-1rem)] gap-0 bg-transparent p-0 shadow-none ring-0"
                    >
                      {renderStatusPanel("popover")}
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-testid="studio-status-panel-toggle"
                        aria-label={panelLabels.envEnvironmentInfo}
                        aria-pressed={statusPanelInlineOpen}
                        className={cn(
                          "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                          statusPanelInlineOpen && "bg-muted text-foreground"
                        )}
                        onClick={toggleStatusPanel}
                      >
                        <RiInformationLine aria-hidden className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent align="end" side="bottom">
                      <span>{panelLabels.envEnvironmentInfo}</span>
                    </TooltipContent>
                  </Tooltip>
                )
              ) : null}

              <IconButton
                type="button"
                variant="chrome"
                size="icon-sm"
                data-testid="studio-right-panel-toggle"
                label={panelLabels.toggleRightPanel}
                tooltip={panelLabels.toggleRightPanel}
                tooltipAlign="end"
                tooltipSide="bottom"
                aria-pressed={rightPanelOpen}
                className={cn(
                  "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                  rightPanelOpen && "bg-muted text-foreground"
                )}
                onClick={toggleRightPanel}
              >
                <CentralIcon
                  name="sidebar-hidden-right-wide"
                  className="size-3.5"
                />
              </IconButton>
            </div>
          </TitlebarSurface>

          <div className={statusPanelContentClassName}>
            <div ref={chatViewportRef} className="relative min-h-0 flex-1">
              {hasMessages ? (
                <div className="h-full min-h-0">
                  <ChatContainerRoot
                    className="h-full min-h-0"
                    followOutput={isBusy && followLiveOutput}
                  >
                    <ChatContainerContent
                      className={cn(
                        "mx-auto flex min-h-full w-full max-w-[736px] gap-6 px-8 py-10",
                        statusPanelSurfaceClassName
                      )}
                      style={statusPanelContentStyle}
                    >
                      <StudioPerformanceProfiler id="StudioChatMessages">
                        {visibleMessages.map((message) => (
                          <ChatMessageBubble
                            key={message.id}
                            message={message}
                            projectId={
                              currentWorkspace?.origin === "selected_local"
                                ? currentWorkspace.localProjectId
                                : null
                            }
                            workspace={messageWorkspace}
                            onRetry={handleRetryMessage}
                            onRewind={handleRewindMessage}
                            onFeedback={openMessageFeedback}
                          />
                        ))}
                      </StudioPerformanceProfiler>

                      {isStarting && !hasStreamingMessage ? (
                        <div className="flex w-full justify-start">
                          <Shimmer className="text-sm">
                            {t.studioThinking}
                          </Shimmer>
                        </div>
                      ) : null}

                      {error ? (
                        <div
                          className={cn(
                            "rounded-lg border px-3 py-2 text-sm",
                            error === "chat-failed"
                              ? "border-destructive/25 bg-destructive/5 text-destructive"
                              : "border-border/70 bg-muted/35 text-muted-foreground"
                          )}
                        >
                          <p>
                            {error === "chat-failed"
                              ? t.studioChatFailed
                              : t.studioLoadFailed}
                          </p>
                          {error === "chat-failed" && chatError ? (
                            <p className="mt-1 text-xs break-words whitespace-pre-wrap text-destructive/80">
                              {chatError}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <ChatContainerScrollAnchor />
                    </ChatContainerContent>
                  </ChatContainerRoot>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-full items-center justify-center px-8 pb-24",
                    statusPanelSurfaceClassName
                  )}
                  style={statusPanelContentStyle}
                >
                  <div className="flex w-full max-w-[736px] flex-col items-center gap-6">
                    <h1 className="font-sans text-[22px] leading-7 font-semibold">
                      {t.studioChatGreeting(greetingPeriod)}
                    </h1>
                    <ChatComposer
                      key={`composer:${sessionId || "new"}`}
                      sessionId={sessionId}
                      workspace={currentWorkspace}
                      workspaces={workspaces}
                      workspacesLoading={workspacesLoading}
                      value={input}
                      userMessageHistory={userMessageHistory}
                      model={selectedModel}
                      modelOptions={modelOptions}
                      runtimeId={resolvedRuntimeId}
                      runtimeInfos={runtimeInfos}
                      reasoningEffort={selectedReasoningEffort}
                      permissionMode={selectedPermissionMode}
                      localProjects={localProjects}
                      selectedProjectId={selectedProjectId}
                      contextUsage={latestRunUsage}
                      attachments={pendingAttachments}
                      mentions={promptMentions}
                      onModelChange={handleModelChange}
                      onRuntimeChange={handleRuntimeChange}
                      onReasoningEffortChange={handleReasoningEffortChange}
                      onPermissionModeChange={handlePermissionModeChange}
                      onWorkspaceChange={handleWorkspaceChange}
                      onAddWorkspace={handleAddWorkspace}
                      onValueChange={setInput}
                      onMentionsChange={setPromptMentions}
                      onAddFiles={addFiles}
                      onRemoveAttachment={removeAttachment}
                      modelSelectOpen={modelSelectOpen}
                      onModelSelectOpenChange={setModelSelectOpen}
                      reasoningSelectOpen={reasoningSelectOpen}
                      onReasoningSelectOpenChange={setReasoningSelectOpen}
                      onSubmit={handleSubmit}
                      onStop={handleStop}
                      canSubmit={canSubmit}
                      isBusy={isBusy}
                    />
                    {agentModelSettings?.hasModelverseApiKey ? (
                      <StudioPromptTips
                        label={t.studioMediaPromptTipLabel}
                        prompts={t.studioMediaSuggestedPrompts}
                        disabled={isBusy}
                        onAsk={(prompt) => {
                          void handleSubmit([], prompt)
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              )}

              {hasMessages ? (
                <StudioMessageTrail messages={visibleMessages} />
              ) : null}

              {floatingPlan ? (
                <div
                  data-testid="studio-floating-plan"
                  className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-8"
                >
                  <div
                    className={cn(
                      "flex w-full justify-center",
                      statusPanelSurfaceClassName
                    )}
                    style={statusPanelContentStyle}
                  >
                    <AssistantPlan
                      todos={floatingPlan.todos}
                      partId={floatingPlan.partId}
                      expandOnHover
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {hasMessages ? (
              <div className="shrink-0 px-8 pb-5">
                <div
                  className={cn(
                    "mx-auto flex w-full max-w-[736px] flex-col gap-2",
                    statusPanelSurfaceClassName
                  )}
                  style={statusPanelContentStyle}
                >
                  {pendingUserInputPart ? (
                    <PendingUserInputPanel
                      key={pendingUserInputPart.id}
                      part={pendingUserInputPart}
                      onDecision={handleUserInputDecision}
                    />
                  ) : pendingPermissionPart ? (
                    <PendingPermissionApprovalPanel
                      part={pendingPermissionPart}
                      onDecision={handlePermissionDecision}
                    />
                  ) : (
                    <>
                      <ComposerSubagentStrip
                        items={composerSubagentSummaries}
                        compact={subagentStripCompact}
                        onCompactChange={setSubagentStripCompact}
                        onOpenSubagent={handleOpenSubagentSummary}
                        onStopAll={isBusy ? handleStop : undefined}
                      />
                      <ChatComposer
                        key={`composer:${sessionId || "new"}`}
                        sessionId={sessionId}
                        workspace={currentWorkspace}
                        workspaces={workspaces}
                        workspacesLoading={workspacesLoading}
                        value={input}
                        userMessageHistory={userMessageHistory}
                        model={selectedModel}
                        modelOptions={modelOptions}
                        runtimeId={resolvedRuntimeId}
                        runtimeInfos={runtimeInfos}
                        reasoningEffort={selectedReasoningEffort}
                        permissionMode={selectedPermissionMode}
                        localProjects={localProjects}
                        selectedProjectId={selectedProjectId}
                        contextUsage={latestRunUsage}
                        attachments={pendingAttachments}
                        mentions={promptMentions}
                        onModelChange={handleModelChange}
                        onRuntimeChange={handleRuntimeChange}
                        onReasoningEffortChange={handleReasoningEffortChange}
                        onPermissionModeChange={handlePermissionModeChange}
                        onWorkspaceChange={handleWorkspaceChange}
                        onAddWorkspace={handleAddWorkspace}
                        onValueChange={setInput}
                        onMentionsChange={setPromptMentions}
                        onAddFiles={addFiles}
                        onRemoveAttachment={removeAttachment}
                        modelSelectOpen={modelSelectOpen}
                        onModelSelectOpenChange={setModelSelectOpen}
                        reasoningSelectOpen={reasoningSelectOpen}
                        onReasoningSelectOpenChange={setReasoningSelectOpen}
                        onSubmit={handleSubmit}
                        onStop={handleStop}
                        canSubmit={canSubmit}
                        isBusy={isBusy}
                      />
                      <p className="text-center text-xs text-muted-foreground">
                        {t.studioDisclaimer}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {statusPanelDisplayMode === "overlay"
            ? null
            : renderStatusPanel("inline")}
        </div>

        {panelWorkspace ? (
          <StudioRightPanel
            open={rightPanelOpen}
            focused={effectiveRightPanelFocused}
            sessionId={sessionId}
            workspace={panelWorkspace}
            mode={rightPanelMode}
            subagents={subagentPanelItems}
            getSessionFileChanges={getSessionReviewFileChanges}
            subagentPanelRequest={subagentPanelRequest}
            onOpenChange={handleRightPanelOpenChange}
            onFocusedChange={handleRightPanelFocusedChange}
            onModeChange={setRightPanelMode}
          />
        ) : null}
      </div>

      {panelWorkspace ? (
        <StudioTerminalPanel
          open={terminalPanelOpen}
          workspace={panelWorkspace}
          onOpenChange={setTerminalPanelOpen}
        />
      ) : null}

      <StudioFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        sessionId={sessionId}
        target={feedbackTarget}
      />
      </section>
    </StudioWorkspaceServiceIdentityContext.Provider>
  )
}

export { StudioChatWorkbench }
