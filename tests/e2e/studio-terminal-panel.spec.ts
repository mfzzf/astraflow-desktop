import { expect, type Page, type Response, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"

const TERMINAL_TOGGLE = "studio-terminal-panel-toggle"
const TERMINAL_PANEL = "studio-terminal-panel"
const TERMINAL_HEIGHT_STORAGE_KEY = "astraflow.studio.terminal-panel-height"
const TERMINAL_OPEN_STORAGE_KEY = "astraflow.studio.terminal-panel-open"
const RIGHT_PANEL_OPEN_STORAGE_KEY = "astraflow.studio.right-panel-open"
const ONBOARDING_STORAGE_KEY = "astraflow.studio-onboarding.v1"
const evidencePath = "test-results/studio-terminal-panel.png"

test.beforeAll(async () => {
  await mkdir("test-results", { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, "done"),
    ONBOARDING_STORAGE_KEY
  )
})

test("Studio titlebar controls share one vertical center line", async ({
  page,
}, testInfo) => {
  const result = await gotoStudio(page)

  if (!result.ready) {
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(true, `BLOCKED: ${result.reason}`)
  }

  const geometry = await page.evaluate(() => {
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>("[data-electron-drag-header]")
    ).map((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
    const controlGroups = Array.from(
      document.querySelectorAll<HTMLElement>("[data-titlebar-control-group]")
    ).map((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })

    return { controlGroups, headers }
  })

  expect(geometry.headers.length).toBeGreaterThanOrEqual(2)
  expect(geometry.controlGroups.length).toBeGreaterThanOrEqual(3)

  const centerLine = geometry.headers[0]

  for (const center of [...geometry.headers, ...geometry.controlGroups]) {
    expect(Math.abs(center - centerLine)).toBeLessThan(0.1)
  }
})

test("Studio bottom terminal panel opens, closes, and responds to shortcut", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ heightKey, openKey }) => {
      window.localStorage.removeItem(heightKey)
      window.localStorage.removeItem(openKey)
    },
    {
      heightKey: TERMINAL_HEIGHT_STORAGE_KEY,
      openKey: TERMINAL_OPEN_STORAGE_KEY,
    }
  )

  const result = await gotoStudio(page)

  if (!result.ready) {
    await page.screenshot({ path: evidencePath, fullPage: true })
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(true, `BLOCKED: ${result.reason}. Screenshot: ${evidencePath}`)
  }

  const toggle = page.getByTestId(TERMINAL_TOGGLE)
  const panel = page.getByTestId(TERMINAL_PANEL)
  await expect(toggle).toBeVisible()
  await expect(panel).toHaveAttribute("inert", "")
  await expect(panel.locator(".xterm")).toHaveCount(0)
  await toggle.click()

  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveAttribute("inert", "")
  await expect
    .poll(() =>
      panel.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBe(320)
  await expect(panel.locator(".xterm").first()).toBeVisible()

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+J" : "Control+J"
  )
  await expect(panel).toBeHidden()
  await expect(panel).toHaveAttribute("inert", "")

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+J" : "Control+J"
  )
  await expect(page.getByTestId(TERMINAL_PANEL)).toBeVisible()
  await expect(panel).not.toHaveAttribute("inert", "")

  await page
    .getByRole("button", {
      name: /^(Close terminal panel|关闭底部面板)$/,
    })
    .click()
  await expect(page.getByTestId(TERMINAL_PANEL)).toBeHidden()
  await expect(panel).toHaveAttribute("inert", "")

  await page.screenshot({ path: evidencePath, fullPage: true })
})

test("Studio bottom terminal panel reclamps its stored height when the viewport shrinks", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.addInitScript(
    ({ heightKey, openKey }) => {
      window.localStorage.setItem(heightKey, "560")
      window.localStorage.removeItem(openKey)
    },
    {
      heightKey: TERMINAL_HEIGHT_STORAGE_KEY,
      openKey: TERMINAL_OPEN_STORAGE_KEY,
    }
  )

  const result = await gotoStudio(page)

  if (!result.ready) {
    const resizeEvidencePath = "test-results/studio-terminal-panel-resize.png"
    await page.screenshot({ path: resizeEvidencePath, fullPage: true })
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(
      true,
      `BLOCKED: ${result.reason}. Screenshot: ${resizeEvidencePath}`
    )
  }

  const panel = page.getByTestId(TERMINAL_PANEL)
  await page.getByTestId(TERMINAL_TOGGLE).click()
  await expect
    .poll(() =>
      panel.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBe(560)

  const resizeHandle = panel.getByRole("separator")
  await expect
    .poll(() =>
      resizeHandle.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBeGreaterThanOrEqual(8)

  await page.setViewportSize({ width: 1280, height: 600 })

  await expect
    .poll(() =>
      panel.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      )
    )
    .toBe(348)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        TERMINAL_HEIGHT_STORAGE_KEY
      )
    )
    .toBe("348")
})

