export function shouldShowStreamingThinking({
  streaming,
  hasActiveStreamingPart,
}: {
  streaming: boolean
  hasActiveStreamingPart: boolean
}) {
  return streaming && !hasActiveStreamingPart
}
