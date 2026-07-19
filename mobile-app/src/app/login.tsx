import { MaterialIcons } from "@expo/vector-icons"
import { Redirect } from "expo-router"
import { useState } from "react"
import { StyleSheet, View } from "react-native"

import {
  AppText,
  ErrorState,
  PrimaryButton,
  Screen,
  Surface,
} from "@/components/ui"
import { useAuth } from "@/lib/auth"
import { palette, radius, spacing } from "@/lib/theme"

export default function LoginScreen() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  if (auth.status === "signed_in") return <Redirect href="/models" />

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <View style={styles.markCore} />
        </View>
        <AppText variant="label" style={styles.brandLabel}>
          AstraFlow / Mobile
        </AppText>
      </View>

      <View style={styles.hero}>
        <AppText variant="display">把 Agent{`\n`}装进口袋。</AppText>
        <AppText style={styles.heroCopy}>
          在云端继续工作，或安全连接你的 Mac。任务、审批和结果跨设备实时接续。
        </AppText>
      </View>

      <Surface style={styles.modeCard}>
        <View style={styles.modeRow}>
          <View style={[styles.modeIcon, styles.cloudIcon]}>
            <MaterialIcons name="cloud-queue" size={22} color={palette.ink} />
          </View>
          <View style={styles.modeCopy}>
            <AppText variant="subtitle" style={styles.modeTitle}>云端 Sandbox</AppText>
            <AppText variant="caption" style={styles.muted}>
              手机退出后任务仍继续，完成后 Push 通知。
            </AppText>
          </View>
        </View>
        <View style={styles.rule} />
        <View style={styles.modeRow}>
          <View style={[styles.modeIcon, styles.macIcon]}>
            <MaterialIcons name="laptop-mac" size={22} color={palette.ink} />
          </View>
          <View style={styles.modeCopy}>
            <AppText variant="subtitle" style={styles.modeTitle}>连接我的 Mac</AppText>
            <AppText variant="caption" style={styles.muted}>
              Mac 只建立出站加密连接，本地文件默认不上云。
            </AppText>
          </View>
        </View>
      </Surface>

      {auth.error ? <ErrorState message={auth.error} /> : null}

      <PrimaryButton
        label="使用 UCloud 安全登录"
        icon="arrow-forward"
        tone="ink"
        busy={busy}
        onPress={() => {
          setBusy(true)
          void auth.signIn().finally(() => setBusy(false))
        }}
      />
      <AppText variant="caption" style={styles.privacy}>
        使用系统浏览器与 OAuth PKCE。AstraFlow App 内不包含 OAuth client secret。
      </AppText>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { justifyContent: "space-between", paddingTop: spacing.xl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "8deg" }],
  },
  markCore: {
    width: 17,
    height: 17,
    borderRadius: 5,
    backgroundColor: palette.signal,
  },
  brandLabel: { color: palette.textMuted },
  hero: { gap: spacing.lg, marginVertical: spacing.xl },
  heroCopy: { color: palette.textMuted, fontSize: 18, lineHeight: 27 },
  modeCard: { backgroundColor: palette.ink, borderColor: palette.ink },
  modeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  cloudIcon: { backgroundColor: palette.sky },
  macIcon: { backgroundColor: palette.signal },
  modeCopy: { flex: 1, gap: 3 },
  modeTitle: { color: palette.textOnDark },
  muted: { color: "#ADB7BC" },
  rule: { height: 1, backgroundColor: "#33434E" },
  privacy: { color: palette.textMuted, textAlign: "center" },
})
