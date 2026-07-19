import * as React from "react"
import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiExternalLinkLine,
} from "@remixicon/react"

import { DenseListRow } from "@/components/dense-list-row"
import {
  DialogListEmpty,
  DialogListGrid,
  DialogListSection,
  dialogListDangerItemClassName,
  dialogListItemClassName,
  dialogListMutedItemClassName,
} from "@/components/dialog-list-panel"
import { useI18n } from "@/components/i18n-provider"
import { Markdown } from "@/components/chat-markdown"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  type InstalledMcpServer,
  type McpKeyValue,
  extractMcpRegistryTransports,
  type McpTransportType,
  type McpRegistryServer,
} from "@/lib/mcp"
import {
  type InstalledSkill,
  type SkillImportCandidate,
  type SkillImportScanData,
  type SkillMeta,
} from "@/lib/skill-market"
import { cn } from "@/lib/utils"
import {
  compactNumber,
  createEmptyKeyValueRow,
  formatBytes,
  formatIsoDate,
  formatIsoDateTime,
  formatUpdatedAt,
  getRegistryPackages,
  getRegistryPackageTransport,
  getRegistryRemotes,
  getMcpTransportLabel,
  getSkillDescription,
  getSkillTitle,
  getSkillGridClass,
  parseSkillMarkdown,
  readRecord,
  readString,
  categoryLabel,
} from "./utils"
import {
  type McpManualFormState,
  type SkillCardSize,
  type SkillDetailState,
} from "./types"

export {
  type SkillImportCandidate,
  type SkillImportScanData,
  type InstalledSkill,
  type SkillMeta,
}

export function PluginMeta({
  parts,
}: {
  parts: Array<string | null | undefined>
}) {
  return (
    <p className="mt-1 truncate text-xs text-muted-foreground/80">
      {parts.filter(Boolean).join(" · ")}
    </p>
  )
}

function MarketplaceIcon({
  iconUrl,
  label,
  size = "default",
}: {
  iconUrl?: string
  label: string
  size?: "default" | "lg"
}) {
  const fallback = label.trim().charAt(0).toLocaleUpperCase() || "·"

  return (
    <Avatar
      size={size}
      className="rounded-lg after:rounded-lg"
      aria-hidden="true"
    >
      {iconUrl ? (
        <AvatarImage src={iconUrl} alt="" className="rounded-lg" />
      ) : null}
      <AvatarFallback className="rounded-lg font-medium">
        {fallback}
      </AvatarFallback>
    </Avatar>
  )
}

export function SkillCard({
  installedSkill,
  installing,
  locale,
  onInstall,
  onOpen,
  skill,
}: {
  installedSkill?: InstalledSkill
  installing?: boolean
  locale: string
  onInstall?: (skill: SkillMeta) => void
  onOpen: (skill: SkillMeta) => void
  skill: SkillMeta
}) {
  const { t } = useI18n()
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)
  const slug = skill.Slug?.trim() || "-"
  const canInstall =
    Boolean(skill.Slug?.trim()) && !installedSkill && Boolean(onInstall)

  return (
    <DenseListRow>
      <MarketplaceIcon iconUrl={skill.IconUrl} label={title} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <span className="truncate text-xs text-muted-foreground">{slug}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {description || t.skillNoDescription}
        </p>
        <PluginMeta
          parts={[
            t.skillDownloads(compactNumber(skill.Downloads, locale)),
            skill.Stars
              ? t.skillStars(compactNumber(skill.Stars, locale))
              : null,
            t.skillFiles(skill.FileCount ?? 0),
            formatBytes(skill.SizeBytes),
            formatUpdatedAt(skill.UpStreamUpdatedAt, locale),
          ]}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => onOpen(skill)}
        >
          {t.skillView}
        </Button>
        <Button
          type="button"
          variant={installedSkill ? "ghost" : "outline"}
          size="sm"
          className="h-8"
          disabled={!canInstall || installing}
          onClick={() => onInstall?.(skill)}
        >
          {installedSkill ? (
            <RiCheckLine aria-hidden />
          ) : (
            <RiAddLine aria-hidden />
          )}
          {installedSkill
            ? t.skillAdded
            : installing
              ? t.skillAdding
              : t.skillAdd}
        </Button>
      </div>
    </DenseListRow>
  )
}

