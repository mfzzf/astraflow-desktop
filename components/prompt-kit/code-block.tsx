"use client"

import * as React from "react"
import type { ThemeRegistration } from "shiki"

import { useTheme } from "@/components/theme-provider"
import {
  chatGptXcodeDarkTheme,
  chatGptXcodeLightTheme,
} from "@/lib/chatgpt-shiki-themes"
import { cn } from "@/lib/utils"

type ShikiTheme = string | ThemeRegistration

type ShikiHighlightOptions = {
  lang: string
  theme: ShikiTheme
  tokenizeMaxLineLength?: number
  tokenizeTimeLimit?: number
}

type ShikiCodeToHtml = (
  code: string,
  options: ShikiHighlightOptions
) => Promise<string>

type ShikiHighlighter = {
  codeToHtml: ShikiCodeToHtml
  loadLanguage: (...languages: unknown[]) => Promise<void>
  loadTheme: (...themes: ShikiTheme[]) => Promise<void>
}

type ShikiWebBundle = {
  codeToHtml: ShikiCodeToHtml
  getSingletonHighlighter: (options?: {
    langs?: string[]
    themes?: ShikiTheme[]
    warnings?: boolean
  }) => Promise<ShikiHighlighter>
}

const maxHighlightedCodeLength = 30_000
const maxHighlightedLineLength = 2_000
const maxHighlightCacheEntries = 80
const maxQueuedHighlightJobs = 6
const maxFallbackLineNodes = 5_000
const maxFocusedFallbackLines = 200

const highlightedCodeCache = new Map<string, string>()
const pendingHighlightCache = new Map<string, Promise<string | null>>()
const loadedExtraLanguages = new Set<string>()
const extraLanguageRegistrations = new Map<string, Promise<unknown | null>>()

let shikiWebBundlePromise: Promise<ShikiWebBundle> | null = null
let highlightJobActive = false
const highlightJobQueue: Array<{
  run: () => Promise<string | null>
  resolve: (value: string | null) => void
}> = []

function drainHighlightJobQueue() {
  if (highlightJobActive) {
    return
  }

  const job = highlightJobQueue.shift()

  if (!job) {
    return
  }

  highlightJobActive = true
  window.setTimeout(() => {
    void job
      .run()
      .then(job.resolve, () => job.resolve(null))
      .finally(() => {
        highlightJobActive = false
        drainHighlightJobQueue()
      })
  }, 0)
}

function scheduleHighlightJob(run: () => Promise<string | null>) {
  if (
    typeof window === "undefined" ||
    highlightJobQueue.length + Number(highlightJobActive) >=
      maxQueuedHighlightJobs
  ) {
    return Promise.resolve(null)
  }

  return new Promise<string | null>((resolve) => {
    highlightJobQueue.push({ run, resolve })
    drainHighlightJobQueue()
  })
}

const extraLanguageLoaders: Record<
  string,
  () => Promise<{ default: unknown }>
