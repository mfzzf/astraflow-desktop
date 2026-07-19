"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  KeyRoundIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  deleteChannelAction,
  saveChannelAction,
  type ChannelActionInput,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
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
import type { AstraflowV1Channel } from "@/lib/generated/astraflow-api"

const featureOptions = [
  ["models", "Models"],
  ["skills", "SKILLS"],
  ["automations", "自动化"],
  ["mobile", "移动渠道"],
  ["codebox", "CodeBox"],
  ["files", "文件库"],
  ["chat", "Chat"],
  ["image", "图像生成"],
  ["video", "视频生成"],
  ["audio", "音频生成"],
] as const

const defaultFeatures = featureOptions.map(([value]) => value)

type ChannelDraft = ChannelActionInput

function newDraft(): ChannelDraft {
  return {
    slug: "",
    name: "",
    status: "draft",
    oauthClientId: "",
    oauthClientSecret: "",
    clearOauthClientSecret: false,
    enabledFeatures: [...defaultFeatures],
    restrictModels: false,
    allowedModelIds: [],
  }
}

function channelDraft(channel: AstraflowV1Channel): ChannelDraft {
  return {
    id: channel.id,
    slug: channel.slug ?? "",
    name: channel.name ?? "",
    status: (channel.status ?? "draft") as ChannelDraft["status"],
    oauthClientId: channel.oauthClientId ?? "",
    oauthClientSecret: "",
    clearOauthClientSecret: false,
    enabledFeatures: (channel.enabledFeatures ??
      []) as ChannelDraft["enabledFeatures"],
    restrictModels: channel.restrictModels ?? false,
    allowedModelIds: channel.allowedModelIds ?? [],
  }
}

function statusLabel(status?: string) {
  if (status === "active") return "运行中"
  if (status === "disabled") return "已停用"
  return "草稿"
}

