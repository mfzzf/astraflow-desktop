import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, StyleSheet, TextInput, View } from "react-native"

import { marketplaceServiceListSkillMarket } from "@/generated/astraflow-api"
import {
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Screen,
  Surface,
} from "@/components/ui"
import { requireApiData } from "@/lib/api"
import { palette, radius, spacing } from "@/lib/theme"

export default function SkillsScreen() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const skills = useQuery({
    queryKey: ["skills", search],
    queryFn: async () =>
      requireApiData(
        await marketplaceServiceListSkillMarket({
          query: { keyword: search.trim(), orderBy: "popular", limit: 60 },
        }),
        "读取 SKILLS 市场失败。"
      ),
  })

  return (
    <Screen>
      <PageHeader
        eyebrow="能力市场"
        title="SKILLS"
        description="由 Agent 按需调用的可审计能力包。"
      />
      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={18} color={palette.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索技能、作者或用途"
          placeholderTextColor={palette.textMuted}
          style={styles.searchInput}
        />
      </View>
      {skills.isLoading ? <LoadingState label="正在加载能力市场…" /> : null}
      {skills.error ? (
        <ErrorState
          message={skills.error.message}
          retry={() => void skills.refetch()}
        />
      ) : null}
      {!skills.isLoading && !skills.error && !skills.data?.skills?.length ? (
        <EmptyState
          icon="extension-off"
          title="没有匹配的 SKILL"
          description="尝试更短或更通用的关键词。"
        />
      ) : null}
      <View style={styles.grid}>
        {(skills.data?.skills ?? []).map((skill, index) => (
          <Pressable
            key={`${skill.slug}-${skill.version}`}
            disabled={!skill.slug}
            onPress={() =>
              skill.slug &&
              router.push({
                pathname: "/skill/[slug]",
                params: { slug: skill.slug, version: skill.version || "" },
              })
            }
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Surface style={styles.skillCard}>
              <View
                style={[
                  styles.iconWrap,
                  {
                    backgroundColor:
                      index % 3 === 0
                        ? palette.signal
                        : index % 3 === 1
                          ? palette.sky
                          : "#FFD3C9",
                  },
                ]}
              >
                {skill.iconUrl ? (
                  <Image
                    source={skill.iconUrl}
                    style={styles.icon}
                    contentFit="cover"
                    alt=""
                  />
                ) : (
                  <MaterialIcons
                    name="extension"
                    size={22}
                    color={palette.ink}
                  />
                )}
              </View>
              <View style={styles.flex}>
                <AppText variant="subtitle" numberOfLines={1}>
                  {skill.name || skill.slug}
                </AppText>
                <AppText
                  variant="caption"
                  style={styles.muted}
                  numberOfLines={2}
                >
                  {skill.descriptionZh || skill.description || "暂无描述"}
                </AppText>
                <View style={styles.metaRow}>
                  <AppText variant="label" style={styles.category}>
                    {skill.category || "General"}
                  </AppText>
                  <AppText variant="mono" style={styles.muted}>
                    ★ {skill.stars || "0"}
                  </AppText>
                </View>
              </View>
              <MaterialIcons
                name="chevron-right"
                size={22}
                color={palette.textMuted}
              />
            </Surface>
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
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
  searchInput: {
    flex: 1,
    color: palette.text,
    fontFamily: "IBMPlexSans_400Regular",
  },
  grid: { gap: spacing.md },
  skillCard: { flexDirection: "row", alignItems: "flex-start" },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  icon: { width: 48, height: 48 },
  muted: { color: palette.textMuted },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  category: { color: palette.signalDark },
  pressed: { opacity: 0.7 },
})
