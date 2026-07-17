import { parseSlashCommandText } from "@/lib/agent/composer-types"

export type StudioSkillInvocationCandidate = {
  slug: string
  loadedContent: string
}

export type ResolvedStudioSkillInvocation = {
  prompt: string
  slug: string
}

export function resolveStudioSkillInvocation({
  candidates,
  content,
}: {
  candidates: StudioSkillInvocationCandidate[]
  content: string
}): ResolvedStudioSkillInvocation | null {
  const command = parseSlashCommandText(content)

  if (!command) {
    return null
  }

  const candidate = candidates.find(
    (available) => available.slug === command.name
  )

  if (!candidate) {
    return null
  }

  const task =
    command.args ||
    `Start the "${candidate.slug}" Skill workflow. Ask for any user input required by the Skill before continuing.`

  return {
    slug: candidate.slug,
    prompt: [
      "AstraFlow resolved the leading slash token as an enabled Skill invocation.",
      `Skill slug: ${candidate.slug}`,
      `The token \"/${candidate.slug}\" is a Skill command, not a filesystem path. Do not read, list, search for, or otherwise treat \"/${candidate.slug}\" as a path.`,
      "The complete Skill instructions are loaded below. Follow them for this request.",
      "",
      "--- BEGIN LOADED ASTRAFLOW SKILL ---",
      candidate.loadedContent,
      "--- END LOADED ASTRAFLOW SKILL ---",
      "",
      "User request after the Skill command:",
      task,
    ].join("\n"),
  }
}
