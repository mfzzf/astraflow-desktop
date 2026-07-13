import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

const root = process.cwd()
const distDir = join(root, "dist", "electron")
const timeoutMs = 120_000

function walk(directory) {
  const entries = []

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)

    if (stats.isDirectory()) {
      entries.push(...walk(absolutePath))
    } else {
      entries.push(absolutePath)
    }
  }

  return entries
}

function findPackagedExecutable() {
  const files = walk(distDir)

  if (process.platform === "darwin") {
    return files.find((file) => file.endsWith(".app/Contents/MacOS/AstraFlow"))
  }

  if (process.platform === "win32") {
    return files.find(
      (file) => file.includes("win-unpacked") && file.endsWith("AstraFlow.exe")
    )
  }

  return files.find((file) =>
    ["AstraFlow", "astraflow", "astraflow-desktop"].some(
      (name) => file.includes("linux-unpacked") && file.endsWith(`/${name}`)
    )
  )
}

function getPackagedAppRoot(executable) {
  if (process.platform === "darwin") {
    return join(dirname(executable), "..", "Resources", "app")
  }

  return join(dirname(executable), "resources", "app")
}

function runChecked(command, args, options, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with code ${result.status}: ${
        result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      }`
    )
  }
}

function smokeBundledDocumentRuntime(executable) {
  const appRoot = getPackagedAppRoot(executable)
  const runtimeTarget = `${process.platform}-${process.arch}`
  const pythonRoot = join(appRoot, "runtime", "python", runtimeTarget)
  const pythonExecutable =
    process.platform === "win32"
      ? join(pythonRoot, "python.exe")
      : join(pythonRoot, "bin", "python3")
  const nodeModulesRoot = join(appRoot, "node_modules")

  for (const slug of ["pptx", "xlsx", "docx", "pdf"]) {
    const skillPath = join(appRoot, "bundled-skills", slug, "SKILL.md")

    if (!existsSync(skillPath)) {
      throw new Error(`Packaged bundled skill is missing: ${skillPath}`)
    }
  }

  if (!existsSync(pythonExecutable)) {
    throw new Error(`Packaged Python is missing: ${pythonExecutable}`)
  }

  runChecked(
    pythonExecutable,
    [
      "-c",
      [
        "import defusedxml, docx, lxml, markitdown, openpyxl, pandas",
        "import pdf2image, pdfplumber, PIL, pptx, pypdf, pypdfium2",
        "import pytesseract, reportlab, xlsxwriter",
        "print('packaged-python-ok')",
      ].join("; "),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONHOME: pythonRoot,
        PYTHONNOUSERSITE: "1",
      },
    },
    "Packaged Python document runtime smoke test"
  )

  runChecked(
    executable,
    [
      "-e",
      [
        "require('docx')",
        "require('pdf-lib')",
        "require('pptxgenjs')",
        "require('react')",
        "require('react-dom/server')",
        "require('react-icons/fa')",
        "require('sharp')",
        "require('@napi-rs/canvas')",
        "import('pdfjs-dist/legacy/build/pdf.mjs').then(() => console.log('packaged-node-documents-ok')).catch((error) => { console.error(error); process.exitCode = 1 })",
      ].join("; "),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: nodeModulesRoot,
      },
    },
    "Packaged Node.js document runtime smoke test"
  )
}

const executable = findPackagedExecutable()
const smokeArgs = process.platform === "linux" ? ["--no-sandbox"] : []
const smokeEnv =
  process.platform === "linux"
    ? {
        ELECTRON_DISABLE_SANDBOX: "1",
      }
    : {}

if (!executable) {
  throw new Error(
    `Could not find a packaged AstraFlow executable in ${distDir}.`
  )
}

smokeBundledDocumentRuntime(executable)

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, smokeArgs, {
    env: {
      ...process.env,
      ASTRAFLOW_ELECTRON_SMOKE: "1",
      ELECTRON_ENABLE_LOGGING: "1",
      ...smokeEnv,
    },
    stdio: "inherit",
    windowsHide: true,
  })

  const timeout = setTimeout(() => {
    child.kill()
    rejectRun(new Error(`Electron smoke run timed out: ${executable}`))
  }, timeoutMs)

  child.once("error", (error) => {
    clearTimeout(timeout)
    rejectRun(error)
  })

  child.once("exit", (code, signal) => {
    clearTimeout(timeout)

    if (code === 0) {
      resolveRun()
      return
    }

    rejectRun(
      new Error(
        `Electron smoke run failed with code ${code ?? "null"} and signal ${
          signal ?? "null"
        }.`
      )
    )
  })
})
