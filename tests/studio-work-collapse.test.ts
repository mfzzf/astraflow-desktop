// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { TurnActivitySummary } from "@/components/studio-message-parts/activity"

describe("completed Work summary", () => {
  test("starts collapsed even when the Work contains an error", () => {
    const Summary = TurnActivitySummary as ComponentType<
      Omit<ComponentProps<typeof TurnActivitySummary>, "children"> & {
        children?: ReactNode
      }
    >
    const html = renderToStaticMarkup(
      createElement(
        Summary,
        {
          startedAt: "2026-07-20T00:00:00.000Z",
          completedAt: "2026-07-20T00:00:02.000Z",
          durationMs: 2_000,
          hasError: true,
        },
        createElement("div", null, "failed tool")
      )
    )

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("Worked for 2.0s")
    expect(html).toContain("Error")
    expect(html).not.toContain("failed tool")
  })
})
