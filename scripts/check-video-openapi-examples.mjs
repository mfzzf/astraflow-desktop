#!/usr/bin/env bun

import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { dereference } from "@readme/openapi-parser"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import {
  VIDEO_OPENAPI_FIELDS,
  VIDEO_OPENAPI_MODELS,
} from "../lib/generated/video-openapi-fields.ts"
import {
  serializeVideoProfileMedia,
  serializeVideoStructuredFields,
} from "../lib/studio-video-serialization.ts"

const openapiDir = join(process.cwd(), "openapi/video")
const files = (await readdir(openapiDir))
  .filter((file) => /\.ya?ml$/.test(file) && file !== "volce-asset.yaml")
  .sort()
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)

let checkedExamples = 0
let checkedModes = 0

function clone(value) {
  return structuredClone(value)
}

function setPath(target, path, value) {
  let current = target

  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== "object") {
      current[segment] = {}
    }
    current = current[segment]
  }

  current[path.at(-1)] = value
}

function deletePath(target, path) {
  let current = target

  for (const segment of path.slice(0, -1)) {
    if (!current?.[segment] || typeof current[segment] !== "object") {
      return
    }
    current = current[segment]
  }

  delete current[path.at(-1)]
}

function getPath(target, path) {
  let current = target

  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined
    }
    current = current[segment]
  }

  return current
}

function mediaFixture(field) {
  const extension =
    field.mediaKind === "video"
      ? "mp4"
      : field.mediaKind === "audio"
        ? "mp3"
        : "png"
  const mimeType =
    field.mediaKind === "video"
      ? "video/mp4"
      : field.mediaKind === "audio"
        ? "audio/mpeg"
        : "image/png"
  const attachment = field.acceptedSources.includes("url")
    ? { url: `https://example.com/profile-fixture.${extension}` }
    : { dataUrl: `data:${mimeType};base64,AA==` }

  return Array.from({ length: field.minItems }, () => attachment)
}

for (const file of files) {
  const document = await dereference(join(openapiDir, file), {
    dereference: { circular: "ignore" },
  })
  const operation = document.paths?.["/v1/tasks/submit"]?.post ??
    document.paths?.["/v1/videos"]?.post

  assert.ok(operation, `${file} needs a supported submit operation.`)
  const content =
    operation.requestBody?.content?.["application/json"] ??
    operation.requestBody?.content?.["multipart/form-data"]
  assert.ok(content?.schema, `${file} submit operation needs a request schema.`)

  const examples = Object.values(content.examples ?? {})
    .map((example) => example?.value)
    .filter((value) => value && typeof value === "object")
  assert.ok(examples.length > 0, `${file} needs at least one submit example.`)

  const validate = ajv.compile(content.schema)
  for (const [index, example] of examples.entries()) {
    assert.ok(
      validate(example),
      `${file} submit example ${index + 1} does not match its request schema: ${ajv.errorsText(
        validate.errors,
        { separator: "; " }
      )}`
    )
  }
  checkedExamples += examples.length

  const projectFile = `openapi/video/${file}`
  const profileEntry = VIDEO_OPENAPI_MODELS.find(
    (entry) => entry.file === projectFile
  )
  assert.ok(profileEntry, `${file} is missing generated model metadata.`)
  const fields =
    VIDEO_OPENAPI_FIELDS[`${projectFile}#${profileEntry.operationId}`] ?? []
  const promptFields = fields.filter(
    (field) => field.name === "prompt" || field.name === "text"
  )
  const allProfilePaths = new Map()

  for (const mode of profileEntry.profile.modes) {
    for (const field of [...mode.media, ...mode.structuredFields]) {
      allProfilePaths.set(field.fieldPath.join("."), field.fieldPath)
    }
  }

  for (const mode of profileEntry.profile.modes.filter(
    (candidate) => candidate.available !== false
  )) {
    const fixture = clone(examples[0])
    const prompt = mode.promptRequired ? "OpenAPI profile fixture" : ""

    for (const path of allProfilePaths.values()) {
      deletePath(fixture, path)
    }
    for (const field of promptFields) {
      if (mode.promptAllowed === false) {
        deletePath(fixture, field.payloadPath)
      } else {
        setPath(fixture, field.payloadPath, prompt)
      }
    }

    const media = Object.fromEntries(
      mode.media.map((field) => [field.id, mediaFixture(field)])
    )
    for (const entry of serializeVideoProfileMedia({
      prompt,
      media,
      inputMode: mode,
    })) {
      setPath(fixture, entry.path, entry.value)
    }
    for (const field of fields.filter(
      (candidate) => candidate.mediaShape === "content-item"
    )) {
      if (getPath(fixture, field.payloadPath) === undefined && prompt) {
        setPath(fixture, field.payloadPath, [{ type: "text", text: prompt }])
      }
    }

    const structuredParams = Object.fromEntries(
      mode.structuredFields.map((field) => [
        field.fieldPath.join("."),
        field.placeholder ?? "[]",
      ])
    )
    for (const field of mode.structuredFields) {
      if (!field.sum || !field.placeholder) continue
      const values = JSON.parse(field.placeholder)
      structuredParams[field.sum.equalsFieldPath.join(".")] = values.reduce(
        (sum, item) =>
          sum + Number(item[field.sum.itemFieldPath.at(-1)] ?? 0),
        0
      )
    }
    for (const entry of serializeVideoStructuredFields({
      inputMode: mode,
      params: structuredParams,
    })) {
      setPath(fixture, entry.path, entry.value)
    }

    for (const constraint of profileEntry.profile.constraints) {
      if (
        constraint.kind !== "parameter-rule" ||
        (constraint.modes && !constraint.modes.includes(mode.id))
      ) {
        continue
      }
      for (const action of constraint.actions) {
        if (action.kind === "set") {
          setPath(fixture, action.fieldPath, action.value)
        } else if (action.kind === "omit") {
          deletePath(fixture, action.fieldPath)
        }
      }
    }

    for (const field of mode.media.filter(
      (candidate) => candidate.serializer === "multipart-file"
    )) {
      setPath(fixture, field.fieldPath, "profile-fixture.png")
    }

    assert.ok(
      validate(fixture),
      `${file}/${mode.id} generated an invalid request shape: ${ajv.errorsText(
        validate.errors,
        { separator: "; " }
      )}`
    )
    checkedModes += 1
  }
}

console.log(
  `Validated ${checkedExamples} submit examples and ${checkedModes} generated mode fixtures for ${files.length} video models.`
)
