// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  getStudioReviewDiffReference,
  loadStudioReviewDiff,
} from "@/components/studio-chat/right-panel/review-diff"
import {
  getStudioRightPanelLabels,
  StudioReviewFileSection,
} from "@/components/studio-chat/right-panel"
import type { StudioReviewFileChange } from "@/lib/studio-review-panel"

const blobId = "a".repeat(64)
const revision = "b".repeat(64)
const path = "src/components/demo file.tsx"
const diff = [
  `--- a/${path}`,
  `+++ b/${path}`,
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n")

function reviewChange(
  overrides: Partial<StudioReviewFileChange> = {}
): StudioReviewFileChange {
  return {
    path,
    kind: "edit",
    additions: 1,
    deletions: 1,
    diff: null,
    diffBlobId: blobId,
    revision,
    diffTruncated: true,
    ...overrides,
  }
}

describe("Studio Review lazy diff loading", () => {
  test("builds a session, path, and revision-bound request", () => {
    const reference = getStudioReviewDiffReference({
      sessionId: "session / 1",
      diffBlobId: blobId.toUpperCase(),
      path,
      revision: revision.toUpperCase(),
    })

    expect(reference).not.toBeNull()
    expect(reference?.id).toBe(blobId)
    expect(reference?.revision).toBe(revision)

    const url = new URL(reference!.url, "http://localhost")

    expect(url.pathname).toBe(
      `/api/studio/sessions/session%20%2F%201/file-mutations/${blobId}`
    )
    expect(url.searchParams.get("path")).toBe(path)
    expect(url.searchParams.get("revision")).toBe(revision)
  })

  test("loads a full diff only when response identity matches", async () => {
    const reference = getStudioReviewDiffReference({
      sessionId: "session-1",
      diffBlobId: blobId,
      path,
      revision,
    })!
    const loaded = await loadStudioReviewDiff(reference, {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { id: blobId, path, revision, diff },
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        ),
    })

    expect(loaded).toBe(diff)

    for (const mismatchedData of [
      { id: "c".repeat(64), path, revision, diff },
      { id: blobId, path: "src/other.tsx", revision, diff },
      { id: blobId, path, revision: "d".repeat(64), diff },
    ]) {
      await expect(
        loadStudioReviewDiff(reference, {
          fetcher: async () =>
            new Response(
              JSON.stringify({ ok: true, data: mismatchedData }),
              {
                headers: { "Content-Type": "application/json" },
              }
            ),
        })
      ).rejects.toThrow("unavailable")
    }
  })

  test("shows loading for a valid blob and explicit unavailability without one", () => {
    const labels = getStudioRightPanelLabels("en")
    const withBlob = renderToStaticMarkup(
      createElement(StudioReviewFileSection, {
        change: reviewChange(),
        labels,
        onOpenFile: () => undefined,
        sessionId: "session-1",
      })
    )
    const withoutBlob = renderToStaticMarkup(
      createElement(StudioReviewFileSection, {
        change: reviewChange({ diffBlobId: null }),
        labels,
        onOpenFile: () => undefined,
        sessionId: "session-1",
      })
    )

    expect(withBlob).toContain("Loading the full diff")
    expect(withBlob).not.toContain("expired or is unavailable")
    expect(withoutBlob).toContain("full diff expired or is unavailable")
    expect(withoutBlob).not.toContain("Loading the full diff")
  })

  test("fails closed before fetching malformed blob references", () => {
    expect(
      getStudioReviewDiffReference({
        sessionId: "session-1",
        diffBlobId: "not-a-digest",
        path,
        revision,
      })
    ).toBeNull()
    expect(
      getStudioReviewDiffReference({
        sessionId: "session-1",
        diffBlobId: blobId,
        path,
        revision: "untrusted-revision",
      })
    ).toBeNull()
  })
})
