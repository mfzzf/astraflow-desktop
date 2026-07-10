import {
  expect,
  type APIRequestContext,
  type Page,
  test,
} from "@playwright/test"

const FEEDBACK_NAME = /^(Report a bug|反馈问题)$/

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: unknown }

type Session = { id: string }
type Message = { id: string; sessionId: string; role: "user" | "assistant" }

test("message and titlebar feedback submit the latest conversation", async ({
  page,
  request,
}) => {
  const session = await createSession(request, "Feedback e2e")
  await createMessage(request, session.id, "user", "The panel disappeared")
  const assistant = await createMessage(
    request,
    session.id,
    "assistant",
    "I can help investigate."
  )

  await gotoSession(page, session.id)

  const latestMessages = [
    { id: "latest-user", role: "user", content: "Latest user message" },
    {
      id: "latest-assistant",
      role: "assistant",
      content: "Latest assistant message",
    },
  ]
  await page.route(`**/api/studio/sessions/${session.id}/messages`, (route) =>
    route.fulfill({ json: { ok: true, data: latestMessages } })
  )

  const submitted: Array<Record<string, unknown>> = []
  await page.route("**/api/studio/feedback", async (route) => {
    submitted.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: 201,
      json: {
        ok: true,
        data: {
          feedbackId: `feedback-${submitted.length}`,
          createdAt: new Date().toISOString(),
        },
      },
    })
  })

  await page
    .locator(`[data-studio-message-id="${assistant.id}"]`)
    .getByRole("button", { name: FEEDBACK_NAME })
    .click()
  await fillAndSubmit(page, "The response controls stopped working.", true)

  await expect.poll(() => submitted.length).toBe(1)
  expect(submitted[0]).toMatchObject({
    sessionId: session.id,
    targetMessageId: assistant.id,
    entryPoint: "message_action",
    description: "The response controls stopped working.",
    messages: latestMessages,
  })
  expect(submitted[0]?.images).toEqual([
    expect.objectContaining({ name: "bug.png", mimeType: "image/png" }),
  ])

  await page.getByTestId("studio-feedback-titlebar").click()
  await fillAndSubmit(page, "The whole chat layout shifted.", false)

  await expect.poll(() => submitted.length).toBe(2)
  expect(submitted[1]).toMatchObject({
    sessionId: session.id,
    targetMessageId: null,
    entryPoint: "titlebar",
    description: "The whole chat layout shifted.",
    messages: latestMessages,
  })
})

test("titlebar feedback is disabled for an empty session", async ({
  page,
  request,
}) => {
  const session = await createSession(request, "Empty feedback e2e")
  await gotoSession(page, session.id)

  await expect(page.getByTestId("studio-feedback-titlebar")).toBeDisabled()
})

async function fillAndSubmit(
  page: Page,
  description: string,
  attachImage: boolean
) {
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(/Problem description|问题描述/).fill(description)

  if (attachImage) {
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "bug.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  }

  await dialog.getByRole("button", { name: /Send feedback|提交反馈/ }).click()
  await expect(dialog).toBeHidden()
}

async function createSession(request: APIRequestContext, title: string) {
  const response = await request.post("/api/studio/sessions", {
    data: { mode: "chat", title },
  })
  const payload = (await response.json()) as ApiResponse<Session>
  expect(response.status()).toBe(201)
  expect(payload.ok).toBe(true)
  if (!payload.ok) throw new Error("Failed to create session")
  return payload.data
}

async function createMessage(
  request: APIRequestContext,
  sessionId: string,
  role: "user" | "assistant",
  content: string
) {
  const response = await request.post(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/messages`,
    { data: { role, content, status: "complete" } }
  )
  const payload = (await response.json()) as ApiResponse<Message>
  expect(response.status()).toBe(201)
  expect(payload.ok).toBe(true)
  if (!payload.ok) throw new Error("Failed to create message")
  return payload.data
}

async function gotoSession(page: Page, sessionId: string) {
  await page.goto(`/studio/chat/${encodeURIComponent(sessionId)}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(page.getByTestId("studio-chat-workbench")).toBeVisible({
    timeout: 30_000,
  })
}