export function InstalledSkillCard({
  busy,
  installedSkill,
  locale,
  onOpen,
  onRemove,
  onToggle,
}: {
  busy: boolean
  installedSkill: InstalledSkill
  locale: string
  onOpen: (installedSkill: InstalledSkill) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
}) {
  const { t } = useI18n()
  const skill = installedSkill.skill
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)

  return (
    <DenseListRow>
      <MarketplaceIcon iconUrl={skill.IconUrl} label={title} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {installedSkill.slug}
          </span>
          {installedSkill.bundled ? (
            <Badge variant="secondary" className="shrink-0">
              {t.skillBundled}
            </Badge>
          ) : null}
          {installedSkill.enabled ? null : (
            <Badge variant="outline" className="shrink-0">
              {t.skillDisabled}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {description || t.skillNoDescription}
        </p>
        <PluginMeta
          parts={[
            t.skillFiles(installedSkill.installedFileCount),
            formatBytes(installedSkill.installedSizeBytes),
            t.skillInstalledAt(
              formatIsoDate(installedSkill.installedAt, locale)
            ),
            `v${installedSkill.version}`,
          ]}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => onOpen(installedSkill)}
        >
          {t.skillView}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={busy}
          onClick={() => onToggle(installedSkill, !installedSkill.enabled)}
        >
          {installedSkill.enabled ? t.skillDisable : t.skillEnable}
        </Button>
        {installedSkill.bundled ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => onRemove(installedSkill)}
          >
            <RiCloseLine aria-hidden />
            {t.skillRemove}
          </Button>
        )}
      </div>
    </DenseListRow>
  )
}

