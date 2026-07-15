"use client"

import * as React from "react"
import {
  RiAddLine,
  RiFolderOpenLine,
  RiRefreshLine,
  RiSearchLine,
  RiUploadCloud2Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsValueRow,
} from "@/components/settings-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const copyByLocale = {
  en: {
    title: "Environment",
    unavailableTitle: "Desktop environment unavailable",
    unavailable:
      "Python environment management is available in the AstraFlow desktop app.",
    interpreterSection: "Python interpreter",
    interpreterDescription:
      "One interpreter is shared by AstraFlow document tools, local sandboxes, and new local terminals.",
    managed: "Managed",
    custom: "Custom",
    managedLabel: "AstraFlow managed Python",
    managedDescription:
      "A small Python and pip bootstrap ships with the app. Required packages install automatically after launch and stay outside the app bundle.",
    customLabel: "Custom interpreter",
    customDescription:
      "Use an existing Python installation. AstraFlow will not change it unless you explicitly install the required packages below.",
    customPlaceholder: "/path/to/python3",
    choose: "Choose",
    useInterpreter: "Use interpreter",
    activeInterpreter: "Active interpreter",
    bootstrapInterpreter: "Bundled bootstrap",
    pythonVersion: "Python version",
    pipVersion: "pip version",
    notAvailable: "Not available",
    status: "Status",
    ready: "Ready",
    pending: "Packages pending",
    installing: "Installing",
    failed: "Needs attention",
    installSection: "AstraFlow packages",
    installDescription:
      "These packages support document parsing, spreadsheet work, PDF inspection, and presentation workflows.",
    install: "Install packages",
    retry: "Retry installation",
    reinstall: "Reinstall",
    refresh: "Refresh",
    packagesSection: "Installed packages",
    packageCount: (count: number) =>
      `${count} package${count === 1 ? "" : "s"}`,
    noPackages: "No packages reported by this interpreter.",
    configured: "Python interpreter updated.",
    installComplete: "Python packages are ready.",
    loadFailed: "Failed to read the Python environment.",
    saveFailed: "Failed to update the Python interpreter.",
    installFailed: "Failed to install Python packages.",
    pathRequired: "Choose or enter a Python interpreter path.",
    customPackagesSection: "Install another package",
    customPackagesDescription:
      "Look up compatible versions from the active interpreter's package index, then install one into the shared environment.",
    packageSearchPlaceholder: "Package name, for example matplotlib",
    search: "Search versions",
    searching: "Searching…",
    version: "Version",
    latest: "latest",
    installedVersion: "Installed",
    notInstalled: "Not installed",
    installPackage: "Install version",
    packageInstalling: "Installing package…",
    packageInstalled: (name: string, version: string) =>
      `${name} ${version} is installed.`,
    packageSearchFailed: "Failed to search Python package versions.",
    packageInstallFailed: "Failed to install the Python package.",
    packageNameRequired: "Enter a Python package name.",
    agentInstallHint:
      "In managed mode, Agents can also install packages with pip after permission approval. PyPI access and writes stay limited to this managed Python environment.",
    managedPackageHint: "Its version is managed by AstraFlow.",
    requiredPackage: "AstraFlow",
    customPackage: "Custom",
  },
  zh: {
    title: "运行环境",
    unavailableTitle: "桌面运行环境不可用",
    unavailable: "Python 环境管理仅在 AstraFlow 桌面应用中可用。",
    interpreterSection: "Python 解释器",
    interpreterDescription:
      "AstraFlow 文档工具、本地沙箱和新建本地终端统一使用这里配置的解释器。",
    managed: "应用托管",
    custom: "自定义",
    managedLabel: "AstraFlow 托管 Python",
    managedDescription:
      "安装包仅内置精简 Python 与 pip。应用启动后自动安装所需依赖，依赖保存在安装包之外。",
    customLabel: "自定义解释器",
    customDescription:
      "使用已有 Python。除非你明确点击安装依赖，否则 AstraFlow 不会修改该解释器。",
    customPlaceholder: "/path/to/python3",
    choose: "选择",
    useInterpreter: "使用此解释器",
    activeInterpreter: "当前解释器",
    bootstrapInterpreter: "内置引导解释器",
    pythonVersion: "Python 版本",
    pipVersion: "pip 版本",
    notAvailable: "不可用",
    status: "状态",
    ready: "可用",
    pending: "等待安装依赖",
    installing: "正在安装",
    failed: "需要处理",
    installSection: "AstraFlow Python 依赖",
    installDescription:
      "这些依赖用于文档解析、表格处理、PDF 检查和演示文稿工作流。",
    install: "安装依赖",
    retry: "重试安装",
    reinstall: "重新安装",
    refresh: "刷新",
    packagesSection: "已安装的包",
    packageCount: (count: number) => `${count} 个包`,
    noPackages: "该解释器没有返回已安装的包。",
    configured: "Python 解释器已更新。",
    installComplete: "Python 依赖已准备完成。",
    loadFailed: "读取 Python 环境失败。",
    saveFailed: "更新 Python 解释器失败。",
    installFailed: "安装 Python 依赖失败。",
    pathRequired: "请选择或输入 Python 解释器路径。",
    customPackagesSection: "安装其他 Python 包",
    customPackagesDescription:
      "通过当前解释器的包索引查询兼容版本，并将选定版本安装到统一环境中。",
    packageSearchPlaceholder: "输入包名，例如 matplotlib",
    search: "搜索版本",
    searching: "正在搜索…",
    version: "版本",
    latest: "最新",
    installedVersion: "已安装",
    notInstalled: "未安装",
    installPackage: "安装此版本",
    packageInstalling: "正在安装包…",
    packageInstalled: (name: string, version: string) =>
      `已安装 ${name} ${version}。`,
    packageSearchFailed: "搜索 Python 包版本失败。",
    packageInstallFailed: "安装 Python 包失败。",
    packageNameRequired: "请输入 Python 包名。",
    agentInstallHint:
      "应用托管模式下，Agent 经权限确认后也可以使用 pip 安装包；网络仅开放 PyPI，写入范围仅限该托管 Python 环境。",
    managedPackageHint: "该包版本由 AstraFlow 统一管理。",
    requiredPackage: "AstraFlow 内置",
    customPackage: "自定义",
  },
} as const

