const WINDOWS_SRT_TIMEOUT_PATTERN =
  /\bsrt-win\b[\s\S]*\bspawn failed\b[\s\S]*\bETIMEDOUT\b/i

export function isTransientWindowsSrtTimeout(error) {
  return (
    error instanceof Error &&
    WINDOWS_SRT_TIMEOUT_PATTERN.test(error.message)
  )
}

/**
 * srt-win status probes are synchronous and can hit their bounded timeout
 * when Windows or the Base Filtering Engine is temporarily busy. Retry one
 * time without weakening the fail-closed checks: startup proceeds only after
 * the same operation completes successfully.
 */
export async function runWithTransientWindowsSrtRetry(
  operation,
  {
    beforeRetry = () => {},
    platform = process.platform,
    wait = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}
) {
  const maxAttempts = platform === "win32" ? 2 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !isTransientWindowsSrtTimeout(error)
      ) {
        throw error
      }

      await beforeRetry()
      await wait(250)
    }
  }

  throw new Error("Windows sandbox retry ended without a result.")
}
