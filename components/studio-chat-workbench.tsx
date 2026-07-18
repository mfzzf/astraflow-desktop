"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiFeedbackLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"
import {
  Cloud,
  Diff,
  Folder,
  GitBranch,
  PanelBottom,
  PanelRight,
} from "lucide-react"
import { toast } from "sonner"

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
import { StudioTerminalPanel } from "@/components/studio-terminal-panel"
import {
  PendingPermissionApprovalPanel,
  PendingUserInputPanel,
} from "@/components/studio-message-parts-renderer"
import {
  AssistantPlan,
  isAssistantPlanComplete,
} from "@/components/studio-message-parts/plan-todo"
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
  StudioChatRunLiveSnapshot,
  StudioLocalProjectWithGitInfo,
  StudioMessage,
  StudioMessagePart,
  StudioPermissionMode,
  StudioPermissionOption,
  StudioTokenUsage,
  StudioUserInputAnswer,
  StudioWorkspace,
} from "@/lib/studio-types"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioRemoteWorkspaceCreateRequested,
  dispatchStudioSessionsChanged,
  dispatchStudioSlashCommandsRefresh,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
  STUDIO_WORKSPACES_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import { getStudioExpertDraftPromptStorageKey } from "@/lib/studio-expert-draft"
import {
  createStudioAgentWorkspace,
  createStudioDefaultHomeWorkspace,
} from "@/lib/studio-default-workspace"
import { openStudioReviewPanel } from "@/lib/studio-review-panel"
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
  getChatModelOptionsForRuntime,
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
  ChatPreferenceRecord,
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

function subscribeDesktopHomePath() {
  return () => undefined
}

