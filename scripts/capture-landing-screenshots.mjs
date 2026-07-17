import { spawn } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"

import { chromium } from "playwright"
import sharp from "sharp"

import {
  FIXED_NOW,
  resolveLandingDemoResponse,
} from "../tests/fixtures/landing-demo/routes.mjs"

const root = resolve(import.meta.dirname, "..")
const outputDir = join(root, "public", "screenshots")
const screenshotBuildDir = join(root, ".next-screenshot")
const temporaryRoot = mkdtempSync(join(tmpdir(), "astraflow-screenshots-"))
const userDataPath = join(temporaryRoot, "user-data")
const tsconfigPath = join(root, "tsconfig.json")
const originalTsconfig = readFileSync(tsconfigPath)
const require = createRequire(import.meta.url)
const electronExecutable = require("electron")
const screenshotWidth = 1920
const screenshotHeight = 1080
const screenshotScaleFactor = 2
const outputWidth = screenshotWidth * screenshotScaleFactor
const outputHeight = screenshotHeight * screenshotScaleFactor

const captures = [
  {
    name: "studio",
    path: "/studio/chat/demo-research",
    readyText: "2026 AI 行业趋势报告",
  },
  {
    name: "skills",
    path: "/skills",
    readyText: "深度研究助手",
    crop: { left: 320, top: 20, width: 960, height: 460 },
    prepare: async (page) => {
      await page.getByRole("button", { name: "技能", exact: true }).click()
    },
  },
  {
    name: "automation",
    path: "/automations",
    readyText: "每日 AI 行业简报",
    crop: { left: 320, top: 0, width: 1190, height: 250 },
    prepare: async (page) => {
      await page
        .getByText("每日 AI 行业简报", { exact: true })
        .first()
        .click()
    },
  },
]

mkdirSync(userDataPath, { recursive: true })
mkdirSync(outputDir, { recursive: true })
for (const extension of ["png", "webp", "avif"]) {
  rmSync(join(outputDir, `models.${extension}`), { force: true })
}
writeFileSync(join(userDataPath, "studio-onboarding-v1.state"), "done\n")

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(port)
      })
    })
  })
}

