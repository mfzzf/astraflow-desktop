export function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ""
  }

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("file://")
  ) {
    return trimmed
  }

  if (trimmed.includes(".") || trimmed.includes(":")) {
    return `https://${trimmed}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function getBrowserTabTitle(url: string) {
  if (!url) {
    return "新选项卡"
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "") || "浏览器"
  } catch {
    return "浏览器"
  }
}