> = {
  bat: () => import("@shikijs/langs/bat"),
  clojure: () => import("@shikijs/langs/clojure"),
  cmake: () => import("@shikijs/langs/cmake"),
  cs: () => import("@shikijs/langs/cs"),
  csharp: () => import("@shikijs/langs/csharp"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  elixir: () => import("@shikijs/langs/elixir"),
  erlang: () => import("@shikijs/langs/erlang"),
  fsharp: () => import("@shikijs/langs/fsharp"),
  go: () => import("@shikijs/langs/go"),
  groovy: () => import("@shikijs/langs/groovy"),
  haskell: () => import("@shikijs/langs/haskell"),
  hcl: () => import("@shikijs/langs/hcl"),
  ini: () => import("@shikijs/langs/ini"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  kt: () => import("@shikijs/langs/kt"),
  latex: () => import("@shikijs/langs/latex"),
  log: () => import("@shikijs/langs/log"),
  lua: () => import("@shikijs/langs/lua"),
  make: () => import("@shikijs/langs/make"),
  makefile: () => import("@shikijs/langs/makefile"),
  nginx: () => import("@shikijs/langs/nginx"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  "objective-cpp": () => import("@shikijs/langs/objective-cpp"),
  ocaml: () => import("@shikijs/langs/ocaml"),
  perl: () => import("@shikijs/langs/perl"),
  powershell: () => import("@shikijs/langs/powershell"),
  prisma: () => import("@shikijs/langs/prisma"),
  proto: () => import("@shikijs/langs/proto"),
  protobuf: () => import("@shikijs/langs/protobuf"),
  ps1: () => import("@shikijs/langs/ps1"),
  properties: () => import("@shikijs/langs/properties"),
  rb: () => import("@shikijs/langs/rb"),
  rs: () => import("@shikijs/langs/rs"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  swift: () => import("@shikijs/langs/swift"),
  terraform: () => import("@shikijs/langs/terraform"),
  toml: () => import("@shikijs/langs/toml"),
  tsv: () => import("@shikijs/langs/tsv"),
  twig: () => import("@shikijs/langs/twig"),
  vb: () => import("@shikijs/langs/vb"),
  rst: () => import("@shikijs/langs/rst"),
  gitignore: async () => ({
    default: [
      {
        displayName: "Git Ignore",
        name: "gitignore",
        scopeName: "source.gitignore",
        patterns: [
          { match: "^\\s*#.*$", name: "comment.line.number-sign.gitignore" },
          { match: "^!", name: "keyword.operator.negation.gitignore" },
          {
            match: "(?:\\*\\*|\\*|\\?|\\[[^\\]]+\\])",
            name: "keyword.operator.glob.gitignore",
          },
          { match: "^/|/$", name: "punctuation.separator.path.gitignore" },
        ],
      },
    ],
  }),
  yang: async () => ({
    default: [
      {
        displayName: "YANG",
        name: "yang",
        scopeName: "source.yang",
        patterns: [
          { begin: "/\\*", end: "\\*/", name: "comment.block.yang" },
          { match: "//.*$", name: "comment.line.double-slash.yang" },
          { begin: '"', end: '"', name: "string.quoted.double.yang" },
          { begin: "'", end: "'", name: "string.quoted.single.yang" },
          {
            match:
              "\\b(module|submodule|namespace|prefix|import|include|revision|container|list|leaf|leaf-list|choice|case|typedef|grouping|uses|augment|rpc|notification|type|description|reference|config|mandatory|default|key|unique|when|must|if-feature|feature|identity|base|path|require-instance)\\b",
            name: "keyword.control.yang",
          },
          { match: "\\b(true|false)\\b", name: "constant.language.yang" },
          { match: "\\b\\d+(?:\\.\\d+)?\\b", name: "constant.numeric.yang" },
        ],
      },
    ],
  }),
}

function normalizeShikiLanguage(language: string) {
  const normalized = language.trim().toLowerCase()

  if (!normalized || ["plain", "text", "txt"].includes(normalized)) {
    return "plaintext"
  }

  return normalized
}

function normalizeShikiTheme(theme: ShikiTheme) {
  return typeof theme === "string" ? theme.trim() || "github-light" : theme
}

function getShikiThemeCacheKey(theme: ShikiTheme) {
  return typeof theme === "string" ? theme : theme.name
}

function getHighlightCacheKey(
  code: string,
  language: string,
  theme: ShikiTheme
) {
  return `${getShikiThemeCacheKey(theme)}\u0000${language}\u0000${code}`
}

function getCachedHighlightedCode(key: string) {
  const cached = highlightedCodeCache.get(key)

  if (typeof cached !== "string") {
    return null
  }

  highlightedCodeCache.delete(key)
  highlightedCodeCache.set(key, cached)

  return cached
}

function setCachedHighlightedCode(key: string, html: string) {
  if (highlightedCodeCache.has(key)) {
    highlightedCodeCache.delete(key)
  }

  highlightedCodeCache.set(key, html)

  while (highlightedCodeCache.size > maxHighlightCacheEntries) {
    const oldestKey = highlightedCodeCache.keys().next().value

    if (!oldestKey) {
      break
    }

    highlightedCodeCache.delete(oldestKey)
  }
}

function loadShikiWebBundle() {
  shikiWebBundlePromise ??= import("shiki/bundle/web")
    .then((mod) => mod as unknown as ShikiWebBundle)
    .catch((error) => {
      shikiWebBundlePromise = null
      throw error
    })

  return shikiWebBundlePromise
}

function getExtraLanguageRegistration(language: string) {
  const loader = extraLanguageLoaders[language]

  if (!loader) {
    return Promise.resolve(null)
  }

  let registration = extraLanguageRegistrations.get(language)

  if (!registration) {
    registration = loader()
      .then((mod) => mod.default)
      .catch(() => null)
    extraLanguageRegistrations.set(language, registration)
  }

  return registration
}

function getShikiOptions(
  language: string,
  theme: ShikiTheme
): ShikiHighlightOptions {
  return {
    lang: language,
    theme,
    tokenizeMaxLineLength: maxHighlightedLineLength,
    tokenizeTimeLimit: 500,
  }
}

async function highlightWithShiki(
  code: string,
  language: string,
  theme: ShikiTheme
) {
  const shiki = await loadShikiWebBundle()

  try {
    return await shiki.codeToHtml(code, getShikiOptions(language, theme))
  } catch {
    const extraLanguage = await getExtraLanguageRegistration(language)

    if (extraLanguage) {
      try {
        const highlighter = await shiki.getSingletonHighlighter({
          langs: [],
          themes: [theme],
          warnings: false,
        })

        await highlighter.loadTheme(theme)

        if (!loadedExtraLanguages.has(language)) {
          await highlighter.loadLanguage(extraLanguage)
          loadedExtraLanguages.add(language)
        }

        return highlighter.codeToHtml(code, getShikiOptions(language, theme))
      } catch {
        // Fall through to plaintext.
      }
    }
  }

  try {
    return await shiki.codeToHtml(code, getShikiOptions("plaintext", theme))
  } catch {
    return null
  }
}

function getHighlightedCode(
  key: string,
  code: string,
  language: string,
  theme: ShikiTheme
) {
  const cached = getCachedHighlightedCode(key)

  if (cached) {
    return Promise.resolve(cached)
  }

  let pending = pendingHighlightCache.get(key)

  if (!pending) {
    pending = scheduleHighlightJob(() =>
      highlightWithShiki(code, language, theme)
    )
      .then((html) => {
        if (html) {
          setCachedHighlightedCode(key, html)
        }

        return html
      })
      .finally(() => {
        pendingHighlightCache.delete(key)
      })
    pendingHighlightCache.set(key, pending)
  }

  return pending
}

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "rounded-xl border-border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: ShikiTheme
  streaming?: boolean
  renderFallbackLines?: boolean
  fallbackFocusLine?: number | null
  fallbackFocusEndLine?: number | null
  className?: string
} & React.HTMLProps<HTMLDivElement>

function useHighlightedCodeHtml({
  code,
  language,
  theme,
  enabled = true,
}: {
  code: string
  language: string
  theme?: ShikiTheme
  enabled?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const normalizedLanguage = normalizeShikiLanguage(language)
  const normalizedTheme = normalizeShikiTheme(
    theme ??
      (resolvedTheme === "dark"
        ? chatGptXcodeDarkTheme
        : chatGptXcodeLightTheme)
  )
  const shouldHighlight =
    enabled && code.length > 0 && code.length <= maxHighlightedCodeLength
  const cacheKey = shouldHighlight
    ? getHighlightCacheKey(code, normalizedLanguage, normalizedTheme)
    : null
  const [highlighted, setHighlighted] = React.useState<{
    key: string
    html: string
  } | null>(null)

  React.useEffect(() => {
    let isMounted = true

    if (!cacheKey || !shouldHighlight) {
      return () => {
        isMounted = false
      }
    }

    void getHighlightedCode(
      cacheKey,
      code,
      normalizedLanguage,
      normalizedTheme
    ).then((html) => {
      if (isMounted && html) {
        setHighlighted({ key: cacheKey, html })
      }
    })

    return () => {
      isMounted = false
    }
  }, [cacheKey, code, normalizedLanguage, normalizedTheme, shouldHighlight])

  return cacheKey && highlighted?.key === cacheKey ? highlighted.html : null
}

export function useShikiHighlightedLines({
  code,
  language = "plaintext",
  theme,
  enabled = true,
}: {
  code: string
  language?: string
  theme?: ShikiTheme
  enabled?: boolean
}) {
  const highlightedHtml = useHighlightedCodeHtml({
    code,
    language,
    theme,
    enabled,
  })

  return React.useMemo(() => {
    if (!highlightedHtml || typeof DOMParser === "undefined") {
      return null
    }

    const document = new DOMParser().parseFromString(
      highlightedHtml,
      "text/html"
    )

    return Array.from(document.querySelectorAll("pre code .line")).map(
      (line) => line.innerHTML
    )
  }, [highlightedHtml])
}

function CodeBlockCode({
  code,
  language = "tsx",
  theme,
  streaming = false,
  renderFallbackLines = false,
  fallbackFocusLine = null,
  fallbackFocusEndLine = null,
  className,
  ...props
}: CodeBlockCodeProps) {
  const highlightedHtml = useHighlightedCodeHtml({
    code,
    language,
    theme,
    enabled: !streaming,
  })
  const numberedHighlightedHtml = React.useMemo(() => {
    let lineNumber = 0
    const numbered = highlightedHtml?.replaceAll('<span class="line">', () => {
      lineNumber += 1
      return `<span class="line" data-line-number="${lineNumber}">`
    })

    // In block-line mode each `.line` renders as `display: block`, so shiki's
    // newline separators inside `white-space: pre` would add an empty row
    // after every line and double the spacing.
    return renderFallbackLines
      ? numbered?.replaceAll("</span>\n", "</span>")
      : numbered
  }, [highlightedHtml, renderFallbackLines])

  const fallbackContent = React.useMemo(() => {
    if (!renderFallbackLines) {
      return code
    }

    if (code.length <= maxHighlightedCodeLength) {
      const lines = code.split("\n")

      if (lines.length <= maxFallbackLineNodes) {
        return lines.map((line, index) => (
          <span
            className="line"
            data-line-number={index + 1}
            key={index}
          >
            {line || " "}
          </span>
        ))
      }
    }

    const firstLine = Math.max(1, Math.floor(fallbackFocusLine ?? 0))

    if (!fallbackFocusLine || firstLine < 1) {
      return code
    }

    const requestedEndLine = Math.max(
      firstLine,
      Math.floor(fallbackFocusEndLine ?? firstLine)
    )
    const lastLine = Math.min(
      requestedEndLine,
      firstLine + maxFocusedFallbackLines - 1
    )
    let startOffset = 0

    for (let line = 1; line < firstLine; line += 1) {
      const newlineIndex = code.indexOf("\n", startOffset)

      if (newlineIndex === -1) {
        return code
      }

      startOffset = newlineIndex + 1
    }

    let endOffset = startOffset
    const focusedLines: string[] = []

    for (let line = firstLine; line <= lastLine; line += 1) {
      const newlineIndex = code.indexOf("\n", endOffset)

      if (newlineIndex === -1) {
        focusedLines.push(code.slice(endOffset))
        endOffset = code.length
        break
      }

      focusedLines.push(code.slice(endOffset, newlineIndex))
      endOffset = newlineIndex + 1
    }

    if (focusedLines.length === 0) {
      return code
    }

    return (
      <>
        {code.slice(0, startOffset)}
        {focusedLines.map((line, index) => (
          <span
            className="line"
            data-line-number={firstLine + index}
            key={firstLine + index}
          >
            {line || " "}
          </span>
        ))}
        {code.slice(endOffset)}
      </>
    )
  }, [
    code,
    fallbackFocusEndLine,
    fallbackFocusLine,
    renderFallbackLines,
  ])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )
  return numberedHighlightedHtml ? (
    <div
      data-code-scroll-container
      className={classNames}
      dangerouslySetInnerHTML={{ __html: numberedHighlightedHtml }}
      {...props}
    />
  ) : (
    <div data-code-scroll-container className={classNames} {...props}>
      <pre>
        <code>{fallbackContent}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
