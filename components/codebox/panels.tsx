import * as React from "react"

import {
  RiCheckLine,
  RiDeleteBin6Line,
  RiEditLine,
  RiInformationLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiPauseLine,
  RiRestartLine,
  RiTerminalBoxLine,
  RiArrowRightUpLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { type CodeBoxSandbox, type ConfirmAction } from "./types"
import { getRepoName, VSCodeIcon, getSandboxStatusLabel } from "./utils"

export function Panel({
  title,
  description,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  icon: React.ReactNode
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const hasBody = React.Children.count(children) > 0

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          hasBody && "mb-3"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {hasBody ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  )
}

export function SandboxItem({
  sandbox,
  busyAction,
  sshBusy,
  onCopy,
  onAction,
  onRename,
  onOpenWorkspace,
  onOpenTerminal,
  onOpenVSCode,
}: {
  sandbox: CodeBoxSandbox
  busyAction: string | null
  sshBusy: boolean
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onAction: (
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) => Promise<void>
  onRename: (sandbox: CodeBoxSandbox) => void
  onOpenWorkspace: (sandbox: CodeBoxSandbox) => void
  onOpenTerminal: (sandbox: CodeBoxSandbox) => void
  onOpenVSCode: (sandbox: CodeBoxSandbox) => void
}) {
  const { t } = useI18n()
  const statusLabel = getSandboxStatusLabel(sandbox.status, t)
  const isPaused = sandbox.status === "paused"
  const isRunning = sandbox.status === "running"
  const isRenaming = busyAction === `rename:${sandbox.sandboxId}`

  return (
    <article className="rounded-2xl border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-[220px] truncate text-sm font-semibold">
              {sandbox.name ||
                (sandbox.repoUrl
                  ? getRepoName(sandbox.repoUrl)
                  : sandbox.sandboxId)}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-ml-1 text-muted-foreground"
              onClick={() => onRename(sandbox)}
              disabled={isRenaming}
              aria-label={t.codeboxRenameSandbox}
            >
              {isRenaming ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiEditLine />
              )}
            </Button>
            <Badge
              variant={
                isRunning ? "default" : isPaused ? "secondary" : "outline"
              }
            >
              {statusLabel}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {(isRunning || isPaused) && sandbox.codeServerUrl ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenWorkspace(sandbox)}
            >
              {t.codeboxOpen}
              <RiArrowRightUpLine />
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenTerminal(sandbox)}
              aria-label={t.codeboxOpenTerminalAria}
            >
              <RiTerminalBoxLine />
              {t.codeboxTerminal}
            </Button>
          ) : null}
          {isRunning || isPaused ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenVSCode(sandbox)}
              disabled={sshBusy}
              aria-label={t.codeboxOpenVSCodeAria}
            >
              {sshBusy ? <RiLoader4Line className="animate-spin" /> : <VSCodeIcon className="size-4" />}
              {t.codeboxOpenVSCode}
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "pause")}
              disabled={busyAction === `pause:${sandbox.sandboxId}`}
              aria-label={t.codeboxPauseSandbox}
            >
              {busyAction === `pause:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiPauseLine />
              )}
            </Button>
          ) : null}
          {isPaused ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "resume")}
              disabled={busyAction === `resume:${sandbox.sandboxId}`}
              aria-label={t.codeboxResumeSandbox}
            >
              {busyAction === `resume:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiRestartLine />
              )}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="icon-sm"
            onClick={() => void onAction(sandbox, "kill")}
            disabled={busyAction === `kill:${sandbox.sandboxId}`}
            aria-label={t.codeboxKillSandbox}
          >
            {busyAction === `kill:${sandbox.sandboxId}` ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiDeleteBin6Line />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <CopyLine
          label={t.codeboxUrl}
          value={sandbox.codeServerUrl ?? "-"}
          onCopy={() => onCopy(sandbox.codeServerUrl)}
        />
        <CopyLine
          label={t.codeboxPassword}
          value={sandbox.password ?? "-"}
          onCopy={() => onCopy(sandbox.password)}
        />
        <InfoLine label={t.codeboxWorkspace} value={sandbox.workspacePath} />
        <InfoLine label={t.codeboxRepo} value={sandbox.repoUrl ?? "-"} />
      </div>
    </article>
  )
}

function CopyLine({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => Promise<boolean>
}) {
  const [copied, setCopied] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => setCopied(false), 1200)

    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    setCopied(await onCopy())
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 py-1.5 pl-3 pr-2">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void handleCopy()}
        disabled={value === "-"}
        aria-label={t.codeboxCopyLabel(label)}
      >
        {copied ? <RiCheckLine /> : <RiFileCopyLine />}
      </Button>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
    </div>
  )
}

export function LoadingBlock() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background text-sm text-muted-foreground">
      <RiLoader4Line className="mr-2 size-4 animate-spin" aria-hidden />
      {t.codeboxLoading}
    </div>
  )
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background px-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

export function ApiKeyRequiredBlock() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-background px-4 py-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <RiInformationLine className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{t.codeboxApiKeyRequiredTitle}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t.codeboxApiKeyRequiredDescription}
      </p>
    </div>
  )
}

export type { ConfirmAction, CodeBoxSandbox }
