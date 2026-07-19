export function shouldShowStreamingThinking({
  streaming,
  renderablePartCount,
  filePartCount,
}: {
  streaming: boolean
  renderablePartCount: number
  filePartCount: number
}) {
  return streaming && renderablePartCount === 0 && filePartCount === 0
}
