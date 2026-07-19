import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { Alert, Pressable, StyleSheet, View } from "react-native"

import {
  AppText,
  PageHeader,
  Screen,
  StatusPill,
  Surface,
} from "@/components/ui"
import { useAuth } from "@/lib/auth"
import { useCrossDeviceSync } from "@/lib/sync"
import { palette, radius, spacing } from "@/lib/theme"

export default function SettingsScreen() {
  const auth = useAuth()
  const router = useRouter()
  const sync = useCrossDeviceSync()
  return (
    <Screen>
      <PageHeader
        eyebrow="账户与隐私"
        title="设置"
        description="管理同步、通知、安全会话与设备撤销。"
      />
      <Surface style={styles.accountCard}>
        <View style={styles.avatar}>
          <AppText variant="title" style={styles.avatarText}>
            {(auth.account?.displayName || auth.account?.email || "A")
              .slice(0, 1)
              .toUpperCase()}
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="subtitle">
            {auth.account?.displayName || "UCloud 用户"}
          </AppText>
          <AppText variant="caption" style={styles.muted} numberOfLines={1}>
            {auth.account?.email || `Account ${auth.account?.id?.slice(0, 8)}`}
          </AppText>
        </View>
        <StatusPill status="ready" label="已登录" />
      </Surface>

      <AppText variant="label" style={styles.sectionLabel}>
        运行状态
      </AppText>
      <Surface style={styles.settingsGroup}>
        <SettingRow
          icon="sync"
          title="跨端同步"
          detail={sync.error || syncStatusLabel(sync.status)}
          onPress={() => void sync.syncNow()}
        />
        <View style={styles.rule} />
        <SettingRow
          icon="notifications-none"
          title="Agent 通知"
          detail={sync.pushDetail}
          onPress={() => void sync.syncNow()}
        />
        <View style={styles.rule} />
        <SettingRow
          icon="security"
          title="隐私保护"
          detail="本机文件默认不上云"
        />
      </Surface>

      <AppText variant="label" style={styles.sectionLabel}>
        工作方式
      </AppText>
      <Surface style={styles.settingsGroup}>
        <SettingRow
          icon="groups"
          title="Experts 专家团"
          detail="专业角色、SKILLS 与工具策略"
          onPress={() => router.push("/experts")}
        />
        <View style={styles.rule} />
        <SettingRow
          icon="schedule"
          title="Automations"
          detail="查看与创建云端计划任务"
          onPress={() => router.push("/automations")}
        />
      </Surface>

      <AppText variant="label" style={styles.sectionLabel}>
        安全
      </AppText>
      <Surface style={styles.settingsGroup}>
        <SettingRow
          icon="logout"
          title="退出登录"
          detail="移除本机 SecureStore 中的 OAuth 令牌"
          destructive
          onPress={() =>
            Alert.alert(
              "退出 AstraFlow？",
              "离线缓存会保留；再次登录后继续同步。",
              [
                { text: "取消", style: "cancel" },
                {
                  text: "退出",
                  style: "destructive",
                  onPress: () => void auth.signOut(),
                },
              ]
            )
          }
        />
      </Surface>

      <AppText variant="caption" style={styles.footer}>
        AstraFlow Mobile · protocol 1 · Expo SDK 57
      </AppText>
    </Screen>
  )
}

function SettingRow({
  icon,
  title,
  detail,
  destructive,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
  detail: string
  destructive?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.rowIcon, destructive && styles.dangerIcon]}>
        <MaterialIcons
          name={icon}
          size={21}
          color={destructive ? palette.danger : palette.ink}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="subtitle" style={destructive && styles.dangerText}>
          {title}
        </AppText>
        <AppText variant="caption" style={styles.muted}>
          {detail}
        </AppText>
      </View>
      {onPress ? (
        <MaterialIcons
          name="chevron-right"
          size={22}
          color={palette.textMuted}
        />
      ) : null}
    </Pressable>
  )
}

function syncStatusLabel(status: string) {
  if (status === "live") return "已连接实时事件流"
  if (status === "syncing") return "正在补拉持久化事件"
  if (status === "offline") return "离线 · 将从 cursor 恢复"
  if (status === "error") return "同步遇到问题"
  return "等待同步"
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  accountCard: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: palette.signal },
  muted: { color: palette.textMuted },
  sectionLabel: { color: palette.textMuted, marginTop: spacing.sm },
  settingsGroup: { paddingVertical: spacing.sm, gap: 0 },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.paperMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerIcon: { backgroundColor: "#F7DAD5" },
  dangerText: { color: palette.danger },
  rule: { height: 1, backgroundColor: palette.border, marginLeft: 52 },
  pressed: { opacity: 0.65 },
  footer: {
    color: palette.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
  },
})
