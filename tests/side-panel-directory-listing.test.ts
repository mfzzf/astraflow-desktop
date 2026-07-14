// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { areSameSidePanelDirectoryListing } from "@/components/studio-chat/side-panel-utils"

const listing: AstraFlowSidePanelDirectory = {
  cwd: "/workspace",
  name: "workspace",
  parent: null,
  entries: [
    {
      name: "test.md",
      path: "/workspace/test.md",
      kind: "file",
      extension: "md",
      size: 11,
      modifiedAt: 1,
    },
  ],
}

describe("side panel directory listing comparison", () => {
  test("keeps the current listing when a refresh returns identical data", () => {
    expect(
      areSameSidePanelDirectoryListing(listing, {
        ...listing,
        entries: listing.entries.map((entry) => ({ ...entry })),
      })
    ).toBe(true)
  })

  test("detects file metadata changes for an in-place directory update", () => {
    expect(
      areSameSidePanelDirectoryListing(listing, {
        ...listing,
        entries: listing.entries.map((entry) => ({
          ...entry,
          size: 12,
          modifiedAt: 2,
        })),
      })
    ).toBe(false)
  })

  test("detects files added to the directory", () => {
    expect(
      areSameSidePanelDirectoryListing(listing, {
        ...listing,
        entries: [
          ...listing.entries,
          {
            name: "new.ts",
            path: "/workspace/new.ts",
            kind: "file",
            extension: "ts",
            size: 20,
            modifiedAt: 3,
          },
        ],
      })
    ).toBe(false)
  })
})
