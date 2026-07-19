import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useLocalSearchParams, useRouter } from "expo-router"
import { StyleSheet, View } from "react-native"

import {
  AppText,
  ErrorState,
  LoadingState,
  PrimaryButton,
  Screen,
  Surface,
} from "@/components/ui"
import { marketplaceServiceGetSkillDetail } from "@/generated/astraflow-api"
import { requireApiData } from "@/lib/api"
import { palette, radius, spacing } from "@/lib/theme"

export default function SkillDetailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    slug: string | string[]
    version?: string | string[]
  }>()
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug
  const version = Array.isArray(params.version)
    ? params.version[0]
    : params.version
  const query = useQuery({
    queryKey: ["skill", slug, version],
    enabled: Boolean(slug),
    queryFn: async () =>
      requireApiData(
        await marketplaceServiceGetSkillDetail({
          path: { slug: slug! },
          query: { version: version || undefined },
        }),
        "读取 SKILL 详情失败。"
      ),
  })
  if (query.isLoading) return <LoadingState label="正在读取 SKILL…" />
  if (query.error || !query.data?.skill) {
    return (
      <ErrorState
        message={query.error?.message || "SKILL 不存在。"}
        retry={() => void query.refetch()}
      />
    )
  }
  const skill = query.data.skill
  const invocationPrompt = [
    `请严格按照 AstraFlow SKILL「${skill.name || skill.slug}」的说明执行接下来的任务。`,
    "",
    "<skill_instructions>",
    query.data.skillMd?.slice(0, 20_000) || `使用 ${skill.slug} 的专业工作流。`,
    "</skill_instructions>",
    "",
    "任务：",
  ].join("\n")
  return (
    <Screen>
      <Surface style={styles.hero}>
        <View style={styles.iconWrap}>
          {skill.iconUrl ? (
            <Image
              source={skill.iconUrl}
              style={styles.icon}
              contentFit="cover"
              alt=""
            />
          ) : (
            <MaterialIcons name="extension" size={30} color={palette.ink} />
          )}
        </View>
        <View style={styles.flex}>
          <AppText variant="title">{skill.name || skill.slug}</AppText>
          <AppText variant="label" style={styles.signal}>
            {skill.category || "General"} · v{skill.version || "latest"}
          </AppText>
          <AppText variant="caption" style={styles.muted}>
            {skill.descriptionZh || skill.description || "暂无描述"}
          </AppText>
        </View>
      </Surface>
      <View style={styles.metaGrid}>
        <Meta label="Stars" value={skill.stars || "0"} />
        <Meta label="Files" value={String(skill.fileCount || 0)} />
        <Meta label="Author" value={skill.author || "—"} />
      </View>
      {query.data.skillMd ? (
        <Surface style={styles.readme}>
          <AppText variant="label" style={styles.muted}>
            SKILL.md
          </AppText>
          <AppText variant="caption" selectable>
            {query.data.skillMd.slice(0, 12_000)}
          </AppText>
        </Surface>
      ) : null}
      <PrimaryButton
        label="在新任务中调用"
        icon="arrow-forward"
        tone="ink"
        onPress={() =>
          router.push({
            pathname: "/new-task",
            params: { prompt: invocationPrompt },
          })
        }
      />
    </Screen>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Surface style={styles.meta}>
      <AppText variant="mono" style={styles.muted}>
        {label}
      </AppText>
      <AppText variant="subtitle" numberOfLines={1}>
        {value}
      </AppText>
    </Surface>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.sm },
  hero: { gap: spacing.md },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  icon: { width: 72, height: 72 },
  signal: { color: palette.signalDark },
  muted: { color: palette.textMuted },
  metaGrid: { flexDirection: "row", gap: spacing.sm },
  meta: { flex: 1, alignItems: "center", padding: spacing.md },
  readme: { gap: spacing.md },
})
