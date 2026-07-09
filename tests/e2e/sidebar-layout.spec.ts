import { expect, type Locator, test } from "@playwright/test"

const SIDEBAR_TOGGLE_NAME = /^(Toggle sidebar|切换边栏)$/
const MODEL_SEARCH_NAME = /^(Search models|搜索模型)$/

test("sidebar controls, shortcut, page inset, and edge hover stay synchronized", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/explore", {
    waitUntil: "domcontentloaded",
  })
  const search = page.getByRole("searchbox", { name: MODEL_SEARCH_NAME })
  const ready = await search
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false)

  if (!ready) {
    const reason = `Models page unavailable; url=${page.url()}; status=${response?.status() ?? "no-response"}`
    testInfo.annotations.push({ type: "blocked", description: reason })
    test.skip(true, `BLOCKED: ${reason}`)
  }

  const pageInset = search.locator("xpath=ancestor::main[1]/*[1]")
  const shellCollapsed = page.locator('[data-app-shell-left-collapsed="true"]')
  const floatingSidebar = page.locator(
    '[data-pip-obstacle="desktop-shell-floating-left-panel"]'
  )
  const sidebarEdge = page.locator("[data-app-shell-floating-sidebar-edge]")
  const sidebarToggle = page
    .getByRole("button", { name: SIDEBAR_TOGGLE_NAME })
    .first()
  const sidebarHeader = page
    .locator('[data-slot="sidebar"] [data-electron-drag-header]')
    .first()
  const mainHeader = page
    .locator(".main-surface [data-electron-drag-header]")
    .first()

  await expectPaddingTop(pageInset, 24)
  await expectHeaderAlignment(sidebarHeader, mainHeader)
  await sidebarToggle.click()
  await expect(shellCollapsed).toBeVisible()
  await expectPaddingTop(pageInset, 64)

  const collapsedToggle = page
    .locator(".electron-collapsed-sidebar-trigger")
    .getByRole("button", { name: SIDEBAR_TOGGLE_NAME })
  const edgeBox = await sidebarEdge.boundingBox()
  const toggleBox = await collapsedToggle.boundingBox()

  expect(edgeBox).not.toBeNull()
  expect(toggleBox).not.toBeNull()
  expect(edgeBox!.y).toBeGreaterThanOrEqual(toggleBox!.y + toggleBox!.height)

  await page.mouse.move(1, toggleBox!.y + toggleBox!.height / 2)
  await expect(floatingSidebar).toHaveCount(0)
  await collapsedToggle.click()
  await expect(shellCollapsed).toHaveCount(0)
  await expectPaddingTop(pageInset, 24)

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "b",
        repeat: true,
      })
    )
  })
  await expect(shellCollapsed).toHaveCount(0)
  await expectPaddingTop(pageInset, 24)

  await sidebarToggle.click()
  await expect(shellCollapsed).toBeVisible()
  await page.mouse.move(edgeBox!.x + 1, edgeBox!.y + 20)
  await expect(floatingSidebar).toBeVisible()
  await expect(collapsedToggle).toHaveCount(0)

  await page.mouse.move(800, 400)
  await expect(floatingSidebar).toHaveCount(0)
  await page.keyboard.press("Control+B")
  await expect(shellCollapsed).toHaveCount(0)
  await expectPaddingTop(pageInset, 24)

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "b",
        metaKey: true,
      })
    )
  })
  await expect(shellCollapsed).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "b",
        metaKey: true,
      })
    )
  })
  await expect(shellCollapsed).toHaveCount(0)
})

async function expectPaddingTop(locator: Locator, expected: number) {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Number.parseFloat(window.getComputedStyle(element).paddingTop)
      )
    )
    .toBe(expected)
}

async function expectHeaderAlignment(left: Locator, main: Locator) {
  await expect(left).toBeVisible()
  await expect(main).toBeVisible()

  const [leftBox, mainBox] = await Promise.all([
    left.boundingBox(),
    main.boundingBox(),
  ])

  expect(leftBox).not.toBeNull()
  expect(mainBox).not.toBeNull()
  expect(Math.abs(leftBox!.y - mainBox!.y)).toBeLessThan(0.1)
  expect(
    Math.abs(
      leftBox!.y + leftBox!.height / 2 - (mainBox!.y + mainBox!.height / 2)
    )
  ).toBeLessThan(0.1)
}