export function McpMarketCard({
  busy,
  installed,
  locale,
  onInstall,
  onOpen,
  server,
}: {
  busy: boolean
  installed?: InstalledMcpServer
  locale: string
  onInstall: (server: McpRegistryServer) => void
  onOpen: (server: McpRegistryServer) => void
  server: McpRegistryServer
}) {
  const { t } = useI18n()
  const transports =
    server.transports.length > 0
      ? server.transports
      : extractMcpRegistryTransports(server.serverJson)

  return (
    <DenseListRow>
      <MarketplaceIcon
        iconUrl={readString(server.registryMeta.iconUrl)}
        label={server.title}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-medium">{server.title}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {server.name}
          </span>
          {server.latest ? (
            <Badge variant="outline" className="shrink-0">
              {t.skillLatest}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {server.description || t.skillNoDescription}
        </p>
        <PluginMeta
          parts={[
            transports.length > 0
              ? transports
                  .map((transport) => getMcpTransportLabel(transport, t))
                  .join(" / ")
              : t.none,
            `v${server.version}`,
            formatIsoDateTime(server.updatedAt, locale),
            server.status || server.source,
          ]}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => onOpen(server)}
        >
          {t.skillView}
        </Button>
        <Button
          type="button"
          variant={installed ? "ghost" : "outline"}
          size="sm"
          className="h-8"
          disabled={Boolean(installed) || busy}
          onClick={() => onInstall(server)}
        >
          {installed ? <RiCheckLine aria-hidden /> : <RiAddLine aria-hidden />}
          {installed ? t.mcpInstalled : busy ? t.skillAdding : t.mcpInstall}
        </Button>
      </div>
    </DenseListRow>
  )
}

export function InstalledMcpCard({
  busy,
  locale,
  onEdit,
  onRemove,
  onTest,
  onToggle,
  server,
}: {
  busy: boolean
  locale: string
  onEdit: (server: InstalledMcpServer) => void
  onRemove: (server: InstalledMcpServer) => void
  onTest: (server: InstalledMcpServer) => void
  onToggle: (server: InstalledMcpServer, enabled: boolean) => void
  server: InstalledMcpServer
}) {
  const { t } = useI18n()

  return (
    <DenseListRow>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-medium">{server.title}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {server.name}
          </span>
          {server.enabled ? null : (
            <Badge variant="outline" className="shrink-0">
              {t.skillDisabled}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {server.description || t.skillNoDescription}
        </p>
        <PluginMeta
          parts={[
            getMcpTransportLabel(server.transport, t),
            t.mcpTools(server.tools.length),
            t.mcpResources(server.resources.length),
            t.mcpPrompts(server.prompts.length),
            t.mcpLastConnected(
              formatIsoDateTime(server.lastConnectedAt, locale)
            ),
          ]}
        />

        {server.lastError ? (
          <p className="mt-1 line-clamp-1 text-xs text-destructive">
            {t.mcpLastError(server.lastError)}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={busy}
          onClick={() => onEdit(server)}
        >
          {t.mcpEdit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={busy}
          onClick={() => onTest(server)}
        >
          {busy ? t.mcpTesting : t.mcpTest}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={busy}
          onClick={() => onToggle(server, !server.enabled)}
        >
          {server.enabled ? t.skillDisable : t.skillEnable}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => onRemove(server)}
        >
          {t.skillRemove}
        </Button>
      </div>
    </DenseListRow>
  )
}

export function McpHeadersEditor({
  onChange,
  value,
}: {
  onChange: (value: McpKeyValue[]) => void
  value: McpKeyValue[]
}) {
  const { t } = useI18n()
  const rows = value.length > 0 ? value : [createEmptyKeyValueRow()]

  // McpKeyValue has no intrinsic id, so we keep a stable id per logical row in
  // state aligned to row order. This survives edits (updateRow preserves length
  // and order) and deletions (removeRow drops the matching id), so React keys
  // stay stable and inputs no longer shift onto the wrong row after a middle
  // delete. Length reconciliation uses the render-time state adjustment pattern.
  const [rowIdState, setRowIdState] = React.useState(() => ({
    counter: rows.length,
    ids: rows.map((_, index) => `mcp-header-${index + 1}`),
  }))

  let rowIds = rowIdState.ids
  if (rowIds.length !== rows.length) {
    if (rowIds.length < rows.length) {
      let counter = rowIdState.counter
      rowIds = [...rowIds]
      while (rowIds.length < rows.length) {
        counter += 1
        rowIds.push(`mcp-header-${counter}`)
      }
      setRowIdState({ counter, ids: rowIds })
    } else {
      rowIds = rowIds.slice(0, rows.length)
      setRowIdState({ counter: rowIdState.counter, ids: rowIds })
    }
  }

  function updateRow(index: number, updates: Partial<McpKeyValue>) {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...updates } : row
      )
    )
  }

  function removeRow(index: number) {
    setRowIdState((state) => ({
      counter: state.counter,
      ids: state.ids.filter((_, rowIndex) => rowIndex !== index),
    }))
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <label className="text-xs font-medium">{t.mcpHeaders}</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => onChange([...rows, createEmptyKeyValueRow()])}
        >
          <RiAddLine aria-hidden />
          {t.mcpAddHeader}
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={rowIds[index]}
            className="grid gap-2 rounded-lg border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto_auto] sm:items-center"
          >
            <Input
              aria-label={`${t.mcpHeaderName} ${index + 1}`}
              value={row.name}
              placeholder={t.mcpHeaderName}
              onChange={(event) =>
                updateRow(index, { name: event.target.value })
              }
            />
            <Input
              aria-label={`${t.mcpHeaderValue} ${index + 1}`}
              value={row.value ?? ""}
              type={row.isSecret ? "password" : "text"}
              placeholder={
                row.isSecret && row.hasValue && !row.value
                  ? t.mcpKeepExistingSecret
                  : t.mcpHeaderValue
              }
              onChange={(event) =>
                updateRow(index, {
                  value: event.target.value,
                  hasValue: row.isSecret
                    ? Boolean(row.hasValue || event.target.value)
                    : Boolean(event.target.value),
                })
              }
            />
            <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(row.isSecret)}
                onChange={(event) =>
                  updateRow(index, {
                    isSecret: event.target.checked,
                    hasValue: event.target.checked
                      ? Boolean(row.hasValue || row.value)
                      : Boolean(row.value),
                  })
                }
              />
              <span>{t.mcpSecret}</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 justify-self-start sm:justify-self-end"
              aria-label={t.mcpRemoveHeader}
              onClick={() => removeRow(index)}
            >
              <RiCloseLine aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t.mcpHeadersHint}</p>
    </div>
  )
}

