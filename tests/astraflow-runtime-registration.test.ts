// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import "@/lib/agent/adapters/astraflow-runtime"
import { getAgentRuntime } from "@/lib/agent/runtime"

describe("astraflow runtime registration", () => {
  test("exposes ACP preparation through the registered wrapper", () => {
    const runtime = getAgentRuntime("astraflow")

    expect(runtime).not.toBeNull()
    expect(typeof runtime?.prepareRun).toBe("function")
    expect(typeof runtime?.startRun).toBe("function")
  })
})
