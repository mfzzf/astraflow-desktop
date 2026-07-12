export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    const description =
      typeof record.description === "string"
        ? record.description
        : typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : null
    const code =
      typeof record.code === "string" || typeof record.code === "number"
        ? String(record.code)
        : null

    if (description && code && !description.includes(code)) {
      return `${description} (${code})`
    }
    if (description) {
      return description
    }
    if (code) {
      return `平台返回错误 ${code}`
    }
  }
  if (
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return String(error)
  }
  return "平台返回了未识别的错误。"
}
