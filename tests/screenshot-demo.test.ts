// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { isScreenshotDemoMode } from "@/lib/screenshot-demo"

const screenshotEnvironment = {
  ASTRAFLOW_DEMO_MODE: "1",
  ASTRAFLOW_ELECTRON: "1",
  ASTRAFLOW_ELECTRON_DEV: "1",
  ASTRAFLOW_ELECTRON_SCREENSHOT: "1",
}

describe("isScreenshotDemoMode", () => {
  test("requires the complete development screenshot environment", () => {
    expect(isScreenshotDemoMode(screenshotEnvironment)).toBe(true)
  })

  test.each(Object.keys(screenshotEnvironment))(
    "stays disabled without %s",
    (environmentKey: keyof typeof screenshotEnvironment) => {
      expect(
        isScreenshotDemoMode({
          ...screenshotEnvironment,
          [environmentKey]: undefined,
        })
      ).toBe(false)
    }
  )

  test("cannot be enabled by demo mode alone", () => {
    expect(isScreenshotDemoMode({ ASTRAFLOW_DEMO_MODE: "1" })).toBe(false)
  })
})
