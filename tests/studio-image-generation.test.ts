// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { extractGeminiImageOutputs } from "@/lib/studio-media-generation/image"

describe("Gemini image output extraction", () => {
  test("ignores intermediate thought images", () => {
    const outputs = extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [
              {
                thought: true,
                inlineData: {
                  mimeType: "image/png",
                  data: "draft-image",
                },
              },
              {
                thoughtSignature: "final",
                inlineData: {
                  mimeType: "image/png",
                  data: "final-image",
                },
              },
            ],
          },
        },
      ],
    })

    expect(outputs).toEqual([
      {
        url: null,
        dataUrl: "data:image/png;base64,final-image",
        mimeType: "image/png",
        width: null,
        height: null,
      },
    ])
  })

  test("keeps multiple user-facing outputs", () => {
    const outputs = extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: "first-image",
                },
              },
              {
                inlineData: {
                  mimeType: "image/webp",
                  data: "second-image",
                },
              },
            ],
          },
        },
      ],
    })

    expect(outputs.map((output) => output.dataUrl)).toEqual([
      "data:image/png;base64,first-image",
      "data:image/webp;base64,second-image",
    ])
  })
})
