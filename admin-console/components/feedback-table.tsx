"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { EyeIcon, ImageIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
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
  AstraflowV1FeedbackSummary,
} from "@/lib/generated/astraflow-api"

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

function formatMessages(value?: string) {
  if (!value) return "没有会话快照"
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
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

        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
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
                  <TableCell className="max-w-96 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="line-clamp-2 font-medium">
                        {feedback.description}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {feedback.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {feedback.reporterEmail || "匿名"}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs">
                    {feedback.channelSlug || "default"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">
                      {statusLabel(feedback.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {feedback.assignee || "未分配"}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
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
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
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
            <div className="flex flex-col gap-6">
              <div className="grid gap-3 rounded-lg bg-muted p-4 text-sm md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">渠道</p>
                  <p className="font-mono">{detail.summary?.channelSlug}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">客户端</p>
                  <p>
                    {detail.summary?.platform} · {detail.summary?.clientVersion}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">提交者</p>
                  <p>{detail.summary?.reporterEmail || "匿名"}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">问题描述</h3>
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {detail.summary?.description}
                </p>
              </div>

              {(detail.images?.length ?? 0) > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <ImageIcon aria-hidden />
                    截图
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {detail.images?.map((image) => (
                      <a
                        key={image.id}
                        href={`${ADMIN_BASE_PATH}/api/feedback/${encodeURIComponent(detail.summary?.id ?? "")}/images/${encodeURIComponent(image.id ?? "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-lg border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${ADMIN_BASE_PATH}/api/feedback/${encodeURIComponent(detail.summary?.id ?? "")}/images/${encodeURIComponent(image.id ?? "")}`}
                          alt={image.name ?? "反馈截图"}
                          className="aspect-video w-full object-cover"
                        />
                        <p className="truncate px-3 py-2 text-xs">
                          {image.name}
                        </p>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <details className="rounded-lg border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  会话快照
                </summary>
                <pre className="max-h-72 overflow-auto border-t bg-muted p-4 font-mono text-xs leading-5">
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

          <DialogFooter>
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
