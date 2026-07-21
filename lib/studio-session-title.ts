export const RUNTIME_SKILLS_PREAMBLE_TITLE_PREFIX =
  "AstraFlow Skills are registered through the "

export const RUNTIME_PREAMBLE_TITLE_PREFIXES = [
  RUNTIME_SKILLS_PREAMBLE_TITLE_PREFIX,
  "Installed AstraFlow Skills are globally enabled",
  "AstraFlow Skills are exposed to Sandbox and external ACP Agents through the ",
  "Globally enabled skills:",
] as const

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
    !isRuntimePreambleSessionTitle(proposedTitle)
  )
}

export function isRuntimePreambleSessionTitle(title: string) {
  const normalized = title.trim().toLowerCase()

  return RUNTIME_PREAMBLE_TITLE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase())
  )
}

export function recoverSessionTitleFromUserPrompt(prompt: string) {
  const normalized = prompt.trim()
  const withoutLeadingSkills = normalized.replace(
    /^(?:\/[$\w:.-]+(?:\s+|$))+/,
    ""
  )
  const recovered = withoutLeadingSkills.trim() || normalized || "New chat"

  // Keep session-list labels short without calling a model.
  if (/[\s]/.test(recovered)) {
    return recovered.split(/\s+/).slice(0, 10).join(" ")
  }

  return recovered.length > 24 ? recovered.slice(0, 24) : recovered
}
