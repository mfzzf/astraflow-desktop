#!/usr/bin/env bun

import assert from "node:assert/strict"

import { VIDEO_OPENAPI_MODELS } from "../lib/generated/video-openapi-fields.ts"
import {
  getVideoInputMode,
  validateVideoConstraints,
  validateVideoModeMedia,
} from "../lib/studio-video-profile.ts"
import { serializeVideoProfileMedia } from "../lib/studio-video-serialization.ts"
import { serializeVideoStructuredFields } from "../lib/studio-video-serialization.ts"
import { buildVideoModelOption } from "../lib/video-openapi.ts"
import {
  getVideoProtocolResultUrls,
  getVideoProtocolTaskId,
  getVideoProtocolTaskStatus,
  isVideoProtocolFailure,
  isVideoProtocolSuccess,
} from "../lib/studio-video-protocol.ts"

function setPath(target, path, value) {
  let current = target

  for (const segment of path.slice(0, -1)) {
    current[segment] ??= {}
    current = current[segment]
  }

  current[path.at(-1)] = value
}

const allowIncomplete = process.argv.includes("--allow-incomplete")
const incomplete = VIDEO_OPENAPI_MODELS.filter((entry) => !entry.profile.explicit)

if (!allowIncomplete) {
  assert.deepEqual(
    incomplete.map((entry) => `${entry.file}#${entry.operationId}`),
    [],
    "Every video submit operation must declare x-astraflow-profile."
  )
}

