export type StudioFilePreviewKind =
  | "code"
  | "markdown"
  | "image"
  | "pdf"
  | "document"
  | "presentation"
  | "spreadsheet"
  | "notebook"
  | "molecule"
  | "binary"
  | "text"
  | "unsupported"

export type StudioFileTone =
  "blue" | "cyan" | "gold" | "green" | "orange" | "purple" | "red" | "slate"

export type StudioFileDescriptor = {
  extension: string
  iconLabel: string
  kind: StudioFilePreviewKind
  language: string
  tone: StudioFileTone
}

type StudioFileDescriptorDefinition = Omit<StudioFileDescriptor, "extension">

const CODE_FILE_DESCRIPTORS = {
  ts: { iconLabel: "TS", kind: "code", language: "typescript", tone: "blue" },
  tsx: { iconLabel: "TS", kind: "code", language: "tsx", tone: "blue" },
  js: { iconLabel: "JS", kind: "code", language: "javascript", tone: "gold" },
  jsx: { iconLabel: "JS", kind: "code", language: "jsx", tone: "gold" },
  mjs: { iconLabel: "JS", kind: "code", language: "javascript", tone: "gold" },
  cjs: { iconLabel: "JS", kind: "code", language: "javascript", tone: "gold" },
  json: { iconLabel: "{}", kind: "code", language: "json", tone: "gold" },
  jsonc: { iconLabel: "{}", kind: "code", language: "jsonc", tone: "gold" },
  jsonl: { iconLabel: "{}", kind: "code", language: "json", tone: "gold" },
  py: { iconLabel: "PY", kind: "code", language: "python", tone: "blue" },
  go: { iconLabel: "GO", kind: "code", language: "go", tone: "cyan" },
  rs: { iconLabel: "RS", kind: "code", language: "rust", tone: "orange" },
  java: { iconLabel: "JV", kind: "code", language: "java", tone: "red" },
  c: { iconLabel: "C", kind: "code", language: "c", tone: "blue" },
  h: { iconLabel: "H", kind: "code", language: "c", tone: "purple" },
  hpp: { iconLabel: "H+", kind: "code", language: "cpp", tone: "purple" },
  cpp: { iconLabel: "C+", kind: "code", language: "cpp", tone: "blue" },
  cs: { iconLabel: "C#", kind: "code", language: "csharp", tone: "purple" },
  dart: { iconLabel: "D", kind: "code", language: "dart", tone: "blue" },
  clj: { iconLabel: "CLJ", kind: "code", language: "clojure", tone: "green" },
  cljs: { iconLabel: "CLJ", kind: "code", language: "clojure", tone: "green" },
  coffee: {
    iconLabel: "CF",
    kind: "code",
    language: "coffeescript",
    tone: "slate",
  },
  ex: { iconLabel: "EX", kind: "code", language: "elixir", tone: "purple" },
  exs: { iconLabel: "EX", kind: "code", language: "elixir", tone: "purple" },
  erl: { iconLabel: "ERL", kind: "code", language: "erlang", tone: "red" },
  fs: { iconLabel: "F#", kind: "code", language: "fsharp", tone: "blue" },
  fsx: { iconLabel: "F#", kind: "code", language: "fsharp", tone: "blue" },
  groovy: { iconLabel: "GR", kind: "code", language: "groovy", tone: "blue" },
  hbs: {
    iconLabel: "HB",
    kind: "code",
    language: "handlebars",
    tone: "orange",
  },
  hs: { iconLabel: "HS", kind: "code", language: "haskell", tone: "purple" },
  jl: { iconLabel: "JL", kind: "code", language: "julia", tone: "purple" },
  kt: { iconLabel: "KT", kind: "code", language: "kotlin", tone: "purple" },
  kts: { iconLabel: "KT", kind: "code", language: "kotlin", tone: "purple" },
  less: { iconLabel: "L", kind: "code", language: "less", tone: "blue" },
  lua: { iconLabel: "LUA", kind: "code", language: "lua", tone: "blue" },
  m: { iconLabel: "OC", kind: "code", language: "objective-c", tone: "blue" },
  mm: {
    iconLabel: "OC",
    kind: "code",
    language: "objective-cpp",
    tone: "blue",
  },
  ml: { iconLabel: "ML", kind: "code", language: "ocaml", tone: "orange" },
  mli: { iconLabel: "ML", kind: "code", language: "ocaml", tone: "orange" },
  pl: { iconLabel: "PL", kind: "code", language: "perl", tone: "blue" },
  pm: { iconLabel: "PL", kind: "code", language: "perl", tone: "blue" },
  php: { iconLabel: "PHP", kind: "code", language: "php", tone: "purple" },
  ps1: { iconLabel: "PS", kind: "code", language: "powershell", tone: "blue" },
  pug: { iconLabel: "PUG", kind: "code", language: "pug", tone: "orange" },
  r: { iconLabel: "R", kind: "code", language: "r", tone: "blue" },
  rb: { iconLabel: "RB", kind: "code", language: "ruby", tone: "red" },
  scala: { iconLabel: "SC", kind: "code", language: "scala", tone: "red" },
  css: { iconLabel: "#", kind: "code", language: "css", tone: "blue" },
  scss: { iconLabel: "S", kind: "code", language: "scss", tone: "purple" },
  html: { iconLabel: "<>", kind: "code", language: "html", tone: "orange" },
  htm: { iconLabel: "<>", kind: "code", language: "html", tone: "orange" },
  xml: { iconLabel: "<>", kind: "code", language: "xml", tone: "orange" },
  yaml: { iconLabel: "Y", kind: "code", language: "yaml", tone: "purple" },
  yml: { iconLabel: "Y", kind: "code", language: "yaml", tone: "purple" },
  toml: { iconLabel: "T", kind: "code", language: "toml", tone: "slate" },
  sql: { iconLabel: "DB", kind: "code", language: "sql", tone: "blue" },
  gql: { iconLabel: "GQL", kind: "code", language: "graphql", tone: "purple" },
  graphql: {
    iconLabel: "GQL",
    kind: "code",
    language: "graphql",
    tone: "purple",
  },
  ini: { iconLabel: "INI", kind: "code", language: "ini", tone: "slate" },
  conf: { iconLabel: "CFG", kind: "code", language: "ini", tone: "slate" },
  env: { iconLabel: "ENV", kind: "code", language: "dotenv", tone: "gold" },
  properties: {
    iconLabel: "CFG",
    kind: "code",
    language: "properties",
    tone: "slate",
  },
  sh: { iconLabel: ">_", kind: "code", language: "shell", tone: "green" },
  bash: { iconLabel: ">_", kind: "code", language: "shell", tone: "green" },
  zsh: { iconLabel: ">_", kind: "code", language: "shell", tone: "green" },
  diff: { iconLabel: "+-", kind: "code", language: "diff", tone: "green" },
  patch: { iconLabel: "+-", kind: "code", language: "diff", tone: "green" },
  bat: { iconLabel: "BAT", kind: "code", language: "bat", tone: "slate" },
  cmd: { iconLabel: "CMD", kind: "code", language: "bat", tone: "slate" },
  swift: { iconLabel: "SW", kind: "code", language: "swift", tone: "orange" },
  vb: { iconLabel: "VB", kind: "code", language: "vb", tone: "blue" },
  wasm: { iconLabel: "WA", kind: "binary", language: "", tone: "purple" },
  rst: { iconLabel: "RST", kind: "code", language: "rst", tone: "slate" },
  twig: { iconLabel: "TW", kind: "code", language: "twig", tone: "green" },
  yang: { iconLabel: "Y", kind: "code", language: "yang", tone: "green" },
} satisfies Record<string, StudioFileDescriptorDefinition>

