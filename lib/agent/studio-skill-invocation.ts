export type StudioSkillInvocationCandidate = {
  slug: string
  loadedContent: string
}

export type ResolvedStudioSkillInvocation = {
  prompt: string
  slug: string
  slugs: string[]
}

export function parseLeadingSkillCommandNames(content: string) {
  const names: string[] = []
  let remaining = content.trim()

  while (remaining) {
    const match = /^\/([A-Za-z0-9][\w:-]*)(?=\s|$)/.exec(remaining)

    if (!match) {
      break
    }

    names.push(match[1])
    remaining = remaining.slice(match[0].length).trimStart()
  }

  return names
}

export function resolveStudioSkillInvocation({
  candidates,
  content,
}: {
  candidates: StudioSkillInvocationCandidate[]
  content: string
}): ResolvedStudioSkillInvocation | null {
  const selected: StudioSkillInvocationCandidate[] = []
  let remaining = content.trim()

  while (remaining) {
    const match = /^\/([A-Za-z0-9][\w:-]*)(?=\s|$)/.exec(remaining)
    const candidate = match
      ? candidates.find((available) => available.slug === match[1])
      : null

    if (!match || !candidate) {
      break
    }

    selected.push(candidate)
    remaining = remaining.slice(match[0].length).trimStart()
  }

  if (selected.length === 0) {
    return null
  }

  const slugs = selected.map((candidate) => candidate.slug)
  const multiple = selected.length > 1
  const task =
    remaining ||
    (multiple
      ? `Start the selected Skill workflows (${slugs.join(", ")}). Ask for any user input required by the Skills before continuing.`
      : `Start the "${slugs[0]}" Skill workflow. Ask for any user input required by the Skill before continuing.`)

  return {
    slug: slugs[0],
    slugs,
    prompt: [
      multiple
        ? "AstraFlow resolved the leading slash tokens as enabled Skill invocations."
        : "AstraFlow resolved the leading slash token as an enabled Skill invocation.",
      multiple ? `Skill slugs: ${slugs.join(", ")}` : `Skill slug: ${slugs[0]}`,
      multiple
        ? `The tokens ${slugs.map((slug) => `"/${slug}"`).join(", ")} are Skill commands, not filesystem paths. Do not read, list, search for, or otherwise treat them as paths.`
        : `The token "/${slugs[0]}" is a Skill command, not a filesystem path. Do not read, list, search for, or otherwise treat "/${slugs[0]}" as a path.`,
      multiple
        ? "The complete Skill instructions are loaded below. Follow all applicable instructions for this request."
        : "The complete Skill instructions are loaded below. Follow them for this request.",
      "",
      ...selected.flatMap((candidate) => [
        `--- BEGIN LOADED ASTRAFLOW SKILL: ${candidate.slug} ---`,
        candidate.loadedContent,
        `--- END LOADED ASTRAFLOW SKILL: ${candidate.slug} ---`,
        "",
      ]),
      multiple
        ? "User request after the Skill commands:"
        : "User request after the Skill command:",
      task,
    ].join("\n"),
  }
}
