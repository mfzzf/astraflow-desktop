import type { PromptMention } from "@/lib/agent/composer-types"

export type AgentMessageContentPart =
  | string
  | {
      type: string
      [key: string]: unknown
    }

export type AgentMessageContent = string | AgentMessageContentPart[]

export type AgentMessage = {
  role: "user" | "assistant" | "system" | "tool"
  content: AgentMessageContent
  id?: string
  mentions?: PromptMention[]
  name?: string
  toolCallId?: string
}
