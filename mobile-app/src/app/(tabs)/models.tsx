import { MaterialIcons } from "@expo/vector-icons"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useDeferredValue, useMemo, useState } from "react"
import { Pressable, StyleSheet, TextInput, View } from "react-native"

import {
  crossDeviceServiceListSessions,
  modelCatalogServiceListModels,
  type AstraflowV1ModelCatalogItem,
} from "@/generated/astraflow-api"
import {
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Screen,
  Surface,
} from "@/components/ui"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { readCachedSessions } from "@/lib/mobile-db"
import { palette, radius, spacing } from "@/lib/theme"

const outputTypes = [
  { id: "", label: "全部" },
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
] as const

export default function ModelsScreen() {
  const auth = useAuth()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [vendor, setVendor] = useState("")
  const [outputType, setOutputType] = useState("")
  const deferredSearch = useDeferredValue(search.trim())

  const catalog = useQuery({
    queryKey: ["model-catalog", deferredSearch, vendor, outputType],
    queryFn: async () => {
      const authorization = await auth.getAuthorization()
      const models: AstraflowV1ModelCatalogItem[] = []
      let pageToken = ""
      let vendors: Array<{ name?: string; iconUrl?: string; count?: number }> = []
      for (let page = 0; page < 50; page += 1) {
        const response = requireApiData(
          await modelCatalogServiceListModels({
            headers: authorizationHeaders(authorization),
            query: {
              keyword: deferredSearch,
              vendor,
              outputType,
              pageToken,
              pageSize: 100,
            },
          }),
          "读取 UCloud 模型目录失败。"
        )
        models.push(...(response.models ?? []))
        if (page === 0) vendors = response.vendors ?? []
        if (!response.nextPageToken) break
        pageToken = response.nextPageToken
      }
      return { models, vendors }
    },
  })

  const sessions = useQuery({
    queryKey: ["sessions", "model-usage"],
    queryFn: async () => {
      try {
        const authorization = await auth.getAuthorization()
        return (
          requireApiData(
            await crossDeviceServiceListSessions({
              headers: authorizationHeaders(authorization),
              query: { includeArchived: true, pageSize: 100 },
            }),
            "读取最近模型失败。"
          ).sessions ?? []
        )
      } catch {
        return readCachedSessions()
      }
    },
  })
  const recent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions.data ?? []) {
      if (session.model) counts.set(session.model, (counts.get(session.model) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5)
  }, [sessions.data])

  const choose = (modelId?: string) => {
    if (!modelId) return
    router.push({ pathname: "/new-task", params: { model: modelId } })
  }

  return (
    <Screen>
      <PageHeader
        eyebrow="UCloud 模型广场"
        title="Models"
        description="目录由当前 UCloud OAuth 账号实时加载，选择后可直接创建任务。"
      />
      <Surface style={styles.heroCard}>
        <View style={styles.orbit}>
          <MaterialIcons name="auto-awesome" size={30} color={palette.ink} />
        </View>
        <View style={styles.flex}>
          <AppText variant="subtitle" style={styles.lightText}>一个模型，两种执行环境</AppText>
          <AppText style={styles.heroCopy}>云端 Sandbox 与在线 Mac 共用同一目录，runtime 会在启动前校验能力。</AppText>
        </View>
      </Surface>

      {recent.length ? (
        <View style={styles.recentRow}>
          {recent.map(([id, count]) => (
            <Pressable key={id} onPress={() => choose(id)} style={styles.recentChip}>
              <MaterialIcons name="history" size={15} color={palette.textMuted} />
              <AppText variant="caption" numberOfLines={1} style={styles.flex}>{id}</AppText>
              <AppText variant="mono" style={styles.muted}>{count}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={18} color={palette.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索模型、厂商或能力"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          style={styles.searchInput}
        />
        {search ? (
          <Pressable accessibilityLabel="清空搜索" onPress={() => setSearch("")}>
            <MaterialIcons name="cancel" size={19} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {outputTypes.map((option) => (
          <FilterChip
            key={option.id || "all"}
            label={option.label}
            selected={outputType === option.id}
            onPress={() => setOutputType(option.id)}
          />
        ))}
      </View>
      {catalog.data?.vendors.length ? (
        <View style={styles.filterRow}>
          <FilterChip label="所有厂商" selected={!vendor} onPress={() => setVendor("")} />
          {catalog.data.vendors.slice(0, 12).map((facet) => (
            <FilterChip
              key={facet.name}
              label={`${facet.name} · ${facet.count ?? 0}`}
              selected={vendor === facet.name}
              onPress={() => setVendor(facet.name || "")}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.sectionTitle}>
        <AppText variant="label" style={styles.muted}>可用模型</AppText>
        <AppText variant="caption" style={styles.muted}>{catalog.data?.models.length ?? 0} 个结果</AppText>
      </View>
      {catalog.isLoading ? <LoadingState label="正在加载账号可用模型…" /> : null}
      {catalog.error ? <ErrorState message={catalog.error.message} retry={() => void catalog.refetch()} /> : null}
      {!catalog.isLoading && !catalog.error && !catalog.data?.models.length ? (
        <EmptyState icon="memory" title="没有匹配模型" description="尝试清空厂商、输出类型或搜索关键词。" />
      ) : null}

      <View style={styles.modelGrid}>
        {(catalog.data?.models ?? []).map((model, index) => (
          <Pressable key={model.id} onPress={() => choose(model.id)} style={({ pressed }) => pressed && styles.pressed}>
            <Surface style={styles.modelCard}>
              <View style={[styles.modelIcon, { backgroundColor: index % 3 === 0 ? palette.signal : index % 3 === 1 ? palette.sky : "#FFD3C9" }]}>
                {model.iconUrl ? (
                  <Image source={model.iconUrl} style={styles.image} contentFit="cover" alt="" />
                ) : (
                  <MaterialIcons name="memory" size={23} color={palette.ink} />
                )}
              </View>
              <View style={styles.modelCopy}>
                <View style={styles.nameRow}>
                  <AppText variant="subtitle" numberOfLines={1} style={styles.flex}>
                    {model.chineseName || model.name || model.id}
                  </AppText>
                  <MaterialIcons name="arrow-forward" size={19} color={palette.textMuted} />
                </View>
                <AppText variant="mono" style={styles.muted} numberOfLines={1}>{model.id}</AppText>
                <AppText variant="caption" style={styles.muted} numberOfLines={2}>
                  {model.description || model.descriptionEn || "暂无模型说明"}
                </AppText>
                <View style={styles.metaRow}>
                  <AppText variant="label" style={styles.vendor}>{model.manufacturer || "UCloud"}</AppText>
                  <AppText variant="caption" style={styles.muted}>
                    {formatContext(model.contextLength)} · {(model.outputModalities ?? []).join(" / ") || "text"}
                  </AppText>
                </View>
              </View>
            </Surface>
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, selected && styles.filterChipSelected]}>
      <AppText variant="caption" style={selected && styles.filterChipText}>{label}</AppText>
    </Pressable>
  )
}

function formatContext(value?: string) {
  const size = Number(value ?? 0)
  if (!Number.isFinite(size) || size <= 0) return "上下文未知"
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(size % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(size / 1_000)}K`
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heroCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.ink, borderColor: palette.ink },
  orbit: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.signal, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-8deg" }] },
  lightText: { color: palette.textOnDark, marginBottom: spacing.xs },
  heroCopy: { color: "#B9C2C7" },
  recentRow: { gap: spacing.sm },
  recentChip: { minHeight: 42, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill, backgroundColor: palette.paperRaised, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchBox: { minHeight: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.paperRaised, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.sm },
  searchInput: { flex: 1, color: palette.text, fontFamily: "IBMPlexSans_400Regular" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filterChip: { minHeight: 36, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: palette.paperRaised },
  filterChipSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  filterChipText: { color: palette.textOnDark },
  sectionTitle: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: palette.textMuted },
  modelGrid: { gap: spacing.md },
  modelCard: { flexDirection: "row", alignItems: "flex-start" },
  modelIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: 50, height: 50 },
  modelCopy: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.xs },
  vendor: { color: palette.signalDark },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
})
