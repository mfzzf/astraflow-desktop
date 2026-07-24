function readyStatus(platform) {
  return {
    platform,
    supported: true,
    ready: true,
    needsInstall: false,
  }
}

function createWindowsSandboxEnvironmentManager({
  platform = process.platform,
  getSrtWinPath,
  loadSandboxRuntime = () => import("@anthropic-ai/sandbox-runtime"),
}) {
  let installPromise = null

  async function inspect() {
    if (platform !== "win32") {
      return readyStatus(platform)
    }

    try {
      const sandboxRuntime = await loadSandboxRuntime()
      const srtWin = sandboxRuntime.resolveSrtWin({ path: getSrtWinPath() })
      const user = sandboxRuntime.getWindowsSandboxUserStatus({ srtWin })

      if (!user.provisioned || !user.credPresent) {
        return {
          platform,
          supported: true,
          ready: false,
          needsInstall: true,
          message:
            "The dedicated Windows sandbox account and network fence have not been provisioned.",
        }
      }

      await sandboxRuntime.verifyWindowsWfpEgress({ srtWin })
      return readyStatus(platform)
    } catch (error) {
      return {
        platform,
        supported: true,
        ready: false,
        needsInstall: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async function performInstall() {
    const current = await inspect()

    if (current.ready || platform !== "win32") {
      return current
    }

    try {
      const sandboxRuntime = await loadSandboxRuntime()
      const srtWin = sandboxRuntime.resolveSrtWin({ path: getSrtWinPath() })
      const result = sandboxRuntime.installWindowsSandbox({ srtWin })

      if (result.cancelled) {
        return {
          platform,
          supported: true,
          ready: false,
          needsInstall: true,
          cancelled: true,
          message: "Windows sandbox setup was cancelled.",
        }
      }

      await sandboxRuntime.verifyWindowsWfpEgress({ srtWin })
      return readyStatus(platform)
    } catch (error) {
      return {
        platform,
        supported: true,
        ready: false,
        needsInstall: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  function install() {
    if (!installPromise) {
      installPromise = performInstall().finally(() => {
        installPromise = null
      })
    }

    return installPromise
  }

  return {
    ensureReady: install,
    getStatus: inspect,
    install,
  }
}

module.exports = {
  createWindowsSandboxEnvironmentManager,
}
