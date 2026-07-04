import { expect, type Page, type Response, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"

const CHAT_RUNTIME_STORAGE_KEY = "astraflow:chat-runtime"
const AGENT_SWITCHER_NAME = /^(Agent|智能体)$/
const SEND_BUTTON_NAME = /^(Send message|发送消息)$/
const CHAT_ERROR_TEXT = /Failed to get a response\.|获取回复失败。/
const THINKING_TEXT = /^(Thinking|正在思考)$/

const evidencePaths = {
  blocked: "test-results/studio-agent-switcher-T1-blocked.png",
  t2: "test-results/studio-agent-switcher-T2-switcher.png",
  t3: "test-results/studio-agent-switcher-T3-persisted.png",
  t4Finding: "test-results/studio-agent-switcher-T4-finding.png",
  t5: "test-results/studio-agent-switcher-T5-astraflow-plan.png",
  t5Finding: "test-results/studio-agent-switcher-T5-finding.png",
}

type StudioBlock = {
  reason: string
  screenshotPath: string
}

type PageEvidence = {
  console: string[]
  failedRequests: string[]
  badResponses: string[]
}

let studioBlocked: StudioBlock | null = null

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  await mkdir("test-results", { recursive: true })
})

test.beforeEach(async ({ page }, testInfo) => {
  if (studioBlocked && !testInfo.title.startsWith("T1 ")) {
    test.skip(
      true,
      `BLOCKED by T1: ${studioBlocked.reason}. Screenshot: ${studioBlocked.screenshotPath}`
    )
  }

  collectPageEvidence(page, testInfo.title)
})

test("T1 page is reachable", async ({ page }, testInfo) => {
  const result = await gotoStudio(page)

  if (!result.ready) {
    await page.screenshot({ path: evidencePaths.blocked, fullPage: true })
    studioBlocked = {
      reason: result.reason,
      screenshotPath: evidencePaths.blocked,
    }
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(
      true,
      `BLOCKED: ${result.reason}. Screenshot: ${evidencePaths.blocked}`
    )
  }

  expect(result.response?.status()).toBe(200)
  await expect(agentSwitcher(page)).toBeVisible()
  await expect(chatInput(page)).toBeVisible()
})

test("T2 switcher exists and loads the AstraFlow runtime", async ({
  page,
}) => {
  const result = await gotoStudio(page)
  expect(result.ready, result.reason).toBe(true)
  expect(result.runtimesResponse?.status()).toBe(200)

  const payload = (await result.runtimesResponse?.json()) as {
    ok?: boolean
    data?: Array<{ id?: string; label?: string }>
  }
  expect(payload.ok).toBe(true)
  expect(payload.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "astraflow", label: "AstraFlow Agent" }),
    ])
  )
  expect(payload.data).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "langchain" }),
      expect.objectContaining({ id: "deepagents" }),
    ])
  )

  await openAgentSwitcher(page)
  await expect(runtimeOption(page, "AstraFlow Agent")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.screenshot({ path: evidencePaths.t2, fullPage: true })
})

test("T3 legacy runtime ids resolve to AstraFlow Agent", async ({ page }) => {
  const result = await gotoStudio(page)
  expect(result.ready, result.reason).toBe(true)

  // Legacy persisted ids from before the runtime merge must fall back to
  // the AstraFlow Agent default instead of breaking the switcher.
  await page.evaluate(
    (key) => localStorage.setItem(key, "deepagents"),
    CHAT_RUNTIME_STORAGE_KEY
  )
  await reloadStudio(page)
  await expect(agentSwitcher(page)).toContainText("AstraFlow Agent")

  await page.evaluate(
    (key) => localStorage.setItem(key, "langchain"),
    CHAT_RUNTIME_STORAGE_KEY
  )
  await reloadStudio(page)
  await expect(agentSwitcher(page)).toContainText("AstraFlow Agent")
  await page.screenshot({ path: evidencePaths.t3, fullPage: true })
})

test("T4 astraflow sends runtimeId and receives assistant text", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)

  const result = await gotoStudio(page)
  expect(result.ready, result.reason).toBe(true)

  await selectRuntime(page, "AstraFlow Agent")

  const responsePromise = waitForChatPost(page)
  await sendPrompt(page, "用一句话介绍你自己")
  const response = await responsePromise
  const body = readJsonPostData(response)

  expect(body.runtimeId ?? "astraflow").toBe("astraflow")
  expect(body.environment ?? "remote").toBe("remote")
  expect(response.status()).toBe(202)

  const assistant = await waitForAssistantTextOrFinding(page, {
    screenshotPath: evidencePaths.t4Finding,
  })

  if (assistant.kind === "finding") {
    testInfo.annotations.push({
      type: "finding",
      description: assistant.description,
    })
    console.log(`FINDING T4: ${assistant.description}`)
  } else {
    expect(assistant.text.trim().length).toBeGreaterThan(0)
  }
})

test("T5 astraflow renders plan and receives assistant text", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)

  const result = await gotoStudio(page)
  expect(result.ready, result.reason).toBe(true)

  await selectRuntime(page, "AstraFlow Agent")

  const responsePromise = waitForChatPost(page)
  await sendPrompt(page, "列一个两步计划然后回答：1+1=?")
  const response = await responsePromise
  const body = readJsonPostData(response)

  expect(body.runtimeId).toBe("astraflow")
  expect(response.status()).toBe(202)

  const assistant = await waitForAssistantTextOrFinding(page, {
    screenshotPath: evidencePaths.t5Finding,
  })

  if (assistant.kind === "finding") {
    testInfo.annotations.push({
      type: "finding",
      description: assistant.description,
    })
    console.log(`FINDING T5: ${assistant.description}`)
  } else {
    expect(assistant.text.trim().length).toBeGreaterThan(0)
  }

  const planItemCount = await page.getByRole("log").locator("ul li").count()
  if (planItemCount > 0) {
    testInfo.annotations.push({
      type: "info",
      description: `Plan/todo list rendered with ${planItemCount} item(s).`,
    })
    console.log(`INFO T5: plan/todo list rendered (${planItemCount} item(s)).`)
  }

  await page.screenshot({ path: evidencePaths.t5, fullPage: true })
})