for (const entry of VIDEO_OPENAPI_MODELS) {
  const { profile } = entry

  assert.equal(profile.version, 1)
  assert.equal(profile.submit.path, entry.path)
  assert.equal(profile.submit.contentType, entry.contentType)
  assert.equal(profile.polling.path, entry.statusPath)

  const submitFixture = {}
  setPath(submitFixture, profile.submit.taskIdPath, "task-fixture")
  assert.equal(
    getVideoProtocolTaskId(submitFixture, profile.submit),
    "task-fixture"
  )

  const successFixture = {}
  setPath(
    successFixture,
    profile.polling.statusPath,
    profile.polling.successStatuses[0]
  )
  assert.equal(
    getVideoProtocolTaskStatus(successFixture, profile.polling),
    profile.polling.successStatuses[0]
  )
  assert.ok(
    isVideoProtocolSuccess(
      getVideoProtocolTaskStatus(successFixture, profile.polling),
      profile.polling
    )
  )

  const failureFixture = {}
  setPath(
    failureFixture,
    profile.polling.statusPath,
    profile.polling.failureStatuses[0]
  )
  assert.ok(
    isVideoProtocolFailure(
      getVideoProtocolTaskStatus(failureFixture, profile.polling),
      profile.polling
    )
  )

  if (profile.polling.resultUrlsPath) {
    const resultFixture = {}
    setPath(resultFixture, profile.polling.resultUrlsPath, ["https://example.com/out.mp4"])
    assert.deepEqual(getVideoProtocolResultUrls(resultFixture, profile.polling), [
      "https://example.com/out.mp4",
    ])
  }

  if (!profile.explicit) {
    continue
  }

  assert.ok(profile.modes.length > 0, `${entry.title} needs at least one mode.`)
  assert.ok(
    getVideoInputMode(profile, profile.defaultMode),
    `${entry.title} has an invalid default mode.`
  )

  for (const mode of profile.modes) {
    const media = Object.fromEntries(
      mode.media.map((field) => [
        field.id,
        Array.from({ length: field.minItems }, (_, index) => ({
          url: `https://example.com/${field.id}-${index}`,
        })),
      ])
    )
    const validationErrors = validateVideoModeMedia({
      profile,
      modeId: mode.id,
      mediaCounts: Object.fromEntries(
        Object.entries(media).map(([key, values]) => [key, values.length])
      ),
    })

    assert.deepEqual(
      validationErrors,
      [],
      `${entry.title}/${mode.id} rejected its generated minimum fixture.`
    )

    for (const field of mode.media) {
      if (field.minItems > 0) {
        const belowMinimum = Object.fromEntries(
          Object.entries(media).map(([key, values]) => [key, values.length])
        )
        belowMinimum[field.id] = field.minItems - 1
        assert.ok(
          validateVideoModeMedia({
            profile,
            modeId: mode.id,
            mediaCounts: belowMinimum,
          }).some(
            (error) => error.fieldPath.join(".") === field.fieldPath.join(".")
          ),
          `${entry.title}/${mode.id}/${field.id} accepted too few media items.`
        )
      }

      if (field.maxItems !== undefined) {
        const aboveMaximum = Object.fromEntries(
          Object.entries(media).map(([key, values]) => [key, values.length])
        )
        aboveMaximum[field.id] = field.maxItems + 1
        assert.ok(
          validateVideoModeMedia({
            profile,
            modeId: mode.id,
            mediaCounts: aboveMaximum,
          }).some(
            (error) => error.fieldPath.join(".") === field.fieldPath.join(".")
          ),
          `${entry.title}/${mode.id}/${field.id} accepted too many media items.`
        )
      }
    }

    for (const field of mode.media) {
      if (
        field.minItems > 0 &&
        field.serializer === "base64-object"
      ) {
        media[field.id] = Array.from({ length: field.minItems }, () => ({
          dataUrl: "data:image/png;base64,AA==",
        }))
      }
    }

    serializeVideoProfileMedia({
      prompt: mode.promptRequired ? "contract fixture" : "",
      media,
      inputMode: mode,
    })

    const structuredParams = Object.fromEntries(
      mode.structuredFields.map((field) => [
        field.fieldPath.join("."),
        field.placeholder ?? "[]",
      ])
    )
    for (const field of mode.structuredFields) {
      if (!field.sum || !field.placeholder) continue

      const values = JSON.parse(field.placeholder)
      const total = values.reduce(
        (sum, item) =>
          sum + Number(item[field.sum.itemFieldPath.at(-1)] ?? 0),
        0
      )
      structuredParams[field.sum.equalsFieldPath.join(".")] = total
    }
    serializeVideoStructuredFields({ inputMode: mode, params: structuredParams })
    assert.ok(
      mode.structuredFields.every((field) => field.schema),
      `${entry.title}/${mode.id} has a structured field without its OpenAPI schema.`
    )
    if (mode.structuredFields.some((field) => field.required)) {
      assert.throws(
        () => serializeVideoStructuredFields({ inputMode: mode, params: {} }),
        /is required/,
        `${entry.title}/${mode.id} accepted missing structured input.`
      )
    }

    const constraintErrors = validateVideoConstraints({
      profile,
      modeId: mode.id,
      params: structuredParams,
      mediaCounts: Object.fromEntries(
        Object.entries(media).map(([key, values]) => [key, values.length])
      ),
      context: {
        "input.prompt": mode.promptRequired ? "contract fixture" : "",
        "input.text": mode.promptRequired ? "contract fixture" : "",
      },
    })
    assert.deepEqual(
      constraintErrors,
      [],
      `${entry.title}/${mode.id} rejected its generic constraint fixture.`
    )
  }

  for (const constraint of profile.constraints) {
    if (constraint.kind === "required-any") {
      assert.ok(
        validateVideoConstraints({
          profile,
          modeId: profile.defaultMode,
          params: {},
          mediaCounts: {},
        }).some((error) => error.message),
        `${entry.title} did not reject an empty required-any fixture.`
      )
      continue
    }

    if (constraint.kind === "requires") {
      const mode =
        profile.modes.find((candidate) =>
          candidate.media.some(
            (field) =>
              field.fieldPath.join(".") === constraint.fieldPath.join(".")
          )
        ) ?? getVideoInputMode(profile, profile.defaultMode)
      assert.ok(mode, `${entry.title} requires a mode fixture.`)
      const mediaCounts = Object.fromEntries(
        mode.media.map((field) => [
          field.id,
          field.fieldPath.join(".") === constraint.fieldPath.join(".") ? 1 : 0,
        ])
      )
      const params = mode.media.some(
        (field) =>
          field.fieldPath.join(".") === constraint.fieldPath.join(".")
      )
        ? {}
        : { [constraint.fieldPath.join(".")]: "constraint fixture" }
      assert.ok(
        validateVideoConstraints({
          profile,
          modeId: mode.id,
          params,
          mediaCounts,
        }).some((error) => error.message),
        `${entry.title} did not reject a broken requires fixture.`
      )
      continue
    }

    if (constraint.kind === "mutually-exclusive-media-roles") {
      for (const mode of profile.modes) {
        const activeRoles = new Set(
          mode.media.flatMap((field) =>
            field.roles?.kind === "repeat"
              ? [field.roles.value]
              : field.roles?.kind === "sequence"
                ? field.roles.values
                : []
          )
        )
        assert.ok(
          constraint.roles.filter((role) => activeRoles.has(role)).length <= 1,
          `${entry.title}/${mode.id} structurally mixes exclusive media roles.`
        )
      }
    }
  }
}

