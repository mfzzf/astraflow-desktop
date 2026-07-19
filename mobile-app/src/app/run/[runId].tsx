import { MaterialIcons } from "@expo/vector-icons"
import { FlashList } from "@shopify/flash-list"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { useMemo, useState } from "react"
import {
  Alert,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native"

import { RunPart } from "@/components/run-part"
import {
  AppText,
  ErrorState,
  IconButton,
  LoadingState,
  PrimaryButton,
  Screen,
  StatusPill,
  Surface,
} from "@/components/ui"
import {
  artifactServiceCreateArtifactShare,
  artifactServiceGetArtifact,
  artifactServiceListArtifacts,
  artifactServiceRevokeArtifactShare,
  crossDeviceServiceCancelAgentRun,
  crossDeviceServiceGetAgentRun,
  crossDeviceServiceListAgentActions,
  crossDeviceServiceListAgentRunEvents,
  crossDeviceServiceListMessages,
  crossDeviceServiceResolveAgentAction,
  type AstraflowV1AgentAction,
  type AstraflowV1AgentRun,
  type AstraflowV1AgentRunEvent,
  type AstraflowV1Artifact,
  type AstraflowV1Message,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { getOrCreateMobileDeviceId, useAuth } from "@/lib/auth"
import { createId } from "@/lib/ids"
import {
  cacheActions,
  cacheArtifacts,
  cacheMessages,
  cacheRun,
  cacheRunEvents,
  readCachedActions,
  readCachedArtifacts,
  readCachedMessages,
  readCachedRunEvents,
  readCachedRuns,
} from "@/lib/mobile-db"
import { palette, radius, spacing } from "@/lib/theme"

type JsonRecord = Record<string, unknown>
const activeStatuses = new Set([
  "queued",
  "waiting_device",
  "running",
  "waiting_approval",
  "waiting_input",
])

export default function RunDetailScreen() {
  const params = useLocalSearchParams<{ runId?: string | string[] }>()
  const runId = Array.isArray(params.runId)
    ? params.runId[0]
    : params.runId || ""
  const auth = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  const runQuery = useQuery({
    queryKey: ["run", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        const run = requireApiData(
          await crossDeviceServiceGetAgentRun({
            headers: authorizationHeaders(authorization),
            path: { runId },
          }),
          "读取任务状态失败。"
        )
        await cacheRun(run)
        return run
      } catch (error) {
        const cached = (await readCachedRuns()).find(
          (candidate) => candidate.id === runId
        )
        if (cached) return cached
        throw error
      }
    },
    refetchInterval: (query) =>
      activeStatuses.has(query.state.data?.status || "") ? 2_000 : false,
  })

  const sessionId = runQuery.data?.sessionId || ""
  const messagesQuery = useQuery({
    queryKey: ["messages", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        const messages =
          requireApiData(
            await crossDeviceServiceListMessages({
              headers: authorizationHeaders(authorization),
              path: { sessionId },
              query: { pageSize: 100 },
            }),
            "读取任务消息失败。"
          ).messages ?? []
        await cacheMessages(sessionId, messages)
        return messages
      } catch (error) {
        const cached = await readCachedMessages(sessionId)
        if (cached.length) return cached
        throw error
      }
    },
  })

  const eventsQuery = useQuery({
    queryKey: ["run-events", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        const events = await loadAllRunEvents(runId, authorization)
        await cacheRunEvents(runId, events)
        return events
      } catch (error) {
        const cached = await readCachedRunEvents(runId)
        if (cached.length) return cached
        throw error
      }
    },
    refetchInterval: () =>
      activeStatuses.has(runQuery.data?.status || "") ? 2_000 : false,
  })

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        const artifacts =
          requireApiData(
            await artifactServiceListArtifacts({
              headers: authorizationHeaders(authorization),
              query: { sessionId, pageSize: 100 },
            }),
            "读取任务附件失败。"
          ).artifacts ?? []
        await cacheArtifacts(artifacts)
        return artifacts
      } catch (error) {
        const cached = await readCachedArtifacts(sessionId)
        if (cached.length) return cached
        throw error
      }
    },
  })

  const actionsQuery = useQuery({
    queryKey: ["run-actions", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        const actions =
          requireApiData(
            await crossDeviceServiceListAgentActions({
              headers: authorizationHeaders(authorization),
              path: { runId },
              query: { pendingOnly: false },
            }),
            "读取待处理操作失败。"
          ).actions ?? []
        await cacheActions(actions)
        return actions
      } catch (error) {
        const cached = await readCachedActions(runId)
        if (cached.length) return cached
        throw error
      }
    },
    refetchInterval: () =>
      activeStatuses.has(runQuery.data?.status || "") ? 2_000 : false,
  })

  const refresh = async () => {
    await Promise.all([
      runQuery.refetch(),
      messagesQuery.refetch(),
      eventsQuery.refetch(),
      actionsQuery.refetch(),
      artifactsQuery.refetch(),
    ])
  }

  const snapshot = useMemo(
    () => latestSnapshot(eventsQuery.data ?? []),
    [eventsQuery.data]
  )
  const usage = useMemo(
    () => latestUsage(eventsQuery.data ?? []),
    [eventsQuery.data]
  )
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data])
  const userMessage = useMemo(() => latestMessage(messages, "user"), [messages])
  const assistantMessage = useMemo(
    () => latestMessage(messages, "assistant"),
    [messages]
  )
  const parts = snapshot.parts.length
    ? snapshot.parts
    : recordArray(assistantMessage?.parts)
  const pendingActions = (actionsQuery.data ?? []).filter(
    (action) => action.status === "pending"
  )
  const primaryError = runQuery.error || eventsQuery.error

  if (runQuery.isLoading && !runQuery.data) {
    return (
      <Screen scroll={false}>
        <LoadingState label="正在连接任务运行时…" />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <FlashList
        data={parts}
        keyExtractor={(part, index) =>
          text(part.id) || `${text(part.type)}-${index}`
        }
        renderItem={({ item }) => <RunPart part={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={runQuery.isRefetching || eventsQuery.isRefetching}
        onRefresh={() => void refresh()}
        ListHeaderComponent={
          <RunHeader
            run={runQuery.data}
            userMessage={userMessage}
            snapshot={snapshot}
            usage={usage}
            pendingActions={pendingActions}
            artifacts={artifactsQuery.data ?? []}
            getAuthorization={auth.getAuthorization}
            onResolved={() => {
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: ["run", runId] }),
                queryClient.invalidateQueries({
                  queryKey: ["run-actions", runId],
                }),
              ])
            }}
            onCancel={() => {
              Alert.alert(
                "停止任务？",
                "Agent 会停止当前 Run，已产生的消息和制品仍会保留。",
                [
                  { text: "继续运行", style: "cancel" },
                  {
                    text: "停止",
                    style: "destructive",
                    onPress: () =>
                      void cancelRun(runId, auth.getAuthorization, queryClient),
                  },
                ]
              )
            }}
            onBack={() => router.back()}
            onRefresh={() => void refresh()}
          />
        }
        ListEmptyComponent={
          primaryError ? (
            <ErrorState
              message={primaryError.message}
              retry={() => void refresh()}
            />
          ) : (
            <Surface style={styles.waitingCard}>
              <MaterialIcons
                name="hourglass-top"
                size={24}
                color={palette.signalDark}
              />
              <View style={styles.flex}>
                <AppText variant="subtitle">Agent 正在准备结果</AppText>
                <AppText style={styles.muted}>
                  {snapshot.content || statusDescription(runQuery.data?.status)}
                </AppText>
              </View>
            </Surface>
          )
        }
        ListFooterComponent={
          runQuery.data?.errorMessage ? (
            <ErrorState
              message={runQuery.data.errorMessage}
              retry={() => void refresh()}
            />
          ) : (
            <View style={styles.footer}>
              <AppText variant="caption" style={styles.muted}>
                {runQuery.data?.executionTarget === "desktop"
                  ? "通过 Mac 出站 Runtime Gateway 安全执行"
                  : "通过云端 Sandbox Runtime Gateway 执行"}
              </AppText>
            </View>
          )
        }
      />
    </Screen>
  )
}

