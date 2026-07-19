import { MaterialIcons } from "@expo/vector-icons"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native"

import {
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PrimaryButton,
  Screen,
  Surface,
} from "@/components/ui"
import {
  automationServiceCreateAutomation,
  automationServiceListAutomations,
  automationServiceSetAutomationEnabled,
  crossDeviceServiceListWorkspaces,
  type AstraflowV1CloudAutomation,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { getOrCreateMobileDeviceId, useAuth } from "@/lib/auth"
import { createId } from "@/lib/ids"
import { palette, radius, spacing } from "@/lib/theme"

export default function AutomationsScreen() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [scheduleKind, setScheduleKind] = useState<"daily" | "interval">(
    "daily"
  )
  const [scheduleValue, setScheduleValue] = useState("09:00")

  const list = useQuery({
    queryKey: ["automations"],
    queryFn: async () => {
      const authorization = await auth.getAuthorization()
      return requireApiData(
        await automationServiceListAutomations({
          headers: authorizationHeaders(authorization),
          query: { pageSize: 100 },
        }),
        "读取云端自动化失败。"
      )
    },
  })
  const workspaces = useQuery({
    queryKey: ["workspaces", "automation"],
    queryFn: async () => {
      const authorization = await auth.getAuthorization()
      return (
        requireApiData(
          await crossDeviceServiceListWorkspaces({
            headers: authorizationHeaders(authorization),
          }),
          "读取云端 Workspace 失败。"
        ).workspaces ?? []
      ).filter(
        (workspace) =>
          workspace.type === "sandbox" &&
          workspace.state !== "deleted" &&
          workspace.state !== "unavailable"
      )
    },
  })
  const effectiveWorkspaceId = workspaces.data?.some(
    (workspace) => workspace.id === workspaceId
  )
    ? workspaceId
    : (workspaces.data?.[0]?.id ?? "")

  const create = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim()
      const cleanPrompt = prompt.trim()
      if (!cleanName || !cleanPrompt || !effectiveWorkspaceId) {
        throw new Error("名称、任务内容和云端 Workspace 都是必填项。")
      }
      let expression = scheduleValue.trim()
      if (scheduleKind === "daily") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(expression)) {
          throw new Error("每日时间请使用 24 小时制 HH:MM。")
        }
      } else {
        const minutes = Number(expression)
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43_200) {
          throw new Error("间隔分钟数必须在 5 到 43200 之间。")
        }
        expression = String(minutes * 60)
      }
      const authorization = await auth.getAuthorization()
      const deviceId = await getOrCreateMobileDeviceId()
      const automationId = createId("automation")
      return requireApiData(
        await automationServiceCreateAutomation({
          headers: authorizationHeaders(authorization),
          body: {
            automationId,
            workspaceId: effectiveWorkspaceId,
            name: cleanName,
            prompt: cleanPrompt,
            runtimeId: "astraflow",
            model: "gpt-5.6-sol",
            permissionMode: "default",
            scheduleKind,
            scheduleExpression: expression,
            timeZone:
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "Asia/Shanghai",
            enabled: true,
            sourceDeviceId: deviceId,
            clientMutationId: `${automationId}:create`,
          },
        }),
        "创建云端自动化失败。"
      )
    },
    onSuccess: async () => {
      setName("")
      setPrompt("")
      setCreating(false)
      await queryClient.invalidateQueries({ queryKey: ["automations"] })
      Alert.alert("已创建", "自动化会在云端 Sandbox 中按计划执行。")
    },
  })

  const toggle = useMutation({
    mutationFn: async (automation: AstraflowV1CloudAutomation) => {
      const authorization = await auth.getAuthorization()
      const deviceId = await getOrCreateMobileDeviceId()
      return requireApiData(
        await automationServiceSetAutomationEnabled({
          headers: authorizationHeaders(authorization),
          path: { automationId: automation.id! },
          body: {
            automationId: automation.id,
            expectedVersion: automation.version,
            enabled: !automation.enabled,
            sourceDeviceId: deviceId,
            clientMutationId: `${automation.id}:enabled:${automation.version}:${!automation.enabled}`,
          },
        }),
        "更新自动化状态失败。"
      )
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["automations"] }),
  })

  return (
    <Screen>
      <PageHeader
        eyebrow="云端计划任务"
        title="Automations"
        description="手机退出、Mac 离线时，计划仍由云端持久化并执行。"
        action={
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreating((value) => !value)}
            style={styles.addButton}
          >
            <MaterialIcons
              name={creating ? "close" : "add"}
              size={22}
              color={palette.ink}
            />
          </Pressable>
        }
      />
      {creating ? (
        <Surface style={styles.form}>
          <AppText variant="subtitle">新建云端自动化</AppText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="名称"
            placeholderTextColor={palette.textMuted}
            style={styles.input}
          />
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="每次运行时交给 Agent 的任务"
            placeholderTextColor={palette.textMuted}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.prompt]}
          />
          <AppText variant="label" style={styles.muted}>
            云端 Workspace
          </AppText>
          <View style={styles.chips}>
            {(workspaces.data ?? []).map((workspace) => (
              <Choice
                key={workspace.id}
                label={workspace.name || "Sandbox"}
                selected={workspace.id === effectiveWorkspaceId}
                onPress={() => setWorkspaceId(workspace.id || "")}
              />
            ))}
          </View>
          <View style={styles.chips}>
            <Choice
              label="每天"
              selected={scheduleKind === "daily"}
              onPress={() => {
                setScheduleKind("daily")
                setScheduleValue("09:00")
              }}
            />
            <Choice
              label="按间隔"
              selected={scheduleKind === "interval"}
              onPress={() => {
                setScheduleKind("interval")
                setScheduleValue("60")
              }}
            />
          </View>
          <TextInput
            value={scheduleValue}
            onChangeText={setScheduleValue}
            placeholder={scheduleKind === "daily" ? "09:00" : "分钟数"}
            placeholderTextColor={palette.textMuted}
            keyboardType={
              scheduleKind === "daily"
                ? "numbers-and-punctuation"
                : "number-pad"
            }
            style={styles.input}
          />
          {create.error ? <ErrorState message={create.error.message} /> : null}
          <PrimaryButton
            label="创建并启用"
            icon="schedule"
            tone="ink"
            busy={create.isPending}
            onPress={() => create.mutate()}
          />
        </Surface>
      ) : null}

      {list.isLoading ? <LoadingState label="正在读取计划任务…" /> : null}
      {list.error ? (
        <ErrorState
          message={list.error.message}
          retry={() => void list.refetch()}
        />
      ) : null}
      {!list.isLoading && !list.error && !list.data?.automations?.length ? (
        <EmptyState
          icon="schedule"
          title="还没有云端自动化"
          description="创建每日或间隔任务；每次触发都会生成普通 Session 与 Run。"
        />
      ) : null}
      <View style={styles.list}>
        {(list.data?.automations ?? []).map((automation) => (
          <Surface key={automation.id} style={styles.card}>
            <View style={styles.icon}>
              <MaterialIcons name="schedule" size={23} color={palette.ink} />
            </View>
            <View style={styles.flex}>
              <AppText variant="subtitle">{automation.name}</AppText>
              <AppText variant="caption" numberOfLines={2} style={styles.muted}>
                {automation.prompt}
              </AppText>
              <AppText variant="mono" style={styles.muted}>
                {scheduleLabel(automation)}
              </AppText>
              {automation.lastError ? (
                <AppText
                  variant="caption"
                  style={styles.error}
                  numberOfLines={2}
                >
                  {automation.lastError}
                </AppText>
              ) : null}
            </View>
            <Switch
              value={Boolean(automation.enabled)}
              disabled={toggle.isPending}
              onValueChange={() => toggle.mutate(automation)}
              trackColor={{ false: palette.border, true: palette.signal }}
              thumbColor={palette.ink}
            />
          </Surface>
        ))}
      </View>
      {toggle.error ? <ErrorState message={toggle.error.message} /> : null}
    </Screen>
  )
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <AppText variant="caption" style={selected && styles.chipTextSelected}>
        {label}
      </AppText>
    </Pressable>
  )
}

function scheduleLabel(automation: AstraflowV1CloudAutomation) {
  const schedule =
    automation.scheduleKind === "daily"
      ? `每天 ${automation.scheduleExpression}`
      : automation.scheduleKind === "interval"
        ? `每 ${Math.round(Number(automation.scheduleExpression) / 60)} 分钟`
        : automation.scheduleExpression
  const next = automation.nextRunAt
    ? new Date(automation.nextRunAt).toLocaleString()
    : "暂无下次运行"
  return `${schedule} · ${next}`
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  form: { gap: spacing.md },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    paddingHorizontal: spacing.md,
    color: palette.text,
    fontFamily: "IBMPlexSans_400Regular",
  },
  prompt: { minHeight: 110, paddingTop: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipTextSelected: { color: palette.textOnDark },
  list: { gap: spacing.md },
  card: { flexDirection: "row", alignItems: "flex-start" },
  icon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: palette.sky,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: { color: palette.textMuted },
  error: { color: palette.danger },
})