const specificMiniMax = buildVideoModelOption({
  id: "MiniMax-Hailuo-2.3-I2V",
  name: "MiniMax-Hailuo-2.3",
  label: "MiniMax Hailuo 2.3 I2V",
  manufacturer: "contract fixture",
  inputModalities: ["image"],
  outputModalities: ["video"],
  coverUrl: null,
})
assert.deepEqual(
  specificMiniMax.operations.map((operation) => operation.openapi.file),
  ["openapi/video/MiniMax-Hailuo-2.3-I2V.yaml"],
  "An exact model id must take precedence over a broader model name."
)

for (const entry of VIDEO_OPENAPI_MODELS) {
  for (const modelValue of entry.modelValues) {
    const option = buildVideoModelOption({
      id: modelValue,
      name: modelValue,
      label: modelValue,
      manufacturer: "contract fixture",
      inputModalities: [],
      outputModalities: ["video"],
      coverUrl: null,
    })
    const operationId = `${entry.file}#${entry.operationId}`

    assert.equal(option.supported, true, `${modelValue} did not match OpenAPI.`)
    assert.ok(
      option.operations.some((operation) => operation.id === operationId),
      `${modelValue} did not retain ${operationId}.`
    )
  }
}

const seedance = VIDEO_OPENAPI_MODELS.find(
  (entry) => entry.title === "doubao-seedance-2-0-260128"
)
assert.ok(seedance, "Seedance 2.0 profile is missing.")
const referenceMode = getVideoInputMode(seedance.profile, "reference-images")
assert.ok(referenceMode, "Seedance 2.0 reference-images mode is missing.")
const [referenceContent] = serializeVideoProfileMedia({
  prompt: "reference fixture",
  media: {
    images: [
      { url: "https://example.com/1.png" },
      { url: "https://example.com/2.png" },
      { url: "https://example.com/3.png" },
    ],
  },
  inputMode: referenceMode,
})
assert.ok(referenceContent)
assert.equal(referenceContent.path.join("."), "input.content")
assert.ok(Array.isArray(referenceContent.value))
assert.deepEqual(
  referenceContent.value.slice(1).map((item) => item.role),
  ["reference_image", "reference_image", "reference_image"]
)

const klingV3 = VIDEO_OPENAPI_MODELS.find(
  (entry) => entry.title === "Kling-v3"
)

const klingO3 = VIDEO_OPENAPI_MODELS.find((entry) => entry.title === "Kling-O3")
assert.ok(klingO3, "Kling O3 profile is missing.")
const klingO3FirstFrame = getVideoInputMode(klingO3.profile, "first-frame")
assert.ok(klingO3FirstFrame, "Kling O3 first-frame mode is missing.")
const [klingO3Images] = serializeVideoProfileMedia({
  prompt: "raw base64 fixture",
  media: { images: [{ dataUrl: "data:image/png;base64,AA==" }] },
  inputMode: klingO3FirstFrame,
})
assert.deepEqual(klingO3Images.value, [
  { image_url: "AA==", type: "first_frame" },
])
assert.ok(klingV3, "Kling v3 profile is missing.")
const multiShotMode = getVideoInputMode(klingV3.profile, "multi-shot")
assert.ok(multiShotMode, "Kling v3 multi-shot mode is missing.")
assert.throws(
  () =>
    serializeVideoStructuredFields({
      inputMode: multiShotMode,
      params: { "parameters.multi_prompt": "[]" },
    }),
  /fewer than 1 items/
)
assert.throws(
  () =>
    serializeVideoStructuredFields({
      inputMode: multiShotMode,
      params: {
        "parameters.duration": 10,
        "parameters.multi_prompt":
          '[{"index":1,"prompt":"fixture","duration":"5"}]',
      },
    }),
  /item durations must sum/
)

for (const title of [
  "HappyHorse-1.0-I2V",
  "HappyHorse-1.0-R2V",
  "HappyHorse-1.0-T2V",
  "HappyHorse-1.0-Video-Edit",
]) {
  const entry = VIDEO_OPENAPI_MODELS.find((candidate) => candidate.title === title)
  assert.equal(entry?.profile.submit.headers?.["X-DashScope-Async"], "enable")
}

console.log(
  `Checked ${VIDEO_OPENAPI_MODELS.length} video profiles (${incomplete.length} incomplete).`
)
