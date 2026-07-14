// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { createStudioDefaultHomeWorkspace } from "@/lib/studio-default-workspace"

describe("default Studio home workspace", () => {
  test("creates a stable local workspace rooted at the desktop home path", () => {
    expect(createStudioDefaultHomeWorkspace(" /Users/example ")).toEqual({
      id: "astraflow:default-home",
      type: "local",
      name: "~",
      rootPath: "/Users/example",
      localProjectId: "",
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    })
  })

  test("does not create a workspace without a resolved home path", () => {
    expect(createStudioDefaultHomeWorkspace("   ")).toBeNull()
  })
})
