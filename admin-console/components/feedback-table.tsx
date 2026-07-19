"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ExternalLinkIcon,
  EyeIcon,
  ImageIcon,
  ImageOffIcon,
  LoaderCircleIcon,
  SearchIcon,
} from "lucide-react"
import { toast } from "sonner"

import { getFeedbackAction, updateFeedbackAction } from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ADMIN_BASE_PATH } from "@/lib/admin-base-path"
import type {
  AstraflowV1FeedbackDetail,
  AstraflowV1FeedbackImageMetadata,
  AstraflowV1FeedbackSummary,
} from "@/lib/generated/astraflow-api"
import { cn } from "@/lib/utils"

const statusOptions = [
  { value: "new", label: "新反馈" },
  { value: "reviewing", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
] as const

function statusLabel(value?: string) {
  return (
    statusOptions.find((status) => status.value === value)?.label ??
    value ??
    "—"
  )
}

function formatByteSize(value?: string) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function summarizeEmbeddedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(summarizeEmbeddedValue)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        summarizeEmbeddedValue(nested),
      ])
    )
  }
  if (typeof value !== "string") return value
  if (value.startsWith("data:")) {
    const headerEnd = value.indexOf(",")
    const mediaType = value.slice(5, value.indexOf(";", 5)) || "文件"
    const encodedLength = Math.max(0, value.length - headerEnd - 1)
    const estimatedBytes = Math.floor((encodedLength * 3) / 4)
    return `[${mediaType} 内嵌数据已省略 · 约 ${formatByteSize(String(estimatedBytes))}]`
  }
  if (value.length > 8_000) {
    return `${value.slice(0, 8_000)}\n… 已省略 ${value.length - 8_000} 个字符`
  }
  return value
}

function formatMessages(value?: string) {
  if (!value) return "没有会话快照"
  try {
    return JSON.stringify(summarizeEmbeddedValue(JSON.parse(value)), null, 2)
  } catch {
    return String(summarizeEmbeddedValue(value))
  }
}