async function waitForCdp(port, child) {
  const endpoint = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before CDP was ready (${child.exitCode}).`)
    }

    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return endpoint
    } catch {
      // Electron is still starting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }

  throw new Error("Timed out waiting for Electron's CDP endpoint.")
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return

  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ])

  if (child.exitCode === null) child.kill("SIGKILL")
}

let browser
let screenshotProcess

try {
  const debuggingPort = await reservePort()
  screenshotProcess = spawn(
    electronExecutable,
    [
      `--remote-debugging-port=${debuggingPort}`,
      "--remote-allow-origins=*",
      `--force-device-scale-factor=${screenshotScaleFactor}`,
      root,
    ],
    {
    cwd: root,
    env: {
      ...process.env,
      ASTRAFLOW_DEMO_MODE: "1",
      ASTRAFLOW_DEMO_SCENARIO: "research",
      ASTRAFLOW_ELECTRON_DEV: "1",
      ASTRAFLOW_ELECTRON_SCREENSHOT: "1",
      ASTRAFLOW_ELECTRON_SCREENSHOT_USER_DATA: userDataPath,
      ASTRAFLOW_ELECTRON_SCREENSHOT_WIDTH: String(screenshotWidth),
      ASTRAFLOW_ELECTRON_SCREENSHOT_HEIGHT: String(screenshotHeight),
      LANG: "zh_CN.UTF-8",
      LC_ALL: "zh_CN.UTF-8",
      NEXT_TELEMETRY_DISABLED: "1",
      TZ: "Asia/Shanghai",
    },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  screenshotProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk)
  })
  screenshotProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk)
  })

  const cdpEndpoint = await waitForCdp(debuggingPort, screenshotProcess)
  browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 120_000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent("page"))
  await page.waitForFunction(() => window.location.hash.length > 1, null, {
    timeout: 120_000,
  })
  const encodedServerUrl = new URL(page.url()).hash.slice(1)
  const serverUrl = decodeURIComponent(encodedServerUrl)

  if (!serverUrl.startsWith("http://127.0.0.1:")) {
    throw new Error(`Unexpected screenshot server URL: ${serverUrl}`)
  }

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(
    ({ fixedNow }) => {
      const NativeDate = Date
      const timestamp = NativeDate.parse(fixedNow)

      class FixedDate extends NativeDate {
        constructor(...args) {
          super(...(args.length === 0 ? [timestamp] : args))
        }

        static now() {
          return timestamp
        }
      }

      Object.defineProperty(window, "Date", { value: FixedDate })
      window.localStorage.setItem("astraflow-locale", "zh")
      window.localStorage.setItem("theme", "light")
      window.localStorage.setItem("app-shell:sidebar-open", "true")
      window.localStorage.setItem("astraflow:chat-model", "glm-5.2")
      window.localStorage.setItem("astraflow:chat-reasoning-effort", "max")
      window.localStorage.setItem(
        "astraflow-chat-defaults",
        JSON.stringify({
          runtimeId: "astraflow",
          model: "glm-5.2",
          reasoningEffort: "max",
        })
      )
    },
    { fixedNow: FIXED_NOW }
  )

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const localOrigin = new URL(serverUrl).origin

    if (url.origin === localOrigin && !url.pathname.startsWith("/api/")) {
      await route.continue()
      return
    }

    if (url.origin === localOrigin && url.pathname.startsWith("/api/")) {
      const response = resolveLandingDemoResponse(
        request.url(),
        request.method()
      )
      await route.fulfill({
        status: response.status,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(response.body),
      })
      return
    }

    await route.abort("blockedbyclient")
  })

  for (const capture of captures) {
    await page.goto(new URL(capture.path, serverUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    })
    await capture.prepare?.(page)
    await page.getByText(capture.readyText, { exact: false }).first().waitFor({
      state: "visible",
      timeout: 60_000,
    })
    await page.waitForFunction(() =>
      Array.from(document.images).every(
        (image) => image.complete && image.naturalWidth > 0
      )
    )
    await page.evaluate(async () => {
      await document.fonts.ready
      const style = document.createElement("style")
      style.dataset.astraflowScreenshot = "true"
      style.textContent = `
        nextjs-portal {
          display: none !important;
        }

        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }
      `
      document.head.append(style)
    })

    const pngPath = join(outputDir, `${capture.name}.png`)
    const rawPngPath = capture.crop
      ? join(temporaryRoot, `${capture.name}-raw.png`)
      : pngPath
    await page.screenshot({
      path: rawPngPath,
      animations: "disabled",
      scale: "device",
      clip: {
        x: 0,
        y: 48,
        width: screenshotWidth,
        height: screenshotHeight,
      },
    })

    const rawPngMetadata = await sharp(rawPngPath).metadata()
    if (
      rawPngMetadata.width !== outputWidth ||
      rawPngMetadata.height !== outputHeight
    ) {
      throw new Error(
        `${capture.name} raw capture is ${rawPngMetadata.width}x${rawPngMetadata.height}; expected ${outputWidth}x${outputHeight}.`
      )
    }

    if (capture.crop) {
      const crop = Object.fromEntries(
        Object.entries(capture.crop).map(([key, value]) => [
          key,
          value * screenshotScaleFactor,
        ])
      )

      await sharp(rawPngPath)
        .extract(crop)
        .resize({ width: outputWidth, kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9 })
        .toFile(pngPath)
    }

    const pngMetadata = await sharp(pngPath).metadata()
    const expectedOutputHeight = capture.crop
      ? Math.round((capture.crop.height / capture.crop.width) * outputWidth)
      : outputHeight

    if (
      pngMetadata.width !== outputWidth ||
      pngMetadata.height !== expectedOutputHeight
    ) {
      throw new Error(
        `${capture.name}.png is ${pngMetadata.width}x${pngMetadata.height}; expected ${outputWidth}x${expectedOutputHeight}.`
      )
    }

    await Promise.all([
      sharp(pngPath)
        .webp({ lossless: true, effort: 6 })
        .toFile(join(outputDir, `${capture.name}.webp`)),
      sharp(pngPath)
        .avif({ lossless: true, effort: 6, chromaSubsampling: "4:4:4" })
        .toFile(join(outputDir, `${capture.name}.avif`)),
    ])
  }

  process.stdout.write(
    `Captured ${captures.length} landing screenshots in ${outputDir}.\n`
  )
} finally {
  await browser?.close().catch(() => undefined)
  await stopProcess(screenshotProcess)
  writeFileSync(tsconfigPath, originalTsconfig)
  rmSync(screenshotBuildDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })
  rmSync(temporaryRoot, { recursive: true, force: true })
}
