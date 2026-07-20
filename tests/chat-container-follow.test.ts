// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { canAutoScrollChat } from "@/components/ui/chat-container"

describe("chat output following", () => {
  test("stops automatic scrolling after the user leaves the bottom", () => {
    expect(canAutoScrollChat(false)).toBe(true)
    expect(canAutoScrollChat(true)).toBe(false)
  })
})
