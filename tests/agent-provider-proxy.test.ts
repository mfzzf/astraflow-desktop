// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import { POST } from "@/app/api/internal/agent-provider/[token]/[...path]/route"
import {
  createAgentProviderProxyCredential,
  releaseAgentProviderProxyCredential,
  resolveAgentProviderProxyCredential,
  retainAgentProviderProxyCredential,
} from "@/lib/agent/provider-proxy"

const originalFetch = globalThis.fetch
const originalOrigin = process.env.ASTRAFLOW_INTERNAL_ORIGIN

afterEach(() => {
  globalThis.fetch = originalFetch

  if (originalOrigin === undefined) {
    delete process.env.ASTRAFLOW_INTERNAL_ORIGIN
  } else {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = originalOrigin
  }
})

describe("Desktop Agent provider proxy", () => {
  test("issues an opaque scoped credential without returning the provider key", () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-proxy",
      apiKey: "real-provider-secret",
      baseUrl: "https://provider.example/v1",
      protocol: "openai-responses",
    })
    const token = credential.apiKey

    expect(token).not.toContain("real-provider-secret")
    expect(credential.baseUrl).toBe(
      "http://127.0.0.1:3210/api/internal/agent-provider/credential"
    )
    expect(credential.baseUrl).not.toContain(token)
    expect(credential.providerHostname).toBe("127.0.0.1")
    expect(credential.providerEndpoint).toEqual({
      host: "127.0.0.1",
      port: 3210,
    })
    expect(resolveAgentProviderProxyCredential(token)).toMatchObject({
      sessionId: "session-proxy",
      apiKey: "real-provider-secret",
      baseUrl: "https://provider.example/v1",
    })
    expect(resolveAgentProviderProxyCredential("invalid")).toBeNull()
  })

  test("keeps an active process lease alive and revokes it on exit", () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-lifecycle",
      apiKey: "real-provider-secret",
      authMode: "bearer",
      baseUrl: "https://provider.example/v1",
      protocol: "openai-responses",
      scopeId: "codex:default",
    })

    expect(retainAgentProviderProxyCredential(credential.apiKey)).toBeTrue()
    expect(
      resolveAgentProviderProxyCredential(credential.apiKey)
    ).toMatchObject({
      activeConsumers: 1,
      authMode: "bearer",
    })

    releaseAgentProviderProxyCredential(credential.apiKey)
    expect(resolveAgentProviderProxyCredential(credential.apiKey)).toBeNull()
  })

  test("forwards only to the registered provider and replaces child auth", async () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-forward",
      apiKey: "real-provider-secret",
      baseUrl: "https://93.184.216.34/v1",
      protocol: "openai-responses",
    })
    const token = credential.apiKey
    let upstreamUrl = ""
    let upstreamAuthorization = ""
    let upstreamBody = ""

    globalThis.fetch = async (input, init) => {
      upstreamUrl = String(input)
      upstreamAuthorization =
        new Headers(init?.headers).get("authorization") ?? ""
      upstreamBody = String(init?.body)

      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "request-1",
        },
      })
    }

    const response = await POST(
      new Request(
        "http://127.0.0.1:3210/api/internal/agent-provider/credential/responses?stream=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: '{"model":"test"}',
        }
      ),
      {
        params: Promise.resolve({
          token: "credential",
          path: ["responses"],
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(upstreamUrl).toBe("https://93.184.216.34/v1/responses?stream=true")
    expect(upstreamAuthorization).toBe("Bearer real-provider-secret")
    expect(upstreamAuthorization).not.toContain(token)
    expect(upstreamBody).toBe('{"model":"test"}')
    expect(response.headers.get("x-request-id")).toBe("request-1")
    expect(await response.text()).toBe('{"ok":true}')
  })

  test("keeps the opaque token in auth headers and supports Anthropic x-api-key", async () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-anthropic",
      apiKey: "real-anthropic-secret",
      authMode: "x-api-key",
      baseUrl: "https://93.184.216.34",
      protocol: "anthropic-messages",
    })
    let upstreamApiKey = ""
    let upstreamAuthorization = ""

    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)

      upstreamApiKey = headers.get("x-api-key") ?? ""
      upstreamAuthorization = headers.get("authorization") ?? ""
      return new Response("{}", { status: 200 })
    }

    const response = await POST(
      new Request(`${credential.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": credential.apiKey,
        },
        body: "{}",
      }),
      {
        params: Promise.resolve({
          token: "credential",
          path: ["v1", "messages"],
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(upstreamApiKey).toBe("real-anthropic-secret")
    expect(upstreamAuthorization).toBe("")
    expect(await response.text()).toBe("{}")
  })

  test("rejects route tokens and missing or conflicting auth sentinels", async () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-rejected",
      apiKey: "real-provider-secret",
      baseUrl: "https://provider.example/v1",
      protocol: "openai-responses",
    })
    const request = new Request(`${credential.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        "x-api-key": "a".repeat(43),
      },
      body: "{}",
    })
    const response = await POST(request, {
      params: Promise.resolve({
        token: "credential",
        path: ["responses"],
      }),
    })

    expect(response.status).toBe(401)
  })

  test("rejects metadata targets and non-default provider ports before fetch", async () => {
    process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3210"
    expect(() =>
      createAgentProviderProxyCredential({
        sessionId: "session-port",
        apiKey: "real-provider-secret",
        baseUrl: "https://provider.example:8443/v1",
        protocol: "openai-responses",
      })
    ).toThrow(/provider URL is invalid/)
    const credential = createAgentProviderProxyCredential({
      sessionId: "session-metadata",
      apiKey: "real-provider-secret",
      baseUrl: "http://169.254.169.254",
      protocol: "openai-responses",
    })
    let fetchCalled = false

    globalThis.fetch = async () => {
      fetchCalled = true
      return new Response("should not run")
    }

    const response = await POST(
      new Request(`${credential.baseUrl}/latest/meta-data`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
        },
        body: "{}",
      }),
      {
        params: Promise.resolve({
          token: "credential",
          path: ["latest", "meta-data"],
        }),
      }
    )

    expect(response.status).toBe(502)
    expect(fetchCalled).toBeFalse()
  })
})
