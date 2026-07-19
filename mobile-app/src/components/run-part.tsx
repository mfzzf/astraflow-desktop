import { MaterialIcons } from "@expo/vector-icons"
import { Image } from "expo-image"
import type { ReactNode } from "react"
import { Linking, Pressable, StyleSheet, View } from "react-native"

import { AppText, StatusPill, Surface } from "@/components/ui"
import { palette, radius, spacing } from "@/lib/theme"

type JsonRecord = Record<string, unknown>

export function RunPart({ part }: { part: JsonRecord }) {
  const type = text(part.type)
  if (type === "text") {
    const content = text(part.content) || text(part.text)
    return content ? <AppText style={styles.answer}>{content}</AppText> : null
  }
  if (type === "content") return <ContentBlock content={record(part.content)} />
  if (type === "reasoning") {
    return (
      <CompactCard icon="psychology" title="思考过程" status="complete">
        <AppText style={styles.muted}>{boundedText(part.content)}</AppText>
      </CompactCard>
    )
  }
  if (type === "plan") return <PlanPart part={part} />
  if (type === "tool") return <ToolPart part={part} />
  if (type === "file" || type === "file_group") return <FilePart part={part} />
  if (type === "media_generation") return <MediaPart part={part} />
  if (type === "subagent") return <SubagentPart part={part} />
  if (type === "permission" || type === "user_input") {
    return (
      <CompactCard
        icon={type === "permission" ? "verified-user" : "question-answer"}
        title={type === "permission" ? "需要权限" : "等待你的回答"}
        status={text(part.status) || "pending"}
      >
        <AppText style={styles.muted}>
          {type === "permission"
            ? text(part.toolName) || "Agent 请求执行受保护操作。"
            : "请在页面顶部的操作卡片中处理。"}
        </AppText>
      </CompactCard>
    )
  }
  if (type === "error") {
    return (
      <CompactCard icon="error-outline" title="执行错误" status="failed">
        <AppText style={styles.error}>{boundedText(part.message || part.error)}</AppText>
      </CompactCard>
    )
  }
  return null
}

function ContentBlock({ content }: { content: JsonRecord }) {
  const type = text(content.type)
  const value = text(content.text) || text(content.content)
  if (value) {
    return (
      <AppText style={type === "thinking" ? styles.muted : styles.answer}>
        {value}
      </AppText>
    )
  }
  const uri = text(content.url) || text(content.uri)
  if (uri && isDisplayableImage(uri)) {
    return <Image source={{ uri }} contentFit="contain" style={styles.image} alt="" />
  }
  if (uri) return <ResourceLink title={text(content.name) || "打开结果"} uri={uri} />
  return null
}

function PlanPart({ part }: { part: JsonRecord }) {
  const todos = records(part.todos)
  return (
    <CompactCard icon="checklist" title="执行计划" status="running">
      {text(part.content) ? <AppText>{boundedText(part.content)}</AppText> : null}
      {todos.map((todo, index) => {
        const status = text(todo.status) || "pending"
        return (
          <View key={`${text(todo.text)}-${index}`} style={styles.todo}>
            <MaterialIcons
              name={
                status === "completed"
                  ? "check-circle"
                  : status === "in_progress"
                    ? "radio-button-checked"
                    : "radio-button-unchecked"
              }
              size={18}
              color={status === "completed" ? palette.success : palette.textMuted}
            />
            <AppText style={styles.flex}>{text(todo.text) || `步骤 ${index + 1}`}</AppText>
          </View>
        )
      })}
    </CompactCard>
  )
}

function ToolPart({ part }: { part: JsonRecord }) {
  const activity = record(part.activity)
  const status = text(activity.status) || text(part.status) || "running"
  const name = text(activity.title) || text(activity.toolName) || text(part.name) || "工具调用"
  const output = boundedText(activity.output || activity.error || part.output)
  const input = boundedText(activity.input || part.input)
  return (
    <CompactCard icon="terminal" title={name} status={status}>
      {input ? <CodeBlock label="输入" value={input} /> : null}
      {output ? <CodeBlock label={status === "error" ? "错误" : "输出"} value={output} /> : null}
    </CompactCard>
  )
}