function FeedbackImagePreview({
  image,
  feedbackId,
}: {
  image: AstraflowV1FeedbackImageMetadata
  feedbackId: string
}) {
  const [loaded, setLoaded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const url = `${ADMIN_BASE_PATH}/api/feedback/${encodeURIComponent(feedbackId)}/images/${encodeURIComponent(image.id ?? "")}`

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group min-w-0 overflow-hidden rounded-lg border bg-card transition-colors hover:bg-muted/40"
    >
      <div className="relative flex h-44 items-center justify-center overflow-hidden bg-muted/50">
        {!loaded && !failed ? (
          <LoaderCircleIcon
            className="animate-spin text-muted-foreground"
            aria-label="截图加载中"
          />
        ) : null}
        {failed ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
            <ImageOffIcon aria-hidden />
            <span className="text-xs">预览加载失败，点击打开原图</span>
          </div>
        ) : (
          // Authenticated same-origin images cannot use next/image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={image.name ?? "反馈截图"}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              "absolute inset-0 size-full object-contain p-2 transition-opacity",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 border-t px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={image.name}>
            {image.name ?? "未命名截图"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatByteSize(image.byteSize)}
          </p>
        </div>
        <ExternalLinkIcon
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      </div>
    </a>
  )
}

export function FeedbackTable({
  feedbacks,
}: {
  feedbacks: AstraflowV1FeedbackSummary[]
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [detail, setDetail] = React.useState<AstraflowV1FeedbackDetail | null>(
    null
  )
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [draftStatus, setDraftStatus] = React.useState("new")
  const [assignee, setAssignee] = React.useState("")
  const [adminNote, setAdminNote] = React.useState("")

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return feedbacks.filter((feedback) => {
      const matchesStatus = status === "all" || feedback.status === status
      const matchesQuery =
        !needle ||
        [
          feedback.id,
          feedback.description,
          feedback.reporterEmail,
          feedback.channelSlug,
          feedback.assignee,
        ].some((value) => value?.toLowerCase().includes(needle))
      return matchesStatus && matchesQuery
    })
  }, [feedbacks, query, status])

  async function openDetail(feedbackId: string) {
    setDialogOpen(true)
    setLoading(true)
    setDetail(null)
    try {
      const next = await getFeedbackAction(feedbackId)
      setDetail(next)
      setDraftStatus(next.summary?.status ?? "new")
      setAssignee(next.summary?.assignee ?? "")
      setAdminNote(next.adminNote ?? "")
    } catch (error) {
      toast.error("反馈详情加载失败", {
        description: error instanceof Error ? error.message : String(error),
      })
      setDialogOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function saveFeedback() {
    const feedbackId = detail?.summary?.id
    if (!feedbackId) return
    setSaving(true)
    try {
      const updated = await updateFeedbackAction({
        feedbackId,
        status: draftStatus as "new" | "reviewing" | "resolved" | "closed",
        assignee,
        adminNote,
      })
      setDetail(updated)
      toast.success("反馈已更新")
      router.refresh()
    } catch (error) {
      toast.error("反馈更新失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索描述、邮箱、ID 或渠道"
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-fit min-w-32">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部状态</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {
              filtered.filter((item) =>
                ["new", "reviewing"].includes(item.status ?? "")
              ).length
            }{" "}
            待处理 · {filtered.length} 条
          </span>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table className="min-w-[960px] table-fixed">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[16%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
              <col className="w-[8%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">反馈</TableHead>
                <TableHead className="text-center">提交者</TableHead>
                <TableHead className="text-center">渠道</TableHead>
                <TableHead className="text-center">状态</TableHead>
                <TableHead className="text-center">负责人</TableHead>
                <TableHead className="text-center">时间</TableHead>
                <TableHead className="text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((feedback) => (
                <TableRow key={feedback.id}>
                  <TableCell className="min-w-0 whitespace-normal">
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <span
                        className="line-clamp-2 max-w-full text-left leading-5 font-medium break-words"
                        title={feedback.description}
                      >
                        {feedback.description}
                      </span>
                      <span
                        className="block max-w-full truncate font-mono text-[11px] text-muted-foreground"
                        title={feedback.id}
                      >
                        {feedback.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0 text-center">
                    <span
                      className="block truncate"
                      title={feedback.reporterEmail || "匿名"}
                    >
                      {feedback.reporterEmail || "匿名"}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-0 text-center font-mono text-xs">
                    <span
                      className="block truncate"
                      title={feedback.channelSlug || "default"}
                    >
                      {feedback.channelSlug || "default"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">
                      {statusLabel(feedback.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-0 text-center">
                    <span
                      className="block truncate"
                      title={feedback.assignee || "未分配"}
                    >
                      {feedback.assignee || "未分配"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-xs whitespace-normal text-muted-foreground">
                    {feedback.createdAt
                      ? new Date(feedback.createdAt).toLocaleString("zh-CN")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        feedback.id && void openDetail(feedback.id)
                      }
                    >
                      <EyeIcon data-icon="inline-start" />
                      详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="grid max-h-[calc(100dvh-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-6 py-5 pr-16">
            <DialogTitle className="font-heading text-2xl">
              反馈详情
            </DialogTitle>
            <DialogDescription>
              查看客户端上下文并记录处理结论。
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center text-muted-foreground">
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            </div>
          ) : detail ? (
            <div className="flex min-w-0 flex-col gap-6 overflow-y-auto px-6 py-5">
              <div className="grid min-w-0 gap-3 rounded-lg bg-muted p-4 text-sm md:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground">渠道</p>
                  <p
                    className="truncate font-mono"
                    title={detail.summary?.channelSlug}
                  >
                    {detail.summary?.channelSlug}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground">客户端</p>
                  <p className="truncate">
                    {detail.summary?.platform} · {detail.summary?.clientVersion}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground">提交者</p>
                  <p
                    className="truncate"
                    title={detail.summary?.reporterEmail || "匿名"}
                  >
                    {detail.summary?.reporterEmail || "匿名"}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="font-semibold">问题描述</h3>
                <p className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm leading-6 break-words whitespace-pre-wrap">
                  {detail.summary?.description}
                </p>
              </div>

              {(detail.images?.length ?? 0) > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <ImageIcon aria-hidden />
                    截图
                  </h3>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {detail.images?.map((image) => (
                      <FeedbackImagePreview
                        key={image.id}
                        image={image}
                        feedbackId={detail.summary?.id ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <details className="min-w-0 overflow-hidden rounded-lg border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  会话快照
                </summary>
                <pre className="max-h-80 max-w-full overflow-auto border-t bg-muted p-4 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
                  {formatMessages(detail.messagesJson)}
                </pre>
              </details>

              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="feedback-status">处理状态</FieldLabel>
                    <Select value={draftStatus} onValueChange={setDraftStatus}>
                      <SelectTrigger id="feedback-status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {statusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="feedback-assignee">负责人</FieldLabel>
                    <Input
                      id="feedback-assignee"
                      value={assignee}
                      onChange={(event) => setAssignee(event.target.value)}
                      placeholder="例如：Jason"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="feedback-note">内部处理备注</FieldLabel>
                  <Textarea
                    id="feedback-note"
                    value={adminNote}
                    onChange={(event) => setAdminNote(event.target.value)}
                    rows={5}
                    placeholder="记录复现情况、处理方案和后续动作"
                  />
                  <FieldDescription>
                    仅管理端可见，不会返回客户端。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </div>
          ) : null}

          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!detail || saving}
              onClick={() => void saveFeedback()}
            >
              {saving ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              保存处理结果
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
