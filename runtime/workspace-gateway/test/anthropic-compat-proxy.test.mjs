import assert from "node:assert/strict"
import http from "node:http"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"

import { createAnthropicCompatProxy } from "../src/anthropic-compat-proxy.mjs"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()

  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

async function readBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString("utf8")
}

test("intercepts token counting and securely streams Anthropic requests", async (t) => {
  const upstreamRequests = []
  const upstream = http.createServer(async (request, response) => {
    upstreamRequests.push({
      authorization: request.headers.authorization,
      beta: request.headers["anthropic-beta"],
      body: await readBody(request),
      path: request.url,
      version: request.headers["anthropic-version"],
      xApiKey: request.headers["x-api-key"],
    })
    response.writeHead(201, {
      "content-type": "text/event-stream",
      "x-upstream": "reached",
    })
    response.write("event: message_start\n")
    await delay(10)
    response.end("event: message_stop\n")
  })
  const upstreamBaseUrl = await listen(upstream)
  const proxy = await createAnthropicCompatProxy({
    authToken: "upstream-secret",
    clientToken: "gateway-managed",
    upstreamBaseUrl: `${upstreamBaseUrl}/anthropic`,
  })

  t.after(async () => {
    await proxy.close()
    await close(upstream)
  })

  const unauthorized = await fetch(
    `${proxy.baseUrl}/v1/messages/count_tokens`,
    {
      method: "POST",
      body: "{}",
    }
  )

  assert.equal(unauthorized.status, 401)
  assert.equal(upstreamRequests.length, 0)

  const counted = await fetch(
    `${proxy.baseUrl}/v1/messages/count_tokens?beta=true`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-managed",
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }
  )

  assert.equal(counted.status, 200)
  assert.ok((await counted.json()).input_tokens > 0)
  assert.equal(upstreamRequests.length, 0)

  const forwarded = await fetch(`${proxy.baseUrl}/v1/messages?beta=true`, {
    method: "POST",
    headers: {
      authorization: "Bearer gateway-managed",
      "anthropic-beta": "context-management-2025-06-27,interleaved-thinking-2025-05-14",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": "must-not-forward",
    },
    body: JSON.stringify({
      context_management: { edits: [] },
      model: "claude-test",
      stream: true,
    }),
  })

  assert.equal(forwarded.status, 201)
  assert.equal(forwarded.headers.get("x-upstream"), "reached")
  assert.equal(
    await forwarded.text(),
    "event: message_start\nevent: message_stop\n"
  )
  assert.deepEqual(upstreamRequests, [
    {
      authorization: "Bearer upstream-secret",
      beta: "interleaved-thinking-2025-05-14",
      body: JSON.stringify({ model: "claude-test", stream: true }),
      path: "/anthropic/v1/messages?beta=true",
      version: "2023-06-01",
      xApiKey: undefined,
    },
  ])

  const responsesBody = JSON.stringify({
    input: "hello",
    model: "gpt-test",
    stream: true,
  })
  const openai = await fetch(`${proxy.baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: "Bearer gateway-managed",
      "content-type": "application/json",
      "x-api-key": "must-not-forward",
    },
    body: responsesBody,
  })

  assert.equal(openai.status, 201)
  assert.equal(
    await openai.text(),
    "event: message_start\nevent: message_stop\n"
  )
  assert.deepEqual(upstreamRequests[1], {
    authorization: "Bearer upstream-secret",
    beta: undefined,
    body: responsesBody,
    path: "/anthropic/v1/responses",
    version: undefined,
    xApiKey: undefined,
  })

  await proxy.close()
  await assert.rejects(fetch(`${proxy.baseUrl}/v1/messages/count_tokens`))
})
