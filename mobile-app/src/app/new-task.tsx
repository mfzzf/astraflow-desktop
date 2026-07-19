import NetInfo from "@react-native-community/netinfo"
import { MaterialIcons } from "@expo/vector-icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as Haptics from "expo-haptics"
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native"

import {
  crossDeviceServiceListDevices,
  crossDeviceServiceListWorkspaces,
} from "@/generated/astraflow-api"
import {
  AppText,
  ErrorState,
  LoadingState,
  PrimaryButton,
  Screen,
  Surface,
} from "@/components/ui"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { getOrCreateMobileDeviceId, useAuth } from "@/lib/auth"
import {
  captureTaskPhoto,
  cleanupTaskAttachments,
  pickTaskDocuments,
  persistVoiceRecording,
  type LocalAttachment,
} from "@/lib/attachments"
import { createId } from "@/lib/ids"
import { readDraft, saveDraft } from "@/lib/mobile-db"
import {
  createTaskPayload,
  executeNewTask,
  queueNewTask,
} from "@/lib/submit-task"
import { palette, radius, spacing } from "@/lib/theme"

const runtimes = ["astraflow", "codex", "claude", "opencode"] as const
const permissions = [
  { id: "default", label: "按需审批" },
  { id: "plan", label: "仅计划" },
  { id: "full", label: "完全访问" },
] as const

