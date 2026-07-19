import { agentContentBlockText } from "@/lib/agent/structured-content"
import type {
  StudioMessage,
  StudioMessageActivity,
  StudioMessagePart,
  StudioSession,
} from "@/lib/studio-types"

function normalizeHeading(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim() || "Untitled chat"
}

function readMessageMarkdown(message: StudioMessage) {
  const content = message.content.trim()

  if (content) {
    return content
  }

  return message.parts
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.content]
      }

      if (
        part.type === "content" &&
        (part.channel ?? "message") === "message"
      ) {
        return [agentContentBlockText(part.content)]
      }

      return []
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n")
}

function readAttachmentMarkdown(message: StudioMessage) {
  if (message.attachments.length === 0) {
    return ""
  }

  return message.attachments
    .map((attachment) => `- Attachment: ${attachment.name}`)
    .join("\n")
}

function compactLine(value: string | null | undefined) {
  return value?.replace(/[\r\n]+/g, " ").trim() ?? ""
}

function activitySummary(activity: StudioMessageActivity) {
  const label = compactLine(activity.title) || compactLine(activity.toolName)
  const status = activity.status === "complete" ? "completed" : activity.status

  return label ? `- Tool ${status}: ${label}` : ""
}

function readStructuredPartMarkdown(part: StudioMessagePart) {
  if (part.type === "tool") {
    return activitySummary(part.activity)
  }

  if (part.type === "plan") {
    const entries = part.todos.map(
      (todo) =>
        `  - [${todo.status === "completed" ? "x" : " "}] ${compactLine(todo.text)} (${todo.status})`
    )
    const content = compactLine(part.content)

    return ["- Plan", content ? `  - ${content}` : "", ...entries]
      .filter(Boolean)
      .join("\n")
  }

  if (part.type === "subagent") {
    const summary = compactLine(part.summary) || compactLine(part.content)
    return `- Subagent ${part.status}: ${compactLine(part.name)}${summary ? ` — ${summary}` : ""}`
  }

  if (part.type === "file") {
    const stats = part.stats
      ? ` (+${part.stats.additions}/-${part.stats.deletions})`
      : ""
    return `- File ${part.kind}: ${compactLine(part.path)}${stats} [${part.status}]`
  }

  if (part.type === "permission") {
    const selected = part.options.find(
      (option) => option.optionId === part.selectedOptionId
    )
    const decision = compactLine(selected?.name) || compactLine(part.selectedOptionId)

    return `- Permission ${part.status}: ${compactLine(part.toolName)}${decision ? ` — ${decision}` : ""}`
  }

  if (part.type === "user_input") {
    const answers = part.answers.map((answer) => {
      const question = part.questions.find(
        (candidate) => candidate.id === answer.questionId
      )
      const response = question?.isSecret
        ? "[redacted]"
        : compactLine(answer.label) || compactLine(answer.text) || "[empty]"

      return `  - ${compactLine(question?.header) || compactLine(question?.question) || answer.questionId}: ${response}`
    })

    return [`- User input ${part.status}`, ...answers].join("\n")
  }

  if (part.type === "media_generation") {
    return `- ${part.kind === "image" ? "Image" : "Video"} generation ${part.status}: ${compactLine(part.modelName)}${part.outputs.length ? ` (${part.outputs.length} output${part.outputs.length === 1 ? "" : "s"})` : ""}`
  }

  return ""
}

function readStructuredMarkdown(message: StudioMessage) {
  const entries = message.parts
    .map(readStructuredPartMarkdown)
    .filter(Boolean)

  if (entries.length === 0) {
    return ""
  }

  return ["### Activity", ...entries].join("\n\n")
}

export function createStudioSessionMarkdown(
  session: Pick<StudioSession, "title">,
  messages: StudioMessage[]
) {
  const turns = messages.flatMap((message) => {
    const body = readMessageMarkdown(message)
    const structured = readStructuredMarkdown(message)
    const attachments = readAttachmentMarkdown(message)
    const content = [body, structured, attachments]
      .filter(Boolean)
      .join("\n\n")

    if (!content) {
      return []
    }

    const role = message.role === "user" ? "User" : "Assistant"
    return [`## ${role}\n\n${content}`]
  })

  return [`# ${normalizeHeading(session.title)}`, ...turns].join(
    "\n\n---\n\n"
  )
}

export function createStudioSessionMarkdownFilename(title: string) {
  const normalized = normalizeHeading(title)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim()

  return `${normalized || "conversation"}.md`
}
