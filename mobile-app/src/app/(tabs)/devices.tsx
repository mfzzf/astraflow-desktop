import { MaterialIcons } from "@expo/vector-icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, StyleSheet, View } from "react-native"

import {
  crossDeviceServiceListDevices,
  crossDeviceServiceRevokeDevice,
  type AstraflowV1Device,
} from "@/generated/astraflow-api"
import {
  AppText,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Screen,
  StatusPill,
  Surface,
} from "@/components/ui"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { getOrCreateMobileDeviceId, useAuth } from "@/lib/auth"
import { readCachedDevices } from "@/lib/mobile-db"
import { palette, radius, spacing } from "@/lib/theme"

export default function DevicesScreen() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const currentDeviceId = useQuery({
    queryKey: ["mobile-device-id"],
    queryFn: getOrCreateMobileDeviceId,
    staleTime: Infinity,
  })
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        return (
          requireApiData(
            await crossDeviceServiceListDevices({
              headers: authorizationHeaders(authorization),
            }),
            "读取设备失败。"
          ).devices ?? []
        )
      } catch (error) {
        const cached = await readCachedDevices()
        if (cached.length) return cached
        throw error
      }
    },
    refetchInterval: 10_000,
  })

  const revoke = (device: AstraflowV1Device) => {
    Alert.alert(
      "撤销设备？",
      `${device.name || "该设备"} 将立即失去跨端访问权限。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "撤销",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const authorization = await auth.getAuthorization()
              requireApiData(
                await crossDeviceServiceRevokeDevice({
                  headers: authorizationHeaders(authorization),
                  path: { deviceId: device.id! },
                  body: {
                    deviceId: device.id,
                    expectedVersion: device.version,
                  },
                }),
                "撤销设备失败。"
              )
              await queryClient.invalidateQueries({ queryKey: ["devices"] })
            })().catch((error) =>
              Alert.alert(
                "撤销失败",
                error instanceof Error ? error.message : "请稍后重试。"
              )
            )
          },
        },
      ]
    )
  }

  return (
    <Screen>
      <PageHeader
        eyebrow="Device Relay"
        title="设备与连接"
        description="在线只表示安全通道可用；Workspace 能力会单独校验。"
        action={
          <IconButton
            icon="refresh"
            label="刷新"
            onPress={() => void devices.refetch()}
          />
        }
      />
      {devices.isLoading ? (
        <LoadingState label="正在检查设备在线状态…" />
      ) : null}
      {devices.error ? <ErrorState message={devices.error.message} /> : null}
      {!devices.isLoading && !devices.error && !devices.data?.length ? (
        <EmptyState
          icon="devices-other"
          title="还没有已注册设备"
          description="在 Mac 上登录 AstraFlow Desktop 后，它会自动出现在这里。"
        />
      ) : null}
      <View style={styles.list}>
        {(devices.data ?? []).map((device) => {
          const isCurrentDevice = device.id === currentDeviceId.data
          return (
            <Surface key={device.id} style={styles.deviceCard}>
              <View style={styles.deviceIcon}>
                <MaterialIcons
                  name={device.type === "desktop" ? "laptop-mac" : "smartphone"}
                  size={24}
                  color={palette.ink}
                />
              </View>
              <View style={styles.copy}>
                <View style={styles.titleRow}>
                  <AppText
                    variant="subtitle"
                    style={styles.flex}
                    numberOfLines={1}
                  >
                    {device.name || "未命名设备"}
                  </AppText>
                  <StatusPill
                    status={
                      device.revokedAt
                        ? "cancelled"
                        : device.online
                          ? "ready"
                          : "unavailable"
                    }
                    label={
                      device.revokedAt
                        ? "已撤销"
                        : device.online
                          ? "在线"
                          : "离线"
                    }
                  />
                </View>
                <AppText variant="caption" style={styles.muted}>
                  {isCurrentDevice ? "当前手机 · " : ""}
                  {device.platform} · v{device.appVersion || "?"} · protocol{" "}
                  {device.protocolVersion}
                </AppText>
                <View style={styles.capabilities}>
                  {capabilityLabels(device).map((label) => (
                    <View key={label} style={styles.capability}>
                      <AppText variant="caption">{label}</AppText>
                    </View>
                  ))}
                </View>
              </View>
              {!device.revokedAt && !isCurrentDevice ? (
                <IconButton
                  icon="block"
                  label="撤销设备"
                  onPress={() => revoke(device)}
                />
              ) : null}
            </Surface>
          )
        })}
      </View>
    </Screen>
  )
}

function capabilityLabels(device: AstraflowV1Device) {
  const capabilities = (device.capabilities ?? {}) as Record<string, unknown>
  const labels = []
  if (capabilities.local_agent) labels.push("本地 Agent")
  if (capabilities.local_files) labels.push("本地文件")
  if (capabilities.workspace_gateway) labels.push("Gateway")
  if (capabilities.approval_ui) labels.push("手机审批")
  if (capabilities.push) labels.push("Push")
  return labels.length ? labels : [device.type || "device"]
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  deviceCard: { flexDirection: "row", alignItems: "center" },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: spacing.sm },
  flex: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  muted: { color: palette.textMuted },
  capabilities: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  capability: {
    borderRadius: radius.pill,
    backgroundColor: palette.paperMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
})
