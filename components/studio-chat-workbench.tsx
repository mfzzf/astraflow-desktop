"use client"

import * as React from "react"
import { RiArrowDownSLine, RiCheckLine, RiLoader4Line } from "@remixicon/react"
import { Diff, Folder, GitBranch, PanelBottom, PanelRight } from "lucide-react"
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
import { Button } from "@/components/ui/button"
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
import type {
  StudioChatRunLiveSnapshot,
  StudioLocalProjectWithGitInfo,
  StudioMessage,
  StudioMessagePart,
  StudioPermissionMode,
  StudioPermissionOption,
  StudioTokenUsage,
  StudioUserInputAnswer,
} from "@/lib/studio-types"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioSessionsChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import { getStudioExpertDraftPromptStorageKey } from "@/lib/studio-expert-draft"
import { openStudioReviewPanel } from "@/lib/studio-review-panel"
import {
  createStudioProjectReviewDetail,
  loadStudioProjectReviewData,
} from "@/lib/studio-review-data"
import { aggregateTurnFileChanges } from "@/components/studio-message-parts/file-change"
import type { StudioFilePart } from "@/components/studio-message-parts/types"
import { cn, createClientId } from "@/lib/utils"
import { useStudioChatRunLiveStream } from "@/hooks/use-studio-chat-run"

