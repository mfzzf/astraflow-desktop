export type DesktopNotificationAction = {
  id: string
  label: string
}

export type DesktopNotificationInput = {
  id?: string
  title: string
  body?: string
  silent?: boolean
  path?: string
  actions?: DesktopNotificationAction[]
}

export async function isDesktopNotificationSupported() {
  const bridge = window.astraflowDesktop

  if (bridge?.isNotificationSupported) {
    try {
      return await bridge.isNotificationSupported()
    } catch {
      return false
    }
  }

  return "Notification" in window && window.isSecureContext
}

export async function requestDesktopNotificationPermission() {
  if (window.astraflowDesktop?.showNotification) return "granted" as const
  if (!("Notification" in window) || !window.isSecureContext) {
    return "unsupported" as const
  }
  if (Notification.permission !== "default") return Notification.permission

  return Notification.requestPermission()
}

export async function showDesktopNotification(
  input: DesktopNotificationInput
) {
  const bridge = window.astraflowDesktop

  if (bridge?.showNotification) {
    try {
      return await bridge.showNotification(input)
    } catch {
      return false
    }
  }

  if (
    !("Notification" in window) ||
    !window.isSecureContext ||
    Notification.permission !== "granted"
  ) {
    return false
  }

  const notification = new Notification(input.title, {
    body: input.body,
    silent: input.silent,
    tag: input.id,
  })

  notification.addEventListener("click", () => {
    window.focus()
    if (input.path?.startsWith("/")) {
      // Browser notifications fire outside React's event tree.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(input.path)
    }
  })

  return true
}