const SPECIAL_CODE_FILE_DESCRIPTORS = {
  dockerfile: {
    iconLabel: "DK",
    kind: "code",
    language: "dockerfile",
    tone: "blue",
  },
  makefile: {
    iconLabel: "MK",
    kind: "code",
    language: "makefile",
    tone: "slate",
  },
  "cmakelists.txt": {
    iconLabel: "CM",
    kind: "code",
    language: "cmake",
    tone: "blue",
  },
  ".env": {
    iconLabel: "ENV",
    kind: "code",
    language: "dotenv",
    tone: "gold",
  },
  ".gitignore": {
    iconLabel: "GIT",
    kind: "code",
    language: "gitignore",
    tone: "orange",
  },
  ".editorconfig": {
    iconLabel: "CFG",
    kind: "code",
    language: "ini",
    tone: "slate",
  },
  ".eslintrc": {
    iconLabel: "ES",
    kind: "code",
    language: "jsonc",
    tone: "purple",
  },
  ".npmrc": {
    iconLabel: "NPM",
    kind: "code",
    language: "properties",
    tone: "red",
  },
  ".prettierrc": {
    iconLabel: "PRE",
    kind: "code",
    language: "jsonc",
    tone: "cyan",
  },
} satisfies Record<string, StudioFileDescriptorDefinition>

