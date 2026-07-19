import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Pressable, StyleSheet, View } from "react-native"

import {
  AppText,
  ErrorState,
  LoadingState,
  PrimaryButton,
  Screen,
  Surface,
} from "@/components/ui"
import { expertServiceGetExpert } from "@/generated/astraflow-api"
import { requireApiData } from "@/lib/api"
import { palette, radius, spacing } from "@/lib/theme"

export default function ExpertDetailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ expertId: string }>()
  const expertId = Array.isArray(params.expertId)
    ? params.expertId[0]
    : params.expertId
  const query = useQuery({
    queryKey: ["expert", expertId],
    enabled: Boolean(expertId),
    queryFn: async () =>
      requireApiData(
        await expertServiceGetExpert({
          path: { expertId: expertId! },
          query: { locale: "zh-CN" },
        }),
        "读取专家详情失败。"
      ).expert,
  })
  if (query.isLoading) return <LoadingState label="正在读取专家详情…" />
  const expert = query.data
  const summary = expert?.summary
  if (query.error || !expert || !summary) {
    return (
      <ErrorState
        message={query.error?.message || "专家不存在。"}
        retry={() => void query.refetch()}
      />
    )
  }
  const starter =
    expert.defaultInitPrompt?.zh ||
    summary.quickPrompts?.[0] ||
    `请以${summary.displayNameZh || summary.displayName || "该专家"}的方式协助我完成任务。`
  return (
    <Screen>
      <Surface style={styles.hero}>
        <View style={styles.avatar}>
          {summary.avatarUrl ? (
            <Image
              source={summary.avatarUrl}
              style={styles.avatarImage}
              contentFit="cover"
              alt=""
            />
          ) : (
            <MaterialIcons name="person" size={34} color={palette.ink} />
          )}
        </View>
        <View style={styles.flex}>
          <AppText variant="title">
            {summary.displayNameZh || summary.displayName || summary.slug}
          </AppText>
          <AppText variant="label" style={styles.signal}>
            {summary.professionZh || summary.profession || summary.type}
          </AppText>
          <AppText variant="caption" style={styles.muted}>
            {summary.descriptionZh || summary.description}
          </AppText>
        </View>
      </Surface>
      <View style={styles.stats}>
        <Stat label="Agents" value={expert.agents?.length || 0} />
        <Stat label="SKILLS" value={expert.skills?.length || 0} />
        <Stat label="MCP" value={expert.mcpServers?.length || 0} />
      </View>
      {summary.quickPrompts?.length ? (
        <View style={styles.section}>
          <AppText variant="label" style={styles.muted}>
            快速开始
          </AppText>
          {summary.quickPrompts.slice(0, 5).map((prompt) => (
            <Pressable
              key={prompt}
              onPress={() =>
                router.push({ pathname: "/new-task", params: { prompt } })
              }
            >
              <Surface style={styles.promptRow}>
                <MaterialIcons
                  name="north-east"
                  size={18}
                  color={palette.ink}
                />
                <AppText variant="caption" style={styles.flex}>
                  {prompt}
                </AppText>
              </Surface>
            </Pressable>
          ))}
        </View>
      ) : null}
      <PrimaryButton
        label="用这个专家开始任务"
        icon="arrow-forward"
        tone="ink"
        onPress={() =>
          router.push({ pathname: "/new-task", params: { prompt: starter } })
        }
      />
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Surface style={styles.stat}>
      <AppText variant="title">{value}</AppText>
      <AppText variant="mono" style={styles.muted}>
        {label}
      </AppText>
    </Surface>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.sm },
  hero: { gap: spacing.md },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 76, height: 76 },
  signal: { color: palette.signalDark },
  muted: { color: palette.textMuted },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", padding: spacing.md },
  section: { gap: spacing.sm },
  promptRow: { flexDirection: "row", alignItems: "center" },
})
