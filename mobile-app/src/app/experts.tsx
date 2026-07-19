import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, StyleSheet, TextInput, View } from "react-native"

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Screen,
  Surface,
  AppText,
} from "@/components/ui"
import { expertServiceListExperts } from "@/generated/astraflow-api"
import { requireApiData } from "@/lib/api"
import { palette, radius, spacing } from "@/lib/theme"

export default function ExpertsScreen() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const experts = useQuery({
    queryKey: ["experts", search],
    queryFn: async () =>
      requireApiData(
        await expertServiceListExperts({
          query: {
            pageSize: 100,
            query: search.trim(),
            status: "active",
            locale: "zh-CN",
          },
        }),
        "读取专家目录失败。"
      ),
  })

  return (
    <Screen>
      <PageHeader
        eyebrow="专家团"
        title="Experts"
        description="选择一个带角色、SKILLS 与工具策略的专业工作方式。"
      />
      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={18} color={palette.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索专家或职业"
          placeholderTextColor={palette.textMuted}
          style={styles.searchInput}
        />
      </View>
      {experts.isLoading ? <LoadingState label="正在加载专家团…" /> : null}
      {experts.error ? (
        <ErrorState
          message={experts.error.message}
          retry={() => void experts.refetch()}
        />
      ) : null}
      {!experts.isLoading &&
      !experts.error &&
      !experts.data?.experts?.length ? (
        <EmptyState
          icon="groups"
          title="没有匹配的专家"
          description="换一个关键词试试。"
        />
      ) : null}
      <View style={styles.grid}>
        {(experts.data?.experts ?? []).map((expert, index) => (
          <Pressable
            key={expert.id}
            onPress={() =>
              expert.id &&
              router.push({
                pathname: "/expert/[expertId]",
                params: { expertId: expert.id },
              })
            }
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Surface style={styles.card}>
              <View
                style={[
                  styles.avatar,
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
                {expert.avatarUrl ? (
                  <Image
                    source={expert.avatarUrl}
                    style={styles.avatarImage}
                    contentFit="cover"
                    alt=""
                  />
                ) : (
                  <MaterialIcons name="person" size={26} color={palette.ink} />
                )}
              </View>
              <View style={styles.flex}>
                <AppText variant="subtitle" numberOfLines={1}>
                  {expert.displayNameZh ||
                    expert.displayName ||
                    expert.displayNameEn ||
                    expert.slug}
                </AppText>
                <AppText variant="label" style={styles.profession}>
                  {expert.professionZh || expert.profession || expert.type}
                </AppText>
                <AppText
                  variant="caption"
                  style={styles.muted}
                  numberOfLines={2}
                >
                  {expert.descriptionZh || expert.description || "暂无简介"}
                </AppText>
                <AppText variant="mono" style={styles.muted}>
                  {expert.memberCount || 1} agents · {expert.skillCount || 0}{" "}
                  skills
                </AppText>
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
  card: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 58, height: 58 },
  profession: { color: palette.signalDark },
  muted: { color: palette.textMuted },
  pressed: { opacity: 0.7 },
})
