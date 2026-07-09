"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Eye, Hand, ShieldCheck, UnlockKeyhole, Zap } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import {
  getChatModelConfig,
  getChatReasoningEfforts,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"
import { getStudioExpertDraftPromptStorageKey } from "@/lib/studio-expert-draft"
import type { StudioPermissionMode, StudioSession } from "@/lib/studio-types"

import {
  clearSessionExpertForComposer,
  getSessionExpertForComposer,
  listInstalledMcpForComposer,
  listInstalledSkillsForComposer,
  listLocalExpertsForComposer,
  listSessionSlashCommands,
  listStudioSessionsForComposer,
  listWorkspaceFilesForComposer,
  summonLocalExpertForComposer,
} from "./api"
import {
  COMPOSER_ICON_ONLY_WIDTH,
  DEFAULT_CHAT_RUNTIME_ID,
  FALLBACK_CHAT_RUNTIME_INFO,
  PROJECT_NONE_VALUE,
} from "./constants"
import { supportsPermissionMode } from "./chat-preferences"
import { ChatComposerView } from "./composer-view"
import {
  commandMatchesFilter,
  fileCandidateMatchesFilter,
  formatFileMentionReference,
  formatSessionMentionReference,
  getBuiltinSlashCommands,
  getMentionTokenAtCursor,
  normalizeMentionQuery,
  getReasoningEffortDescription,
  getRuntimeGuideDescription,
  getSlashCommandTokenAtCursor,
  mcpMatchesSlashFilter,
  mergeComposerMention,
  mergeComposerSessionMention,
  mergeSlashCommands,
  removeComposerMentionTokenFromText,
  sessionCandidateMatchesFilter,
  skillMatchesSlashFilter,
  slashMenuEntryMatchesExactToken,
  textHasComposerMentionToken,
} from "./composer-utils"
import { useComposerPopupPlacement, useElementWidth } from "./layout-hooks"
import type {
  ChatComposerProps,
  ComposerMention,
  ComposerSelectedExpert,
  MentionToken,
  SlashComposerMenuEntry,
  SlashCommandToken,
  WorkspaceFileCandidate,
} from "./types"

