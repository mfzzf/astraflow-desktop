export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return
  }

  const { ensureMobileChannelRuntimeStarted } =
    await import("./lib/mobile-channels/runtime")
  void ensureMobileChannelRuntimeStarted()

  const { ensureAutomationRuntimeStarted } =
    await import("./lib/automations/runtime")
  ensureAutomationRuntimeStarted()

  const { ensureCrossDeviceSyncStarted } =
    await import("./lib/cross-device/sync-coordinator")
  void ensureCrossDeviceSyncStarted()

  const { ensureDeviceRelayStarted } =
    await import("./lib/cross-device/device-relay-runtime")
  void ensureDeviceRelayStarted()
}