function statusLabel(
  status: AstraFlowPythonEnvironmentStatus,
  copy: (typeof copyByLocale)[keyof typeof copyByLocale]
) {
  if (status.installing) {
    return copy.installing
  }

  if (status.error) {
    return copy.failed
  }

  if (status.needsInstall) {
    return copy.pending
  }

  return copy.ready
}

function SettingsEnvironmentPage() {
  const { locale, t } = useI18n()
  const copy = copyByLocale[locale]
  const [status, setStatus] =
    React.useState<AstraFlowPythonEnvironmentStatus | null>(null)
  const [selectedMode, setSelectedMode] =
    React.useState<AstraFlowPythonEnvironmentMode>("managed")
  const [customExecutable, setCustomExecutable] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [packageQuery, setPackageQuery] = React.useState("")
  const [packageSearch, setPackageSearch] =
    React.useState<AstraFlowPythonPackageSearchResult | null>(null)
  const [selectedPackageVersion, setSelectedPackageVersion] = React.useState("")
  const [isSearchingPackage, setIsSearchingPackage] = React.useState(false)
  const [isInstallingPackage, setIsInstallingPackage] = React.useState(false)

  const load = React.useCallback(
    async ({ quiet = false } = {}) => {
      const bridge = window.astraflowDesktop

      if (!bridge?.getPythonEnvironmentStatus) {
        setIsLoading(false)
        return null
      }

      if (!quiet) {
        setIsLoading(true)
      }

      try {
        const next = await bridge.getPythonEnvironmentStatus()
        setStatus(next)
        setSelectedMode(next.mode)
        setCustomExecutable(next.customExecutable ?? "")
        return next
      } catch (error) {
        if (!quiet) {
          toast.error(error instanceof Error ? error.message : copy.loadFailed)
        }
        return null
      } finally {
        if (!quiet) {
          setIsLoading(false)
        }
      }
    },
    [copy.loadFailed]
  )

  React.useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  React.useEffect(() => {
    if (!status?.installing) {
      return
    }

    const timer = window.setInterval(() => {
      void load({ quiet: true })
    }, 1_500)

    return () => window.clearInterval(timer)
  }, [load, status?.installing])

  async function chooseInterpreter() {
    const path = await window.astraflowDesktop?.pickPythonInterpreter?.()

    if (path) {
      setCustomExecutable(path)
    }
  }

  async function configureManaged() {
    const bridge = window.astraflowDesktop

    setSelectedMode("managed")
    if (!bridge?.configurePythonEnvironment || status?.mode === "managed") {
      return
    }

    setIsSaving(true)
    try {
      const next = await bridge.configurePythonEnvironment({ mode: "managed" })
      setStatus(next)
      toast.success(copy.configured)
      void load({ quiet: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.saveFailed)
      setSelectedMode(status?.mode ?? "managed")
    } finally {
      setIsSaving(false)
    }
  }

  async function configureCustom() {
    const bridge = window.astraflowDesktop
    const executable = customExecutable.trim()

    if (!executable) {
      toast.error(copy.pathRequired)
      return
    }

    if (!bridge?.configurePythonEnvironment) {
      return
    }

    setIsSaving(true)
    try {
      const next = await bridge.configurePythonEnvironment({
        mode: "custom",
        customExecutable: executable,
      })
      setStatus(next)
      setSelectedMode("custom")
      setCustomExecutable(next.customExecutable ?? executable)
      toast.success(copy.configured)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.saveFailed)
    } finally {
      setIsSaving(false)
    }
  }

  async function installPackages(force = false) {
    const bridge = window.astraflowDesktop

    if (!bridge?.installPythonEnvironment || status?.installing) {
      return
    }

    setStatus((current) =>
      current
        ? {
            ...current,
            installing: true,
            stage: "installing",
            error: null,
          }
        : current
    )
    const toastId = toast.loading(copy.installing)

    try {
      const next = await bridge.installPythonEnvironment({ force })
      setStatus(next)

      if (next.error) {
        toast.error(next.error, { id: toastId })
      } else {
        toast.success(copy.installComplete, { id: toastId })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.installFailed, {
        id: toastId,
      })
      void load({ quiet: true })
    }
  }

  async function searchPackageVersions() {
    const query = packageQuery.trim()
    const bridge = window.astraflowDesktop

    if (!query) {
      toast.error(copy.packageNameRequired)
      return
    }

    if (!bridge?.searchPythonPackage) {
      return
    }

    setIsSearchingPackage(true)
    try {
      const result = await bridge.searchPythonPackage(query)
      setPackageSearch(result)
      setSelectedPackageVersion(result.latest || result.versions[0] || "")
    } catch (error) {
      setPackageSearch(null)
      setSelectedPackageVersion("")
      toast.error(
        error instanceof Error ? error.message : copy.packageSearchFailed
      )
    } finally {
      setIsSearchingPackage(false)
    }
  }

  async function installSelectedPackage() {
    const bridge = window.astraflowDesktop

    if (
      !bridge?.installPythonPackage ||
      !packageSearch ||
      !selectedPackageVersion
    ) {
      return
    }

    setIsInstallingPackage(true)
    const toastId = toast.loading(copy.packageInstalling)

    try {
      const next = await bridge.installPythonPackage({
        name: packageSearch.name,
        version: selectedPackageVersion,
      })
      setStatus(next)

      if (next.error) {
        toast.error(next.error, { id: toastId })
        return
      }

      const installed = next.packages.find(
        (entry) =>
          entry.name.localeCompare(packageSearch.name, undefined, {
            sensitivity: "base",
          }) === 0
      )
      setPackageSearch((current) =>
        current
          ? {
              ...current,
              installedVersion: installed?.version ?? selectedPackageVersion,
            }
          : current
      )
      toast.success(
        copy.packageInstalled(
          packageSearch.name,
          installed?.version ?? selectedPackageVersion
        ),
        { id: toastId }
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : copy.packageInstallFailed,
        { id: toastId }
      )
      void load({ quiet: true })
    } finally {
      setIsInstallingPackage(false)
    }
  }

  const desktopAvailable =
    typeof window !== "undefined" &&
    window.astraflowDesktop?.getPythonEnvironmentStatus != null
  const packageCount = status?.packages.length ?? 0
  const busy =
    isLoading ||
    isSaving ||
    isSearchingPackage ||
    isInstallingPackage ||
    Boolean(status?.installing)

  return (
    <SettingsPage>
      <SettingsPageHeader
        busy={busy}
        description={t.settingsEnvironmentDescription}
        title={copy.title}
      />

      {!desktopAvailable && !isLoading ? (
        <Alert>
          <AlertTitle>{copy.unavailableTitle}</AlertTitle>
          <AlertDescription>{copy.unavailable}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        description={copy.interpreterDescription}
        title={copy.interpreterSection}
      >
        <SettingsRow
          description={
            selectedMode === "managed"
              ? copy.managedDescription
              : copy.customDescription
          }
          label={
            selectedMode === "managed" ? copy.managedLabel : copy.customLabel
          }
        >
          <SettingsSegmented
            ariaLabel={copy.interpreterSection}
            disabled={busy || !desktopAvailable}
            options={[
              { id: "managed", label: copy.managed },
              { id: "custom", label: copy.custom },
            ]}
            value={selectedMode}
            onChange={(mode) => {
              if (mode === "managed") {
                void configureManaged()
              } else {
                setSelectedMode("custom")
              }
            }}
          />
        </SettingsRow>

        {selectedMode === "custom" ? (
          <SettingsRow
            description={copy.customDescription}
            label={copy.customLabel}
            className="items-start"
          >
            <div className="flex max-w-xl items-center gap-2">
              <Input
                className="min-w-0 flex-1 font-mono text-xs"
                disabled={busy || !desktopAvailable}
                placeholder={copy.customPlaceholder}
                value={customExecutable}
                onChange={(event) => setCustomExecutable(event.target.value)}
              />
              <Button
                disabled={busy || !desktopAvailable}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void chooseInterpreter()}
              >
                <RiFolderOpenLine className="size-4" aria-hidden />
                {copy.choose}
              </Button>
              <Button
                disabled={busy || !desktopAvailable}
                size="sm"
                type="button"
                onClick={() => void configureCustom()}
              >
                {copy.useInterpreter}
              </Button>
            </div>
          </SettingsRow>
        ) : null}

        <SettingsValueRow
          label={copy.activeInterpreter}
          mono
          value={status?.executable ?? copy.notAvailable}
        />
        <SettingsValueRow
          label={copy.bootstrapInterpreter}
          mono
          value={status?.bootstrapExecutable ?? copy.notAvailable}
        />
        <SettingsValueRow
          label={copy.pythonVersion}
          value={status?.pythonVersion ?? copy.notAvailable}
        />
        <SettingsValueRow
          label={copy.pipVersion}
          value={status?.pipVersion ?? copy.notAvailable}
        />
        <SettingsRow label={copy.status}>
          <Badge variant={status?.error ? "destructive" : "secondary"}>
            {status ? statusLabel(status, copy) : copy.notAvailable}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      {status?.error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.failed}</AlertTitle>
          <AlertDescription>{status.error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        action={
          <div className="flex items-center gap-2">
            <Button
              disabled={busy || !desktopAvailable}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void load()}
            >
              <RiRefreshLine className="size-4" aria-hidden />
              {copy.refresh}
            </Button>
            <Button
              disabled={busy || !desktopAvailable}
              size="sm"
              type="button"
              onClick={() => void installPackages(!status?.needsInstall)}
            >
              <RiUploadCloud2Line className="size-4" aria-hidden />
              {status?.error
                ? copy.retry
                : status?.needsInstall
                  ? copy.install
                  : copy.reinstall}
            </Button>
          </div>
        }
        description={copy.installDescription}
        title={copy.installSection}
      >
        <SettingsRow
          description={status?.message ?? undefined}
          label={copy.status}
        >
          <Badge variant="secondary">
            {status ? statusLabel(status, copy) : copy.notAvailable}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        description={`${copy.customPackagesDescription} ${copy.agentInstallHint}`}
        title={copy.customPackagesSection}
      >
        <form
          className="flex items-center gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void searchPackageVersions()
          }}
        >
          <div className="relative min-w-0 flex-1">
            <RiSearchLine
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-token-description-foreground"
            />
            <Input
              aria-label={copy.customPackagesSection}
              className="w-full pl-9"
              disabled={busy || !desktopAvailable || !status?.pipAvailable}
              placeholder={copy.packageSearchPlaceholder}
              value={packageQuery}
              onChange={(event) => {
                setPackageQuery(event.target.value)
                if (
                  packageSearch &&
                  event.target.value.trim().toLowerCase() !==
                    packageSearch.name.toLowerCase()
                ) {
                  setPackageSearch(null)
                  setSelectedPackageVersion("")
                }
              }}
            />
          </div>
          <Button
            disabled={
              busy ||
              !desktopAvailable ||
              !status?.pipAvailable ||
              !packageQuery.trim()
            }
            size="sm"
            type="submit"
            variant="outline"
          >
            <RiSearchLine aria-hidden className="size-4" />
            {isSearchingPackage ? copy.searching : copy.search}
          </Button>
        </form>

        {packageSearch ? (
          <SettingsRow
            description={`${copy.installedVersion}: ${packageSearch.installedVersion ?? copy.notInstalled}${packageSearch.managedByAstraFlow ? ` · ${copy.managedPackageHint}` : ""}`}
            label={packageSearch.name}
          >
            <Select
              disabled={busy}
              value={selectedPackageVersion}
              onValueChange={setSelectedPackageVersion}
            >
              <SelectTrigger
                aria-label={copy.version}
                className="w-40"
                size="sm"
              >
                <SelectValue placeholder={copy.version} />
              </SelectTrigger>
              <SelectContent align="end" className="max-h-80" position="popper">
                <SelectGroup>
                  {packageSearch.versions.map((version) => (
                    <SelectItem key={version} value={version}>
                      {version}
                      {version === packageSearch.latest
                        ? ` · ${copy.latest}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              disabled={
                busy ||
                !selectedPackageVersion ||
                packageSearch.managedByAstraFlow
              }
              size="sm"
              type="button"
              onClick={() => void installSelectedPackage()}
            >
              <RiAddLine aria-hidden className="size-4" />
              {copy.installPackage}
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection
        action={
          <Badge variant="secondary">{copy.packageCount(packageCount)}</Badge>
        }
        title={copy.packagesSection}
      >
        {status?.packages.length ? (
          status.packages.map((pythonPackage) => (
            <SettingsValueRow
              key={`${pythonPackage.name}:${pythonPackage.version}`}
              label={pythonPackage.name}
              value={
                <span className="flex items-center gap-2">
                  {pythonPackage.required || pythonPackage.userInstalled ? (
                    <Badge variant="secondary">
                      {pythonPackage.required
                        ? copy.requiredPackage
                        : copy.customPackage}
                    </Badge>
                  ) : null}
                  <span className="font-mono text-[11px]">
                    {pythonPackage.version}
                  </span>
                </span>
              }
            />
          ))
        ) : (
          <SettingsEmptyRow>{copy.noPackages}</SettingsEmptyRow>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}

export { SettingsEnvironmentPage }
