import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { parse as parseYaml } from "yaml"

const repositoryRoot = resolve(import.meta.dirname, "..")

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8")
}

test("Gemini image registry uses production model ids", () => {
  const registry = read("lib/image-model-openapi.ts")
  const models = [
    {
      id: "gemini-3-pro-image",
      openapi: "openapi/image/gemini-3-pro-image.yaml",
    },
    {
      id: "gemini-3.1-flash-image",
      openapi: "openapi/image/gemini-3.1-flash-image.yaml",
    },
  ]

  for (const model of models) {
    const expectedPath = `/v1beta/models/${model.id}:generateContent`
    const document = parseYaml(read(model.openapi))

    assert.ok(document.paths[expectedPath], `${model.openapi} must use ${model.id}`)
    assert.ok(
      registry.includes(`path: "${expectedPath}"`),
      `Registry path must use ${model.id}`
    )
    assert.ok(
      registry.includes(`modelConstant: "${model.id}"`),
      `Registry model constant must use ${model.id}`
    )
  }

  assert.doesNotMatch(
    `${registry}\n${read("openapi/image/gemini-3-pro-image.yaml")}`,
    /gemini-3(?:\.1)?-(?:pro|flash)-image-preview/
  )
})
