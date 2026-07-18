import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { InstalledMcpServer } from "@/lib/mcp"
import type { InstalledSkill } from "@/lib/skill-market"
import type { StudioOpenReviewPanelDetail } from "@/lib/studio-review-panel"
import type {
  StudioAttachment,
  StudioLocalProjectWithGitInfo,
  StudioMessagePart,
  StudioPermissionMode,
  StudioTokenUsage,
  StudioWorkspace,
} from "@/lib/studio-types"

export type StudioChatWorkbenchProps = {
  sessionId: string
  workspaceId?: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

export type PendingAttachment = StudioAttachment & { id: string }

export type ComposerPopupPlacement = "top" | "bottom"

export type StudioOutputFile = {
  path: string
  name: string
  environment: ChatRunEnvironment
  sourceKind?: "read" | "updated"
}

export type StudioFileChangeSummary = {
  path: string
  name: string
  kind: Extract<StudioMessagePart, { type: "file" }>["kind"]
  additions: number
  deletions: number
  environment: ChatRunEnvironment
}

export type ComposerFileMention = {
  kind: "file" | "folder"
  path: string
  relativePath: string
  name: string
}

export type ComposerSessionMention = {
  kind: "session"
  sessionId: string
  title: string
}

export type ComposerMention = ComposerFileMention | ComposerSessionMention

export type ComposerSelectedExpert = {
  sessionId: string
  expertId: string
  expertType: string
  runtimeHash: string
  displayName: string
  profession: string
  defaultInitPrompt: string
  selectedAt: string
}

export type StudioTerminalTab = {
  id: string
  cwd: string | null
  sequence: number
  title: string
  resolvedCwd?: string
}

export type StudioRightPanelMode =
  | "launcher"
  | "files"
  | "side-chat"
  | "subagent"
  | "browser"
  | "browser-settings"
  | "terminal"
  | "review"

export type StudioBrowserTab = {
  id: string
  title: string
  address: string
  url: string
}

export type StudioWorkspaceBrowserTab = StudioBrowserTab & {
  kind: "browser"
}

export type StudioWorkspaceFileTab = {
  id: string
  kind: "files"
  title: string
  entry: AstraFlowSidePanelDirectoryEntry | null
  focusLine?: number | null
  focusColumn?: number | null
  focusEndLine?: number | null
}

export type StudioWorkspaceTerminalTab = StudioTerminalTab & {
  kind: "terminal"
}

export type StudioWorkspaceSideChatTab = {
  id: string
  kind: "side-chat"
  title: string
}

export type StudioSubagentPart = Extract<
  StudioMessagePart,
  { type: "subagent" }
>

export type StudioSubagentPanelItem = {
  subagent: StudioSubagentPart
  environment: ChatRunEnvironment
}

export type StudioSubagentPanelRequest = StudioSubagentPanelItem & {
  requestId: string
}

export type StudioWorkspaceSubagentTab = {
  id: string
  kind: "subagent"
  title: string
  subagent: StudioSubagentPart
  environment: ChatRunEnvironment
}

export type StudioWorkspaceReviewTab = {
  id: string
  kind: "review"
  title: string
  detail: StudioOpenReviewPanelDetail
}

export type StudioWorkspaceTab =
  | StudioWorkspaceBrowserTab
  | StudioWorkspaceFileTab
  | StudioWorkspaceTerminalTab
  | StudioWorkspaceSideChatTab
  | StudioWorkspaceSubagentTab
  | StudioWorkspaceReviewTab

export type StudioSidePanelFilePreview =
  | {
      kind: "text"
      entry: AstraFlowSidePanelDirectoryEntry
      file: AstraFlowSidePanelTextFile
    }
  | {
      kind: "image"
      entry: AstraFlowSidePanelDirectoryEntry
      file: AstraFlowSidePanelDataUrlFile
    }
  | {
      kind: "binary"
      entry: AstraFlowSidePanelDirectoryEntry
      file: AstraFlowSidePanelDataUrlFile
    }
  | {
      kind: "unsupported"
      entry: AstraFlowSidePanelDirectoryEntry
      error?: string
    }

export type StudioSideChatMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

export type ApiResponse<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error?: unknown
      message?: string
    }

export type ChatRunEnvironment = "remote" | "local"

export type ChatPreferenceRecord = {
  chatModel?: SupportedChatModel | null
  chatRuntimeId?: string | null
  chatReasoningEffort?: ChatReasoningEffort | null
}

export type StoredChatDefaults = {
  runtimeId?: string
  model?: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
}

export type ResolvedChatPreferences = {
  runtimeId: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
}

export type ChatRuntimeOption = Pick<
  AgentRuntimeInfo,
  "id" | "label" | "description" | "capabilities"
>

export type WorkspaceFileCandidate = {
  path: string
  relativePath: string
  name: string
  kind: "file" | "folder"
}

export type ChatComposerProps = {
  sessionId: string
  workspace: StudioWorkspace | null
  workspaces: StudioWorkspace[]
  workspacesLoading: boolean
  value: string
  userMessageHistory: string[]
  model: SupportedChatModel
  modelOptions: AgentModelDefinition[]
  runtimeId: string
  runtimeInfos: ChatRuntimeOption[]
  reasoningEffort: ChatReasoningEffort
  permissionMode: StudioPermissionMode
  localProjects: StudioLocalProjectWithGitInfo[]
  selectedProjectId: string | null
  contextUsage: StudioTokenUsage | null
  attachments: PendingAttachment[]
  mentions: ComposerMention[]
  onModelChange: (model: SupportedChatModel) => void
  onRuntimeChange: (runtimeId: string) => void
  onEnsureAcpSession: () => Promise<string>
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void
  onPermissionModeChange: (permissionMode: StudioPermissionMode) => void
  onWorkspaceChange: (workspaceId: string | null) => void
  onAddWorkspace: () => void
  onValueChange: (value: string) => void
  onMentionsChange: (mentions: ComposerMention[]) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  modelSelectOpen: boolean
  onModelSelectOpenChange: (open: boolean) => void
  reasoningSelectOpen: boolean
  onReasoningSelectOpenChange: (open: boolean) => void
  onSubmit: (skillSlugs?: string[], promptOverride?: string) => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

export type BuiltinSlashCommandName =
  | "clear"
  | "model"
  | "reasoning"
  | "approve"
  | "always"
  | "deny"
  | "compact"
  | "tools"
  | "packages"
  | "reload"
  | "session"
  | "undo"
  | "redo"
  | "checkpoint"
  | "tree"
  | "rewind"

export type SlashCommandToken = {
  start: number
  end: number
  prefix: string
}

export type MentionToken = {
  start: number
  end: number
  prefix: string
}

export type SlashComposerMenuEntry =
  | { kind: "command"; command: SlashCommandDescriptor }
  | { kind: "skill"; skill: InstalledSkill }
  | { kind: "mcp"; server: InstalledMcpServer }

export type SkillsMarketPageProps = {
  embedded?: boolean
  initialView?: "market" | "mine"
}