export function ChatComposer({
  sessionId,
  value,
  userMessageHistory,
  model,
  modelOptions,
  runtimeId,
  runtimeInfos,
  reasoningEffort,
  permissionMode,
  localProjects,
  selectedProjectId,
  environment,
  contextUsage,
  isAddingProject,
  attachments,
  mentions,
  onModelChange,
  onRuntimeChange,
  onEnvironmentChange,
  onReasoningEffortChange,
  onPermissionModeChange,
  onAddProject,
  onProjectChange,
  onValueChange,
  onMentionsChange,
  onAddFiles,
  onRemoveAttachment,
  modelSelectOpen,
  onModelSelectOpenChange,
  reasoningSelectOpen,
  onReasoningSelectOpenChange,
  onSubmit,
  onStop,
  canSubmit,
  isBusy,
}: ChatComposerProps) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const [isTextareaFocused, setIsTextareaFocused] = React.useState(false)
  const [composerRef, composerWidth] = useElementWidth<HTMLDivElement>()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const menuAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const slashMenuScrollRef = React.useRef<HTMLDivElement | null>(null)
  const mentionMenuScrollRef = React.useRef<HTMLDivElement | null>(null)
  const runtimeCommandRequestIdRef = React.useRef(0)
  const mentionFileRequestIdRef = React.useRef(0)
  const mentionSessionRequestIdRef = React.useRef(0)
  const wasBusyRef = React.useRef(isBusy)
  const historyDraftRef = React.useRef("")
  const isApplyingHistoryValueRef = React.useRef(false)
  const [runtimeCommands, setRuntimeCommands] = React.useState<
    SlashCommandDescriptor[]
  >([])
  const [installedSkillsForSlash, setInstalledSkillsForSlash] = React.useState<
    InstalledSkill[] | null
  >(null)
  const [installedMcpForSlash, setInstalledMcpForSlash] = React.useState<
    InstalledMcpServer[] | null
  >(null)
  const [availableExperts, setAvailableExperts] = React.useState<
    ComposerSelectedExpert[]
  >([])
  const [expertsLoading, setExpertsLoading] = React.useState(false)
  const [summoningExpertId, setSummoningExpertId] = React.useState("")
  const [selectedExpert, setSelectedExpert] =
    React.useState<ComposerSelectedExpert | null>(null)
  const [workspaceFiles, setWorkspaceFiles] = React.useState<
    WorkspaceFileCandidate[]
  >([])
  const [mentionSessions, setMentionSessions] = React.useState<StudioSession[]>(
    []
  )
  const [workspaceFilesLoading, setWorkspaceFilesLoading] =
    React.useState(false)
  const [mentionSessionsLoading, setMentionSessionsLoading] =
    React.useState(false)
  const [cursorPosition, setCursorPosition] = React.useState<number | null>(
    null
  )
  const [selectedCommandIndex, setSelectedCommandIndex] = React.useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0)
  const [projectSearch, setProjectSearch] = React.useState("")
  const [dismissedSlashTokenKey, setDismissedSlashTokenKey] = React.useState<
    string | null
  >(null)
  const [dismissedMentionTokenKey, setDismissedMentionTokenKey] =
    React.useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null)
  const activeHistoryIndex = value.length === 0 ? null : historyIndex
  const showCustomCaret = isTextareaFocused && value.length === 0
  const iconOnlyControls =
    composerWidth > 0 && composerWidth < COMPOSER_ICON_ONLY_WIDTH
  const denseControls = composerWidth > 0 && composerWidth < 360
  const supportsCompact =
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.capabilities
      .compact ?? false
  const builtinCommands = React.useMemo(
    () => getBuiltinSlashCommands(t, supportsCompact),
    [supportsCompact, t]
  )
  const slashCommandToken = React.useMemo(
    () => getSlashCommandTokenAtCursor(value, cursorPosition),
    [cursorPosition, value]
  )
  const mentionToken = React.useMemo(
    () => getMentionTokenAtCursor(value, cursorPosition),
    [cursorPosition, value]
  )
  const slashCommandTokenKey = slashCommandToken
    ? `${slashCommandToken.start}:${slashCommandToken.end}:${value.slice(
        slashCommandToken.start,
        slashCommandToken.end
      )}:${cursorPosition ?? ""}`
    : null
  const mentionTokenKey = mentionToken
    ? `${mentionToken.start}:${mentionToken.end}:${value.slice(
        mentionToken.start,
        mentionToken.end
      )}:${cursorPosition ?? ""}`
    : null
  const mentionQuery = mentionToken
    ? normalizeMentionQuery(mentionToken.prefix)
    : ""
  const allSlashCommands = React.useMemo(
    () => mergeSlashCommands(builtinCommands, sessionId ? runtimeCommands : []),
    [builtinCommands, runtimeCommands, sessionId]
  )
  const filteredSlashCommands = React.useMemo(
    () =>
      slashCommandToken
        ? allSlashCommands.filter((command) =>
            commandMatchesFilter(command, slashCommandToken.prefix)
          )
        : [],
    [allSlashCommands, slashCommandToken]
  )
  const filteredSlashSkills = React.useMemo(
    () =>
      slashCommandToken
        ? (installedSkillsForSlash ?? [])
            .filter((skill) => skill.enabled)
            .filter((skill) =>
              skillMatchesSlashFilter(skill, slashCommandToken.prefix)
            )
        : [],
    [installedSkillsForSlash, slashCommandToken]
  )
  const filteredSlashMcpServers = React.useMemo(
    () =>
      slashCommandToken
        ? (installedMcpForSlash ?? [])
            .filter((server) => server.enabled)
            .filter((server) =>
              mcpMatchesSlashFilter(server, slashCommandToken.prefix)
            )
        : [],
    [installedMcpForSlash, slashCommandToken]
  )
  const slashMenuEntries = React.useMemo<SlashComposerMenuEntry[]>(
    () => [
      ...filteredSlashCommands.map((command) => ({
        kind: "command" as const,
        command,
      })),
      ...filteredSlashSkills.map((skill) => ({
        kind: "skill" as const,
        skill,
      })),
      ...filteredSlashMcpServers.map((server) => ({
        kind: "mcp" as const,
        server,
      })),
    ],
    [filteredSlashCommands, filteredSlashMcpServers, filteredSlashSkills]
  )
  const activeCommandIndex =
    slashMenuEntries.length > 0
      ? Math.min(selectedCommandIndex, slashMenuEntries.length - 1)
      : 0
  const filteredWorkspaceFiles = React.useMemo(
    () =>
      mentionToken && selectedProjectId
        ? workspaceFiles.filter((file) =>
            fileCandidateMatchesFilter(file, mentionToken.prefix)
          )
        : [],
    [mentionToken, selectedProjectId, workspaceFiles]
  )
  const filteredMentionSessions = React.useMemo(
    () =>
      mentionToken
        ? mentionSessions
            .filter(
              (session) =>
                session.mode === "chat" &&
                session.id !== sessionId &&
                sessionCandidateMatchesFilter(session, mentionToken.prefix)
            )
            .slice(0, 8)
        : [],
    [mentionSessions, mentionToken, sessionId]
  )
  const addLocalMentionIndex =
    filteredWorkspaceFiles.length + filteredMentionSessions.length
  const mentionMenuItemCount = addLocalMentionIndex + 1
  const activeMentionIndex =
    mentionMenuItemCount > 0
      ? Math.min(selectedMentionIndex, mentionMenuItemCount - 1)
      : 0
  const showSlashCommandMenu = Boolean(
    slashCommandToken && slashCommandTokenKey !== dismissedSlashTokenKey
  )
  const showMentionMenu = Boolean(
    mentionToken && mentionTokenKey !== dismissedMentionTokenKey
  )
  const composerMenuPlacement = useComposerPopupPlacement(
    menuAnchorRef,
    showSlashCommandMenu || showMentionMenu
  )
  const reasoningLabelByValue: Record<ChatReasoningEffort, string> = {
    none: t.studioReasoningNone,
    minimal: t.studioReasoningMinimal,
    low: t.studioReasoningLow,
    medium: t.studioReasoningMedium,
    high: t.studioReasoningHigh,
    xhigh: t.studioReasoningXHigh,
    max: t.studioReasoningMax,
    enabled: t.studioReasoningEnabled,
  }

  const refreshRuntimeCommands = React.useCallback(() => {
    const requestId = runtimeCommandRequestIdRef.current + 1
    runtimeCommandRequestIdRef.current = requestId

    if (!sessionId) {
      return
    }

    void listSessionSlashCommands(sessionId).then((commands) => {
      if (runtimeCommandRequestIdRef.current === requestId) {
        setRuntimeCommands(commands)
      }
    })
  }, [sessionId])

  const syncCursorPosition = React.useCallback(
    (textarea: HTMLTextAreaElement | null = textareaRef.current) => {
      setCursorPosition(textarea ? textarea.selectionStart : null)
    },
    []
  )

  const handleComposerValueChange = React.useCallback(
    (nextValue: string) => {
      if (isApplyingHistoryValueRef.current) {
        isApplyingHistoryValueRef.current = false
      } else if (activeHistoryIndex !== null) {
        setHistoryIndex(null)
        historyDraftRef.current = nextValue
      } else if (nextValue.length === 0) {
        setHistoryIndex(null)
        historyDraftRef.current = ""
      }

      onValueChange(nextValue)
    },
    [activeHistoryIndex, onValueChange]
  )

  const focusTextareaAt = React.useCallback((cursor: number) => {
    window.setTimeout(() => {
      const textarea = textareaRef.current

      if (!textarea) {
        return
      }

      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
      setCursorPosition(cursor)
    }, 0)
  }, [])

  const applyHistoryValue = React.useCallback(
    (nextValue: string) => {
      isApplyingHistoryValueRef.current = true
      handleComposerValueChange(nextValue)
      focusTextareaAt(nextValue.length)
    },
    [focusTextareaAt, handleComposerValueChange]
  )

  const acceptMentionFile = React.useCallback(
    (
      file: WorkspaceFileCandidate,
      token: MentionToken | null = mentionToken
    ) => {
      if (!token) {
        return
      }

      const insertion = `@${formatFileMentionReference(file.relativePath)} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      onMentionsChange(mergeComposerMention(mentions, file))
      setDismissedMentionTokenKey(null)
      setSelectedMentionIndex(0)
      focusTextareaAt(nextCursor)
    },
    [
      focusTextareaAt,
      mentionToken,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptMentionSession = React.useCallback(
    (session: StudioSession, token: MentionToken | null = mentionToken) => {
      if (!token) {
        return
      }

      const insertion = `@${formatSessionMentionReference(session.title)} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      onMentionsChange(mergeComposerSessionMention(mentions, session))
      setDismissedMentionTokenKey(null)
      setSelectedMentionIndex(0)
      focusTextareaAt(nextCursor)
    },
    [
      focusTextareaAt,
      mentionToken,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptAddLocalFile = React.useCallback(
    (token: MentionToken | null = mentionToken) => {
      if (token) {
        const nextValue = value.slice(0, token.start) + value.slice(token.end)

        onValueChange(nextValue)
        focusTextareaAt(token.start)
      }

      setDismissedMentionTokenKey(mentionTokenKey)
      setSelectedMentionIndex(0)

      window.setTimeout(() => {
        fileInputRef.current?.click()
      }, 0)
    },
    [focusTextareaAt, mentionToken, mentionTokenKey, onValueChange, value]
  )

  const removeMention = React.useCallback(
    (mention: ComposerMention) => {
      onMentionsChange(mentions.filter((current) => current !== mention))

      const nextValue = removeComposerMentionTokenFromText(value, mention)

      if (nextValue !== value) {
        onValueChange(nextValue)
      }

      focusTextareaAt(
        Math.min(nextValue.length, cursorPosition ?? nextValue.length)
      )
    },
    [
      cursorPosition,
      focusTextareaAt,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptSlashCommand = React.useCallback(
    (
      command: SlashCommandDescriptor,
      token: SlashCommandToken | null = slashCommandToken
    ) => {
      if (!token) {
        return
      }

      const insertion = `/${command.name} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      setDismissedSlashTokenKey(null)
      setSelectedCommandIndex(0)
      focusTextareaAt(nextCursor)
    },
    [focusTextareaAt, onValueChange, slashCommandToken, value]
  )

  const acceptSlashSkill = React.useCallback(
    (
      skill: InstalledSkill,
      token: SlashCommandToken | null = slashCommandToken
    ) => {
      if (!token) {
        return
      }

      const slug = skill.slug || skill.skill.Name

      if (!slug) {
        return
      }

      const insertion = `/${slug} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      setDismissedSlashTokenKey(null)
      setSelectedCommandIndex(0)
      focusTextareaAt(nextCursor)
    },
    [focusTextareaAt, onValueChange, slashCommandToken, value]
  )

  const acceptSlashMcp = React.useCallback(() => {
    setDismissedSlashTokenKey(slashCommandTokenKey)
    setSelectedCommandIndex(0)
    window.dispatchEvent(new CustomEvent("astraflow:open-composer-plugins"))
  }, [slashCommandTokenKey])

  const handleComposerMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentionMenu) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setSelectedMentionIndex((current) =>
            mentionMenuItemCount > 0 ? (current + 1) % mentionMenuItemCount : 0
          )
          return
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          setSelectedMentionIndex((current) =>
            mentionMenuItemCount > 0
              ? (current - 1 + mentionMenuItemCount) % mentionMenuItemCount
              : 0
          )
          return
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()

          const file =
            activeMentionIndex < filteredWorkspaceFiles.length
              ? filteredWorkspaceFiles[activeMentionIndex]
              : null
          const session =
            activeMentionIndex >= filteredWorkspaceFiles.length
              ? filteredMentionSessions[
                  activeMentionIndex - filteredWorkspaceFiles.length
                ]
              : null

          if (file) {
            acceptMentionFile(file)
          } else if (session) {
            acceptMentionSession(session)
          } else {
            acceptAddLocalFile()
          }
          return
        }

        if (event.key === "Escape") {
          event.preventDefault()
          setDismissedMentionTokenKey(mentionTokenKey)
        }
        return
      }

      if (showSlashCommandMenu && event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          slashMenuEntries.length > 0
            ? (Math.min(current, slashMenuEntries.length - 1) + 1) %
              slashMenuEntries.length
            : 0
        )
        return
      }

      if (showSlashCommandMenu && event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          slashMenuEntries.length > 0
            ? (Math.min(current, slashMenuEntries.length - 1) -
                1 +
                slashMenuEntries.length) %
              slashMenuEntries.length
            : 0
        )
        return
      }

      if (
        showSlashCommandMenu &&
        (event.key === "Enter" || event.key === "Tab")
      ) {
        const entry = slashMenuEntries[activeCommandIndex]

        if (
          event.key === "Enter" &&
          slashMenuEntryMatchesExactToken(entry, slashCommandToken, value)
        ) {
          setDismissedSlashTokenKey(slashCommandTokenKey)
          return
        }

        event.preventDefault()

        if (entry?.kind === "command") {
          acceptSlashCommand(entry.command)
        } else if (entry?.kind === "skill") {
          acceptSlashSkill(entry.skill)
        } else if (entry?.kind === "mcp") {
          acceptSlashMcp()
        }
        return
      }

      if (showSlashCommandMenu && event.key === "Escape") {
        event.preventDefault()
        setDismissedSlashTokenKey(slashCommandTokenKey)
        return
      }

      if (event.key !== "Escape" && event.key.length === 1) {
        if (dismissedSlashTokenKey) {
          setDismissedSlashTokenKey(null)
        }

        if (dismissedMentionTokenKey) {
          setDismissedMentionTokenKey(null)
        }
      }
    },
    [
      acceptAddLocalFile,
      acceptMentionFile,
      acceptMentionSession,
      acceptSlashCommand,
      acceptSlashMcp,
      acceptSlashSkill,
      activeCommandIndex,
      activeMentionIndex,
      dismissedMentionTokenKey,
      dismissedSlashTokenKey,
      filteredMentionSessions,
      filteredWorkspaceFiles,
      mentionMenuItemCount,
      mentionTokenKey,
      showMentionMenu,
      showSlashCommandMenu,
      slashMenuEntries,
      slashCommandToken,
      slashCommandTokenKey,
      value,
    ]
  )

  const canNavigateHistoryForArrow = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        showSlashCommandMenu ||
        showMentionMenu ||
        userMessageHistory.length === 0 ||
        (value.length > 0 && activeHistoryIndex === null)
      ) {
        return false
      }

      const textarea = event.currentTarget

      if (textarea.selectionStart !== textarea.selectionEnd) {
        return false
      }

      if (event.key === "ArrowUp") {
        return !value.slice(0, textarea.selectionStart).includes("\n")
      }

      if (event.key === "ArrowDown") {
        return !value.slice(textarea.selectionEnd).includes("\n")
      }

      return false
    },
    [
      activeHistoryIndex,
      showMentionMenu,
      showSlashCommandMenu,
      userMessageHistory.length,
      value,
    ]
  )

  const handleHistoryNavigationKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
        !canNavigateHistoryForArrow(event)
      ) {
        return false
      }

      if (event.key === "ArrowDown" && activeHistoryIndex === null) {
        return false
      }

      event.preventDefault()

      if (event.key === "ArrowUp") {
        const nextIndex =
          activeHistoryIndex === null
            ? userMessageHistory.length - 1
            : Math.max(0, activeHistoryIndex - 1)

        if (activeHistoryIndex === null) {
          historyDraftRef.current = value
        }

        setHistoryIndex(nextIndex)
        applyHistoryValue(userMessageHistory[nextIndex])
        return true
      }

      const currentHistoryIndex = activeHistoryIndex

      if (currentHistoryIndex === null) {
        return false
      }

      const nextIndex = currentHistoryIndex + 1

      if (nextIndex >= userMessageHistory.length) {
        const draft = historyDraftRef.current

        setHistoryIndex(null)
        applyHistoryValue(draft)
        return true
      }

      setHistoryIndex(nextIndex)
      applyHistoryValue(userMessageHistory[nextIndex])
      return true
    },
    [
      applyHistoryValue,
      canNavigateHistoryForArrow,
      activeHistoryIndex,
      userMessageHistory,
      value,
    ]
  )

  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      handleComposerMenuKeyDown(event)

      if (event.defaultPrevented) {
        return
      }

      handleHistoryNavigationKeyDown(event)
    },
    [handleComposerMenuKeyDown, handleHistoryNavigationKeyDown]
  )

  React.useEffect(() => {
    if (!showSlashCommandMenu) {
      return
    }

    slashMenuScrollRef.current
      ?.querySelector<HTMLElement>("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" })
  }, [activeCommandIndex, showSlashCommandMenu, slashMenuEntries.length])

  React.useEffect(() => {
    if (!showMentionMenu) {
      return
    }

    mentionMenuScrollRef.current
      ?.querySelector<HTMLElement>("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" })
  }, [activeMentionIndex, mentionMenuItemCount, showMentionMenu])

  React.useEffect(() => {
    const requestId = mentionFileRequestIdRef.current + 1
    mentionFileRequestIdRef.current = requestId

    if (!mentionToken || !selectedProjectId) {
      const timer = window.setTimeout(() => {
        if (mentionFileRequestIdRef.current === requestId) {
          setWorkspaceFiles([])
          setWorkspaceFilesLoading(false)
        }
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    const timer = window.setTimeout(() => {
      setWorkspaceFilesLoading(true)

      void listWorkspaceFilesForComposer({
        projectId: selectedProjectId,
        query: mentionQuery,
        limit: 30,
      })
        .then((files) => {
          if (mentionFileRequestIdRef.current === requestId) {
            setWorkspaceFiles(files)
          }
        })
        .finally(() => {
          if (mentionFileRequestIdRef.current === requestId) {
            setWorkspaceFilesLoading(false)
          }
        })
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [mentionQuery, mentionToken, selectedProjectId])

  React.useEffect(() => {
    const requestId = mentionSessionRequestIdRef.current + 1
    mentionSessionRequestIdRef.current = requestId

    if (!showMentionMenu) {
      const timer = window.setTimeout(() => {
        if (mentionSessionRequestIdRef.current === requestId) {
          setMentionSessions([])
          setMentionSessionsLoading(false)
        }
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    const timer = window.setTimeout(() => {
      setMentionSessionsLoading(true)

      void listStudioSessionsForComposer()
        .then((sessions) => {
          if (mentionSessionRequestIdRef.current === requestId) {
            setMentionSessions(sessions)
          }
        })
        .finally(() => {
          if (mentionSessionRequestIdRef.current === requestId) {
            setMentionSessionsLoading(false)
          }
        })
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [sessionId, showMentionMenu])

  React.useEffect(() => {
    if (mentions.length === 0) {
      return
    }

    const nextMentions = mentions.filter((mention) =>
      textHasComposerMentionToken(value, mention)
    )

    if (nextMentions.length !== mentions.length) {
      onMentionsChange(nextMentions)
    }
  }, [mentions, onMentionsChange, value])

  React.useEffect(() => {
    refreshRuntimeCommands()
  }, [refreshRuntimeCommands])

  React.useEffect(() => {
    if (installedSkillsForSlash !== null && installedMcpForSlash !== null) {
      return
    }

    let cancelled = false

    void Promise.allSettled([
      installedSkillsForSlash === null
        ? listInstalledSkillsForComposer()
        : Promise.resolve(installedSkillsForSlash),
      installedMcpForSlash === null
        ? listInstalledMcpForComposer()
        : Promise.resolve(installedMcpForSlash),
    ]).then(([skillsResult, mcpResult]) => {
      if (cancelled) {
        return
      }

      if (installedSkillsForSlash === null) {
        setInstalledSkillsForSlash(
          skillsResult.status === "fulfilled" ? skillsResult.value : []
        )
      }

      if (installedMcpForSlash === null) {
        setInstalledMcpForSlash(
          mcpResult.status === "fulfilled" ? mcpResult.value : []
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [installedMcpForSlash, installedSkillsForSlash])

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setExpertsLoading(true)
      }
    })

    void listLocalExpertsForComposer()
      .then((experts) => {
        if (!controller.signal.aborted) {
          setAvailableExperts(experts)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAvailableExperts([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setExpertsLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [sessionId])

  React.useEffect(() => {
    if (!sessionId) {
      const timer = window.setTimeout(() => setSelectedExpert(null), 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    let cancelled = false

    void getSessionExpertForComposer(sessionId)
      .then((expert) => {
        if (!cancelled) {
          setSelectedExpert(expert)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedExpert(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const handleSummonExpert = React.useCallback(
    async (expert: ComposerSelectedExpert) => {
      const expertId = expert.expertId.trim()

      if (!expertId) {
        toast.error(t.expertUnavailable)
        return
      }

      setSummoningExpertId(expertId)

      try {
        const data = await summonLocalExpertForComposer(expertId, value)

        if (data.draftPrompt && typeof window !== "undefined") {
          window.localStorage.setItem(
            getStudioExpertDraftPromptStorageKey(data.sessionId),
            data.draftPrompt
          )
        }

        toast.success(t.expertSummoned)
        router.push(data.sessionPath)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.requestFailed)
      } finally {
        setSummoningExpertId("")
      }
    },
    [router, t.expertSummoned, t.expertUnavailable, t.requestFailed, value]
  )

  const handleClearSelectedExpert = React.useCallback(async () => {
    if (!sessionId) {
      setSelectedExpert(null)
      return
    }

    const previous = selectedExpert
    setSelectedExpert(null)

    try {
      await clearSessionExpertForComposer(sessionId)
    } catch {
      setSelectedExpert(previous)
      toast.error(t.requestFailed)
      return
    }

    try {
      setAvailableExperts(await listLocalExpertsForComposer())
    } catch {
      setAvailableExperts([])
    }
  }, [selectedExpert, sessionId, t.requestFailed])

  React.useEffect(() => {
    if (wasBusyRef.current && !isBusy) {
      refreshRuntimeCommands()
    }

    wasBusyRef.current = isBusy
  }, [isBusy, refreshRuntimeCommands])

  React.useLayoutEffect(() => {
    syncCursorPosition()
  }, [syncCursorPosition, value])

  const permissionLabelByValue: Record<StudioPermissionMode, string> = {
    ask: t.studioPermissionAsk,
    auto: t.studioPermissionAuto,
    full_access: t.studioPermissionFullAccess,
    readonly: t.studioPermissionReadonly,
  }
  const permissionOptions: Array<{
    value: StudioPermissionMode
    label: string
    icon: typeof Zap
    description: string
  }> = [
    {
      value: "ask",
      label: permissionLabelByValue.ask,
      icon: Hand,
      description: t.studioPermissionAskDescription,
    },
    {
      value: "auto",
      label: permissionLabelByValue.auto,
      icon: ShieldCheck,
      description: t.studioPermissionAutoDescription,
    },
    {
      value: "full_access",
      label: permissionLabelByValue.full_access,
      icon: UnlockKeyhole,
      description: t.studioPermissionFullAccessDescription,
    },
  ]
  const readonlyPermissionOption: (typeof permissionOptions)[number] = {
    value: "readonly",
    label: permissionLabelByValue.readonly,
    icon: Eye,
    description: t.studioPermissionReadonlyDescription,
  }
  const permissionModeOption =
    permissionOptions.find((option) => option.value === permissionMode) ??
    (permissionMode === "readonly"
      ? readonlyPermissionOption
      : permissionOptions[0])
  const PermissionModeIcon = permissionModeOption.icon
  const selectedModelOption =
    modelOptions.find((option) => option.id === model) ?? null
  const selectedModelReasoningEfforts =
    selectedModelOption?.reasoningEfforts ?? getChatReasoningEfforts(model)
  const resolvedReasoningEffort = selectedModelReasoningEfforts.includes(
    reasoningEffort
  )
    ? reasoningEffort
    : (selectedModelOption?.defaultReasoningEffort ??
      resolveChatReasoningEffort(model, reasoningEffort))
  const reasoningOptions = selectedModelReasoningEfforts.map((effort) => ({
    value: effort,
    label: reasoningLabelByValue[effort],
    description: getReasoningEffortDescription(effort, t),
  }))
  const reasoningEffortLabel =
    reasoningOptions.find((option) => option.value === resolvedReasoningEffort)
      ?.label ?? reasoningLabelByValue[resolvedReasoningEffort]
  const selectedRuntimeInfo =
    runtimeInfos.find((runtime) => runtime.id === runtimeId) ??
    FALLBACK_CHAT_RUNTIME_INFO
  const showPermissionMode = supportsPermissionMode(runtimeId, runtimeInfos)
  const selectedProject =
    localProjects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectValue = selectedProject?.id ?? PROJECT_NONE_VALUE
  const normalizedProjectSearch = projectSearch.trim().toLowerCase()
  const filteredLocalProjects = normalizedProjectSearch
    ? localProjects.filter((project) => {
        const haystack = `${project.name} ${project.path}`.toLowerCase()
        return haystack.includes(normalizedProjectSearch)
      })
    : localProjects
  const showSessionScopeControls = !sessionId
  const isAstraflowRuntime = runtimeId === DEFAULT_CHAT_RUNTIME_ID
  const hasAstraflowRuntime = runtimeInfos.some(
    (runtime) => runtime.id === DEFAULT_CHAT_RUNTIME_ID
  )
  // The AstraFlow Agent can run in the remote sandbox or on this machine;
  // other runtimes (Codex, Claude Code, ...) always run locally.
  const runtimeEnvironment = isAstraflowRuntime ? environment : "local"
  const runtimeDescription = getRuntimeGuideDescription(
    runtimeId,
    selectedRuntimeInfo.description,
    t
  )
  const contextWindow =
    contextUsage?.modelContextWindow ?? getChatModelConfig(model).contextWindow

  function handleEnvironmentChange(nextValue: string) {
    if (nextValue === runtimeEnvironment) {
      return
    }

    if (nextValue === "remote") {
      if (!isAstraflowRuntime && hasAstraflowRuntime) {
        onRuntimeChange(DEFAULT_CHAT_RUNTIME_ID)
      }

      onEnvironmentChange("remote")
      return
    }

    if (isAstraflowRuntime) {
      onEnvironmentChange("local")
    }
  }

  function handleProjectValueChange(nextValue: string) {
    onProjectChange(nextValue === PROJECT_NONE_VALUE ? null : nextValue)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files

    if (files && files.length > 0) {
      // Pasted a file (e.g. a screenshot or document) — attach it instead of
      // letting the textarea insert a placeholder. Plain text still pastes
      // normally because clipboardData.files is empty for text.
      event.preventDefault()
      onAddFiles(files)
    }
  }

  return (
    <ChatComposerView
      composerRef={composerRef}
      menuAnchorRef={menuAnchorRef}
      slashMenuScrollRef={slashMenuScrollRef}
      mentionMenuScrollRef={mentionMenuScrollRef}
      fileInputRef={fileInputRef}
      textareaRef={textareaRef}
      t={t}
      locale={locale}
      composerMenuPlacement={composerMenuPlacement}
      showSlashCommandMenu={showSlashCommandMenu}
      slashMenuEntries={slashMenuEntries}
      filteredSlashCommands={filteredSlashCommands}
      filteredSlashSkills={filteredSlashSkills}
      filteredSlashMcpServers={filteredSlashMcpServers}
      installedSkills={installedSkillsForSlash ?? []}
      installedMcpServers={installedMcpForSlash ?? []}
      availableExperts={availableExperts}
      expertsLoading={expertsLoading}
      summoningExpertId={summoningExpertId}
      selectedExpert={selectedExpert}
      onSummonExpert={handleSummonExpert}
      onClearSelectedExpert={handleClearSelectedExpert}
      activeCommandIndex={activeCommandIndex}
      setSelectedCommandIndex={setSelectedCommandIndex}
      acceptSlashCommand={acceptSlashCommand}
      acceptSlashSkill={acceptSlashSkill}
      acceptSlashMcp={acceptSlashMcp}
      showMentionMenu={showMentionMenu}
      selectedProjectId={selectedProjectId}
      workspaceFilesLoading={workspaceFilesLoading}
      filteredWorkspaceFiles={filteredWorkspaceFiles}
      activeMentionIndex={activeMentionIndex}
      setSelectedMentionIndex={setSelectedMentionIndex}
      acceptMentionFile={acceptMentionFile}
      mentionSessionsLoading={mentionSessionsLoading}
      filteredMentionSessions={filteredMentionSessions}
      acceptMentionSession={acceptMentionSession}
      addLocalMentionIndex={addLocalMentionIndex}
      acceptAddLocalFile={acceptAddLocalFile}
      value={value}
      handleComposerValueChange={handleComposerValueChange}
      onSubmit={onSubmit}
      isBusy={isBusy}
      mentions={mentions}
      removeMention={removeMention}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      showCustomCaret={showCustomCaret}
      setIsTextareaFocused={setIsTextareaFocused}
      setCursorPosition={setCursorPosition}
      syncCursorPosition={syncCursorPosition}
      handleComposerKeyDown={handleComposerKeyDown}
      handlePaste={handlePaste}
      onAddFiles={onAddFiles}
      showPermissionMode={showPermissionMode}
      permissionMode={permissionMode}
      onPermissionModeChange={onPermissionModeChange}
      iconOnlyControls={iconOnlyControls}
      permissionModeOption={permissionModeOption}
      PermissionModeIcon={PermissionModeIcon}
      permissionOptions={permissionOptions}
      denseControls={denseControls}
      runtimeId={runtimeId}
      onRuntimeChange={onRuntimeChange}
      runtimeDescription={runtimeDescription}
      runtimeInfos={runtimeInfos}
      contextWindow={contextWindow}
      contextUsage={contextUsage}
      modelSelectOpen={modelSelectOpen}
      onModelSelectOpenChange={onModelSelectOpenChange}
      model={model}
      onModelChange={onModelChange}
      modelOptions={modelOptions}
      reasoningSelectOpen={reasoningSelectOpen}
      onReasoningSelectOpenChange={onReasoningSelectOpenChange}
      resolvedReasoningEffort={resolvedReasoningEffort}
      onReasoningEffortChange={onReasoningEffortChange}
      reasoningOptions={reasoningOptions}
      reasoningEffortLabel={reasoningEffortLabel}
      canSubmit={canSubmit}
      onStop={onStop}
      showSessionScopeControls={showSessionScopeControls}
      selectedProjectValue={selectedProjectValue}
      handleProjectValueChange={handleProjectValueChange}
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
    />
  )
}