function RunHeader({
  run,
  userMessage,
  snapshot,
  usage,
  pendingActions,
  artifacts,
  getAuthorization,
  onResolved,
  onCancel,
  onBack,
  onRefresh,
}: {
  run?: AstraflowV1AgentRun
  userMessage?: AstraflowV1Message
  snapshot: Snapshot
  usage: RunUsage | null
  pendingActions: AstraflowV1AgentAction[]
  artifacts: AstraflowV1Artifact[]
  getAuthorization: () => Promise<string>
  onResolved: () => void
  onCancel: () => void
  onBack: () => void
  onRefresh: () => void
}) {
  const prompt = messageText(userMessage)
  const active = activeStatuses.has(run?.status || "")
  return (
    <View style={styles.headerStack}>
      <View style={styles.toolbar}>
        <IconButton icon="arrow-back" label="返回" onPress={onBack} />
        <View style={styles.flex}>
          <AppText variant="label" style={styles.eyebrow}>
            Agent Run
          </AppText>
          <AppText variant="subtitle" numberOfLines={1}>
            {run?.model || "AstraFlow Agent"}
          </AppText>
        </View>
        <IconButton icon="refresh" label="刷新" onPress={onRefresh} />
      </View>

      <Surface style={styles.runHero}>
        <View style={styles.heroTop}>
          <View style={styles.targetIcon}>
            <MaterialIcons
              name={
                run?.executionTarget === "desktop"
                  ? "laptop-mac"
                  : "cloud-queue"
              }
              size={23}
              color={palette.ink}
            />
          </View>
          <View style={styles.flex}>
            <AppText variant="title" style={styles.heroTitle} numberOfLines={2}>
              {run?.executionTarget === "desktop" ? "我的 Mac" : "云端 Sandbox"}
            </AppText>
            <AppText variant="caption" style={styles.heroMuted}>
              {run?.runtimeId || "astraflow"} ·{" "}
              {run?.permissionMode || "default"}
            </AppText>
          </View>
          <StatusPill status={run?.status} label={statusLabel(run?.status)} />
        </View>
        {active ? (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <AppText variant="caption" style={styles.heroTitle}>
              实时同步中 · 序号 {run?.lastEventSeq || "0"}
            </AppText>
          </View>
        ) : null}
        {usage ? (
          <View style={styles.usageRow}>
            <AppText variant="caption" style={styles.heroMuted}>
              {formatTokenCount(usage.totalTokens)} tokens
            </AppText>
            <AppText variant="caption" style={styles.heroMuted}>
              输入 {formatTokenCount(usage.inputTokens)} · 输出{" "}
              {formatTokenCount(usage.outputTokens)}
            </AppText>
            {usage.cost ? (
              <AppText variant="caption" style={styles.heroMuted}>
                {formatRunCost(usage.cost)}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {active ? (
          <PrimaryButton
            label="停止任务"
            icon="stop-circle"
            tone="quiet"
            onPress={onCancel}
          />
        ) : null}
      </Surface>

      {prompt ? (
        <View style={styles.userBubble}>
          <AppText variant="label" style={styles.userLabel}>
            你的任务
          </AppText>
          <AppText style={styles.userText}>{prompt}</AppText>
        </View>
      ) : null}

      {artifacts.length ? (
        <View style={styles.artifactSection}>
          <View style={styles.responseHeading}>
            <AppText variant="label" style={styles.eyebrow}>
              附件与产物
            </AppText>
            <AppText variant="caption" style={styles.muted}>
              {artifacts.length} 项
            </AppText>
          </View>
          {artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              getAuthorization={getAuthorization}
            />
          ))}
        </View>
      ) : null}

      {pendingActions.map((action) => (
        <ActionCard key={action.id} action={action} onResolved={onResolved} />
      ))}

      {snapshot.updatedAt ? (
        <View style={styles.responseHeading}>
          <AppText variant="label" style={styles.eyebrow}>
            Agent 结果
          </AppText>
          <AppText variant="caption" style={styles.muted}>
            {formatTime(snapshot.updatedAt)}
          </AppText>
        </View>
      ) : null}
    </View>
  )
}

function ArtifactCard({
  artifact,
  getAuthorization,
}: {
  artifact: AstraflowV1Artifact
  getAuthorization: () => Promise<string>
}) {
  const [busy, setBusy] = useState<"open" | "share" | "revoke" | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const open = async () => {
    setBusy("open")
    try {
      const authorization = await getAuthorization()
      const fresh = requireApiData(
        await artifactServiceGetArtifact({
          headers: authorizationHeaders(authorization),
          path: { artifactId: artifact.id! },
        }),
        "无法获取下载地址。"
      )
      if (!fresh.downloadUrl) throw new Error("后端没有返回下载地址。")
      const destination = new File(
        Paths.cache,
        `${artifact.id}-${safeDownloadName(fresh.fileName || "artifact")}`
      )
      const file = await File.downloadFileAsync(
        fresh.downloadUrl,
        destination,
        {
          idempotent: true,
        }
      )
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: fresh.mimeType })
      } else {
        Alert.alert("已下载", file.uri)
      }
    } catch (error) {
      Alert.alert(
        "无法打开制品",
        error instanceof Error ? error.message : "下载失败。"
      )
    } finally {
      setBusy(null)
    }
  }
  const share = async () => {
    setBusy("share")
    try {
      const authorization = await getAuthorization()
      const result = requireApiData(
        await artifactServiceCreateArtifactShare({
          headers: authorizationHeaders(authorization),
          path: { artifactId: artifact.id! },
          body: { artifactId: artifact.id, expiresInSeconds: 24 * 60 * 60 },
        }),
        "无法创建分享链接。"
      )
      if (!result.shareUrl) throw new Error("后端没有返回分享链接。")
      setShareId(result.id || null)
      await Share.share({
        title: artifact.fileName || "AstraFlow 制品",
        message: result.shareUrl,
        url: result.shareUrl,
      })
    } catch (error) {
      Alert.alert(
        "无法分享制品",
        error instanceof Error ? error.message : "分享失败。"
      )
    } finally {
      setBusy(null)
    }
  }
  const revokeShare = async () => {
    if (!shareId) return
    setBusy("revoke")
    try {
      const authorization = await getAuthorization()
      requireApiData(
        await artifactServiceRevokeArtifactShare({
          headers: authorizationHeaders(authorization),
          path: { artifactId: artifact.id!, shareId },
        }),
        "无法撤销分享链接。"
      )
      setShareId(null)
      Alert.alert("分享已撤销", "之前创建的公开链接已立即失效。")
    } catch (error) {
      Alert.alert(
        "无法撤销分享",
        error instanceof Error ? error.message : "撤销失败。"
      )
    } finally {
      setBusy(null)
    }
  }
  return (
    <Surface style={styles.artifactCard}>
      <View style={styles.artifactIcon}>
        <MaterialIcons
          name={artifact.mimeType?.startsWith("image/") ? "image" : "drafts"}
          size={21}
          color={palette.ink}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" numberOfLines={1}>
          {artifact.fileName || "未命名制品"}
        </AppText>
        <AppText variant="caption" style={styles.muted}>
          {formatArtifactBytes(artifact.size)} · SHA-256 已校验
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy !== null}
        onPress={() => void open()}
        style={({ pressed }) => [
          styles.artifactButton,
          pressed && styles.pressed,
        ]}
      >
        <MaterialIcons name="download" size={19} color={palette.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy !== null}
        onPress={() => void share()}
        style={({ pressed }) => [
          styles.artifactButton,
          pressed && styles.pressed,
        ]}
      >
        <MaterialIcons name="ios-share" size={19} color={palette.ink} />
      </Pressable>
      {shareId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="撤销分享链接"
          disabled={busy !== null}
          onPress={() =>
            Alert.alert("撤销公开链接？", "链接会立即失效。", [
              { text: "取消", style: "cancel" },
              {
                text: "撤销",
                style: "destructive",
                onPress: () => void revokeShare(),
              },
            ])
          }
          style={({ pressed }) => [
            styles.artifactButton,
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons name="link-off" size={19} color={palette.danger} />
        </Pressable>
      ) : null}
    </Surface>
  )
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/\u0000\r\n]/g, "-").slice(0, 180)
}