export function McpManualDialog({
  busy,
  error,
  form,
  mode,
  onChange,
  onOpenChange,
  onSubmit,
  open,
}: {
  busy: boolean
  error: string
  form: McpManualFormState
  mode: "create" | "edit"
  onChange: (form: McpManualFormState) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  open: boolean
}) {
  const { t } = useI18n()
  const isStdio = form.transport === "stdio"
  const isEditing = mode === "edit"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t.mcpEditTitle : t.mcpManualTitle}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t.mcpEditDescription : t.mcpManualDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="mcp-name">
                {t.mcpName}
              </label>
              <Input
                id="mcp-name"
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="mcp-title">
                {t.mcpTitle}
              </label>
              <Input
                id="mcp-title"
                value={form.title}
                onChange={(event) =>
                  onChange({ ...form, title: event.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="mcp-description">
              {t.mcpDescription}
            </label>
            <Textarea
              id="mcp-description"
              value={form.description}
              onChange={(event) =>
                onChange({ ...form, description: event.target.value })
              }
              className="min-h-20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="mcp-transport">
              {t.mcpTransport}
            </label>
            <Select
              value={form.transport}
              onValueChange={(value) =>
                onChange({
                  ...form,
                  transport: value as McpTransportType,
                })
              }
            >
              <SelectTrigger id="mcp-transport" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="streamable-http">
                  {t.mcpTransportHttp}
                </SelectItem>
                <SelectItem value="sse">{t.mcpTransportSse}</SelectItem>
                <SelectItem value="stdio">{t.mcpTransportStdio}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isStdio ? (
            <>
              <Alert>
                <AlertTitle>{t.mcpTransportStdio}</AlertTitle>
                <AlertDescription>{t.mcpLocalCommandWarning}</AlertDescription>
              </Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="mcp-command">
                    {t.mcpCommand}
                  </label>
                  <Input
                    id="mcp-command"
                    value={form.command}
                    onChange={(event) =>
                      onChange({ ...form, command: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="mcp-args">
                    {t.mcpArguments}
                  </label>
                  <Input
                    id="mcp-args"
                    value={form.args}
                    onChange={(event) =>
                      onChange({ ...form, args: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-cwd">
                  {t.mcpWorkingDirectory}
                </label>
                <Input
                  id="mcp-cwd"
                  value={form.cwd}
                  onChange={(event) =>
                    onChange({ ...form, cwd: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-env">
                  {t.mcpEnvironment}
                </label>
                <Textarea
                  id="mcp-env"
                  value={form.env}
                  onChange={(event) =>
                    onChange({ ...form, env: event.target.value })
                  }
                  placeholder={t.mcpKeyValueHint}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.localCommandConfirmed}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      localCommandConfirmed: event.target.checked,
                    })
                  }
                />
                <span>{t.mcpConfirmLocalCommand}</span>
              </label>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-url">
                  {t.mcpUrl}
                </label>
                <Input
                  id="mcp-url"
                  value={form.url}
                  onChange={(event) =>
                    onChange({ ...form, url: event.target.value })
                  }
                />
              </div>
              <McpHeadersEditor
                value={form.headers}
                onChange={(headers) => onChange({ ...form, headers })}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.studioCancel}
          </Button>
          <Button type="button" disabled={busy} onClick={onSubmit}>
            {busy ? t.mcpSaving : t.mcpSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SkillSkeletonGrid({
  size = "default",
}: {
  size?: SkillCardSize
}) {
  return (
    <div className={getSkillGridClass(size)}>
      {Array.from({ length: 9 }).map((_, index) => (
        <DenseListRow
          as="div"
          key={`skill-skeleton-${index}`}
          interactive={false}
        >
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-20" />
          </div>
        </DenseListRow>
      ))}
    </div>
  )
}

function formatManifestValue(value: unknown) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : ""
}

export function McpDetailDialog({
  detail,
  error,
  installed,
  installing,
  loading,
  onInstall,
  onOpenChange,
  open,
  server,
}: {
  detail: McpRegistryServer | null
  error: string
  installed?: InstalledMcpServer
  installing: boolean
  loading: boolean
  onInstall: (server: McpRegistryServer) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  server: McpRegistryServer | null
}) {
  const { locale, t } = useI18n()
  const activeServer = detail ?? server
  const registryMeta = readRecord(activeServer?.registryMeta)
  const repository = readRecord(registryMeta.repository)
  const websiteUrl = readString(registryMeta.websiteUrl)
  const repositoryUrl = readString(repository.url)
  const iconUrl = readString(registryMeta.iconUrl)
  const registryTypes = Array.isArray(registryMeta.registryTypes)
    ? registryMeta.registryTypes.map(readString).filter(Boolean)
    : []
  const packages = activeServer ? getRegistryPackages(activeServer) : []
  const remotes = activeServer ? getRegistryRemotes(activeServer) : []
  const manifest = activeServer?.serverJson ?? {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-4xl">
        <DialogHeader className="pr-9">
          <div className="flex min-w-0 items-start gap-3">
            <MarketplaceIcon
              iconUrl={iconUrl}
              label={activeServer?.title || t.mcpDetailTitle}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DialogTitle className="truncate text-lg">
                  {activeServer?.title || t.mcpDetailTitle}
                </DialogTitle>
                {activeServer?.version ? (
                  <Badge variant="secondary">v{activeServer.version}</Badge>
                ) : null}
                {activeServer?.latest ? (
                  <Badge variant="outline">{t.skillLatest}</Badge>
                ) : null}
                {activeServer?.status ? (
                  <Badge variant="outline">{activeServer.status}</Badge>
                ) : null}
              </div>
              {activeServer?.name ? (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {activeServer.name}
                </p>
              ) : null}
            </div>
          </div>
          <DialogDescription className="line-clamp-3">
            {activeServer?.description || t.skillNoDescription}
          </DialogDescription>
        </DialogHeader>

        {activeServer ? (
          <div className="border-y py-2.5">
            <PluginMeta
              parts={[
                activeServer.transports.length > 0
                  ? activeServer.transports
                      .map((transport) => getMcpTransportLabel(transport, t))
                      .join(" / ")
                  : null,
                registryTypes.length > 0
                  ? `${t.mcpRegistryTypes}: ${registryTypes.join(" / ")}`
                  : null,
                `${t.mcpPublishedAt}: ${formatIsoDateTime(
                  readString(registryMeta.publishedAt),
                  locale
                )}`,
                `${t.mcpUpdatedAt}: ${formatIsoDateTime(
                  activeServer.updatedAt,
                  locale
                )}`,
              ]}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : activeServer ? (
            <div className="space-y-5">
              {repositoryUrl || readString(repository.source) ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">{t.mcpRepository}</h3>
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    {repositoryUrl ? (
                      <a
                        href={repositoryUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-foreground underline-offset-4 hover:underline"
                      >
                        {repositoryUrl}
                      </a>
                    ) : null}
                    <PluginMeta
                      parts={[
                        readString(repository.source),
                        readString(repository.subfolder),
                        readString(repository.id),
                      ]}
                    />
                  </div>
                </section>
              ) : null}

              {packages.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">{t.mcpPackages}</h3>
                  <div className="space-y-2">
                    {packages.map((packageEntry, packageIndex) => {
                      const environmentVariables = Array.isArray(
                        packageEntry.environmentVariables
                      )
                        ? packageEntry.environmentVariables.map(readRecord)
                        : []
                      const identifier = readString(packageEntry.identifier)
                      const packageVersion = readString(packageEntry.version)
                      const registryType = readString(packageEntry.registryType)
                      const transport =
                        getRegistryPackageTransport(packageEntry)

                      return (
                        <div
                          key={`${registryType}-${identifier}-${packageIndex}`}
                          className="rounded-lg border p-3"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 font-mono text-sm font-medium break-all">
                              {identifier ||
                                `${t.mcpPackages} ${packageIndex + 1}`}
                            </p>
                            {packageVersion ? (
                              <Badge variant="secondary">
                                v{packageVersion}
                              </Badge>
                            ) : null}
                            {registryType ? (
                              <Badge variant="outline">{registryType}</Badge>
                            ) : null}
                            {transport ? (
                              <Badge variant="outline">{transport}</Badge>
                            ) : null}
                          </div>
                          {readString(packageEntry.registryBaseUrl) ? (
                            <p className="mt-2 text-xs break-all text-muted-foreground">
                              {readString(packageEntry.registryBaseUrl)}
                            </p>
                          ) : null}
                          {environmentVariables.length > 0 ? (
                            <div className="mt-3 space-y-2 border-t pt-3">
                              <p className="text-xs font-medium">
                                {t.mcpEnvironmentVariables}
                              </p>
                              {environmentVariables.map((variable, index) => {
                                const name = readString(variable.name)
                                const defaultValue = formatManifestValue(
                                  variable.default
                                )

                                return (
                                  <div
                                    key={`${name}-${index}`}
                                    className="rounded-md bg-muted/50 px-2.5 py-2"
                                  >
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <code className="text-xs font-medium text-foreground">
                                        {name || "-"}
                                      </code>
                                      <Badge variant="outline">
                                        {variable.isRequired
                                          ? t.mcpRequired
                                          : t.mcpOptional}
                                      </Badge>
                                      {variable.isSecret ? (
                                        <Badge variant="secondary">
                                          {t.mcpSecret}
                                        </Badge>
                                      ) : null}
                                      {readString(variable.format) ? (
                                        <span className="text-[11px] text-muted-foreground">
                                          {readString(variable.format)}
                                        </span>
                                      ) : null}
                                    </div>
                                    {readString(variable.description) ? (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {readString(variable.description)}
                                      </p>
                                    ) : null}
                                    {defaultValue ? (
                                      <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                                        default: {defaultValue}
                                      </p>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {remotes.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">
                    {t.mcpRemoteEndpoints}
                  </h3>
                  <div className="space-y-2">
                    {remotes.map((remote, index) => (
                      <div
                        key={`${readString(remote.type)}-${readString(remote.url)}-${index}`}
                        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-3"
                      >
                        {readString(remote.type) ? (
                          <Badge variant="outline">
                            {readString(remote.type)}
                          </Badge>
                        ) : null}
                        <span className="font-mono text-xs break-all">
                          {readString(remote.url) || "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {packages.length === 0 && remotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.mcpNoManifest}
                </p>
              ) : null}

              {Object.keys(manifest).length > 0 ? (
                <details className="rounded-lg border">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    {t.mcpServerManifest}
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t bg-muted/30 p-3 text-[11px] leading-relaxed">
                    {JSON.stringify(manifest, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {activeServer ? (
            <Button
              type="button"
              size="sm"
              disabled={Boolean(installed) || installing}
              onClick={() => onInstall(activeServer)}
            >
              {installed ? (
                <RiCheckLine aria-hidden />
              ) : (
                <RiAddLine aria-hidden />
              )}
              {installed
                ? t.mcpInstalled
                : installing
                  ? t.skillAdding
                  : t.mcpInstall}
            </Button>
          ) : null}
          {websiteUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={websiteUrl} target="_blank" rel="noreferrer">
                <RiExternalLinkLine aria-hidden />
                {t.mcpWebsite}
              </a>
            </Button>
          ) : null}
          {repositoryUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={repositoryUrl} target="_blank" rel="noreferrer">
                <RiExternalLinkLine aria-hidden />
                {t.mcpRepository}
              </a>
            </Button>
          ) : null}
          {activeServer?.serverJsonUrl ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={activeServer.serverJsonUrl}
                target="_blank"
                rel="noreferrer"
              >
                <RiExternalLinkLine aria-hidden />
                {t.mcpServerManifest}
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SkillDetailDialog({
  detail,
  error,
  installedSkill,
  installing,
  loading,
  onInstall,
  onOpenChange,
  onRemove,
  onToggle,
  open,
  removing,
  skill,
  updating,
}: {
  detail: SkillDetailState | null
  error: string
  installedSkill?: InstalledSkill
  installing: boolean
  loading: boolean
  onInstall: (skill: SkillMeta) => void
  onOpenChange: (open: boolean) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
  open: boolean
  removing: boolean
  skill: SkillMeta | null
  updating: boolean
}) {
  const { locale, t } = useI18n()
  const activeSkill = detail?.skill
    ? {
        ...skill,
        ...detail.skill,
        IconUrl: detail.skill.IconUrl?.trim() || skill?.IconUrl,
        Stars: detail.skill.Stars || skill?.Stars,
        SubCategories:
          (detail.skill.SubCategories?.length ?? 0) > 0
            ? detail.skill.SubCategories
            : skill?.SubCategories,
      }
    : skill
  const skillMd = detail?.skillMd ?? ""
  const parsedSkillMd = React.useMemo(
    () => (skillMd ? parseSkillMarkdown(skillMd) : null),
    [skillMd]
  )
  const title = activeSkill ? getSkillTitle(activeSkill) : t.skills
  const description = activeSkill
    ? getSkillDescription(activeSkill, locale) ||
      parsedSkillMd?.metadata.description ||
      ""
    : ""
  const skillReadme = parsedSkillMd
    ? parsedSkillMd.body.trim() || parsedSkillMd.metadata.description || ""
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-5xl">
        <DialogHeader className="pr-9">
          <div className="flex min-w-0 items-start gap-3">
            <MarketplaceIcon
              iconUrl={activeSkill?.IconUrl}
              label={title}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DialogTitle className="truncate text-lg">{title}</DialogTitle>
                {activeSkill?.Version ? (
                  <Badge variant="secondary">v{activeSkill.Version}</Badge>
                ) : null}
                {activeSkill?.Category ? (
                  <Badge variant="outline">
                    {categoryLabel(activeSkill.Category)}
                  </Badge>
                ) : null}
                {activeSkill?.Latest ? (
                  <Badge variant="outline">{t.skillLatest}</Badge>
                ) : null}
                {installedSkill?.bundled ? (
                  <Badge variant="secondary">{t.skillBundled}</Badge>
                ) : null}
              </div>
              {activeSkill?.Slug ? (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {activeSkill.Slug}
                </p>
              ) : null}
            </div>
          </div>
          <DialogDescription className="line-clamp-2">
            {description || t.skillNoDescription}
          </DialogDescription>
        </DialogHeader>

        {activeSkill ? (
          <div className="space-y-2">
            <div className="border-y py-2.5">
              <PluginMeta
                parts={[
                  t.skillDownloads(
                    compactNumber(activeSkill.Downloads, locale)
                  ),
                  activeSkill.Stars
                    ? t.skillStars(compactNumber(activeSkill.Stars, locale))
                    : null,
                  t.skillFiles(activeSkill.FileCount ?? 0),
                  formatBytes(activeSkill.SizeBytes),
                  formatUpdatedAt(activeSkill.UpStreamUpdatedAt, locale),
                  activeSkill.Author ? t.skillAuthor(activeSkill.Author) : null,
                  activeSkill.UpStream
                    ? t.skillSource(activeSkill.UpStream)
                    : null,
                  activeSkill.License || null,
                ]}
              />
            </div>
            {installedSkill ? (
              <div className="flex flex-col gap-2 border-b py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <span className="font-medium text-foreground">
                      {t.skillLocalStatus}
                    </span>
                    <Badge
                      variant={installedSkill.enabled ? "secondary" : "outline"}
                    >
                      {installedSkill.enabled
                        ? t.skillEnabled
                        : t.skillDisabled}
                    </Badge>
                  </div>
                  <p className="line-clamp-2">{t.skillSandboxHint}</p>
                </div>
                <span className="shrink-0">
                  {t.skillInstalledAt(
                    formatIsoDate(installedSkill.installedAt, locale)
                  )}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : skillMd && skillReadme ? (
            <Markdown className="prose-sm max-w-none dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5">
              {skillReadme}
            </Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{t.skillNoReadme}</p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {activeSkill && !installedSkill ? (
            <Button
              type="button"
              size="sm"
              disabled={installing || !activeSkill.Slug?.trim()}
              onClick={() => onInstall(activeSkill)}
            >
              <RiAddLine aria-hidden />
              {installing ? t.skillAdding : t.skillAdd}
            </Button>
          ) : null}
          {installedSkill ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={updating}
                onClick={() =>
                  onToggle(installedSkill, !installedSkill.enabled)
                }
              >
                {installedSkill.enabled ? t.skillDisable : t.skillEnable}
              </Button>
              {installedSkill.bundled ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={removing}
                  onClick={() => onRemove(installedSkill)}
                >
                  <RiCloseLine aria-hidden />
                  {removing ? t.skillRemoving : t.skillRemove}
                </Button>
              )}
            </>
          ) : null}
          {activeSkill?.UpStreamUrl ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={activeSkill.UpStreamUrl}
                target="_blank"
                rel="noreferrer"
              >
                <RiExternalLinkLine aria-hidden />
                {t.skillUpstream}
              </a>
            </Button>
          ) : null}
          {activeSkill?.SkillMdUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={activeSkill.SkillMdUrl} target="_blank" rel="noreferrer">
                <RiExternalLinkLine aria-hidden />
                SKILL.md
              </a>
            </Button>
          ) : null}
          {activeSkill?.ArchiveUrl ? (
            <Button asChild size="sm">
              <a href={activeSkill.ArchiveUrl}>
                <RiDownloadLine aria-hidden />
                {t.skillDownload}
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SkillImportItem({
  item,
  selected,
  onToggle,
}: {
  item: SkillImportCandidate
  selected: boolean
  onToggle: (sourcePath: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item.sourcePath)}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col text-left transition-colors",
        dialogListItemClassName,
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-muted-foreground/40"
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center border",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            )}
          >
            {selected ? <RiCheckLine className="size-3" aria-hidden /> : null}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {item.slug}
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {formatBytes(item.sizeBytes)}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {item.description}
      </p>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {item.sourcePath}
      </p>
    </button>
  )
}

export function SkillImportDialog({
  busy,
  data,
  onImportSelected,
  onOpenChange,
  onToggleAll,
  onToggleCandidate,
  open,
  selected,
}: {
  busy: boolean
  data: SkillImportScanData | null
  onImportSelected: () => void
  onOpenChange: (open: boolean) => void
  onToggleAll: () => void
  onToggleCandidate: (sourcePath: string) => void
  open: boolean
  selected: Set<string>
}) {
  const { t } = useI18n()
  const candidates = data?.candidates ?? []
  const duplicates = data?.duplicates ?? []
  const invalid = data?.invalid ?? []
  const selectedCount = candidates.filter((candidate) =>
    selected.has(candidate.sourcePath)
  ).length
  const allSelected =
    candidates.length > 0 && selectedCount >= candidates.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.skillImportScanTitle}</DialogTitle>
          <DialogDescription>{t.skillImportScanDescription}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            <DialogListSection
              title={t.skillImportCandidates}
              action={
                candidates.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={onToggleAll}
                  >
                    {allSelected
                      ? t.skillImportDeselectAll
                      : t.skillImportSelectAll}
                  </Button>
                ) : null
              }
              count={
                candidates.length > 0
                  ? `${selectedCount}/${candidates.length}`
                  : candidates.length
              }
            >
              {candidates.length > 0 ? (
                <DialogListGrid twoColumns>
                  {candidates.map((item) => (
                    <SkillImportItem
                      key={item.sourcePath}
                      item={item}
                      selected={selected.has(item.sourcePath)}
                      onToggle={onToggleCandidate}
                    />
                  ))}
                </DialogListGrid>
              ) : (
                <DialogListEmpty>{t.skillImportNoCandidates}</DialogListEmpty>
              )}
            </DialogListSection>

            {duplicates.length > 0 ? (
              <DialogListSection
                title={t.skillImportDuplicates}
                count={duplicates.length}
              >
                <DialogListGrid twoColumns>
                  {duplicates.map((item) => (
                    <div
                      key={`${item.sourcePath}-${item.slug}`}
                      className={dialogListMutedItemClassName}
                    >
                      <div className="truncate text-sm font-medium">
                        {item.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.alreadyInstalled
                          ? t.skillImportAlreadyInstalled
                          : t.skillImportDuplicateSlug(
                              item.duplicateOf ?? item.slug
                            )}
                      </div>
                      <p className="mt-2 truncate text-[11px] text-muted-foreground">
                        {item.sourcePath}
                      </p>
                    </div>
                  ))}
                </DialogListGrid>
              </DialogListSection>
            ) : null}

            {invalid.length > 0 ? (
              <DialogListSection
                title={t.skillImportInvalid}
                count={invalid.length}
                countVariant="destructive"
              >
                <DialogListGrid>
                  {invalid.map((item) => (
                    <div
                      key={item.sourcePath}
                      className={dialogListDangerItemClassName}
                    >
                      <div className="truncate font-medium">
                        {item.sourcePath}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.message}
                      </div>
                    </div>
                  ))}
                </DialogListGrid>
              </DialogListSection>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.skillImportClose}
          </Button>
          <Button
            type="button"
            disabled={busy || selectedCount === 0}
            onClick={onImportSelected}
          >
            <RiDownloadLine aria-hidden />
            {busy ? t.skillImporting : t.skillImportSelected(selectedCount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
