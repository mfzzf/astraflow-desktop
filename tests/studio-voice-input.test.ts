// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { formatVoiceRecordingDuration } from "@/hooks/use-voice-recorder"
import {
  appendVoiceTranscriptToPrompt,
  describeVoiceRecordingStartError,
} from "@/lib/voice-input"

describe("studio voice input", () => {
  test("appends recognized speech without disturbing prompt spacing", () => {
    expect(
      appendVoiceTranscriptToPrompt("Hello there   ", "  next line  ")
    ).toBe("Hello there\nnext line")
    expect(appendVoiceTranscriptToPrompt("", "  单独一段  ")).toBe("单独一段")
    expect(appendVoiceTranscriptToPrompt("Existing", "   ")).toBeNull()
  })

  test("formats recording duration and microphone permission errors", () => {
    expect(formatVoiceRecordingDuration(65_900)).toBe("1:05")

    const error = new Error("Permission denied")
    error.name = "NotAllowedError"

    expect(describeVoiceRecordingStartError(error, "zh")).toContain(
      "麦克风权限被拒绝"
    )
  })
})
