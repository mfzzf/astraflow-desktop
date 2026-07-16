// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { expect, test } from "bun:test"

import { createContentDispositionValue } from "@/lib/studio-file-response"

test("encodes Unicode download filenames without invalid response headers", () => {
  const value = createContentDispositionValue(
    "attachment",
    "星图客户端_产品介绍-1.pptx"
  )

  expect(value).toContain('filename="__________-1.pptx"')
  expect(value).toContain(
    "filename*=UTF-8''%E6%98%9F%E5%9B%BE%E5%AE%A2%E6%88%B7%E7%AB%AF_%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D-1.pptx"
  )
  expect([...value].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(
    true
  )
  expect(
    new Response(null, {
      headers: { "Content-Disposition": value },
    }).headers.get("content-disposition")
  ).toBe(value)
})
