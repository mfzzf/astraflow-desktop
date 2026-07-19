export function appendVoiceTranscriptToPrompt(
  currentPrompt: string,
  transcript: string
) {
  const trimmedTranscript = transcript.trim()

  if (!trimmedTranscript) {
    return null
  }

  return currentPrompt.trim()
    ? `${currentPrompt.replace(/\s+$/, "")}\n${trimmedTranscript}`
    : trimmedTranscript
}

export function describeVoiceRecordingStartError(
  error: unknown,
  locale: "en" | "zh"
) {
  const fallback =
    locale === "zh" ? "无法打开麦克风。" : "The microphone could not be opened."

  if (!(error instanceof Error)) {
    return fallback
  }

  if (
    error.name === "NotAllowedError" ||
    error.name === "PermissionDeniedError"
  ) {
    return locale === "zh"
      ? "麦克风权限被拒绝。请在系统设置的隐私与安全性中允许 AstraFlow 使用麦克风。"
      : "Microphone access was denied. Allow AstraFlow in Privacy & Security settings."
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return locale === "zh"
      ? "未找到麦克风，请连接后重试。"
      : "No microphone was found. Connect one and try again."
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return locale === "zh"
      ? "麦克风正被其他应用占用。请关闭其他录音应用后重试。"
      : "The microphone is busy. Close other audio apps and try again."
  }

  return error.message.trim() || fallback
}
