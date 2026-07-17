type ScreenshotDemoEnvironment = {
  [key: string]: string | undefined
  ASTRAFLOW_DEMO_MODE?: string
  ASTRAFLOW_ELECTRON?: string
  ASTRAFLOW_ELECTRON_DEV?: string
  ASTRAFLOW_ELECTRON_SCREENSHOT?: string
}

export function isScreenshotDemoMode(
  env: ScreenshotDemoEnvironment = process.env
) {
  return (
    env.ASTRAFLOW_DEMO_MODE === "1" &&
    env.ASTRAFLOW_ELECTRON === "1" &&
    env.ASTRAFLOW_ELECTRON_DEV === "1" &&
    env.ASTRAFLOW_ELECTRON_SCREENSHOT === "1"
  )
}
