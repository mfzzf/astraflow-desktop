export const RUNTIME_SKILLS_PREAMBLE_TITLE_PREFIX =
  "AstraFlow Skills are registered through the "

const RUNTIME_TITLE_PLACEHOLDERS = new Set([
  "new chat",
  "new thread",
  "untitled chat",
  "未命名会话",
  "新建会话",
])

export function getSessionTitleSummarySource({
  attachmentName,
  prompt,
  skillSlugs,
}: {
  attachmentName?: string | null
  prompt: string
  skillSlugs?: readonly string[]
}) {
  const userPrompt = prompt.trim()

  if (userPrompt) {
    return userPrompt
  }

  const skillPrompt = (skillSlugs ?? [])
    .map((slug) => slug.trim())
    .filter(Boolean)
    .map((slug) => `/${slug}`)
    .join(" ")

  return skillPrompt || attachmentName?.trim() || "New chat"
}

export function shouldAdoptRuntimeSessionTitle(
  currentTitle: string,
  proposedTitle: string
) {
  return (
    RUNTIME_TITLE_PLACEHOLDERS.has(currentTitle.trim().toLowerCase()) &&
    !proposedTitle.trim().startsWith(RUNTIME_SKILLS_PREAMBLE_TITLE_PREFIX)
  )
}

export function recoverSessionTitleFromUserPrompt(prompt: string) {
  const normalized = prompt.trim()
  const withoutLeadingSkills = normalized.replace(
    /^(?:\/[\w.-]+(?:\s+|$))+/,
    ""
  )

  return withoutLeadingSkills.trim() || normalized || "New chat"
}