const PREVIEW_FILE_DESCRIPTORS = {
  md: { iconLabel: "M↓", kind: "markdown", language: "markdown", tone: "blue" },
  mdx: {
    iconLabel: "M↓",
    kind: "markdown",
    language: "markdown",
    tone: "blue",
  },
  markdown: {
    iconLabel: "M↓",
    kind: "markdown",
    language: "markdown",
    tone: "blue",
  },
  avif: { iconLabel: "IMG", kind: "image", language: "", tone: "purple" },
  bmp: { iconLabel: "BMP", kind: "image", language: "", tone: "purple" },
  ico: { iconLabel: "ICO", kind: "image", language: "", tone: "purple" },
  png: { iconLabel: "IMG", kind: "image", language: "", tone: "purple" },
  jpg: { iconLabel: "IMG", kind: "image", language: "", tone: "purple" },
  jpeg: { iconLabel: "IMG", kind: "image", language: "", tone: "purple" },
  gif: { iconLabel: "GIF", kind: "image", language: "", tone: "purple" },
  webp: { iconLabel: "IMG", kind: "image", language: "", tone: "purple" },
  svg: { iconLabel: "SVG", kind: "image", language: "xml", tone: "orange" },
  pdf: { iconLabel: "PDF", kind: "pdf", language: "", tone: "red" },
  tex: { iconLabel: "TeX", kind: "pdf", language: "latex", tone: "red" },
  docx: { iconLabel: "W", kind: "document", language: "", tone: "blue" },
  pptx: {
    iconLabel: "P",
    kind: "presentation",
    language: "",
    tone: "orange",
  },
  csv: { iconLabel: "X", kind: "spreadsheet", language: "csv", tone: "green" },
  tsv: { iconLabel: "X", kind: "spreadsheet", language: "tsv", tone: "green" },
  xls: { iconLabel: "X", kind: "spreadsheet", language: "", tone: "green" },
  xlsx: { iconLabel: "X", kind: "spreadsheet", language: "", tone: "green" },
  ipynb: {
    iconLabel: "NB",
    kind: "notebook",
    language: "json",
    tone: "orange",
  },
  pdb: {
    iconLabel: "3D",
    kind: "molecule",
    language: "plaintext",
    tone: "purple",
  },
  txt: { iconLabel: "TXT", kind: "text", language: "plaintext", tone: "slate" },
  log: { iconLabel: "LOG", kind: "text", language: "log", tone: "slate" },
} satisfies Record<string, StudioFileDescriptorDefinition>

const UNSUPPORTED_FILE_DESCRIPTOR: StudioFileDescriptorDefinition = {
  iconLabel: "FILE",
  kind: "unsupported",
  language: "plaintext",
  tone: "slate",
}

const EXTENSIONLESS_TEXT_FILE_DESCRIPTOR: StudioFileDescriptorDefinition = {
  iconLabel: "TXT",
  kind: "text",
  language: "plaintext",
  tone: "slate",
}

function extensionsForKind(kind: StudioFilePreviewKind): ReadonlySet<string> {
  return new Set(
    Object.entries(PREVIEW_FILE_DESCRIPTORS)
      .filter(([, descriptor]) => descriptor.kind === kind)
      .map(([extension]) => extension)
  )
}

export const STUDIO_CODE_FILE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.keys(CODE_FILE_DESCRIPTORS)
)

export const STUDIO_SPECIAL_CODE_FILE_NAMES: ReadonlySet<string> = new Set(
  Object.keys(SPECIAL_CODE_FILE_DESCRIPTORS)
)