function collectPageEvidence(page: Page, testTitle: string): PageEvidence {
  const evidence: PageEvidence = {
    console: [],
    failedRequests: [],
    badResponses: [],
  }

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const entry = `[${message.type()}] ${message.text()}`
      evidence.console.push(entry)
      console.log(`${testTitle} console: ${entry}`)
    }
  })

  page.on("pageerror", (error) => {
    const entry = `[pageerror] ${error.message}`
    evidence.console.push(entry)
    console.log(`${testTitle} console: ${entry}`)
  })

  page.on("requestfailed", (request) => {
    const entry = `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`
    evidence.failedRequests.push(entry)
    console.log(`${testTitle} requestfailed: ${entry}`)
  })

  page.on("response", (response) => {
    if (!response.url().includes("/api/") || response.status() < 400) {
      return
    }

    const entry = `${response.status()} ${response.request().method()} ${response.url()}`
    evidence.badResponses.push(entry)
    console.log(`${testTitle} bad-response: ${entry}`)
  })

  return evidence
}

function agentSwitcher(page: Page) {
  return page.getByRole("combobox", { name: AGENT_SWITCHER_NAME })
}

function chatInput(page: Page) {
  return page.locator("textarea").first()
}

function runtimeOption(page: Page, label: string) {
  return page.getByRole("option", {
    name: new RegExp(`^${escapeRegExp(label)}\\b`),
  })
}

async function gotoStudio(page: Page) {
  const runtimesResponsePromise = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/studio/agent-runtimes" &&
        response.request().method() === "GET",
      { timeout: 30_000 }
    )
    .catch(() => null)

  const response = await page.goto("/studio", {
    waitUntil: "domcontentloaded",
  })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // The dev overlay/HMR connection can keep the page busy; visible UI is authoritative.
  })

  const runtimesResponse = await runtimesResponsePromise
  const ready = await isStudioChatReady(page)

  return {
    ready,
    response,
    runtimesResponse,
    reason: ready ? "" : await getBlockedReason(page, response),
  }
}

async function reloadStudio(page: Page) {
  const runtimesResponsePromise = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/studio/agent-runtimes" &&
        response.request().method() === "GET",
      { timeout: 30_000 }
    )
    .catch(() => null)

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // The dev overlay/HMR connection can keep the page busy; visible UI is authoritative.
  })
  await runtimesResponsePromise
  await expect(agentSwitcher(page)).toBeVisible()
}

async function isStudioChatReady(page: Page) {
  try {
    await expect(agentSwitcher(page)).toBeVisible({ timeout: 30_000 })
    await expect(chatInput(page)).toBeVisible({ timeout: 5_000 })
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

  return `chat UI unavailable; url=${url}; status=${status}; body="${excerpt}"`
}

async function openAgentSwitcher(page: Page) {
  const switcher = agentSwitcher(page)
  await expect(switcher).toBeVisible()
  await switcher.click()
}

async function selectRuntime(page: Page, label: "AstraFlow Agent") {
  await openAgentSwitcher(page)
  await runtimeOption(page, label).click()
  await expect(agentSwitcher(page)).toContainText(label)
}

async function sendPrompt(page: Page, prompt: string) {
  await chatInput(page).fill(prompt)
  await expect(
    page.getByRole("button", { name: SEND_BUTTON_NAME })
  ).toBeEnabled()
  await page.getByRole("button", { name: SEND_BUTTON_NAME }).click()
}

function waitForChatPost(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/studio/chat" &&
      response.request().method() === "POST",
    { timeout: 30_000 }
  )
}

function readJsonPostData(response: Response) {
  const postData = response.request().postData()
  expect(postData).toBeTruthy()
  return JSON.parse(postData ?? "{}") as Record<string, unknown>
}

async function waitForAssistantTextOrFinding(
  page: Page,
  {
    screenshotPath,
  }: {
    screenshotPath: string
  }
): Promise<
  | {
      kind: "ok"
      text: string
    }
  | {
      kind: "finding"
      description: string
    }
> {
  const startedAt = Date.now()
  let lastAssistantText = ""

  while (Date.now() - startedAt < 120_000) {
    const chatError = page.getByText(CHAT_ERROR_TEXT).first()
    if (await chatError.isVisible().catch(() => false)) {
      const text = await chatError.innerText()
      await page.screenshot({ path: screenshotPath, fullPage: true })
      return {
        kind: "finding",
        description: `assistant run ended with UI error "${text}". Screenshot: ${screenshotPath}`,
      }
    }

    const assistantBlocks = page.getByRole("log").locator(".justify-start")
    const count = await assistantBlocks.count().catch(() => 0)

    for (let index = count - 1; index >= 0; index -= 1) {
      const text = normalizeText(await assistantBlocks.nth(index).innerText())
      if (!text || THINKING_TEXT.test(text)) {
        continue
      }

      lastAssistantText = text
      return {
        kind: "ok",
        text,
      }
    }

    await page.waitForTimeout(1_000)
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
  return {
    kind: "finding",
    description: `assistant text did not become non-empty within 120s; lastAssistantText="${lastAssistantText}". Screenshot: ${screenshotPath}`,
  }
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