import {
  compactCodexDirectSessionRequest,
  createLocalProjectForComposer,
  createMessage,
  createSession,
  generateSessionTitle,
  getAgentModelSettingsForComposer,
  getFallbackSessionTitle,
  listAgentRuntimes,
  listLocalProjectsForComposer,
  listMessages,
  listStudioSessionsForComposer,
  sendPermissionDecision,
  sendUserInputDecision,
  startAssistantRunRequest,
  stopAssistantRunRequest,
  updateSessionChatPreferences,
  updateSessionPermissionMode,
  updateSessionProject,
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
  useChatEnvironment,
  useChatModel,
  useChatReasoningEffort,
  useChatRuntime,
  writeStoredChatDefaults,
} from "./studio-chat/chat-preferences"
import {
  DEFAULT_CHAT_RUNTIME_ID,
  FALLBACK_CHAT_RUNTIME_INFO,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from "./studio-chat/constants"
import { ChatComposer } from "./studio-chat/composer"
import {
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
import {
  getStoredStatusPanelOpen,
  getStoredTerminalPanelOpen,
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
  StudioFileChangeCard,
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
  StudioSubagentPanelRequest,
} from "./studio-chat/types"

type SummaryPanelDisplayMode = "overlay" | "shift" | "gutter"

const SUMMARY_PANEL_MIN_CONTENT_WIDTH = 736
const SUMMARY_PANEL_MAX_CONTENT_WIDTH = 1024
const SUMMARY_PANEL_WIDTH = 264
const SUMMARY_PANEL_GAP = 16

function getSummaryPanelDisplayMode(width: number): SummaryPanelDisplayMode {
  const reservedWidth = SUMMARY_PANEL_WIDTH + SUMMARY_PANEL_GAP
  const remainingWidth = width - reservedWidth

  if (remainingWidth < SUMMARY_PANEL_MIN_CONTENT_WIDTH) {
    return "overlay"
  }

  const maxContentSideSpace = (width - SUMMARY_PANEL_MAX_CONTENT_WIDTH) / 2

  if (maxContentSideSpace < reservedWidth) {
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
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { locale, t } = useI18n()
  const greetingPeriod = useStudioGreetingPeriod()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedRuntimeId, setSelectedRuntimeId] = useChatRuntime()
  const [selectedReasoningEffort] = useChatReasoningEffort(selectedModel)
  const [selectedEnvironment, setSelectedEnvironment] = useChatEnvironment()
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
  const [isAddingLocalProject, setIsAddingLocalProject] = React.useState(false)
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    string | null
  >(null)
  const [currentSessionTitle, setCurrentSessionTitle] = React.useState("")
  const [selectedPermissionMode, setSelectedPermissionMode] =
    React.useState<StudioPermissionMode>("ask")
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
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

  const visibleMessages = React.useMemo(
    () => (sessionId ? messages : []),
    [messages, sessionId]
  )
  const outputFiles = React.useMemo(
    () => getSessionOutputFiles(visibleMessages),
    [visibleMessages]
  )
  const fileChanges = React.useMemo(
    () => getSessionFileChanges(visibleMessages),
    [visibleMessages]
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
          part,
        })
      }
    }

    return Array.from(summaries.values())
  }, [visibleMessages])
  const resolvedRuntimeId = resolveChatRuntimeId(
    selectedRuntimeId,
    runtimeInfos
  )
  const modelOptions = React.useMemo(() => {
    return getChatModelOptionsForRuntime(resolvedRuntimeId, agentModelSettings)
  }, [agentModelSettings, resolvedRuntimeId])
  const commitChatDefaults = React.useCallback(
    (preferences: ResolvedChatPreferences) => {
      writeStoredChatDefaults(preferences)
      setChatDefaults({
        runtimeId: preferences.runtimeId,
        model: preferences.model,
        reasoningEffort: preferences.reasoningEffort,
      })
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
  const resolvedEnvironment =
    resolvedRuntimeId === DEFAULT_CHAT_RUNTIME_ID
      ? selectedEnvironment
      : undefined
  const isStarting = sessionId ? startingSessionIds.has(sessionId) : false
  const hasStreamingMessage = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
  const isBusy = isStarting || hasStreamingMessage
  const hasMessages = visibleMessages.length > 0 || isStarting
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
  const selectedProjectGit = selectedProject?.git ?? null
  const hasProjectGitChanges = Boolean(
    selectedProjectGit &&
    (selectedProjectGit.isDirty ||
      (selectedProjectGit.changedFiles ?? 0) > 0 ||
      (selectedProjectGit.additions ?? 0) > 0 ||
      (selectedProjectGit.deletions ?? 0) > 0)
  )
  const hasProjectEnvironment = Boolean(selectedProject)
  const statusPanelAvailable =
    hasProjectEnvironment ||
    hasProjectGitChanges ||
    fileChanges.length > 0 ||
    outputFiles.length > 0 ||
    latestPlan !== null ||
    subagentSummaries.length > 0
  const statusPanelDisplayMode = React.useMemo(
    () => getSummaryPanelDisplayMode(chatViewportWidth),
    [chatViewportWidth]
  )
  // Auto-collapse the floating summary when the chat viewport is too narrow
  // for it to coexist with the content (Codex overlay threshold).
  const statusPanelVisible =
    statusPanelOpen &&
    statusPanelAvailable &&
    statusPanelDisplayMode !== "overlay"
  const statusPanelToggleAvailable =
    statusPanelAvailable && statusPanelDisplayMode !== "overlay"
  const statusPanelContentInset =
    statusPanelVisible &&
    !rightPanelOpen &&
    !effectiveRightPanelFocused &&
    statusPanelDisplayMode === "shift"
      ? SUMMARY_PANEL_WIDTH + SUMMARY_PANEL_GAP
      : 0
  const statusPanelContentInsetStyle = React.useMemo(
    () => ({ paddingRight: statusPanelContentInset }),
    [statusPanelContentInset]
  )
  const statusPanelContentInsetClassName =
    "transition-[padding-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
  const autoOpenedPlanPartIdRef = React.useRef<string | null>(null)
  const autoOpenedSubagentTaskIdsRef = React.useRef<Set<string>>(new Set())

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
    window.addEventListener("storage", syncChatDefaults)

    return () => {
      window.removeEventListener("storage", syncChatDefaults)
    }
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

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
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

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
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

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
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
    setTerminalPanelOpen(!getStoredTerminalPanelOpen())
  }, [setTerminalPanelOpen])
  const toggleRightPanel = React.useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelFocused(false)
    }

    setRightPanelOpen(!rightPanelOpen)
  }, [rightPanelOpen, setRightPanelOpen])
  const toggleStatusPanel = React.useCallback(() => {
    setStatusPanelOpen(!getStoredStatusPanelOpen())
  }, [setStatusPanelOpen])
  const toggleTopRightPanel = React.useCallback(() => {
    if (statusPanelToggleAvailable) {
      toggleStatusPanel()
      return
    }

    toggleRightPanel()
  }, [statusPanelToggleAvailable, toggleRightPanel, toggleStatusPanel])
  const openRightPanelMode = React.useCallback(
    (mode: StudioRightPanelMode) => {
      setRightPanelMode(mode)
      setRightPanelOpen(true)
    },
    [setRightPanelMode, setRightPanelOpen]
  )
  const getSessionReviewFileChanges = React.useCallback(() => {
    const fileParts = visibleMessages.flatMap((message) =>
      message.role === "assistant"
        ? message.parts.filter(
            (part): part is StudioFilePart => part.type === "file"
          )
        : []
    )

    return aggregateTurnFileChanges(fileParts)
  }, [visibleMessages])
  const handleOpenWorkspaceChanges = React.useCallback(async () => {
    if (!selectedProject || loadingWorkspaceChanges) {
      return
    }

    setLoadingWorkspaceChanges(true)

    try {
      const data = await loadStudioProjectReviewData(
        selectedProject.id,
        panelLabels.envLoadChangesFailed
      )

      // Outside a git repository there is no baseline to diff against; fall
      // back to the file changes recorded in this session's messages.
      openStudioReviewPanel(
        data.gitAvailable
          ? createStudioProjectReviewDetail({
              ...data,
              scopeLabel: panelLabels.envUncommittedChanges,
            })
          : {
              scopeLabel: panelLabels.envSessionChanges,
              files: getSessionReviewFileChanges(),
              truncated: false,
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
    getSessionReviewFileChanges,
    loadingWorkspaceChanges,
    panelLabels.envLoadChangesFailed,
    panelLabels.envSessionChanges,
    panelLabels.envUncommittedChanges,
    selectedProject,
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
    try {
      setLocalProjects(await listLocalProjectsForComposer())
    } catch {
      setLocalProjects([])
    }
  }, [])

  const handleAddLocalProject = React.useCallback(async () => {
    if (!window.astraflowDesktop?.pickFolder || isAddingLocalProject) {
      return
    }

    try {
      setIsAddingLocalProject(true)
      const path = await window.astraflowDesktop.pickFolder()

      if (!path) {
        return
      }

      const project = await createLocalProjectForComposer(path)
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
      setSelectedProjectId(project.id)
      setPendingProjectId(project.id)
      toast.success(t.studioLocalProjectCreated)
    } catch {
      toast.error(t.studioLocalProjectCreateFailed)
    } finally {
      setIsAddingLocalProject(false)
    }
  }, [
    isAddingLocalProject,
    reloadLocalProjects,
    t.studioLocalProjectCreateFailed,
    t.studioLocalProjectCreated,
  ])

  const reloadSessionProject = React.useCallback(async () => {
    const requestId = sessionProjectRequestIdRef.current + 1
    sessionProjectRequestIdRef.current = requestId
    normalizedPreferenceSaveKeyRef.current = ""
    setSessionChatPreferences(undefined)

    if (!sessionId) {
      setSelectedProjectId(consumePendingProjectId())
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
      return
    }

    const activeSessionId = sessionId

    try {
      const sessions = await listStudioSessionsForComposer()
      const session = sessions.find(
        (candidate) => candidate.id === activeSessionId
      )

      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setSelectedProjectId(session?.projectId ?? null)
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
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
    }
  }, [sessionId])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadLocalProjects()
    })
  }, [reloadLocalProjects])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessionProject()
    })
  }, [reloadSessionProject])

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
    []
  )
  const handleLiveDone = React.useCallback(() => {
    if (!sessionId) {
      return
    }

    void reloadMessages(sessionId)
      .then(() => onSessionsChange())
      .catch(() => setLoadFailed(true))
  }, [onSessionsChange, reloadMessages, sessionId])

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
        })
        .catch((runError) => {
          const message =
            runError instanceof Error ? runError.message : t.studioChatFailed

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
    [onSessionsChange, reloadMessages, t.studioChatFailed]
  )

  const stopAssistantRun = React.useCallback(
    (activeSessionId: string) => {
      void stopAssistantRunRequest(activeSessionId)
        .then(async () => {
          await reloadMessages(activeSessionId)
          onSessionsChange()
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

  const executeBuiltinSlashCommand = React.useCallback(
    (name: string) => {
      const commandName = name.toLowerCase()

      if (!isBuiltinSlashCommandName(commandName)) {
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
        setReasoningSelectOpen(false)
        setModelSelectOpen(true)
        return true
      }

      if (commandName === "reasoning") {
        setModelSelectOpen(false)
        setReasoningSelectOpen(true)
        return true
      }

      if (commandName !== "compact") {
        return false
      }

      if (resolvedRuntimeId !== "codex-direct") {
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
      void compactCodexDirectSessionRequest(sessionId)
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
      reloadSessionProject,
      resolvedRuntimeId,
      sessionId,
      setSelectedEnvironment,
      t.studioCompactFailed,
      t.studioCompactRequiresSession,
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

  const handleProjectChange = React.useCallback(
    async (projectId: string | null) => {
      const previousProjectId = selectedProjectId

      setSelectedProjectId(projectId)

      if (!sessionId) {
        setPendingProjectId(projectId)
        return
      }

      const activeSessionId = sessionId

      try {
        const session = await updateSessionProject(activeSessionId, projectId)

        onSessionsChange()
        dispatchStudioSessionsChanged()

        if (
          session.id !== activeSessionId ||
          sessionIdRef.current !== activeSessionId
        ) {
          return
        }

        setSelectedProjectId(session.projectId)
        setSelectedPermissionMode(session.permissionMode)
      } catch {
        if (sessionIdRef.current === activeSessionId) {
          setSelectedProjectId(previousProjectId)
          toast.error(t.studioLocalProjectBindFailed)
        }
      }
    },
    [onSessionsChange, selectedProjectId, sessionId, t]
  )

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

  async function handleSubmit() {
    const prompt = input.trim()
    const attachments = pendingAttachments
    const mentions = serializeComposerMentions(
      promptMentions.filter((mention) =>
        textHasComposerMentionToken(input, mention)
      )
    )

    if ((!prompt && attachments.length === 0) || isBusy) {
      return
    }

    const slashCommand = parseSlashCommandText(prompt)

    if (
      slashCommand &&
      isBuiltinSlashCommandName(slashCommand.name) &&
      executeBuiltinSlashCommand(slashCommand.name)
    ) {
      return
    }

    setInput("")
    setPendingAttachments([])
    setPromptMentions([])

    const isNewSession = !sessionId

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
              }
            )
      const activeSessionId = activeSession.id
      const projectIdForNewSession =
        !sessionId &&
        selectedProjectId &&
        localProjects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : null
      let nextPermissionMode = selectedPermissionMode

      if (projectIdForNewSession) {
        try {
          const updatedSession = await updateSessionProject(
            activeSessionId,
            projectIdForNewSession
          )

          setSelectedProjectId(updatedSession.projectId)
          nextPermissionMode = updatedSession.permissionMode
          setPendingProjectId(null)
        } catch {
          toast.error(t.studioLocalProjectBindFailed)
        }
      } else if (!sessionId) {
        setSelectedProjectId(null)
        setPendingProjectId(null)
      }

      if (
        !sessionId &&
        selectedPermissionMode !== "ask" &&
        selectedPermissionMode !== nextPermissionMode
      ) {
        try {
          const updatedSession = await updateSessionPermissionMode(
            activeSessionId,
            selectedPermissionMode
          )

          nextPermissionMode = updatedSession.permissionMode
        } catch {
          toast.error(t.requestFailed)
        }
      }

      setSelectedPermissionMode(nextPermissionMode)

      const userMessage = await createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: prompt,
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

  const chatTitle = currentSessionTitle.trim() || t.studioUntitledSession

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background">
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col bg-background",
          effectiveRightPanelFocused && "hidden"
        )}
      >
        <div
          data-electron-drag-header
          data-studio-chat-titlebar
          className="flex h-(--titlebar-height) shrink-0 items-center gap-3 px-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="min-w-0 -translate-y-px truncate text-sm font-medium text-foreground"
              title={chatTitle}
            >
              {chatTitle}
            </div>
            {selectedProject ? (
              <span
                className="flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs text-muted-foreground"
                title={selectedProject.path}
              >
                <Folder aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{selectedProject.name}</span>
              </span>
            ) : null}
            {selectedProject?.git.branch ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 max-w-48 shrink-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <GitBranch aria-hidden className="size-3 shrink-0" />
                    <span className="min-w-0 truncate font-mono">
                      {selectedProject.git.branch}
                    </span>
                    <RiArrowDownSLine aria-hidden className="size-3 shrink-0" />
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
                        <RiCheckLine aria-hidden className="ml-auto size-3.5" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div
            className="no-drag flex shrink-0 items-center gap-1"
            style={{
              transform: "translateY(var(--titlebar-buttons-offset))",
            }}
          >
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
                  disabled={!selectedProject || loadingWorkspaceChanges}
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    statusPanelToggleAvailable
                      ? panelLabels.envEnvironmentInfo
                      : panelLabels.toggleRightPanel
                  }
                  className={cn(
                    "no-drag size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                    (statusPanelVisible ||
                      (!statusPanelToggleAvailable && rightPanelOpen)) &&
                      "bg-muted text-foreground"
                  )}
                  onClick={toggleTopRightPanel}
                >
                  <PanelRight aria-hidden className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end" side="bottom">
                <span>
                  {statusPanelToggleAvailable
                    ? panelLabels.envEnvironmentInfo
                    : panelLabels.toggleRightPanel}
                </span>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div ref={chatViewportRef} className="relative min-h-0 flex-1">
          {hasMessages ? (
            <div
              className={cn(
                "h-full min-h-0",
                statusPanelContentInsetClassName
              )}
              style={statusPanelContentInsetStyle}
            >
              <ChatContainerRoot className="h-full min-h-0">
                <ChatContainerContent className="mx-auto flex min-h-full w-full max-w-5xl gap-6 px-8 py-10">
                  {visibleMessages.map((message) => (
                    <ChatMessageBubble
                      key={message.id}
                      message={message}
                      onRetry={handleRetryMessage}
                    />
                  ))}

                  {fileChanges.length > 0 ? (
                    <StudioFileChangeCard
                      changes={fileChanges}
                      labels={panelLabels}
                      onOpenChanges={handleOpenWorkspaceChanges}
                    />
                  ) : null}

                  {isStarting && !hasStreamingMessage ? (
                    <div className="flex w-full justify-start">
                      <Shimmer className="text-sm">{t.studioThinking}</Shimmer>
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
            <div className="flex h-full items-center justify-center px-8 pb-24">
              <div className="flex w-full max-w-3xl flex-col items-center gap-6">
                <h1 className="font-heading text-2xl font-semibold">
                  {t.studioChatGreeting(greetingPeriod)}
                </h1>
                <ChatComposer
                  key={`composer:${sessionId || "new"}`}
                  sessionId={sessionId}
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
                  environment={selectedEnvironment}
                  contextUsage={latestRunUsage}
                  isAddingProject={isAddingLocalProject}
                  attachments={pendingAttachments}
                  mentions={promptMentions}
                  onModelChange={handleModelChange}
                  onRuntimeChange={handleRuntimeChange}
                  onEnvironmentChange={setSelectedEnvironment}
                  onReasoningEffortChange={handleReasoningEffortChange}
                  onPermissionModeChange={handlePermissionModeChange}
                  onAddProject={handleAddLocalProject}
                  onProjectChange={handleProjectChange}
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
        </div>

        {hasMessages ? (
          <div className="shrink-0 px-8 pb-5">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
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
                    environment={selectedEnvironment}
                    contextUsage={latestRunUsage}
                    isAddingProject={isAddingLocalProject}
                    attachments={pendingAttachments}
                    mentions={promptMentions}
                    onModelChange={handleModelChange}
                    onRuntimeChange={handleRuntimeChange}
                    onEnvironmentChange={setSelectedEnvironment}
                    onReasoningEffortChange={handleReasoningEffortChange}
                    onPermissionModeChange={handlePermissionModeChange}
                    onAddProject={handleAddLocalProject}
                    onProjectChange={handleProjectChange}
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

        <StudioTerminalPanel
          open={terminalPanelOpen}
          project={selectedProject}
          onOpenChange={setTerminalPanelOpen}
        />

        <StudioStatusPanel
          open={statusPanelVisible}
          project={selectedProject}
          files={outputFiles}
          changes={fileChanges}
          labels={panelLabels}
          plan={hasMessages ? latestPlan : null}
          subagents={subagentSummaries}
          usage={latestRunUsage}
          running={isBusy}
          loadingChanges={loadingWorkspaceChanges}
          onOpenChanges={handleOpenWorkspaceChanges}
          onOpenPlan={handleOpenPlanSummary}
          onOpenSubagent={handleOpenSubagentSummary}
          onOpenSources={() => openRightPanelMode("files")}
          onRefresh={reloadLocalProjects}
        />
      </div>

      <StudioRightPanel
        open={rightPanelOpen}
        focused={effectiveRightPanelFocused}
        sessionId={sessionId}
        mode={rightPanelMode}
        project={selectedProject}
        getSessionFileChanges={getSessionReviewFileChanges}
        subagentPanelRequest={subagentPanelRequest}
        onOpenChange={handleRightPanelOpenChange}
        onFocusedChange={handleRightPanelFocusedChange}
        onModeChange={setRightPanelMode}
      />
    </section>
  )
}

export { StudioChatWorkbench }