export const STUDIO_MARKDOWN_FILE_EXTENSIONS = extensionsForKind("markdown")
export const STUDIO_IMAGE_FILE_EXTENSIONS = extensionsForKind("image")
export const STUDIO_PDF_FILE_EXTENSIONS = extensionsForKind("pdf")
export const STUDIO_DOCUMENT_FILE_EXTENSIONS = extensionsForKind("document")
export const STUDIO_PRESENTATION_FILE_EXTENSIONS =
  extensionsForKind("presentation")
export const STUDIO_SPREADSHEET_FILE_EXTENSIONS =
  extensionsForKind("spreadsheet")
export const STUDIO_NOTEBOOK_FILE_EXTENSIONS = extensionsForKind("notebook")
export const STUDIO_MOLECULE_FILE_EXTENSIONS = extensionsForKind("molecule")
export const STUDIO_TEXT_FILE_EXTENSIONS = extensionsForKind("text")

export const STUDIO_FILE_PREVIEW_SUPPORT = [
  {
    kind: "code",
    label: { en: "Code and text", zh: "代码与文本" },
    extensions:
      "ts tsx js jsx mjs cjs json jsonc jsonl py go rs java c h hpp cpp cs dart clj cljs coffee ex exs erl fs fsx groovy hbs hs jl kt kts less lua m mm ml mli pl pm php ps1 pug r rb scala css scss html htm xml yaml yml toml sql gql graphql ini conf env properties sh bash zsh diff patch bat cmd swift vb rst twig yang Dockerfile Makefile CMakeLists.txt .env .gitignore .editorconfig .eslintrc .npmrc .prettierrc",
  },
  {
    kind: "markdown",
    label: { en: "Markdown", zh: "Markdown" },
    extensions: "md mdx markdown",
  },
  {
    kind: "image",
    label: { en: "Images", zh: "图片" },
    extensions: "avif bmp gif ico jpeg jpg png svg webp",
  },
  {
    kind: "pdf",
    label: { en: "PDF / TeX", zh: "PDF / TeX" },
    extensions: "pdf tex",
  },
  {
    kind: "document",
    label: { en: "Documents", zh: "文档" },
    extensions: "docx",
  },
  {
    kind: "presentation",
    label: { en: "Presentations", zh: "演示文稿" },
    extensions: "pptx",
  },
  {
    kind: "spreadsheet",
    label: { en: "Spreadsheets", zh: "电子表格" },
    extensions: "csv tsv xls xlsx",
  },
  {
    kind: "notebook",
    label: { en: "Notebooks", zh: "Notebook" },
    extensions: "ipynb",
  },
  {
    kind: "molecule",
    label: { en: "Molecules", zh: "分子结构" },
    extensions: "pdb",
  },
  {
    kind: "binary",
    label: { en: "Binary modules", zh: "二进制模块" },
    extensions: "wasm",
  },
] as const

export function getStudioFileExtension(path: string) {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path
  const fileName = cleanPath.split(/[\\/]/).at(-1) ?? ""
  const dotIndex = fileName.lastIndexOf(".")

  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ""
}

export function getStudioFileDescriptor(path: string): StudioFileDescriptor {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path
  const fileName = cleanPath.split(/[\\/]/).at(-1)?.toLowerCase() ?? ""
  const extension = getStudioFileExtension(cleanPath)
  const descriptor =
    SPECIAL_CODE_FILE_DESCRIPTORS[
      fileName as keyof typeof SPECIAL_CODE_FILE_DESCRIPTORS
    ] ??
    (fileName.startsWith(".env.")
      ? SPECIAL_CODE_FILE_DESCRIPTORS[".env"]
      : undefined) ??
    CODE_FILE_DESCRIPTORS[extension as keyof typeof CODE_FILE_DESCRIPTORS] ??
    PREVIEW_FILE_DESCRIPTORS[
      extension as keyof typeof PREVIEW_FILE_DESCRIPTORS
    ] ??
    (extension
      ? UNSUPPORTED_FILE_DESCRIPTOR
      : EXTENSIONLESS_TEXT_FILE_DESCRIPTOR)

  return { ...descriptor, extension }
}

export function isStudioFilePreviewable(path: string) {
  return getStudioFileDescriptor(path).kind !== "unsupported"
}