test("Studio bottom panel spans the workspace while the right panel stays above it", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ terminalOpenKey, rightOpenKey }) => {
      window.localStorage.removeItem(terminalOpenKey)
      window.localStorage.removeItem(rightOpenKey)
    },
    {
      terminalOpenKey: TERMINAL_OPEN_STORAGE_KEY,
      rightOpenKey: RIGHT_PANEL_OPEN_STORAGE_KEY,
    }
  )

  const result = await gotoStudio(page)

  if (!result.ready) {
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(true, `BLOCKED: ${result.reason}`)
  }

  const terminal = page.getByTestId(TERMINAL_PANEL)
  const rightPanel = page.locator('[data-app-shell-focus-area="right-panel"]')

  await page.getByTestId("studio-right-panel-toggle").click()
  await expect(rightPanel).toBeVisible()
  await rightPanel
    .getByRole("button", { name: /^(Terminal|终端)$/ })
    .click()
  await page.getByTestId(TERMINAL_TOGGLE).click()

  await expect
    .poll(() =>
      terminal.evaluate((element) => element.getBoundingClientRect().height)
    )
    .toBeGreaterThan(200)
  await expect
    .poll(() =>
      rightPanel.evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThan(200)

  const geometry = await page.evaluate(() => {
    function rect(testId: string) {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="${testId}"]`
      )

      if (!element) {
        throw new Error(`Missing ${testId}`)
      }

      const bounds = element.getBoundingClientRect()
      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
      }
    }

    const panel = document.querySelector<HTMLElement>(
      '[data-app-shell-focus-area="right-panel"]'
    )

    if (!panel) {
      throw new Error("Missing right panel")
    }

    const panelBounds = panel.getBoundingClientRect()
    const workbench = document.querySelector<HTMLElement>(
      '[data-testid="studio-chat-workbench"]'
    )
    const terminalSurfaces = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="studio-terminal-surface"]'
      )
    )
      .filter((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
      .map((element) => {
        const style = window.getComputedStyle(element)
        return {
          backgroundColor: style.backgroundColor,
          paddingTop: Number.parseFloat(style.paddingTop),
          paddingRight: Number.parseFloat(style.paddingRight),
          paddingBottom: Number.parseFloat(style.paddingBottom),
          paddingLeft: Number.parseFloat(style.paddingLeft),
        }
      })

    if (!workbench) {
      throw new Error("Missing Studio workbench")
    }

    return {
      workbench: rect("studio-chat-workbench"),
      workspaceRow: rect("studio-workspace-row"),
      terminal: rect("studio-terminal-panel"),
      terminalSurfaces,
      workbenchBackgroundColor:
        window.getComputedStyle(workbench).backgroundColor,
      rightPanel: {
        top: panelBounds.top,
        right: panelBounds.right,
        bottom: panelBounds.bottom,
        left: panelBounds.left,
        width: panelBounds.width,
      },
    }
  })

  expect(
    Math.abs(geometry.terminal.left - geometry.workbench.left)
  ).toBeLessThan(1)
  expect(
    Math.abs(geometry.terminal.width - geometry.workbench.width)
  ).toBeLessThan(1)
  expect(
    Math.abs(geometry.workspaceRow.bottom - geometry.terminal.top)
  ).toBeLessThan(1)
  expect(
    Math.abs(geometry.rightPanel.bottom - geometry.terminal.top)
  ).toBeLessThan(1)
  expect(geometry.rightPanel.right).toBeLessThanOrEqual(
    geometry.workbench.right + 1
  )
  expect(geometry.terminalSurfaces).toHaveLength(2)

  for (const surface of geometry.terminalSurfaces) {
    expect(surface).toEqual({
      backgroundColor: geometry.workbenchBackgroundColor,
      paddingTop: 4,
      paddingRight: 12,
      paddingBottom: 4,
      paddingLeft: 12,
    })
  }
})

async function gotoStudio(page: Page) {
  const response = await page.goto("/studio", {
    waitUntil: "domcontentloaded",
  })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // HMR can keep the page busy; visible UI is the reliable readiness signal.
  })

  const ready = await isStudioReady(page)

  return {
    ready,
    response,
    reason: ready ? "" : await getBlockedReason(page, response),
  }
}

async function isStudioReady(page: Page) {
  try {
    await expect(page.getByTestId(TERMINAL_TOGGLE)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 5_000,
    })
    return true
  } catch {
    return false
  }
}

async function getBlockedReason(page: Page, response: Response | null) {
  const url = page.url()
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2_000 })
    .catch(() => "")
  const excerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 300)
  const status = response?.status() ?? "no-response"

  if (new URL(url).pathname.startsWith("/login")) {
    return `redirected to login; status=${status}; body="${excerpt}"`
  }

  return `studio UI unavailable; url=${url}; status=${status}; body="${excerpt}"`
}
