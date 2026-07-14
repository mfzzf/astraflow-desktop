// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  isAstraFlowTransientRuntimeError,
  retryAstraFlowTransientOperation,
} from "@/lib/agent/transient-retry"

describe("AstraFlow transient runtime retry", () => {
  test("recognizes the E2B terminated connection error", () => {
    expect(
      isAstraFlowTransientRuntimeError(new Error("2: [unknown] terminated"))
    ).toBe(true)
  })

  test("does not retry validation or permission errors", () => {
    expect(
      isAstraFlowTransientRuntimeError(new Error("Permission denied"))
    ).toBe(false)
    expect(
      isAstraFlowTransientRuntimeError(new Error("Invalid argument"))
    ).toBe(false)
  })

  test("retries a transient failure at most twice", async () => {
    let attempts = 0
    const retries: number[] = []

    await expect(
      retryAstraFlowTransientOperation({
        operation: async () => {
          attempts += 1
          throw new Error("socket connection was closed unexpectedly")
        },
        retryDelaysMs: [0, 0],
        onRetry: (_error, retry) => {
          retries.push(retry)
        },
      })
    ).rejects.toThrow("socket connection was closed unexpectedly")
    expect(attempts).toBe(3)
    expect(retries).toEqual([1, 2])
  })

  test("returns when a retry succeeds", async () => {
    let attempts = 0

    const result = await retryAstraFlowTransientOperation({
      operation: async () => {
        attempts += 1

        if (attempts < 3) {
          throw new Error("ECONNRESET")
        }

        return "ok"
      },
      retryDelaysMs: [0, 0],
    })

    expect(result).toBe("ok")
    expect(attempts).toBe(3)
  })
})