function FilePart({ part }: { part: JsonRecord }) {
  const files = text(part.type) === "file_group" ? records(part.files) : [part]
  return (
    <CompactCard icon="difference" title={files.length > 1 ? `${files.length} 个文件变更` : "文件变更"} status="complete">
      {files.map((file, index) => {
        const stats = record(file.stats)
        return (
          <View key={`${text(file.path)}-${index}`} style={styles.fileRow}>
            <MaterialIcons name={fileIcon(text(file.kind))} size={18} color={palette.ink} />
            <View style={styles.flex}>
              <AppText variant="mono" numberOfLines={2}>{text(file.path) || "未命名文件"}</AppText>
              {number(stats.additions) || number(stats.deletions) ? (
                <AppText variant="caption" style={styles.muted}>
                  +{number(stats.additions)} / -{number(stats.deletions)}
                </AppText>
              ) : null}
            </View>
          </View>
        )
      })}
    </CompactCard>
  )
}

function MediaPart({ part }: { part: JsonRecord }) {
  const outputs = records(part.outputs)
  const kind = text(part.kind) || "image"
  const status = text(part.status) || "running"
  return (
    <CompactCard
      icon={kind === "video" ? "movie" : "image"}
      title={kind === "video" ? "生成视频" : "生成图片"}
      status={status}
    >
      {text(part.prompt) ? <AppText style={styles.muted}>{boundedText(part.prompt)}</AppText> : null}
      {outputs.map((output, index) => {
        const uri = text(output.contentUrl) || text(output.url)
        if (!uri) return null
        return kind === "image" || isDisplayableImage(uri) ? (
          <Pressable key={`${uri}-${index}`} onPress={() => void safeOpen(uri)}>
            <Image source={{ uri }} contentFit="contain" style={styles.image} alt="" />
          </Pressable>
        ) : (
          <ResourceLink key={`${uri}-${index}`} title="播放生成视频" uri={uri} />
        )
      })}
      {text(part.errorMessage) ? <AppText style={styles.error}>{boundedText(part.errorMessage)}</AppText> : null}
    </CompactCard>
  )
}

function SubagentPart({ part }: { part: JsonRecord }) {
  const todos = records(part.todos)
  const activities = records(part.activities)
  return (
    <CompactCard
      icon="account-tree"
      title={text(part.name) || "子 Agent"}
      status={text(part.status) || "running"}
    >
      {text(part.taskInput) ? <AppText style={styles.muted}>{boundedText(part.taskInput)}</AppText> : null}
      {text(part.summary) || text(part.content) ? (
        <AppText>{boundedText(part.summary || part.content)}</AppText>
      ) : null}
      <AppText variant="caption" style={styles.muted}>
        {todos.length} 个步骤 · {activities.length} 个工具调用
      </AppText>
      {text(part.error) ? <AppText style={styles.error}>{boundedText(part.error)}</AppText> : null}
    </CompactCard>
  )
}

function CompactCard({
  icon,
  title,
  status,
  children,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
  status: string
  children: ReactNode
}) {
  return (
    <Surface style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconBox}>
          <MaterialIcons name={icon} size={18} color={palette.ink} />
        </View>
        <AppText variant="subtitle" style={styles.flex} numberOfLines={2}>{title}</AppText>
        <StatusPill status={status} />
      </View>
      {children}
    </Surface>
  )
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.codeBlock}>
      <AppText variant="label" style={styles.codeLabel}>{label}</AppText>
      <AppText variant="mono" selectable>{value}</AppText>
    </View>
  )
}

function ResourceLink({ title, uri }: { title: string; uri: string }) {
  return (
    <Pressable style={styles.resource} onPress={() => void safeOpen(uri)}>
      <MaterialIcons name="open-in-new" size={18} color={palette.ink} />
      <AppText style={styles.flex}>{title}</AppText>
    </Pressable>
  )
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boundedText(value: unknown) {
  const result = text(value)
  return result.length > 12_000 ? `${result.slice(0, 12_000)}\n…` : result
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function fileIcon(kind: string): keyof typeof MaterialIcons.glyphMap {
  if (kind === "delete") return "delete-outline"
  if (kind === "create") return "note-add"
  return "edit-note"
}

function isDisplayableImage(uri: string) {
  return uri.startsWith("data:image/") || /\.(png|jpe?g|gif|webp|avif)(?:\?|$)/i.test(uri)
}

async function safeOpen(uri: string) {
  if (/^(https?:|data:)/i.test(uri) && (await Linking.canOpenURL(uri))) {
    await Linking.openURL(uri)
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  answer: { fontSize: 17, lineHeight: 27 },
  muted: { color: palette.textMuted },
  error: { color: palette.danger },
  card: { padding: spacing.md, borderRadius: radius.md },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: palette.paperMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  todo: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  fileRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  codeBlock: {
    borderRadius: radius.sm,
    backgroundColor: palette.paperMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },
  codeLabel: { color: palette.textMuted },
  image: { width: "100%", height: 240, borderRadius: radius.md, backgroundColor: palette.paperMuted },
  resource: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: palette.signal,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
})
