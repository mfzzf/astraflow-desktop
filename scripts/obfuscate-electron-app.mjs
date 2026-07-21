import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import JavaScriptObfuscator from "javascript-obfuscator"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptDir, "..")
const appDir = join(root, "dist", "electron-app")
const electronDir = join(appDir, "electron")

// Light packaging-time obfuscation for Electron main/preload scripts only.
// Keep options conservative so IPC / native requires keep working.
const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
}

function walkJsFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }

  const files = []

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      files.push(...walkJsFiles(path))
      continue
    }

    if (stat.isFile() && extname(path) === ".cjs") {
      files.push(path)
    }
  }

  return files
}

if (!existsSync(appDir)) {
  throw new Error(
    `Missing packaged app directory: ${appDir}. Run electron prepare first.`
  )
}

if (!existsSync(electronDir)) {
  throw new Error(`Missing packaged electron directory: ${electronDir}`)
}

const targets = walkJsFiles(electronDir)

if (targets.length === 0) {
  throw new Error(`No Electron .cjs files found under ${electronDir}`)
}

for (const file of targets) {
  const source = readFileSync(file, "utf8")
  const result = JavaScriptObfuscator.obfuscate(source, {
    ...obfuscatorOptions,
    inputFileName: relative(appDir, file),
  })
  writeFileSync(file, result.getObfuscatedCode())
  console.log(`Obfuscated ${relative(root, file)}`)
}

console.log(`Obfuscated ${targets.length} Electron script(s).`)
