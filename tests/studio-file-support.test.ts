// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  STUDIO_CODE_FILE_EXTENSIONS,
  STUDIO_SPECIAL_CODE_FILE_NAMES,
  getStudioFileDescriptor,
  getStudioFileExtension,
  isStudioFileLikePath,
  isStudioFilePath,
  isStudioFilePreviewable,
  type StudioFilePreviewKind,
} from "@/lib/studio-file-support"

const expectedCodeExtensions = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "jsonl",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "hpp",
  "cpp",
  "cs",
  "dart",
  "clj",
  "cljs",
  "coffee",
  "ex",
  "exs",
  "erl",
  "fs",
  "fsx",
  "groovy",
  "hbs",
  "hs",
  "jl",
  "kt",
  "kts",
  "less",
  "lua",
  "m",
  "mm",
  "ml",
  "mli",
  "pl",
  "pm",
  "php",
  "ps1",
  "pug",
  "r",
  "rb",
  "scala",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sql",
  "gql",
  "graphql",
  "ini",
  "conf",
  "env",
  "properties",
  "sh",
  "bash",
  "zsh",
  "diff",
  "patch",
  "bat",
  "cmd",
  "swift",
  "vb",
  "wasm",
  "rst",
  "twig",
  "yang",
] as const

describe("studio file support", () => {
  test("keeps the complete ChatGPT code extension matrix", () => {
    expect([...STUDIO_CODE_FILE_EXTENSIONS]).toEqual(expectedCodeExtensions)

    for (const extension of expectedCodeExtensions) {
      expect(getStudioFileDescriptor(`src/example.${extension}`).kind).toBe(
        extension === "wasm" ? "binary" : "code"
      )
    }
  })

  test("recognizes every special code filename case-insensitively", () => {
    expect([...STUDIO_SPECIAL_CODE_FILE_NAMES]).toEqual([
      "dockerfile",
      "makefile",
      "cmakelists.txt",
      ".env",
      ".gitignore",
      ".editorconfig",
      ".eslintrc",
      ".npmrc",
      ".prettierrc",
    ])

    expect(getStudioFileDescriptor("infra/Dockerfile")).toMatchObject({
      extension: "",
      kind: "code",
      language: "dockerfile",
    })
    expect(getStudioFileDescriptor("MAKEFILE")).toMatchObject({
      kind: "code",
      language: "makefile",
    })
    expect(getStudioFileDescriptor("native/CMakeLists.txt")).toMatchObject({
      extension: "txt",
      kind: "code",
      language: "cmake",
    })
    expect(getStudioFileDescriptor(".ENV")).toMatchObject({
      extension: "",
      kind: "code",
      language: "dotenv",
    })
    expect(getStudioFileDescriptor(".GITIGNORE")).toMatchObject({
      extension: "",
      kind: "code",
      language: "gitignore",
    })
    expect(getStudioFileDescriptor(".ENV.LOCAL")).toMatchObject({
      kind: "code",
      language: "dotenv",
    })
    expect(getStudioFileDescriptor(".PRETTIERRC")).toMatchObject({
      kind: "code",
      language: "jsonc",
    })
  })

  test("classifies every preview kind", () => {
    const cases: Array<[string, StudioFilePreviewKind]> = [
      ["component.tsx", "code"],
      ["README.md", "markdown"],
      ["preview.png", "image"],
      ["paper.pdf", "pdf"],
      ["report.docx", "document"],
      ["deck.pptx", "presentation"],
      ["metrics.xlsx", "spreadsheet"],
      ["analysis.ipynb", "notebook"],
      ["protein.pdb", "molecule"],
      ["module.wasm", "binary"],
      ["server.log", "text"],
      ["LICENSE", "text"],
      ["archive.zip", "unsupported"],
    ]

    for (const [path, kind] of cases) {
      expect(getStudioFileDescriptor(path).kind).toBe(kind)
    }
  })

  test("normalizes extensions and ignores query strings and fragments", () => {
    expect(getStudioFileExtension("C:\\Work\\REPORT.MDX?raw=1#L8")).toBe("mdx")
    expect(
      getStudioFileDescriptor("C:\\Work\\REPORT.MDX?raw=1#L8")
    ).toMatchObject({
      extension: "mdx",
      kind: "markdown",
      language: "markdown",
    })
  })

  test("reports whether a path can be previewed", () => {
    expect(isStudioFilePreviewable("src/main.swift")).toBe(true)
    expect(isStudioFilePreviewable("notes.txt")).toBe(true)
    expect(isStudioFilePreviewable("bundle.zip")).toBe(false)
  })

  test("recognizes previewable, downloadable, and unknown file paths", () => {
    expect(isStudioFileLikePath("slides/demo.pptx")).toBe(true)
    expect(isStudioFileLikePath("archives/bundle.zip")).toBe(true)
    expect(isStudioFileLikePath("outputs/result.custom-format")).toBe(true)
    expect(isStudioFileLikePath("infra/Dockerfile")).toBe(true)
    expect(isStudioFileLikePath(".env.local")).toBe(true)
    expect(isStudioFileLikePath("LICENSE")).toBe(false)
    expect(isStudioFileLikePath("folder/")).toBe(false)

    expect(isStudioFilePath("LICENSE")).toBe(true)
    expect(isStudioFilePath("arbitrary-extensionless-output")).toBe(true)
    expect(isStudioFilePath("folder/")).toBe(false)
  })
})
