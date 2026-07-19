import { MaterialIcons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import type { ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { font, palette, radius, spacing, statusColor } from "@/lib/theme"

export function AppText({
  variant = "body",
  style,
  ...props
}: TextProps & {
  variant?: "display" | "title" | "subtitle" | "body" | "label" | "caption" | "mono"
}) {
  return <Text {...props} style={[styles.text, textVariants[variant], style]} />
}

const textVariants: Record<string, TextStyle> = {
  display: {
    fontFamily: font.display,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.2,
  },
  title: {
    fontFamily: font.display,
    fontSize: 29,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: font.semibold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 23 },
  label: {
    fontFamily: font.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  caption: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  mono: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 19,
    fontVariant: ["tabular-nums"],
  },
}

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
  ...props
}: ScrollViewProps & { scroll?: boolean }) {
  const content = (
    <>
      <View pointerEvents="none" style={styles.atmosphereTop} />
      <View pointerEvents="none" style={styles.atmosphereBottom} />
      {children}
    </>
  )
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          {...props}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.screenContent, contentContainerStyle]}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, styles.flex, contentContainerStyle]}>
          {content}
        </View>
      )}
    </SafeAreaView>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <AppText variant="label" style={styles.eyebrow}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="title">{title}</AppText>
        {description ? (
          <AppText style={styles.description}>{description}</AppText>
        ) : null}
      </View>
      {action}
    </View>
  )
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.surface, style]}>{children}</View>
}

export function PrimaryButton({
  label,
  icon,
  busy,
  tone = "signal",
  style,
  disabled,
  onPress,
  ...props
}: Omit<PressableProps, "children"> & {
  label: string
  icon?: keyof typeof MaterialIcons.glyphMap
  busy?: boolean
  tone?: "signal" | "ink" | "danger" | "quiet"
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      {...props}
      disabled={disabled || busy}
      onPress={(event) => {
        void Haptics.selectionAsync()
        onPress?.(event)
      }}
      style={({ pressed }) => [
        styles.button,
        buttonTones[tone],
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === "ink" ? palette.white : palette.ink} />
      ) : icon ? (
        <MaterialIcons
          name={icon}
          size={19}
          color={tone === "ink" || tone === "danger" ? palette.white : palette.ink}
        />
      ) : null}
      <AppText
        style={[
          styles.buttonLabel,
          (tone === "ink" || tone === "danger") && styles.buttonLabelLight,
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  )
}

const buttonTones: Record<string, ViewStyle> = {
  signal: { backgroundColor: palette.signal },
  ink: { backgroundColor: palette.ink },
  danger: { backgroundColor: palette.danger },
  quiet: { backgroundColor: palette.paperMuted },
}

export function IconButton({
  icon,
  label,
  ...props
}: Omit<PressableProps, "children"> & {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
}) {
  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <MaterialIcons name={icon} size={22} color={palette.ink} />
    </Pressable>
  )
}

export function StatusPill({ status, label }: { status?: string; label?: string }) {
  const color = statusColor(status)
  return (
    <View style={[styles.statusPill, { borderColor: color }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <AppText variant="label" style={[styles.statusText, { color }]}>
        {label || status || "unknown"}
      </AppText>
    </View>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Surface style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <MaterialIcons name={icon} size={28} color={palette.ink} />
      </View>
      <AppText variant="subtitle">{title}</AppText>
      <AppText style={styles.emptyDescription}>{description}</AppText>
      {action}
    </Surface>
  )
}

export function LoadingState({ label = "正在连接…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.ink} />
      <AppText style={styles.description}>{label}</AppText>
    </View>
  )
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Surface style={styles.errorSurface}>
      <MaterialIcons name="error-outline" size={24} color={palette.danger} />
      <View style={styles.flex}>
        <AppText variant="subtitle">没有成功完成</AppText>
        <AppText style={styles.description}>{message}</AppText>
      </View>
      {retry ? <IconButton icon="refresh" label="重试" onPress={retry} /> : null}
    </Surface>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.paper },
  flex: { flex: 1 },
  screenContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 112,
    gap: spacing.lg,
    backgroundColor: palette.paper,
    overflow: "hidden",
  },
  atmosphereTop: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: palette.sky,
    opacity: 0.2,
    right: -105,
    top: -85,
  },
  atmosphereBottom: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 42,
    borderColor: palette.signal,
    opacity: 0.12,
    left: -150,
    bottom: -120,
  },
  text: { color: palette.text, fontFamily: font.body },
  pageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: palette.signalDark },
  description: { color: palette.textMuted },
  surface: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonLabel: { fontFamily: font.semibold, color: palette.ink },
  buttonLabelLight: { color: palette.white },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.paperRaised,
    borderWidth: 1,
    borderColor: palette.border,
  },
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 10 },
  emptyState: { alignItems: "center", paddingVertical: spacing.xxl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyDescription: {
    color: palette.textMuted,
    textAlign: "center",
    maxWidth: 300,
  },
  loading: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  errorSurface: { flexDirection: "row", alignItems: "center" },
})
