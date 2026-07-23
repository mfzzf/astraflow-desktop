import type {
  CompShareApiKey,
  CompShareApiKeysResponse,
  ModelverseApiKeyOption,
} from "./types"

export function resolveCompShareApiKeyOptions(
  groups: readonly CompShareApiKeysResponse[]
) {
  const keysByCode = new Map<string, CompShareApiKey>()

  for (const group of groups) {
    for (const key of group.keys) {
      if (key.status === 1) {
        keysByCode.set(key.code, key)
      }
    }
  }

  const items: ModelverseApiKeyOption[] = Array.from(
    keysByCode.values(),
    (key) => ({
      id: key.code,
      name: [key.name.trim() || key.code, key.maskedApiKey?.trim() || null]
        .filter(Boolean)
        .join(" · "),
    })
  )
  const selectedKeyCode =
    groups.find((group) => group.selectedKeyCode)?.selectedKeyCode ?? null

  return {
    items,
    selected: items.find((item) => item.id === selectedKeyCode) ?? null,
  }
}