export default function NewTaskScreen() {
  const auth = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{
    model?: string | string[]
    prompt?: string | string[]
  }>()
  const initialModel = Array.isArray(params.model)
    ? params.model[0]
    : params.model
  const initialPrompt = Array.isArray(params.prompt)
    ? params.prompt[0]
    : params.prompt
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState("")
  const [target, setTarget] = useState<"cloud" | "desktop">("cloud")
  const [deviceId, setDeviceId] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [runtimeId, setRuntimeId] =
    useState<(typeof runtimes)[number]>("astraflow")
  const [model, setModel] = useState(initialModel || "gpt-5.6-sol")
  const [permissionMode, setPermissionMode] = useState("default")
  const [returnArtifacts, setReturnArtifacts] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const audioState = useAudioRecorderState(audioRecorder, 250)

  useEffect(() => {
    void readDraft("new-task").then((draft) =>
      setPrompt(draft || initialPrompt || "")
    )
  }, [initialPrompt])
  useEffect(() => {
    const timeout = setTimeout(() => void saveDraft("new-task", prompt), 350)
    return () => clearTimeout(timeout)
  }, [prompt])

  const environment = useQuery({
    queryKey: ["new-task-environment"],
    queryFn: async () => {
      const authorization = await auth.getAuthorization()
      const [deviceResult, workspaceResult] = await Promise.all([
        crossDeviceServiceListDevices({
          headers: authorizationHeaders(authorization),
        }),
        crossDeviceServiceListWorkspaces({
          headers: authorizationHeaders(authorization),
          query: { includeUnavailable: true },
        }),
      ])
      return {
        devices: requireApiData(deviceResult, "读取设备失败。").devices ?? [],
        workspaces:
          requireApiData(workspaceResult, "读取 Workspace 失败。").workspaces ??
          [],
      }
    },
  })
  const desktops = (environment.data?.devices ?? []).filter(
    (device) => device.type === "desktop" && !device.revokedAt
  )
  const cloudWorkspaces = (environment.data?.workspaces ?? []).filter(
    (workspace) => workspace.type === "sandbox" && workspace.state !== "deleted"
  )
  const effectiveDeviceId = desktops.some((device) => device.id === deviceId)
    ? deviceId
    : ((desktops.find((device) => device.online) ?? desktops[0])?.id ?? "")
  const selectedDevice = desktops.find(
    (device) => device.id === effectiveDeviceId
  )
  const effectiveCloudWorkspaceId = cloudWorkspaces.some(
    (workspace) => workspace.id === workspaceId
  )
    ? workspaceId
    : (cloudWorkspaces[0]?.id ?? "")
  const desktopWorkspaceId = (environment.data?.workspaces ?? []).find(
    (workspace) =>
      workspace.type === "local_ref" &&
      workspace.ownerDeviceId === effectiveDeviceId
  )?.id

  const targetSummary = (() => {
    if (target === "cloud") return "任务在后台继续，Mac 离线也不受影响。"
    if (!selectedDevice) return "选择一台 Mac 才能发送任务。"
    if (!selectedDevice.online)
      return "Mac 当前离线；任务将明确等待它重新上线。"
    return "可使用该 Mac 的本地 Agent 与已授权 Workspace。"
  })()

  const submit = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      Alert.alert("还没有任务内容", "请告诉 Agent 需要完成什么。")
      return
    }
    if (audioState.isRecording) {
      Alert.alert("正在录音", "请先停止录音，再发送任务。")
      return
    }
    if (target === "desktop" && !effectiveDeviceId) {
      Alert.alert("请选择 Mac", "没有目标设备时不会静默切换到云端。")
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      const sourceDeviceId = await getOrCreateMobileDeviceId()
      let resolvedWorkspaceId =
        target === "cloud"
          ? effectiveCloudWorkspaceId || undefined
          : desktopWorkspaceId || undefined
      let createWorkspace: { id: string; name: string } | undefined
      if (target === "cloud" && !resolvedWorkspaceId) {
        resolvedWorkspaceId = createId("workspace")
        createWorkspace = {
          id: resolvedWorkspaceId,
          name: `Mobile workspace · ${new Date().toLocaleDateString()}`,
        }
      }
      const payload = createTaskPayload({
        prompt: trimmed,
        title: trimmed.split(/\r?\n/)[0].slice(0, 80),
        executionTarget: target,
        targetDeviceId: target === "desktop" ? effectiveDeviceId : undefined,
        workspaceId: resolvedWorkspaceId,
        createWorkspace,
        runtimeId,
        model: model.trim(),
        permissionMode,
        returnArtifacts: target === "desktop" && returnArtifacts,
        sourceDeviceId,
        attachments,
      })
      const network = await NetInfo.fetch()
      if (!network.isConnected) {
        await queueNewTask(payload)
        await saveDraft("new-task", "")
        Alert.alert(
          "已加入待发送",
          "网络恢复后会使用同一组幂等 ID 自动发送，不会重复启动。"
        )
        router.replace("/tasks")
        return
      }
      const authorization = await auth.getAuthorization()
      try {
        const run = await executeNewTask(authorization, payload)
        await saveDraft("new-task", "")
        await queryClient.invalidateQueries()
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.replace({ pathname: "/run/[runId]", params: { runId: run.id! } })
      } catch (error) {
        const message = error instanceof Error ? error.message : "发送失败。"
        if (/network|fetch|offline|timeout/i.test(message)) {
          await queueNewTask(payload)
          Alert.alert("暂时无法连接", "任务已安全保存在本机待发送队列。")
          router.replace("/tasks")
          return
        }
        throw error
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "发送任务失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={styles.intro}>
        <AppText variant="label" style={styles.eyebrow}>
          Execution target
        </AppText>
        <AppText variant="title">这次在哪里工作？</AppText>
      </View>

      <View style={styles.targetGrid}>
        <TargetCard
          selected={target === "cloud"}
          icon="cloud-queue"
          title="云端 Sandbox"
          detail="后台继续 · 自动恢复"
          onPress={() => setTarget("cloud")}
        />
        <TargetCard
          selected={target === "desktop"}
          icon="laptop-mac"
          title={selectedDevice?.name || "我的 Mac"}
          detail={selectedDevice?.online ? "在线 · 本地文件" : "离线或未选择"}
          onPress={() => setTarget("desktop")}
        />
      </View>
      <Surface style={styles.targetNotice}>
        <MaterialIcons
          name={
            target === "cloud"
              ? "cloud-done"
              : selectedDevice?.online
                ? "link"
                : "schedule"
          }
          size={21}
          color={palette.ink}
        />
        <AppText variant="caption" style={styles.flex}>
          {targetSummary}
        </AppText>
      </Surface>

      {environment.isLoading ? (
        <LoadingState label="正在读取执行环境…" />
      ) : null}
      {environment.error ? (
        <ErrorState message={environment.error.message} />
      ) : null}

      {target === "desktop" && desktops.length > 1 ? (
        <Field label="目标 Mac">
          <View style={styles.chips}>
            {desktops.map((device) => (
              <ChoiceChip
                key={device.id}
                label={`${device.name}${device.online ? " · 在线" : " · 离线"}`}
                selected={device.id === effectiveDeviceId}
                onPress={() => setDeviceId(device.id ?? "")}
              />
            ))}
          </View>
        </Field>
      ) : null}

      {target === "cloud" && cloudWorkspaces.length ? (
        <Field label="Workspace">
          <View style={styles.chips}>
            {cloudWorkspaces.map((workspace) => (
              <ChoiceChip
                key={workspace.id}
                label={`${workspace.name || "Sandbox"} · ${workspace.state}`}
                selected={workspace.id === effectiveCloudWorkspaceId}
                onPress={() => setWorkspaceId(workspace.id ?? "")}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="任务内容">
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          textAlignVertical="top"
          placeholder="例如：检查这个项目的登录流程，修复会导致 token 泄漏的问题，并运行验证。"
          placeholderTextColor={palette.textMuted}
          style={styles.promptInput}
        />
        <AppText variant="caption" style={styles.muted}>
          草稿已保存在本机 SQLite。发送后执行环境不会被静默更改。
        </AppText>
        <View style={styles.attachmentActions}>
          <AttachmentAction
            icon="attach-file"
            label="添加文件"
            disabled={busy}
            onPress={() =>
              void addAttachments(
                pickTaskDocuments,
                setAttachments,
                setSubmitError
              )
            }
          />
          <AttachmentAction
            icon={audioState.isRecording ? "stop-circle" : "mic"}
            label={
              audioState.isRecording
                ? `停止 ${formatDuration(audioState.durationMillis)}`
                : "录音"
            }
            disabled={busy}
            onPress={() =>
              void toggleVoiceRecording({
                recorder: audioRecorder,
                isRecording: audioState.isRecording,
                setAttachments,
                setError: setSubmitError,
              })
            }
          />
          <AttachmentAction
            icon="photo-camera"
            label="拍照"
            disabled={busy}
            onPress={() =>
              void addAttachments(
                captureTaskPhoto,
                setAttachments,
                setSubmitError
              )
            }
          />
        </View>
        {attachments.length ? (
          <View style={styles.attachmentList}>
            {attachments.map((attachment) => (
              <Surface key={attachment.id} style={styles.attachmentRow}>
                <View style={styles.attachmentIcon}>
                  <MaterialIcons
                    name={
                      attachment.kind === "image"
                        ? "image"
                        : attachment.kind === "audio"
                          ? "graphic-eq"
                          : "description"
                    }
                    size={20}
                    color={palette.ink}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="caption" numberOfLines={1}>
                    {attachment.name}
                  </AppText>
                  <AppText variant="caption" style={styles.muted}>
                    {formatBytes(attachment.size)} · 仅在发送任务时上传
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除 ${attachment.name}`}
                  hitSlop={8}
                  onPress={() => {
                    setAttachments((current) =>
                      current.filter(
                        (candidate) => candidate.id !== attachment.id
                      )
                    )
                    void cleanupTaskAttachments([attachment])
                  }}
                >
                  <MaterialIcons
                    name="close"
                    size={20}
                    color={palette.textMuted}
                  />
                </Pressable>
              </Surface>
            ))}
          </View>
        ) : null}
      </Field>

      <Field label="Runtime">
        <View style={styles.chips}>
          {runtimes.map((runtime) => (
            <ChoiceChip
              key={runtime}
              label={runtime}
              selected={runtimeId === runtime}
              onPress={() => setRuntimeId(runtime)}
            />
          ))}
        </View>
      </Field>

      <Field label="Model">
        <TextInput
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="模型 ID"
          placeholderTextColor={palette.textMuted}
          style={styles.singleInput}
        />
      </Field>

      <Field label="Permission mode">
        <View style={styles.chips}>
          {permissions.map((permission) => (
            <ChoiceChip
              key={permission.id}
              label={permission.label}
              selected={permissionMode === permission.id}
              onPress={() => setPermissionMode(permission.id)}
            />
          ))}
        </View>
      </Field>

      {target === "desktop" ? (
        <Field label="文件回传">
          <ChoiceChip
            label={
              returnArtifacts
                ? "回传已生成文件 · 已开启"
                : "回传已生成文件 · 默认关闭"
            }
            selected={returnArtifacts}
            onPress={() => setReturnArtifacts((current) => !current)}
          />
          <AppText variant="caption" style={styles.muted}>
            开启后，仅把本次 Run
            明确创建或修改的普通文件上传为产物；项目目录、密钥和未变更文件不会被镜像。
          </AppText>
        </Field>
      ) : null}

      {submitError ? <ErrorState message={submitError} /> : null}
      <PrimaryButton
        label={
          target === "cloud"
            ? "在云端开始"
            : selectedDevice?.online
              ? "发送到 Mac"
              : "等待 Mac 并发送"
        }
        icon="arrow-forward"
        tone="ink"
        busy={busy}
        onPress={() => void submit()}
      />
    </Screen>
  )
}

function AttachmentAction({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.attachmentAction,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <MaterialIcons name={icon} size={18} color={palette.ink} />
      <AppText variant="caption">{label}</AppText>
    </Pressable>
  )
}

async function addAttachments(
  picker: () => Promise<LocalAttachment[]>,
  setAttachments: (
    update: (current: LocalAttachment[]) => LocalAttachment[]
  ) => void,
  setError: (message: string | null) => void
) {
  try {
    const selected = await picker()
    setAttachments((current) => {
      const combined = [...current, ...selected]
      void cleanupTaskAttachments(combined.slice(10))
      return combined.slice(0, 10)
    })
    if (selected.length) setError(null)
  } catch (error) {
    setError(error instanceof Error ? error.message : "无法读取附件。")
  }
}

async function toggleVoiceRecording({
  recorder,
  isRecording,
  setAttachments,
  setError,
}: {
  recorder: ReturnType<typeof useAudioRecorder>
  isRecording: boolean
  setAttachments: (
    update: (current: LocalAttachment[]) => LocalAttachment[]
  ) => void
  setError: (message: string | null) => void
}) {
  try {
    if (!isRecording) {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted) {
        throw new Error("需要麦克风权限才能录制语音附件。")
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setError(null)
      return
    }
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false })
    if (!recorder.uri) throw new Error("录音文件没有保存成功，请重试。")
    const attachment = await persistVoiceRecording(recorder.uri)
    setAttachments((current) => {
      if (current.length >= 10) {
        void cleanupTaskAttachments([attachment])
        return current
      }
      return [...current, attachment]
    })
    setError(null)
  } catch (error) {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    setError(error instanceof Error ? error.message : "无法录制语音附件。")
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function TargetCard({
  selected,
  icon,
  title,
  detail,
  onPress,
}: {
  selected: boolean
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
  detail: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.targetCard,
        selected && styles.targetCardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.targetIcon, selected && styles.targetIconSelected]}>
        <MaterialIcons name={icon} size={24} color={palette.ink} />
      </View>
      <AppText variant="subtitle">{title}</AppText>
      <AppText variant="caption" style={styles.muted}>
        {detail}
      </AppText>
      {selected ? (
        <MaterialIcons
          name="check-circle"
          size={20}
          color={palette.signalDark}
        />
      ) : null}
    </Pressable>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" style={styles.fieldLabel}>
        {label}
      </AppText>
      {children}
    </View>
  )
}

function ChoiceChip({
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
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="caption" style={selected && styles.chipTextSelected}>
        {label}
      </AppText>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: spacing.xs },
  eyebrow: { color: palette.signalDark },
  targetGrid: { flexDirection: "row", gap: spacing.md },
  targetCard: {
    flex: 1,
    minHeight: 170,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  targetCardSelected: {
    borderColor: palette.ink,
    borderWidth: 2,
    backgroundColor: "#F9F8EB",
  },
  targetIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: palette.paperMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  targetIconSelected: { backgroundColor: palette.signal },
  targetNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.sky,
    borderColor: "#76B9DB",
  },
  field: { gap: spacing.sm },
  fieldLabel: { color: palette.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 38,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
  },
  chipSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipTextSelected: { color: palette.textOnDark },
  promptInput: {
    minHeight: 150,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    padding: spacing.lg,
    color: palette.text,
    fontFamily: "IBMPlexSans_400Regular",
    fontSize: 17,
    lineHeight: 25,
  },
  attachmentActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  attachmentAction: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
  },
  attachmentList: { gap: spacing.sm },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  attachmentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  singleInput: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    paddingHorizontal: spacing.lg,
    color: palette.text,
    fontFamily: "IBMPlexSans_500Medium",
  },
  muted: { color: palette.textMuted },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
})
