// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  getNextStudioPromptTipState,
  StudioPromptTips,
} from "@/components/studio-chat/studio-prompt-tips"

test("renders the CompShare inventory suggestion as an accessible button", () => {
  const markup = renderToStaticMarkup(
    createElement(StudioPromptTips, {
      label: "试试问我",
      prompts: ["现在还有多少 4090 库存？", "哪些地域还有 5090 可用？"],
      onAsk: () => {},
    })
  )

  expect(markup).toContain('type="button"')
  expect(markup).toContain('data-testid="studio-prompt-tips"')
  expect(markup).toContain("试试问我")
  expect(markup).toContain("现在还有多少 4090 库存？")
  expect(markup).toContain('aria-label="试试问我：现在还有多少 4090 库存？"')
})

test("moves through prompt tips and reverses at both ends", () => {
  expect(getNextStudioPromptTipState(0, 1, 5)).toEqual({
    direction: 1,
    index: 1,
  })
  expect(getNextStudioPromptTipState(4, 1, 5)).toEqual({
    direction: -1,
    index: 3,
  })
  expect(getNextStudioPromptTipState(0, -1, 5)).toEqual({
    direction: 1,
    index: 1,
  })
})
