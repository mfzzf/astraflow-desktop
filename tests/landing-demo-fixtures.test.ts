// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { resolveLandingDemoResponse } from "./fixtures/landing-demo/routes.mjs"

describe("landing screenshot fixtures", () => {
  test("serve the three screenshot surfaces without external services", () => {
    const routes = [
      "/api/studio/sessions",
      "/api/skills",
      "/api/automations",
    ]

    for (const route of routes) {
      expect(resolveLandingDemoResponse(`http://127.0.0.1${route}`, "GET").status).toBe(200)
    }
  })

  test("rejects mutations and unknown APIs", () => {
    expect(
      resolveLandingDemoResponse("http://127.0.0.1/api/skills", "POST").status
    ).toBe(405)
    expect(
      resolveLandingDemoResponse("http://127.0.0.1/api/not-fixtured", "GET").status
    ).toBe(501)
  })
})
