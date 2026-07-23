import assert from "node:assert/strict"
import { test } from "node:test"

import { listModelverseAvailableModelIds } from "@/lib/modelverse-api-keys"

test("lists the models available to a Modelverse API key", async () => {
  const originalFetch = globalThis.fetch
  let authorization = ""
  let requestUrl = ""

  try {
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("authorization") ?? ""

      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "GPT-5.6-SOL", object: "model" },
            { id: "GPT-5.6-SOL", object: "model" },
            { id: "  ", object: "model" },
            { object: "model" },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const modelIds = await listModelverseAvailableModelIds("secret-key")

    assert.equal(requestUrl, "https://api.modelverse.cn/v1/models")
    assert.equal(authorization, "Bearer secret-key")
    assert.deepEqual(modelIds, ["GPT-5.6-SOL"])
  } finally {
    globalThis.fetch = originalFetch
  }
})
