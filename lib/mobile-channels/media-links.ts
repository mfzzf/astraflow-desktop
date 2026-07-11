import type { StudioMediaGenerationOutput } from "@/lib/studio-types"

export function resolveMobileChannelMediaDownloadUrl(
  output: Pick<StudioMediaGenerationOutput, "contentUrl" | "url">
) {
  for (const candidate of [output.url, output.contentUrl]) {
    const value = candidate?.trim()
    if (!value) {
      continue
    }

    try {
      const parsed = new URL(value)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return value
      }
    } catch {
      // Relative desktop routes and data URLs are not reachable from a phone.
    }
  }

  return null
}
