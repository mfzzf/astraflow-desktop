import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { crossDeviceServiceUpsertPushEndpoint } from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"

export type PushRegistrationResult = {
  status: "ready" | "simulator" | "denied" | "unconfigured"
  detail: string
}

function easProjectId() {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId
  )
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function registerPushEndpoint(
  authorization: string,
  deviceId: string
) {
  if (!Device.isDevice) {
    return {
      status: "simulator",
      detail: "模拟器不支持系统 Push token",
    } satisfies PushRegistrationResult
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("agent-runs", {
      name: "Agent Runs",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: "#D5FF5F",
    })
  }
  let permission = await Notifications.getPermissionsAsync()
  if (permission.status !== "granted") {
    permission = await Notifications.requestPermissionsAsync()
  }
  if (permission.status !== "granted") {
    return {
      status: "denied",
      detail: "系统通知权限未开启",
    } satisfies PushRegistrationResult
  }
  const projectId = easProjectId()
  if (!projectId) {
    return {
      status: "unconfigured",
      detail: "Expo EAS projectId 尚未配置",
    } satisfies PushRegistrationResult
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  requireApiData(
    await crossDeviceServiceUpsertPushEndpoint({
      headers: authorizationHeaders(authorization),
      body: {
        endpointId: `push_${deviceId}`,
        deviceId,
        provider: "expo",
        token,
        locale: "zh-CN",
        enabled: true,
      },
    }),
    "注册 Push 通知失败。"
  )
  return {
    status: "ready",
    detail: "完成、失败、审批与提问通知已启用",
  } satisfies PushRegistrationResult
}

export async function disablePushEndpoint(
  authorization: string,
  deviceId: string
) {
  if (!Device.isDevice) return
  const projectId = easProjectId()
  if (!projectId) return

  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const request = (async () => {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId }))
      .data
    requireApiData(
      await crossDeviceServiceUpsertPushEndpoint({
        headers: authorizationHeaders(authorization),
        body: {
          endpointId: `push_${deviceId}`,
          deviceId,
          provider: "expo",
          token,
          locale: "zh-CN",
          enabled: false,
        },
        signal: controller.signal,
      }),
      "停用 Push 通知失败。"
    )
  })()
  try {
    await Promise.race([
      request,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve()
        }, 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
