import * as React from "react"

import {
  RiArrowRightUpLine,
  RiCheckLine,
  RiFileCopyLine,
  RiInformationLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"

import { DialogIconHeader } from "@/components/dialog-icon-header"
import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  type CodeBoxLocalDependencyStatus,
  type CodeBoxSandbox,
  type CodeBoxSshAccess,
  type WebsocatInstallGroup,
  type WebsocatInstallTabKey,
} from "../types"
import { getRepoName, VSCodeIcon } from "../utils"

export function OpenVSCodeDialog({
  sandbox,
  access,
  localDependencies,
  busy,
  configWriting,
  checkingDependencies,
  error,
  onCopy,
  onRetry,
  onWriteConfig,
  onOpenVSCode,
  onOpenChange,
}: {
  sandbox: CodeBoxSandbox | null
  access: CodeBoxSshAccess | null
  localDependencies: CodeBoxLocalDependencyStatus | null
  busy: boolean
  configWriting: boolean
  checkingDependencies: boolean
  error: string | null
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onRetry: () => void
  onWriteConfig: () => void
  onOpenVSCode: (access: CodeBoxSshAccess) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const [installTab, setInstallTab] =
    React.useState<WebsocatInstallTabKey | null>(null)
  const sandboxLabel =
    sandbox?.name ||
    (sandbox?.repoUrl ? getRepoName(sandbox.repoUrl) : sandbox?.sandboxId) ||
    ""
  const isWebsocatMissing = Boolean(
    localDependencies && !localDependencies.websocat.installed
  )
  const installGroups = React.useMemo(() => getWebsocatInstallGroups(t), [t])
  const defaultInstallTab = getDefaultWebsocatInstallTab(
    localDependencies?.platform
  )
  const activeInstallTab = installTab ?? defaultInstallTab
  const activeInstallGroup = installGroups.find(
    (group) => group.key === activeInstallTab
  )
  const activeInstallOptions = activeInstallGroup?.options ?? []
  const canOpenVSCode = Boolean(
    access?.sshConfigPath && access.remoteReady && !busy && !configWriting
  )
  const orderedInstallGroups = React.useMemo(
    () =>
      [...installGroups].sort((a, b) => {
        if (a.key === defaultInstallTab && b.key !== defaultInstallTab) {
          return -1
        }

        if (a.key !== defaultInstallTab && b.key === defaultInstallTab) {
          return 1
        }

        return 0
      }),
    [defaultInstallTab, installGroups]
  )

  React.useEffect(() => {
    if (!copiedKey) {
      return
    }

    const timeout = window.setTimeout(() => setCopiedKey(null), 1200)

    return () => window.clearTimeout(timeout)
  }, [copiedKey])

  async function copyValue(key: string, value: string | null | undefined) {
    setCopiedKey((await onCopy(value)) ? key : null)
  }

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid-rows-[auto_minmax(0,1fr)_auto] max-w-none gap-5 overflow-hidden sm:max-w-none"
        style={{
          width: "min(1280px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 2rem)",
        }}
      >
        <DialogIconHeader
          icon={<VSCodeIcon className="size-5" />}
          title={t.codeboxSshPrepareTitle}
          description={
            sandboxLabel
              ? t.codeboxSshPrepareDescription(sandboxLabel)
              : t.codeboxSshPrepareDescriptionFallback
          }
        />

        {checkingDependencies || (busy && !access) ? (
          <div className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border bg-background text-sm text-muted-foreground">
            <RiLoader4Line className="size-4 animate-spin" aria-hidden />
            {checkingDependencies
              ? t.codeboxSshCheckingDependencies
              : t.codeboxSshPreparing}
          </div>
        ) : error && !access ? (
          <Alert variant="destructive">
            <RiInformationLine />
            <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isWebsocatMissing ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
            <Alert>
              <RiInformationLine />
              <AlertTitle>{t.codeboxSshWebsocatMissingTitle}</AlertTitle>
              <AlertDescription>
                {t.codeboxSshWebsocatMissingDescription}
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {t.codeboxSshDetectedPlatform(
                  localDependencies?.platform ?? "unknown"
                )}
              </Badge>
              <span>{t.codeboxSshInstallOptionsTitle}</span>
            </div>

            <div className="flex min-w-0 gap-1 overflow-x-auto rounded-2xl border bg-muted/50 p-1">
              {orderedInstallGroups.map((group) => (
                <Button
                  key={group.key}
                  type="button"
                  variant={activeInstallTab === group.key ? "secondary" : "ghost"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setInstallTab(group.key)}
                >
                  {group.label}
                  {group.key === defaultInstallTab ? (
                    <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {t.codeboxSshRecommended}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>

            <div className="grid gap-3">
              {activeInstallOptions.map((option) => (
                <div
                  key={option.key}
                  className="rounded-2xl border bg-background p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {option.note}
                      </p>
                    </div>
                    {activeInstallTab === defaultInstallTab ? (
                      <Badge
                        variant="outline"
                        className="border-primary/30 bg-primary/10 text-primary"
                      >
                        {t.codeboxSshRecommended}
                      </Badge>
                    ) : null}
                  </div>
                  <SshSnippet
                    label={t.codeboxSshInstallCommand}
                    value={option.value}
                    copied={copiedKey === option.key}
                    copyLabel={t.codeboxSshCopyInstallCommand}
                    onCopy={() => void copyValue(option.key, option.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : access ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
            <div className="rounded-2xl border bg-muted/40 p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {access.hostAlias}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {access.sshConfigPath
                      ? t.codeboxSshConfigInstalled(access.sshConfigPath)
                      : t.codeboxSshConfigNeedsAuthorization}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {busy && !access.remoteReady ? (
                      <RiLoader4Line className="size-3.5 animate-spin" />
                    ) : null}
                    {access.remoteReady
                      ? t.codeboxSshRemoteReady
                      : t.codeboxSshRemotePreparing}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge variant="secondary">SSH</Badge>
                  {!access.sshConfigPath ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onWriteConfig}
                      disabled={configWriting}
                    >
                      {configWriting ? (
                        <RiLoader4Line className="animate-spin" />
                      ) : (
                        <RiFileCopyLine />
                      )}
                      {configWriting
                        ? t.codeboxSshWritingConfig
                        : t.codeboxSshWriteConfig}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <RiInformationLine />
                <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!access.sshConfigPath ? (
              <SshSnippet
                label={t.codeboxSshConfig}
                value={access.sshConfig}
                copied={copiedKey === "config"}
                copyLabel={t.codeboxSshCopyConfig}
                onCopy={() => void copyValue("config", access.sshConfig)}
              />
            ) : null}

            {access.remoteReady ? (
              <>
                <CopyLine
                  label={t.codeboxPassword}
                  value={access.password ?? "-"}
                  onCopy={() => onCopy(access.password)}
                />

                <SshSnippet
                  label={t.codeboxSshCommand}
                  value={access.sshCommand}
                  copied={copiedKey === "command"}
                  copyLabel={t.codeboxSshCopyCommand}
                  onCopy={() => void copyValue("command", access.sshCommand)}
                />
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.codeboxCancel}
          </Button>
          {error || isWebsocatMissing ? (
            <Button onClick={onRetry}>
              <RiRefreshLine />
              {isWebsocatMissing ? t.codeboxSshCheckAgain : t.codeboxSshRetry}
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (access) {
                  onOpenVSCode(access)
                }
              }}
              disabled={!canOpenVSCode || checkingDependencies}
            >
              {t.codeboxSshOpenVSCode}
              <RiArrowRightUpLine />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SshSnippet({
  label,
  value,
  copied,
  copyLabel,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  copyLabel: string
  onCopy: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="rounded-2xl border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
          {copied ? t.copied : copyLabel}
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-muted-foreground">
        {value}
      </pre>
    </div>
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

function getDefaultWebsocatInstallTab(
  platform: CodeBoxLocalDependencyStatus["platform"] | undefined
): WebsocatInstallTabKey {
  if (platform === "darwin" || platform === "freebsd" || platform === "linux") {
    return platform
  }

  return "prebuilt"
}

function getWebsocatInstallGroups(
  t: ReturnType<typeof useI18n>["t"]
): WebsocatInstallGroup[] {
  return [
    {
      key: "linux",
      label: t.codeboxSshInstallDebian,
      options: [
        {
          key: "debian",
          label: t.codeboxSshInstallDebian,
          value: [
            "sudo curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl",
            "sudo chmod a+x /usr/local/bin/websocat",
          ].join("\n"),
          note: t.codeboxSshInstallDebianNote,
        },
      ],
    },
    {
      key: "darwin",
      label: "macOS",
      options: [
        {
          key: "homebrew",
          label: t.codeboxSshInstallMacHomebrew,
          value: "brew install websocat",
          note: t.codeboxSshInstallMacHomebrewNote,
        },
        {
          key: "macports",
          label: t.codeboxSshInstallMacPorts,
          value: "sudo port install websocat",
          note: t.codeboxSshInstallMacPortsNote,
        },
      ],
    },
    {
      key: "freebsd",
      label: t.codeboxSshInstallFreebsd,
      options: [
        {
          key: "freebsd",
          label: t.codeboxSshInstallFreebsd,
          value: "pkg install websocat",
          note: t.codeboxSshInstallFreebsdNote,
        },
      ],
    },
    {
      key: "source",
      label: t.codeboxSshInstallSource,
      options: [
        {
          key: "source",
          label: t.codeboxSshInstallSource,
          value: "cargo install websocat",
          note: t.codeboxSshInstallSourceNote,
        },
      ],
    },
    {
      key: "prebuilt",
      label: t.codeboxSshInstallPrebuilt,
      options: [
        {
          key: "prebuilt",
          label: t.codeboxSshInstallPrebuilt,
          value: "https://github.com/vi/websocat/releases/latest",
          note: t.codeboxSshInstallPrebuiltNote,
        },
      ],
    },
  ]
}