export function ChannelTable({ channels }: { channels: AstraflowV1Channel[] }) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [draft, setDraft] = React.useState<ChannelDraft>(newDraft)
  const [modelText, setModelText] = React.useState("")

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return channels.filter((channel) =>
      !needle
        ? true
        : [channel.slug, channel.name, channel.oauthClientId].some((value) =>
            value?.toLowerCase().includes(needle)
          )
    )
  }, [channels, query])

  function openCreate() {
    setDraft(newDraft())
    setModelText("")
    setDialogOpen(true)
  }

  function openEdit(channel: AstraflowV1Channel) {
    setDraft(channelDraft(channel))
    setModelText((channel.allowedModelIds ?? []).join("\n"))
    setDialogOpen(true)
  }

  function setFeature(
    feature: ChannelDraft["enabledFeatures"][number],
    checked: boolean
  ) {
    setDraft((current) => ({
      ...current,
      enabledFeatures: checked
        ? Array.from(new Set([...current.enabledFeatures, feature]))
        : current.enabledFeatures.filter((item) => item !== feature),
    }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const allowedModelIds = modelText
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
      await saveChannelAction({ ...draft, allowedModelIds })
      toast.success(draft.id ? "渠道已更新" : "渠道已创建")
      setDialogOpen(false)
      router.refresh()
    } catch (error) {
      toast.error("渠道保存失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(channel: AstraflowV1Channel) {
    if (!channel.id) return
    if (
      !window.confirm(`确认删除草稿渠道「${channel.name}」？此操作无法撤销。`)
    ) {
      return
    }
    try {
      await deleteChannelAction(channel.id)
      toast.success("草稿渠道已删除")
      router.refresh()
    } catch (error) {
      toast.error("渠道删除失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const editingChannel = channels.find((channel) => channel.id === draft.id)

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索渠道、slug 或 OAuth Client ID"
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate}>
            <PlusIcon data-icon="inline-start" />
            新建渠道
          </Button>
          <span className="text-sm text-muted-foreground">
            {filtered.filter((item) => item.status === "active").length} active
            · {filtered.length} total
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">渠道</TableHead>
                <TableHead className="text-center">状态</TableHead>
                <TableHead className="text-center">OAuth</TableHead>
                <TableHead className="text-center">功能</TableHead>
                <TableHead className="text-center">模型策略</TableHead>
                <TableHead className="text-center">更新时间</TableHead>
                <TableHead className="text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">{channel.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {channel.slug}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        channel.status === "active" ? "default" : "outline"
                      }
                    >
                      {statusLabel(channel.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <KeyRoundIcon aria-hidden />
                      <span className="font-mono text-xs">
                        {channel.oauthClientSecretConfigured
                          ? "Configured"
                          : "Missing"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {(channel.enabledFeatures ?? []).length} /{" "}
                    {featureOptions.length}
                  </TableCell>
                  <TableCell className="text-center">
                    {channel.restrictModels
                      ? `${channel.allowedModelIds?.length ?? 0} 个白名单模型`
                      : "全部模型"}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {channel.updatedAt
                      ? new Date(channel.updatedAt).toLocaleString("zh-CN")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(channel)}
                      >
                        <PencilIcon aria-hidden />
                        <span className="sr-only">编辑 {channel.name}</span>
                      </Button>
                      {channel.status === "draft" ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void remove(channel)}
                        >
                          <Trash2Icon aria-hidden />
                          <span className="sr-only">删除 {channel.name}</span>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <form onSubmit={submit} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle className="font-heading text-2xl">
                {draft.id ? "编辑渠道" : "新建渠道"}
              </DialogTitle>
              <DialogDescription>
                配置会在客户端启动时按 ASTRAFLOW_CHANNEL_SLUG 获取。
              </DialogDescription>
            </DialogHeader>

            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="channel-name">渠道名称</FieldLabel>
                  <Input
                    id="channel-name"
                    required
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="例如：教育行业版"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="channel-slug">Channel slug</FieldLabel>
                  <Input
                    id="channel-slug"
                    required
                    value={draft.slug}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        slug: event.target.value.toLowerCase(),
                      }))
                    }
                    placeholder="education-cn"
                    className="font-mono"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="channel-status">发布状态</FieldLabel>
                <Select
                  value={draft.status}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      status: value as ChannelDraft["status"],
                    }))
                  }
                >
                  <SelectTrigger id="channel-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="active">运行中</SelectItem>
                      <SelectItem value="disabled">已停用</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <FieldSet>
                <FieldLegend>OAuth 凭证</FieldLegend>
                <FieldDescription>
                  Client secret 在后端使用 AES-GCM 加密，管理端不会回显明文。
                </FieldDescription>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="oauth-client-id">Client ID</FieldLabel>
                    <Input
                      id="oauth-client-id"
                      value={draft.oauthClientId}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          oauthClientId: event.target.value,
                        }))
                      }
                      className="font-mono"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="oauth-client-secret">
                      Client secret
                    </FieldLabel>
                    <Input
                      id="oauth-client-secret"
                      type="password"
                      value={draft.oauthClientSecret}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          oauthClientSecret: event.target.value,
                          clearOauthClientSecret: false,
                        }))
                      }
                      placeholder={
                        editingChannel?.oauthClientSecretConfigured
                          ? "留空则保留现有 secret"
                          : "输入 OAuth client secret"
                      }
                    />
                  </Field>
                  {editingChannel?.oauthClientSecretConfigured ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        id="clear-oauth-secret"
                        checked={draft.clearOauthClientSecret}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            clearOauthClientSecret: checked === true,
                            oauthClientSecret:
                              checked === true ? "" : current.oauthClientSecret,
                          }))
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor="clear-oauth-secret">
                          清除已保存的 secret
                        </FieldLabel>
                        <FieldDescription>
                          启用后该渠道将无法完成 OAuth 登录。
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  ) : null}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>客户端功能</FieldLegend>
                <FieldDescription>
                  Models 与 SKILLS
                  仍按此顺序显示；未勾选的入口不会出现在侧边栏。
                </FieldDescription>
                <FieldGroup
                  data-slot="checkbox-group"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {featureOptions.map(([value, label]) => (
                    <Field key={value} orientation="horizontal">
                      <Checkbox
                        id={`feature-${value}`}
                        checked={draft.enabledFeatures.includes(value)}
                        onCheckedChange={(checked) =>
                          setFeature(value, checked === true)
                        }
                      />
                      <FieldLabel htmlFor={`feature-${value}`}>
                        {label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>模型可见性</FieldLegend>
                <Field orientation="horizontal">
                  <Checkbox
                    id="restrict-models"
                    checked={draft.restrictModels}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        restrictModels: checked === true,
                      }))
                    }
                  />
                  <FieldContent>
                    <FieldTitle>启用模型白名单</FieldTitle>
                    <FieldDescription>
                      同时作用于 Models 页面、Chat 与图像/视频/音频模型列表。
                    </FieldDescription>
                  </FieldContent>
                </Field>
                {draft.restrictModels ? (
                  <Field>
                    <FieldLabel htmlFor="allowed-models">
                      允许的模型 ID
                    </FieldLabel>
                    <Textarea
                      id="allowed-models"
                      value={modelText}
                      onChange={(event) => setModelText(event.target.value)}
                      rows={8}
                      className="font-mono text-xs"
                      placeholder={
                        "gpt-5.6-sol\nclaude-sonnet-4-6\nflux-kontext-pro"
                      }
                    />
                    <FieldDescription>
                      每行一个 ID，也支持逗号分隔。
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldSet>
            </FieldGroup>

            <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <ShieldCheckIcon aria-hidden />
              Secret 不进入运行时配置响应；客户端通过后端 OAuth broker 完成 code
              exchange 与 refresh。
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                保存渠道
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
