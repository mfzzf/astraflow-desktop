"use client"

import * as React from "react"
import {
  RiBuilding2Line,
  RiFolderLine,
  RiIdCardLine,
  RiLoader4Line,
  RiMailLine,
  RiUser3Line,
} from "@remixicon/react"

import { AppInfoButton } from "@/components/app-info-button"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"

type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type UCloudUserInfoPayload = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type ProjectsPayload = {
  items: UCloudProjectOption[]
  selectedProjectId: string | null
  user: UCloudUserInfoPayload | null
}

type ProjectsResponse =
  | {
      ok: true
      data: ProjectsPayload
    }
  | {
      ok: false
      message?: string
    }

async function fetchProjects() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load projects."
    )
  }

  return payload.data
}

async function saveSelectedProject(projectId: string) {
  const response = await fetch("/api/studio/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to select project."
    )
  }

  return payload.data
}

function emitProjectChanged(projectId: string) {
  writeSelectedUCloudProjectId(projectId)
  window.dispatchEvent(
    new CustomEvent<UCloudProjectChangedDetail>(UCLOUD_PROJECT_CHANGED_EVENT, {
      detail: { projectId },
    })
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-muted/45 px-3 py-2">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function getInitials(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "AF"
  }

  return normalized.slice(0, 2).toUpperCase()
}

function SettingsProfilePage() {
  const { t } = useI18n()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<UCloudUserInfoPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const loadProjects = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError("")

      const next = await fetchProjects()
      const resolvedProjectId = next.selectedProjectId ?? ""
      const previousProjectId = readSelectedUCloudProjectId()

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)

      if (resolvedProjectId && resolvedProjectId !== previousProjectId) {
        emitProjectChanged(resolvedProjectId)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.projectLoadFailed
      )
    } finally {
      setIsLoading(false)
    }
  }, [t.projectLoadFailed])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadProjects()
    })
  }, [loadProjects])

  async function selectProject(projectId: string) {
    const nextProjectId = projectId.trim()

    if (
      !nextProjectId ||
      nextProjectId === "__empty" ||
      nextProjectId === selectedProjectId
    ) {
      return
    }

    const previousProjectId = selectedProjectId

    setSelectedProjectId(nextProjectId)
    setIsSaving(true)
    setError("")

    try {
      const next = await saveSelectedProject(nextProjectId)
      const resolvedProjectId = next.selectedProjectId ?? nextProjectId

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)
      emitProjectChanged(resolvedProjectId)
    } catch (selectError) {
      setSelectedProjectId(previousProjectId)
      setError(
        selectError instanceof Error
          ? selectError.message
          : t.projectSelectFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  const displayName =
    user?.displayName ||
    user?.userName ||
    user?.userEmail ||
    (isLoading ? t.accountLoading : t.account)
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const companyId =
    typeof user?.companyId === "number" ? String(user.companyId) : "-"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-semibold">
                {t.profile}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <LanguageToggle />
              <AppInfoButton />
            </div>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t.account}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-12">
                    <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {displayName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user?.userEmail || "-"}
                    </div>
                  </div>
                  {isLoading || isSaving ? (
                    <RiLoader4Line
                      className="size-4 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden
                    />
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <InfoRow
                    icon={RiUser3Line}
                    label={t.accountDisplayName}
                    value={user?.displayName || "-"}
                  />
                  <InfoRow
                    icon={RiBuilding2Line}
                    label={t.accountCompanyName}
                    value={user?.companyName || "-"}
                  />
                  <InfoRow
                    icon={RiMailLine}
                    label={t.accountUserEmail}
                    value={user?.userEmail || "-"}
                  />
                  <InfoRow
                    icon={RiIdCardLine}
                    label={t.accountCompanyId}
                    value={companyId}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t.project}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Select
                    value={selectedProjectId}
                    onValueChange={(value) => void selectProject(value)}
                    disabled={isLoading || isSaving}
                  >
                    <SelectTrigger
                      aria-label={t.project}
                      className="!h-12 w-full justify-start rounded-2xl border-border bg-muted/45 px-4 hover:bg-muted/60"
                      title={error || t.project}
                    >
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                        <span className="flex min-w-0 items-center gap-2">
                          <RiFolderLine
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="min-w-0 truncate text-sm font-medium">
                            {selectedProject?.name ||
                              (isLoading ? t.projectLoading : t.project)}
                          </span>
                        </span>
                        {selectedProject ? (
                          <span className="max-w-32 shrink-0 truncate font-mono text-xs text-muted-foreground">
                            {selectedProject.id}
                          </span>
                        ) : null}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      align="end"
                      className="max-h-80"
                      position="popper"
                    >
                      <SelectGroup>
                        {projects.length === 0 ? (
                          <SelectItem value="__empty" disabled>
                            {t.projectEmpty}
                          </SelectItem>
                        ) : (
                          projects.map((project) => (
                            <SelectItem
                              className="[&>span:last-child]:w-full"
                              key={project.id}
                              textValue={`${project.name} ${project.id}`}
                              value={project.id}
                            >
                              <span className="flex min-w-0 w-full items-center justify-between gap-3 py-1">
                                <span className="min-w-0 truncate text-sm font-medium">
                                  {project.name}
                                </span>
                                <span className="max-w-36 shrink-0 truncate font-mono text-xs text-muted-foreground">
                                  {project.id}
                                </span>
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {error ? (
                    <div className="text-xs text-destructive">{error}</div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.settings}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <LogoutButton />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </section>
  )
}

export { SettingsProfilePage }
