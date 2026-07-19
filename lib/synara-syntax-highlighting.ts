import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs"

export type SynaraSyntaxTheme = "github-light" | "github-dark"

const highlighterPromiseCache = new Map<
  string,
  Promise<DiffsHighlighter>
>()

export function getSynaraSyntaxHighlighter(
  language: string
): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language)

  if (cached) {
    return cached
  }

  const promise: Promise<DiffsHighlighter> = getSharedHighlighter({
    themes: ["github-dark", "github-light"],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((error) => {
    highlighterPromiseCache.delete(language)

    if (language === "text") {
      throw error
    }

    return getSynaraSyntaxHighlighter("text")
  })

  highlighterPromiseCache.set(language, promise)
  return promise
}

export function highlightCodeWithSynaraHighlighter(
  highlighter: DiffsHighlighter,
  code: string,
  language: string,
  theme: SynaraSyntaxTheme
) {
  try {
    return highlighter.codeToHtml(code, { lang: language, theme })
  } catch {
    return highlighter.codeToHtml(code, { lang: "text", theme })
  }
}
