import NetInfo from "@react-native-community/netinfo"
import { useQueryClient } from "@tanstack/react-query"
import Constants from "expo-constants"
import * as Device from "expo-device"
import EventSource, { type EventSourceListener } from "react-native-sse"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"
import { AppState, Platform } from "react-native"

import {
  crossDeviceServiceGetSyncSnapshot,
  crossDeviceServicePullSyncEvents,
  crossDeviceServiceRegisterDevice,
  type AstraflowV1SyncEventEnvelope,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { apiBaseUrl } from "@/lib/api-client-config"
import { getOrCreateMobileDeviceId, useAuth } from "@/lib/auth"
import {
  applySyncEvent,
  claimOutbox,
  getSyncCursor,
  persistSyncSnapshot,
} from "@/lib/mobile-db"
import { registerPushEndpoint } from "@/lib/notifications"
import type { PushRegistrationResult } from "@/lib/notifications"
import { processTaskOutboxItem } from "@/lib/submit-task"

type SyncStatus = "idle" | "syncing" | "live" | "offline" | "error"

type SyncContextValue = {
  status: SyncStatus
  lastSyncedAt: string | null
  error: string | null
  pushStatus:
    "idle" | "registering" | "error" | PushRegistrationResult["status"]
  pushDetail: string
  syncNow: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue | null>(null)

const invalidationKeys = [
  ["sessions"],
  ["devices"],
  ["workspaces"],
  ["runs"],
  ["run-events"],
  ["messages"],
  ["actions"],
] as const

export function CrossDeviceSyncProvider({ children }: PropsWithChildren) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pushStatus, setPushStatus] =
    useState<SyncContextValue["pushStatus"]>("idle")
  const [pushDetail, setPushDetail] = useState("等待注册通知能力")
  const sourceRef = useRef<EventSource<
    "sync" | "resync_required" | "reconnect"
  > | null>(null)
  const activeSync = useRef<Promise<void> | null>(null)
  const appIsActive = useRef(AppState.currentState === "active")
  const networkIsOnline = useRef(true)

  const invalidate = useCallback(async () => {
    await Promise.all(
      invalidationKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] })
      )
    )
  }, [queryClient])

  const syncNow = useCallback(async () => {
    if (auth.status !== "signed_in") return
    if (activeSync.current) return activeSync.current
    activeSync.current = (async () => {
      setStatus("syncing")
      setError(null)
      const authorization = await auth.getAuthorization()
      const deviceId = await getOrCreateMobileDeviceId()
      requireApiData(
        await crossDeviceServiceRegisterDevice({
          headers: authorizationHeaders(authorization),
          body: {
            deviceId,
            type: "mobile",
            name: Device.deviceName || "Android",
            platform: `${Platform.OS}-${Platform.Version}`,
            appVersion: Constants.expoConfig?.version || "development",
            protocolVersion: 1,
            capabilities: {
              approval_ui: true,
              attachments: true,
              push: true,
              screen_control: false,
            },
            clientMutationId: `mobile-register:${deviceId}:${Constants.expoConfig?.version || "development"}:v1`,
          },
        }),
        "注册手机设备失败。"
      )

      let cursor = await getSyncCursor()
      if (cursor === 0) {
        const snapshot = requireApiData(
          await crossDeviceServiceGetSyncSnapshot({
            headers: authorizationHeaders(authorization),
            query: { includeArchivedSessions: true },
          }),
          "同步快照失败。"
        )
        await persistSyncSnapshot(snapshot)
        cursor = Number(snapshot.cursor ?? 0)
      }

      for (;;) {
        const page = requireApiData(
          await crossDeviceServicePullSyncEvents({
            headers: authorizationHeaders(authorization),
            query: { after: String(cursor), limit: 200 },
          }),
          "补拉同步事件失败。"
        )
        if (page.resyncRequired) {
          const snapshot = requireApiData(
            await crossDeviceServiceGetSyncSnapshot({
              headers: authorizationHeaders(authorization),
              query: { includeArchivedSessions: true },
            }),
            "重新同步快照失败。"
          )
          await persistSyncSnapshot(snapshot)
          cursor = Number(snapshot.cursor ?? 0)
          break
        }
        for (const event of page.events ?? []) {
          await applySyncEvent(event)
          cursor = Number(event.cursor ?? cursor)
        }
        if (!page.hasMore) break
      }

      for (const item of await claimOutbox()) {
        await processTaskOutboxItem(authorization, item)
      }

      setLastSyncedAt(new Date().toISOString())
      await invalidate()
      setStatus("live")

      setPushStatus("registering")
      setPushDetail("正在注册 Expo Push endpoint")
      void registerPushEndpoint(authorization, deviceId)
        .then((result) => {
          setPushStatus(result.status)
          setPushDetail(result.detail)
        })
        .catch((caught) => {
          setPushStatus("error")
          setPushDetail(
            caught instanceof Error ? caught.message : "Push 注册失败。"
          )
        })
    })()
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "同步失败。"
        setError(message)
        setStatus(networkIsOnline.current ? "error" : "offline")
        throw caught
      })
      .finally(() => {
        activeSync.current = null
      })
    return activeSync.current
  }, [auth, invalidate])

  const stopStream = useCallback(() => {
    sourceRef.current?.removeAllEventListeners()
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const startStream = useCallback(async () => {
    stopStream()
    if (
      auth.status !== "signed_in" ||
      !appIsActive.current ||
      !networkIsOnline.current
    ) {
      return
    }
    await syncNow()
    const authorization = await auth.getAuthorization()
    const cursor = await getSyncCursor()
    const source = new EventSource<"sync" | "resync_required" | "reconnect">(
      `${apiBaseUrl || ""}/v1/sync/stream?after=${cursor}`,
      {
        headers: { Authorization: authorization },
        timeout: 15_000,
        pollingInterval: 1_000,
        lineEndingCharacter: "\n",
      }
    )
    sourceRef.current = source
    const onSync: EventSourceListener<"sync"> = (event) => {
      if (event.type !== "sync" || !event.data) return
      const data = event.data
      void (async () => {
        const envelope = JSON.parse(data) as AstraflowV1SyncEventEnvelope
        if (await applySyncEvent(envelope)) await invalidate()
        setStatus("live")
        setLastSyncedAt(new Date().toISOString())
      })().catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "实时事件处理失败。"
        )
      )
    }
    const onResync: EventSourceListener<"resync_required"> = () => {
      stopStream()
      void syncNow()
        .then(startStream)
        .catch(() => undefined)
    }
    const onReconnect: EventSourceListener<"reconnect"> = () => {
      source.close()
    }
    source.addEventListener("sync", onSync)
    source.addEventListener("resync_required", onResync)
    source.addEventListener("reconnect", onReconnect)
  }, [auth, invalidate, stopStream, syncNow])

  useEffect(() => {
    if (auth.status !== "signed_in") {
      stopStream()
      return
    }
    void startStream().catch(() => undefined)
    const appSubscription = AppState.addEventListener("change", (next) => {
      appIsActive.current = next === "active"
      if (appIsActive.current) void startStream().catch(() => undefined)
      else stopStream()
    })
    const networkSubscription = NetInfo.addEventListener((state) => {
      networkIsOnline.current = Boolean(state.isConnected)
      if (!networkIsOnline.current) {
        setStatus("offline")
        stopStream()
      } else if (appIsActive.current) {
        void startStream().catch(() => undefined)
      }
    })
    return () => {
      appSubscription.remove()
      networkSubscription()
      stopStream()
    }
  }, [auth.status, startStream, stopStream])

  const value = useMemo(
    () => ({ status, lastSyncedAt, error, pushStatus, pushDetail, syncNow }),
    [error, lastSyncedAt, pushDetail, pushStatus, status, syncNow]
  )
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useCrossDeviceSync() {
  const value = useContext(SyncContext)
  if (!value) throw new Error("useCrossDeviceSync must be used inside provider")
  return value
}
