import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, TextInput, View } from "react-native"

import {
  crossDeviceServiceListAgentRuns,
  crossDeviceServiceListSessions,
  type AstraflowV1AgentRun,
} from "@/generated/astraflow-api"
import {
  AppText,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  PrimaryButton,
  Screen,
  StatusPill,
  Surface,
} from "@/components/ui"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { readCachedRuns, readCachedSessions } from "@/lib/mobile-db"
import { palette, radius, spacing } from "@/lib/theme"

export default function TasksScreen() {
  const auth = useAuth()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const sessions = useQuery({
    queryKey: ["sessions", "all"],
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        return (
          requireApiData(
            await crossDeviceServiceListSessions({
              headers: authorizationHeaders(authorization),
              query: { includeArchived: true, pageSize: 100 },
            }),
            "读取任务历史失败。"
          ).sessions ?? []
        )
      } catch (error) {
        const cached = await readCachedSessions()
        if (cached.length) return cached
        throw error
      }
    },
  })
  const runs = useQuery({
    queryKey: ["runs", "all"],
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        return (
          requireApiData(
            await crossDeviceServiceListAgentRuns({
              headers: authorizationHeaders(authorization),
              query: { pageSize: 100 },
            }),
            "读取 Run 状态失败。"
          ).runs ?? []
        )
      } catch (error) {
        const cached = await readCachedRuns()
        if (cached.length) return cached
        throw error
      }
    },
    refetchInterval: 5_000,
  })

  const latestRuns = useMemo(() => {
    const map = new Map<string, AstraflowV1AgentRun>()
    for (const run of runs.data ?? []) {
      if (run.sessionId && !map.has(run.sessionId)) map.set(run.sessionId, run)
    }
    return map
  }, [runs.data])
  const filtered = (sessions.data ?? []).filter((session) =>
    `${session.title} ${session.model} ${session.runtimeId}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  )

  return (
    <Screen>
      <PageHeader
        eyebrow="跨设备任务"
        title="继续工作"
        description="云端和 Mac 上的任务，共用同一条时间线。"
        action={
          <IconButton
            icon="add"
            label="新建任务"
            onPress={() => router.push("/new-task")}
          />
        }
      />
      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={18} color={palette.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索任务、模型或 runtime"
          placeholderTextColor={palette.textMuted}
          style={styles.searchInput}
        />
      </View>

      {sessions.isLoading ? <LoadingState label="正在读取任务历史…" /> : null}
      {sessions.error ? (
        <ErrorState
          message={sessions.error.message}
          retry={() => void sessions.refetch()}
        />
      ) : null}
      {!sessions.isLoading && !sessions.error && filtered.length === 0 ? (
        <EmptyState
          icon="route"
          title={search ? "没有匹配的任务" : "从第一项任务开始"}
          description={
            search
              ? "换一个关键词，或清空搜索条件。"
              : "选择云端 Sandbox，或连接在线 Mac，把任务交给 Agent。"
          }
          action={
            !search ? (
              <PrimaryButton
                label="新建任务"
                icon="arrow-forward"
                onPress={() => router.push("/new-task")}
              />
            ) : undefined
          }
        />
      ) : null}

      <View style={styles.list}>
        {filtered.map((session) => {
          const run = session.id ? latestRuns.get(session.id) : undefined
          return (
            <Pressable
              key={session.id}
              disabled={!run?.id}
              onPress={() =>
                run?.id &&
                router.push({ pathname: "/run/[runId]", params: { runId: run.id } })
              }
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Surface style={styles.taskCard}>
                <View style={styles.cardTop}>
                  <View style={styles.cardCopy}>
                    <AppText variant="subtitle" numberOfLines={2}>
                      {session.title || "未命名任务"}
                    </AppText>
                    <AppText variant="caption" style={styles.muted}>
                      {run?.executionTarget === "desktop" ? "我的 Mac" : "云端 Sandbox"}
                      {session.runtimeId ? ` · ${session.runtimeId}` : ""}
                    </AppText>
                  </View>
                  <StatusPill status={run?.status || "ready"} />
                </View>
                <View style={styles.metadataRow}>
                  <AppText variant="mono" style={styles.muted}>
                    {session.model || "默认模型"}
                  </AppText>
                  <AppText variant="caption" style={styles.muted}>
                    {formatRelativeTime(run?.updatedAt || session.updatedAt)}
                  </AppText>
                </View>
              </Surface>
            </Pressable>
          )
        })}
      </View>
    </Screen>
  )
}

function formatRelativeTime(value?: string) {
  if (!value) return "刚刚"
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "刚刚"
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return `${Math.floor(elapsed / 86_400_000)} 天前`
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.paperRaised,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  searchInput: { flex: 1, color: palette.text, fontFamily: "IBMPlexSans_400Regular" },
  list: { gap: spacing.md },
  taskCard: { gap: spacing.lg },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  cardCopy: { flex: 1, gap: spacing.xs },
  metadataRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  muted: { color: palette.textMuted },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
})
