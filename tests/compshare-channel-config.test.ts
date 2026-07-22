import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { mock } from "bun:test"

mock.module("server-only", () => ({}))
mock.module("@/lib/generated/astraflow-api", () => ({
  channelServiceGetChannelRuntimeConfig: async () => {
    throw new Error("fixture unavailable")
  },
}))

// The import must be dynamic because the server-only mock has to be installed first.
const {
  getChannelRuntimeConfig,
  getDistributionChannelSlug,
  resolveCompShareChannelFeatures,
} = await import("@/lib/channel-config")

const originalServerSlug = process.env.ASTRAFLOW_CHANNEL_SLUG
const originalPublicSlug = process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG

beforeEach(() => {
  delete process.env.ASTRAFLOW_CHANNEL_SLUG
  delete process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG
})

afterEach(() => {
  if (originalServerSlug === undefined) {
    delete process.env.ASTRAFLOW_CHANNEL_SLUG
  } else {
    process.env.ASTRAFLOW_CHANNEL_SLUG = originalServerSlug
  }

  if (originalPublicSlug === undefined) {
    delete process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG
  } else {
    process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG = originalPublicSlug
  }
})

describe("CompShare distribution channel activation", () => {
  test("defaults the custom edition to CompShare without environment configuration", () => {
    assert.equal(getDistributionChannelSlug(), "compshare")
  })

  test("treats blank channel configuration as the CompShare default", () => {
    process.env.ASTRAFLOW_CHANNEL_SLUG = "  "
    process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG = "  "

    assert.equal(getDistributionChannelSlug(), "compshare")
  })

  test("preserves an explicit normalized channel override", () => {
    process.env.ASTRAFLOW_CHANNEL_SLUG = "  Partner-Edition  "
    process.env.NEXT_PUBLIC_ASTRAFLOW_CHANNEL_SLUG = "compshare"

    assert.equal(getDistributionChannelSlug(), "partner-edition")
  })

  test("always enables Automations and Mobile for CompShare", () => {
    assert.deepEqual(resolveCompShareChannelFeatures(["skills", "chat"]), [
      "skills",
      "chat",
      "plans",
      "automations",
      "mobile",
    ])
  })

  test("brands the CompShare client as 优云智算", async () => {
    const config = await getChannelRuntimeConfig()

    assert.equal(config.slug, "compshare")
    assert.equal(config.name, "优云智算")
  })
})