function getDesktopHomePath() {
  return typeof window === "undefined"
    ? ""
    : (window.astraflowDesktop?.homePath?.trim() ?? "")
}

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
  const greetingPeriod = useStudioGreetingPeriod()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedRuntimeId, setSelectedRuntimeId] = useChatRuntime()
  const [selectedReasoningEffort] = useChatReasoningEffort(selectedModel)
  const [, setSelectedEnvironment] = useChatEnvironment()
  const [runtimeInfos, setRuntimeInfos] = React.useState<ChatRuntimeOption[]>(
    () => [FALLBACK_CHAT_RUNTIME_INFO]
  )
  const [agentModelSettings, setAgentModelSettings] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [chatDefaultsHydrated, setChatDefaultsHydrated] = React.useState(false)
  const [chatDefaults, setChatDefaults] =
    React.useState<StoredChatDefaults | null>(null)
  const [sessionChatPreferences, setSessionChatPreferences] = React.useState<
    ChatPreferenceRecord | null | undefined
  >(undefined)
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
  const desktopHomePath = React.useSyncExternalStore(
    subscribeDesktopHomePath,
    getDesktopHomePath,
    () => ""
  )
  const panelWorkspace = React.useMemo(
    () =>
      currentWorkspace ??
      createStudioAgentWorkspace(sessionId, agentWorkspaceRoot) ??
      createStudioDefaultHomeWorkspace(desktopHomePath),
    [agentWorkspaceRoot, currentWorkspace, desktopHomePath, sessionId]
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
  const [currentSessionTitle, setCurrentSessionTitle] = React.useState("")
  const [selectedPermissionMode, setSelectedPermissionMode] =
    React.useState<StudioPermissionMode>("ask")
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
  const [startingSessionIds, setStartingSessionIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [chatErrors, setChatErrors] = React.useState<Record<string, string>>({})
  const [liveStreamConnected, setLiveStreamConnected] = React.useState(false)
  const [latestRunUsage, setLatestRunUsage] =
    React.useState<StudioTokenUsage | null>(null)
  const sessionIdRef = React.useRef(sessionId)
  const sessionProjectRequestIdRef = React.useRef(0)
  const preferenceSaveIdRef = React.useRef(0)
  const normalizedPreferenceSaveKeyRef = React.useRef("")
  const localProjectsRefreshPendingRef = React.useRef(false)

  const saveChatPreferences = React.useCallback(
    (
      activeSessionId: string,
      preferences: {
        chatModel?: SupportedChatModel | null
        chatRuntimeId?: string | null
        chatReasoningEffort?: ChatReasoningEffort | null
      }
    ) => {
      const requestId = preferenceSaveIdRef.current + 1
      preferenceSaveIdRef.current = requestId

      void updateSessionChatPreferences(activeSessionId, preferences).catch(
        () => {
          if (preferenceSaveIdRef.current === requestId) {
            preferenceSaveIdRef.current = 0
          }
        }
      )
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
          name: part.name,
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
  const autoOpenedPlanPartIdRef = React.useRef<string | null>(null)
  const autoOpenedSubagentTaskIdsRef = React.useRef<Set<string>>(new Set())
  const terminalPanelVerificationCancelRef = React.useRef<(() => void) | null>(
    null
  )
  const rightPanelVerificationCancelRef = React.useRef<(() => void) | null>(
    null
  )

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
    autoOpenedPlanPartIdRef.current = null
    autoOpenedSubagentTaskIdsRef.current.clear()
  }, [sessionId])

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
    if (!latestPlan) {
      return
    }

    if (autoOpenedPlanPartIdRef.current === latestPlan.partId) {
      return
    }

    autoOpenedPlanPartIdRef.current = latestPlan.partId
    setStatusPanelOpen(true)
  }, [latestPlan, setStatusPanelOpen])

  React.useEffect(() => {
    if (subagentSummaries.length === 0) {
      return
    }

    const openedTaskIds = autoOpenedSubagentTaskIdsRef.current
    const newSubagent = subagentSummaries.find(
      (subagent) => !openedTaskIds.has(subagent.taskId)
    )

    if (!newSubagent) {
      return
    }

    for (const subagent of subagentSummaries) {
      openedTaskIds.add(subagent.taskId)
    }
    setStatusPanelOpen(true)
  }, [setStatusPanelOpen, subagentSummaries])

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
      !chatDefaultsHydrated ||
      (sessionId && sessionChatPreferences === undefined)
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
        setSessionChatPreferences(nextSessionPreferences)
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

      setSessionChatPreferences(nextSessionPreferences)

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

      setSessionChatPreferences(nextSessionPreferences)
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

      setSessionChatPreferences(nextSessionPreferences)
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

    return Array.from(filesByEnvironment, ([environment, files]) =>
      aggregateTurnFileChanges(files, environment)
    ).flat()
  }, [legacyMessageEnvironment, visibleMessages])
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
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInfos([FALLBACK_CHAT_RUNTIME_INFO])
          setAgentModelSettings(null)
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
          ? nextWorkspace.localProjectId
          : nextWorkspace
            ? null
            : consumePendingProjectId()
      )
      setAgentWorkspaceRoot(null)
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
      return
    }

    const activeSessionId = sessionId

    try {
      const session = await getStudioSessionForComposer(activeSessionId)

      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
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
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setCurrentWorkspace(nextWorkspace)
      setSelectedProjectId(
        nextWorkspace?.type === "local"
          ? nextWorkspace.localProjectId
          : (session?.projectId ?? null)
      )
      setAgentWorkspaceRoot(session?.agentWorkspaceRoot ?? null)
      setCurrentSessionTitle(session?.title ?? "")
      setSelectedPermissionMode(session?.permissionMode ?? "ask")
      setLatestRunUsage(session?.latestRunUsage ?? null)
      setSessionChatPreferences({
        chatModel: session?.chatModel ?? null,
        chatRuntimeId: session?.chatRuntimeId ?? null,
        chatReasoningEffort:
          session?.chatReasoningEffort &&
          isChatReasoningEffort(session.chatReasoningEffort)
            ? session.chatReasoningEffort
            : null,
      })
    } catch {
      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setSelectedProjectId(null)
      setCurrentWorkspace(null)
      setAgentWorkspaceRoot(null)
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
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
      setSessionChatPreferences(undefined)
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
        await reloadSessionProject()
        onSessionsChange()
        dispatchStudioLocalProjectsChanged()
      })
      .catch(() => setLoadFailed(true))
  }, [onSessionsChange, reloadMessages, reloadSessionProject, sessionId])

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
        .then(async () => {
          await reloadMessages(activeSessionId)
          onSessionsChange()
          dispatchStudioLocalProjectsChanged()
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
        setSelectedPermissionMode("ask")
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
        nextWorkspace.type === "local" ? nextWorkspace.localProjectId : null
      const nextEnvironment =
        nextWorkspace.type === "sandbox" ? "remote" : "local"

      setCurrentWorkspace(nextWorkspace)
      setSelectedProjectId(nextProjectId)
      setPendingWorkspaceId(nextWorkspace.id)
      setPendingProjectId(nextProjectId)
      setSelectedEnvironment(nextEnvironment)

      router.push(`/studio?workspace=${encodeURIComponent(nextWorkspace.id)}`, {
        scroll: false,
      })
    },
    [
      currentWorkspace,
      isBusy,
      router,
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
    async (permissionMode: StudioPermissionMode) => {
      const previousPermissionMode = selectedPermissionMode

      setSelectedPermissionMode(permissionMode)

      if (!sessionId) {
        return
      }

      const activeSessionId = sessionId

      try {
        const session = await updateSessionPermissionMode(
          activeSessionId,
          permissionMode
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
      } catch {
        if (sessionIdRef.current === activeSessionId) {
          setSelectedPermissionMode(previousPermissionMode)
          toast.error(t.requestFailed)
        }
      }
    },
    [onSessionsChange, selectedPermissionMode, sessionId, t]
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

  async function ensureAcpStudioSession() {
    if (sessionId) {
      return sessionId
    }

    const workspaceIdForNewSession =
      currentWorkspace?.id || workspaceId?.trim() || null
    const activeSession = await createSession("New chat", {
      chatModel: selectedModel,
      chatRuntimeId: resolvedRuntimeId,
      chatReasoningEffort: selectedReasoningEffort,
      workspaceId: workspaceIdForNewSession,
      projectId: selectedProjectId,
      permissionMode: selectedPermissionMode,
    })

    setCurrentSessionTitle(activeSession.title)
    setCurrentWorkspace(activeSession.workspace ?? currentWorkspace)
    setSelectedProjectId(activeSession.projectId)
    setSelectedPermissionMode(activeSession.permissionMode)
    setPendingProjectId(null)
    setPendingWorkspaceId(null)
    onSessionChange(activeSession.id)
    onSessionsChange()

    return activeSession.id
  }

  async function handleSubmit(skillSlugs?: string[], promptOverride?: string) {
    const prompt = formatSlashSkillPrompt(
      skillSlugs ?? [],
      promptOverride ?? input
    )
    const attachments = pendingAttachments
    const mentions = serializeComposerMentions(
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

    setInput("")
    setPendingAttachments([])
    setPromptMentions([])

    let newSessionPersisted = false

    try {
      const activeSession =
        sessionId.length > 0
          ? { id: sessionId }
          : await createSession(
              getFallbackSessionTitle(
                prompt || attachments[0]?.name || "New chat"
              ),
              {
                chatModel: selectedModel,
                chatRuntimeId: resolvedRuntimeId,
                chatReasoningEffort: selectedReasoningEffort,
                workspaceId: workspaceIdForNewSession,
                projectId: projectIdForNewSession,
                permissionMode: selectedPermissionMode,
              }
            )
      const activeSessionId = activeSession.id
      let nextPermissionMode = selectedPermissionMode

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

      const userMessage = await createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: prompt,
        environment: effectiveEnvironment,
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
        void generateSessionTitle(activeSessionId, prompt)
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

  function openMessageFeedback(message: StudioMessage) {
    setFeedbackTarget({
      entryPoint: "message_action",
      messageId: message.id,
    })
    setFeedbackOpen(true)
  }

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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-testid="studio-feedback-titlebar"
                    aria-label={t.studioFeedback}
                    className="no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground"
                    onClick={openTitlebarFeedback}
                  >
                    <RiFeedbackLine aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" side="bottom">
                  {t.studioFeedback}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={panelLabels.files}
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
                    <Folder aria-hidden className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" side="bottom">
                  <span>{panelLabels.files}</span>
                  <span
                    data-slot="kbd"
                    className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
                  >
                    ⌘P
                  </span>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={panelLabels.envChanges}
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
                      <Diff aria-hidden className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" side="bottom">
                  <span>{panelLabels.envChanges}</span>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-testid="studio-terminal-panel-toggle"
                    aria-label={t.studioTerminalPanelToggle}
                    aria-pressed={terminalPanelOpen}
                    className={cn(
                      "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                      terminalPanelOpen && "bg-muted text-foreground"
                    )}
                    onClick={toggleTerminalPanel}
                  >
                    <PanelBottom aria-hidden className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" side="bottom">
                  <span>{t.studioTerminalPanelToggle}</span>
                  <span
                    data-slot="kbd"
                    className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
                  >
                    Cmd+J
                  </span>
                </TooltipContent>
              </Tooltip>

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

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-testid="studio-right-panel-toggle"
                    aria-label={panelLabels.toggleRightPanel}
                    aria-pressed={rightPanelOpen}
                    className={cn(
                      "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                      rightPanelOpen && "bg-muted text-foreground"
                    )}
                    onClick={toggleRightPanel}
                  >
                    <PanelRight aria-hidden className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" side="bottom">
                  <span>{panelLabels.toggleRightPanel}</span>
                </TooltipContent>
              </Tooltip>
            </div>
          </TitlebarSurface>

          <div className={statusPanelContentClassName}>
            <div ref={chatViewportRef} className="relative min-h-0 flex-1">
              {hasMessages ? (
                <div className="h-full min-h-0">
                  <ChatContainerRoot className="h-full min-h-0">
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
                              currentWorkspace?.type === "local"
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
                      onEnsureAcpSession={ensureAcpStudioSession}
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
                  </div>
                </div>
              )}

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
                        onEnsureAcpSession={ensureAcpStudioSession}
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
  )
}

export { StudioChatWorkbench }