function formatArtifactBytes(value?: string) {
  const bytes = Number(value ?? 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function ActionCard({
  action,
  onResolved,
}: {
  action: AstraflowV1AgentAction
  onResolved: () => void
}) {
  const auth = useAuth()
  const request = record(action.request)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const mutation = useMutation({
    mutationFn: async ({
      resolution,
      payload,
    }: {
      resolution: string
      payload: JsonRecord
    }) => {
      if (!action.id || !action.runId || !action.version)
        throw new Error("操作状态不完整，请刷新后重试。")
      const authorization = await auth.getAuthorization()
      const deviceId = await getOrCreateMobileDeviceId()
      return requireApiData(
        await crossDeviceServiceResolveAgentAction({
          headers: authorizationHeaders(authorization),
          path: { runId: action.runId, actionId: action.id },
          body: {
            runId: action.runId,
            actionId: action.id,
            expectedVersion: action.version,
            resolution,
            payload,
            sourceDeviceId: deviceId,
            clientMutationId: createId("resolve"),
          },
        }),
        "提交操作失败，可能已在另一台设备处理。"
      )
    },
    onSuccess: onResolved,
  })

  if (action.type === "permission") {
    const options = recordArray(request.options)
    const allow =
      options.find((option) => text(option.kind) === "allow_once") ||
      options.find((option) => text(option.kind).startsWith("allow"))
    const deny = options.find((option) =>
      text(option.kind).startsWith("reject")
    )
    return (
      <Surface style={styles.actionCard}>
        <ActionTitle icon="verified-user" title="Agent 请求权限" />
        <AppText>{text(request.toolName) || "受保护的工具调用"}</AppText>
        {text(request.input) ? (
          <AppText variant="mono" style={styles.actionInput}>
            {bounded(text(request.input), 2_000)}
          </AppText>
        ) : null}
        {mutation.error ? (
          <AppText style={styles.error}>{mutation.error.message}</AppText>
        ) : null}
        <View style={styles.actionButtons}>
          <PrimaryButton
            style={styles.flex}
            label={text(deny?.name) || "拒绝"}
            tone="quiet"
            disabled={mutation.isPending}
            onPress={() =>
              mutation.mutate({
                resolution: "denied",
                payload: { option_id: text(deny?.optionId) },
              })
            }
          />
          <PrimaryButton
            style={styles.flex}
            label={text(allow?.name) || "允许一次"}
            busy={mutation.isPending}
            onPress={() =>
              mutation.mutate({
                resolution: "approved",
                payload: { option_id: text(allow?.optionId) },
              })
            }
          />
        </View>
      </Surface>
    )
  }

  const questions = recordArray(request.questions)
  return (
    <Surface style={styles.actionCard}>
      <ActionTitle icon="question-answer" title="Agent 需要你的回答" />
      {questions.map((question, index) => {
        const id = text(question.id) || `question-${index}`
        const options = recordArray(question.options)
        return (
          <View key={id} style={styles.question}>
            <AppText variant="label" style={styles.eyebrow}>
              {text(question.header) || `问题 ${index + 1}`}
            </AppText>
            <AppText>{text(question.question)}</AppText>
            {options.length ? (
              <View style={styles.optionList}>
                {options.map((option) => {
                  const value = text(option.optionId) || text(option.label)
                  const selected = answers[id] === value
                  return (
                    <Pressable
                      key={value}
                      onPress={() =>
                        setAnswers((current) => ({ ...current, [id]: value }))
                      }
                      style={[styles.option, selected && styles.optionSelected]}
                    >
                      <MaterialIcons
                        name={
                          selected
                            ? "radio-button-checked"
                            : "radio-button-unchecked"
                        }
                        size={19}
                        color={
                          selected ? palette.signalDark : palette.textMuted
                        }
                      />
                      <View style={styles.flex}>
                        <AppText>{text(option.label)}</AppText>
                        {text(option.description) ? (
                          <AppText variant="caption" style={styles.muted}>
                            {text(option.description)}
                          </AppText>
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ) : (
              <TextInput
                value={answers[id] || ""}
                onChangeText={(value) =>
                  setAnswers((current) => ({ ...current, [id]: value }))
                }
                secureTextEntry={question.isSecret === true}
                multiline={question.isSecret !== true}
                placeholder="输入你的回答"
                placeholderTextColor={palette.textMuted}
                style={styles.answerInput}
              />
            )}
          </View>
        )
      })}
      {mutation.error ? (
        <AppText style={styles.error}>{mutation.error.message}</AppText>
      ) : null}
      <PrimaryButton
        label="提交回答"
        icon="send"
        busy={mutation.isPending}
        disabled={
          !questions.length ||
          questions.some(
            (question, index) =>
              !answers[text(question.id) || `question-${index}`]?.trim()
          )
        }
        onPress={() => {
          const submitted = questions.map((question, index) => {
            const questionId = text(question.id) || `question-${index}`
            const value = answers[questionId] || ""
            const option = recordArray(question.options).find(
              (candidate) =>
                (text(candidate.optionId) || text(candidate.label)) === value
            )
            return {
              questionId,
              optionId: option ? text(option.optionId) || null : null,
              label: option ? text(option.label) || null : null,
              text: option ? text(option.label) : value,
            }
          })
          mutation.mutate({
            resolution: "submitted",
            payload: { answers: submitted },
          })
        }}
      />
    </Surface>
  )
}

function ActionTitle({
  icon,
  title,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
}) {
  return (
    <View style={styles.actionTitle}>
      <View style={styles.actionIcon}>
        <MaterialIcons name={icon} size={21} color={palette.ink} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" style={styles.eyebrow}>
          需要处理
        </AppText>
        <AppText variant="subtitle">{title}</AppText>
      </View>
    </View>
  )
}

async function loadAllRunEvents(runId: string, authorization: string) {
  const events: AstraflowV1AgentRunEvent[] = []
  let afterSeq = "0"
  for (;;) {
    const response = requireApiData(
      await crossDeviceServiceListAgentRunEvents({
        headers: authorizationHeaders(authorization),
        path: { runId },
        query: { afterSeq, limit: 500 },
      }),
      "读取 Agent 事件失败。"
    )
    events.push(...(response.events ?? []))
    if (!response.hasMore || !response.events?.length) break
    const nextSeq = response.events.at(-1)?.seq || afterSeq
    if (nextSeq === afterSeq) {
      throw new Error("Agent 事件分页游标没有前进。")
    }
    afterSeq = nextSeq
  }
  return events
}

async function cancelRun(
  runId: string,
  getAuthorization: () => Promise<string>,
  queryClient: ReturnType<typeof useQueryClient>
) {
  try {
    const authorization = await getAuthorization()
    const deviceId = await getOrCreateMobileDeviceId()
    await crossDeviceServiceCancelAgentRun({
      headers: authorizationHeaders(authorization),
      path: { runId },
      body: {
        runId,
        sourceDeviceId: deviceId,
        clientMutationId: createId("cancel"),
      },
    }).then((result) => requireApiData(result, "停止任务失败。"))
    await queryClient.invalidateQueries({ queryKey: ["run", runId] })
  } catch (error) {
    Alert.alert(
      "停止失败",
      error instanceof Error ? error.message : "请稍后重试。"
    )
  }
}

type Snapshot = { parts: JsonRecord[]; content: string; updatedAt: string }
type RunUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: { amount: number; currency: string } | null
}

function latestSnapshot(events: AstraflowV1AgentRunEvent[]): Snapshot {
  const snapshots = events
    .filter((event) => event.type === "agent.run.snapshot")
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
  const payload = record(snapshots.at(-1)?.payload)
  const message = record(payload.message)
  return {
    parts: recordArray(message.parts),
    content: text(message.content),
    updatedAt: text(payload.updated_at) || snapshots.at(-1)?.occurredAt || "",
  }
}

function latestUsage(events: AstraflowV1AgentRunEvent[]): RunUsage | null {
  for (const event of [...events].sort(
    (left, right) => Number(right.seq || 0) - Number(left.seq || 0)
  )) {
    const payload = record(event.payload)
    const direct = runUsage(record(payload.usage))
    if (direct) return direct
    const nested = runUsage(record(record(payload.event).usage))
    if (nested) return nested
  }
  return null
}

function runUsage(value: JsonRecord): RunUsage | null {
  const inputTokens = finiteNumber(value.inputTokens ?? value.input_tokens)
  const outputTokens = finiteNumber(value.outputTokens ?? value.output_tokens)
  const totalTokens = finiteNumber(
    value.totalTokens ?? value.total_tokens ?? inputTokens + outputTokens
  )
  const costValue = record(value.cost)
  const costAmount = finiteNumber(costValue.amount)
  const costCurrency = text(costValue.currency)
  if (!totalTokens && !inputTokens && !outputTokens && !costCurrency)
    return null
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    cost:
      costCurrency && Number.isFinite(costAmount)
        ? { amount: costAmount, currency: costCurrency }
        : null,
  }
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    value
  )
}

function formatRunCost(cost: { amount: number; currency: string }) {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: cost.currency.toUpperCase(),
      maximumFractionDigits: 4,
    }).format(cost.amount)
  } catch {
    return `${cost.amount.toFixed(4)} ${cost.currency}`
  }
}

function latestMessage(messages: AstraflowV1Message[], role: string) {
  return [...messages]
    .filter((message) => message.role === role)
    .sort(
      (left, right) =>
        Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")
    )
    .at(-1)
}

function messageText(message?: AstraflowV1Message) {
  const content = record(message?.content)
  const direct = text(content.text) || text(content.content)
  if (direct) return direct
  const textPart = recordArray(message?.parts).find(
    (part) => text(part.type) === "text"
  )
  return text(textPart?.text) || text(textPart?.content)
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    queued: "排队中",
    waiting_device: "等待 Mac",
    running: "执行中",
    waiting_approval: "等待审批",
    waiting_input: "等待回答",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  }
  return labels[status || ""] || status || "未知"
}

function statusDescription(status?: string) {
  if (status === "waiting_device") return "等待目标 Mac 在线并接收任务。"
  if (status === "queued") return "云端 Worker 正在领取任务。"
  if (status === "waiting_approval")
    return "Agent 已暂停，等待你批准受保护操作。"
  if (status === "waiting_input") return "Agent 已暂停，等待你的回答。"
  if (status === "completed")
    return "任务已完成，但本地尚未缓存结果。下拉刷新即可重试。"
  return "结果会在运行时产生后实时出现在这里。"
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "刚刚更新"
    : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item) => Object.keys(item).length > 0)
    : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function bounded(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.huge },
  separator: { height: spacing.md },
  flex: { flex: 1 },
  muted: { color: palette.textMuted },
  error: { color: palette.danger },
  eyebrow: { color: palette.signalDark },
  heroTitle: { color: palette.textOnDark },
  heroMuted: { color: "#ADB7BC" },
  headerStack: { gap: spacing.lg, paddingBottom: spacing.lg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  runHero: { backgroundColor: palette.ink, borderColor: palette.ink },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  targetIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  liveRow: {
    backgroundColor: "#24333D",
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  usageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.signal,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    backgroundColor: palette.sky,
    gap: spacing.sm,
  },
  userLabel: { color: "#326176" },
  userText: { fontSize: 17, lineHeight: 25 },
  responseHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  artifactSection: { gap: spacing.sm },
  artifactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  artifactIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  artifactButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.paperRaised,
  },
  waitingCard: { flexDirection: "row", alignItems: "center" },
  footer: { alignItems: "center", paddingVertical: spacing.xl },
  actionCard: {
    borderWidth: 2,
    borderColor: palette.warning,
    backgroundColor: "#FFF4DE",
  },
  actionTitle: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  actionInput: {
    backgroundColor: palette.paperRaised,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  actionButtons: { flexDirection: "row", gap: spacing.md },
  question: { gap: spacing.sm },
  optionList: { gap: spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
  },
  optionSelected: {
    borderColor: palette.signalDark,
    backgroundColor: "#F2FFD0",
  },
  answerInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.paperRaised,
    padding: spacing.md,
    color: palette.text,
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
})
