"use client"

import * as React from "react"
import { toast } from "sonner"
import { useSidebar } from "@/components/ui/sidebar"
import { useI18n } from "@/components/i18n-provider"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import {
  allCategoriesValue,
  createEmptyMcpForm,
  createMcpEditDraft,
  createMcpInstallDraft,
  createMcpStdioDraft,
  fetchInstalledMcp,
  fetchInstalledSkills,
  fetchMcpDetail,
  fetchMcpMarket,
  fetchSkillDetail,
  fetchSkillImportCandidates,
  fetchSkills,
  getMcpSearchText,
  getSkillGridClass,
  getSkillSearchText,
  isLoginRequiredError,
  normalizeKeyValueRows,
  parseArgumentLine,
  parseKeyValueLines,
  parseSkillFolderFiles,
  importSkillCandidatePaths,
  importSkillFolderFiles,
  installMcpServer,
  installSkill,
  removeInstalledMcp,
  removeInstalledSkill,
  testInstalledMcp,
  updateInstalledMcp,
  updateInstalledSkill,
} from "../utils"
import {
  type McpManualFormState,
  type InstallMcpPayload,
  type SkillDetailState,
  type SkillsMarketPageProps,
  type SkillCardSize,
  type SkillsView,
  type PluginType,
  type SkillOrderBy,
  PAGE_SIZE,
} from "../types"
import {
  type InstalledMcpServer,
  type McpRegistryServer,
  normalizeMcpServerId,
} from "@/lib/mcp"
import type {
  InstalledSkill,
  SkillImportCandidate,
  SkillImportScanData,
  SkillMeta,
} from "@/lib/skill-market"
import { cn } from "@/lib/utils"

export function useSkillsMarketPageState({
  embedded = false,
  initialView = "market",
}: SkillsMarketPageProps = {}) {
  const { locale, t } = useI18n()
  const { open: sidebarOpen, isMobile } = useSidebar()
  const [pluginType, setPluginType] = React.useState<PluginType>("experts")
  const [view, setView] = React.useState<SkillsView>(initialView)
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [category, setCategory] = React.useState(allCategoriesValue)
  const [orderBy, setOrderBy] = React.useState<SkillOrderBy>("recent")
  const [page, setPage] = React.useState(0)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [installedSkills, setInstalledSkills] = React.useState<
    InstalledSkill[]
  >([])
  const [mcpServers, setMcpServers] = React.useState<McpRegistryServer[]>([])
  const [installedMcpServers, setInstalledMcpServers] = React.useState<
    InstalledMcpServer[]
  >([])
  const [categories, setCategories] = React.useState<string[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [mcpCursor, setMcpCursor] = React.useState("")
  const [mcpCursorStack, setMcpCursorStack] = React.useState<string[]>([])
  const [mcpNextCursor, setMcpNextCursor] = React.useState<string | null>(null)
  const [refreshTick, setRefreshTick] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [mcpLoading, setMcpLoading] = React.useState(false)
  const [installedLoading, setInstalledLoading] = React.useState(true)
  const [mcpInstalledLoading, setMcpInstalledLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [selectedSkill, setSelectedSkill] = React.useState<SkillMeta | null>(
    null
  )
  const [detailSource, setDetailSource] = React.useState<SkillsView>("market")
  const [detail, setDetail] = React.useState<SkillDetailState | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState("")
  const [mcpDetailOpen, setMcpDetailOpen] = React.useState(false)
  const [selectedMcp, setSelectedMcp] =
    React.useState<McpRegistryServer | null>(null)
  const [mcpDetail, setMcpDetail] = React.useState<McpRegistryServer | null>(
    null
  )
  const [mcpDetailLoading, setMcpDetailLoading] = React.useState(false)
  const [mcpDetailError, setMcpDetailError] = React.useState("")
  const [installingSlug, setInstallingSlug] = React.useState("")
  const [updatingSlug, setUpdatingSlug] = React.useState("")
  const [removingSlug, setRemovingSlug] = React.useState("")
  const [mcpBusyId, setMcpBusyId] = React.useState("")
  const [mcpManualOpen, setMcpManualOpen] = React.useState(false)
  const [mcpEditingId, setMcpEditingId] = React.useState("")
  const [mcpManualForm, setMcpManualForm] = React.useState<McpManualFormState>(
    () => createEmptyMcpForm()
  )
  const [mcpManualError, setMcpManualError] = React.useState("")
  const [skillImportOpen, setSkillImportOpen] = React.useState(false)
  const [skillImportData, setSkillImportData] =
    React.useState<SkillImportScanData | null>(null)
  const [skillImportSource, setSkillImportSource] = React.useState<
    "local" | "upload"
  >("local")
  const [skillImportFiles, setSkillImportFiles] =
    React.useState<FileList | null>(null)
  const [skillImportSelected, setSkillImportSelected] = React.useState<
    Set<string>
  >(() => new Set())
  const [skillImportScanning, setSkillImportScanning] = React.useState(false)
  const [skillImporting, setSkillImporting] = React.useState(false)
  const directoryInputRef = React.useRef<HTMLInputElement | null>(null)
  const cardSize: SkillCardSize = embedded ? "large" : "default"
  const skillGridClass = getSkillGridClass(cardSize)
  const installedGridClass = getSkillGridClass(cardSize, true)
  const offset = page * PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const visibleStart = totalCount === 0 ? 0 : offset + 1
  const visibleEnd = Math.min(offset + skills.length, totalCount)
  const normalizedQuery = query.trim().toLowerCase()
  const isExpertsPlugin = pluginType === "experts"
  const isSkillsPlugin = pluginType === "skills"
  const isMineView = view === "mine"
  const searchPlaceholder = isMineView
    ? t.skillSearch
    : isExpertsPlugin
      ? t.expertSearch
      : pluginType === "mcp"
        ? t.mcpSearch
        : t.skillSearch
  const installedBySlug = React.useMemo(() => {
    return new Map(installedSkills.map((skill) => [skill.slug, skill]))
  }, [installedSkills])
  const installedMcpByRegistry = React.useMemo(() => {
    const map = new Map<string, InstalledMcpServer>()

    for (const server of installedMcpServers) {
      if (server.registryName) {
        map.set(
          `${server.registryName}@${server.registryVersion ?? "latest"}`,
          server
        )
        map.set(server.registryName, server)
      }

      map.set(server.name, server)
    }

    return map
  }, [installedMcpServers])
  const selectedInstalledSkill = React.useMemo(() => {
    const slug = selectedSkill?.Slug?.trim()

    return slug ? installedBySlug.get(slug) : undefined
  }, [installedBySlug, selectedSkill])
  const visibleSkills = React.useMemo(() => {
    if (debouncedQuery || !normalizedQuery) {
      return skills
    }

    return skills.filter((skill) =>
      getSkillSearchText(skill).includes(normalizedQuery)
    )
  }, [debouncedQuery, normalizedQuery, skills])
  const visibleInstalledSkills = React.useMemo(() => {
    if (!normalizedQuery) {
      return installedSkills
    }

    return installedSkills.filter((installedSkill) =>
      getSkillSearchText(installedSkill.skill).includes(normalizedQuery)
    )
  }, [installedSkills, normalizedQuery])
  const visibleInstalledMcpServers = React.useMemo(() => {
    if (!normalizedQuery) {
      return installedMcpServers
    }

    return installedMcpServers.filter((server) =>
      getMcpSearchText(server).includes(normalizedQuery)
    )
  }, [installedMcpServers, normalizedQuery])
  const enabledPluginCount =
    installedSkills.filter((skill) => skill.enabled).length +
    installedMcpServers.filter((server) => server.enabled).length
  const totalPluginCount = installedSkills.length + installedMcpServers.length
  const installedEmptyClass = cn(
    "flex items-center justify-center",
    embedded ? "min-h-32 py-6" : "min-h-40 py-10"
  )
  const marketEmptyClass = cn(
    "flex items-center justify-center",
    embedded ? "min-h-48 py-8" : "min-h-full py-12"
  )
  const needsSidebarToggleOffset = isMobile || !sidebarOpen

  const redirectToLoginIfNeeded = React.useCallback((requestError: unknown) => {
    if (!isLoginRequiredError(requestError)) {
      return false
    }

    window.location.replace("/login")
    return true
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(0)
      setMcpCursor("")
      setMcpCursorStack([])
      setMcpNextCursor(null)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    function handleProjectChanged() {
      setPage(0)
      setMcpCursor("")
      setMcpCursorStack([])
      setMcpNextCursor(null)
      setDetail(null)
      setDetailOpen(false)
      setMcpDetail(null)
      setMcpDetailOpen(false)
      setRefreshTick((current) => current + 1)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [])

  React.useEffect(() => {
    if (pluginType !== "skills" || view !== "market") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setLoading(true)
      setError("")

      void fetchSkills({
        category,
        keyword: debouncedQuery,
        offset,
        orderBy,
        signal: controller.signal,
      })
        .then((payload) => {
          setSkills(payload.data)
          setTotalCount(payload.totalCount)
          setCategories(payload.allCategories)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    category,
    debouncedQuery,
    offset,
    orderBy,
    pluginType,
    redirectToLoginIfNeeded,
    refreshTick,
    t.requestFailed,
    view,
  ])

  React.useEffect(() => {
    if (pluginType !== "mcp" || view !== "market") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setMcpLoading(true)
      setError("")

      void fetchMcpMarket({
        cursor: mcpCursor,
        keyword: debouncedQuery,
        signal: controller.signal,
      })
        .then((payload) => {
          setMcpServers(payload.data)
          setMcpNextCursor(payload.nextCursor)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMcpLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    debouncedQuery,
    mcpCursor,
    pluginType,
    redirectToLoginIfNeeded,
    refreshTick,
    t.requestFailed,
    view,
  ])

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setInstalledLoading(true)

      void fetchInstalledSkills(controller.signal)
        .then((data) => {
          setInstalledSkills(data)
        })
        .catch((loadError) => {
          if (
            !controller.signal.aborted &&
            (pluginType === "skills" || view === "mine")
          ) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setInstalledLoading(false)
          }
        })

      setMcpInstalledLoading(true)

      void fetchInstalledMcp(controller.signal)
        .then((data) => {
          setInstalledMcpServers(data)
        })
        .catch((loadError) => {
          if (
            !controller.signal.aborted &&
            (pluginType === "mcp" || view === "mine")
          ) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMcpInstalledLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [pluginType, redirectToLoginIfNeeded, refreshTick, t.requestFailed, view])

  const refresh = React.useCallback(() => {
    setDebouncedQuery(query.trim())
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
    setRefreshTick((current) => current + 1)
  }, [query])

  const openSkill = React.useCallback((skill: SkillMeta) => {
    setSelectedSkill(skill)
    setDetailSource("market")
    setDetail(null)
    setDetailError("")
    setDetailOpen(true)
  }, [])

  const openInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setSelectedSkill(installedSkill.skill)
      setDetailSource("mine")
      setDetail({
        skill: installedSkill.skill,
        skillMd: installedSkill.skillMd,
      })
      setDetailLoading(false)
      setDetailError("")
      setDetailOpen(true)
    },
    []
  )

  React.useEffect(() => {
    if (!detailOpen || !selectedSkill) {
      return
    }

    if (detailSource === "mine") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setDetailLoading(true)
      setDetailError("")

      void fetchSkillDetail(selectedSkill, controller.signal)
        .then((data) => {
          setDetail({ skill: data.skill, skillMd: data.skillMd })
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setDetailError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setDetailLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    detailOpen,
    detailSource,
    redirectToLoginIfNeeded,
    selectedSkill,
    t.requestFailed,
  ])

  const openMcpDetail = React.useCallback((server: McpRegistryServer) => {
    setSelectedMcp(server)
    setMcpDetail(null)
    setMcpDetailError("")
    setMcpDetailOpen(true)
  }, [])

  React.useEffect(() => {
    if (!mcpDetailOpen || !selectedMcp) {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setMcpDetailLoading(true)
      setMcpDetailError("")

      void fetchMcpDetail(selectedMcp, controller.signal)
        .then(setMcpDetail)
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setMcpDetailError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMcpDetailLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [mcpDetailOpen, redirectToLoginIfNeeded, selectedMcp, t.requestFailed])

  const upsertInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setInstalledSkills((current) => {
        const existingIndex = current.findIndex(
          (item) => item.slug === installedSkill.slug
        )

        if (existingIndex < 0) {
          return [installedSkill, ...current]
        }

        return current.map((item) =>
          item.slug === installedSkill.slug ? installedSkill : item
        )
      })
    },
    []
  )

  const applySkillImportResult = React.useCallback(
    (result: {
      imported: InstalledSkill[]
      skipped: SkillImportCandidate[]
      failed: Array<{ message: string }>
    }) => {
      for (const installedSkill of result.imported) {
        upsertInstalledSkill(installedSkill)
      }

      if (result.imported.length > 0) {
        setPluginType("skills")
        setView("mine")
        setRefreshTick((current) => current + 1)
      }

      toast.success(
        t.skillImportResult(
          result.imported.length,
          result.skipped.length,
          result.failed.length
        )
      )

      if (result.failed.length > 0) {
        setError(result.failed.map((item) => item.message).join("\n"))
      }
    },
    [t, upsertInstalledSkill]
  )

  const handleScanLocalSkills = React.useCallback(async () => {
    setSkillImportScanning(true)
    setError("")

    try {
      const data = await fetchSkillImportCandidates()
      setSkillImportSource("local")
      setSkillImportFiles(null)
      setSkillImportData(data)
      setSkillImportSelected(
        new Set(data.candidates.map((candidate) => candidate.sourcePath))
      )
      setSkillImportOpen(true)
    } catch (scanError) {
      if (redirectToLoginIfNeeded(scanError)) {
        return
      }

      setError(scanError instanceof Error ? scanError.message : t.requestFailed)
    } finally {
      setSkillImportScanning(false)
    }
  }, [redirectToLoginIfNeeded, t.requestFailed])

  const handleToggleImportCandidate = React.useCallback(
    (sourcePath: string) => {
      setSkillImportSelected((current) => {
        const next = new Set(current)

        if (next.has(sourcePath)) {
          next.delete(sourcePath)
        } else {
          next.add(sourcePath)
        }

        return next
      })
    },
    []
  )

  const handleToggleAllImportCandidates = React.useCallback(() => {
    setSkillImportSelected((current) => {
      const candidates = skillImportData?.candidates ?? []

      if (current.size >= candidates.length && candidates.length > 0) {
        return new Set()
      }

      return new Set(candidates.map((candidate) => candidate.sourcePath))
    })
  }, [skillImportData])

  const handleImportSelectedSkills = React.useCallback(async () => {
    const candidates = skillImportData?.candidates ?? []
    const selectedPaths = candidates
      .map((candidate) => candidate.sourcePath)
      .filter((sourcePath) => skillImportSelected.has(sourcePath))

    if (!selectedPaths.length) {
      return
    }

    setSkillImporting(true)
    setError("")

    try {
      const result =
        skillImportSource === "upload"
          ? skillImportFiles
            ? await importSkillFolderFiles(skillImportFiles, selectedPaths)
            : null
          : await importSkillCandidatePaths(selectedPaths)

      if (!result) {
        return
      }

      applySkillImportResult(result)

      const importedPaths = new Set(selectedPaths)

      setSkillImportData((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => !importedPaths.has(candidate.sourcePath)
              ),
              duplicates: [
                ...current.duplicates,
                ...current.candidates
                  .filter((candidate) =>
                    importedPaths.has(candidate.sourcePath)
                  )
                  .map((candidate) => ({
                    ...candidate,
                    alreadyInstalled: true,
                  })),
              ],
            }
          : current
      )
      setSkillImportSelected((current) => {
        const next = new Set(current)

        for (const sourcePath of importedPaths) {
          next.delete(sourcePath)
        }

        return next
      })

      if (selectedPaths.length >= candidates.length) {
        setSkillImportOpen(false)
      }
    } catch (importError) {
      if (redirectToLoginIfNeeded(importError)) {
        return
      }

      setError(
        importError instanceof Error ? importError.message : t.requestFailed
      )
    } finally {
      setSkillImporting(false)
    }
  }, [
    applySkillImportResult,
    redirectToLoginIfNeeded,
    skillImportData,
    skillImportFiles,
    skillImportSelected,
    skillImportSource,
    t.requestFailed,
  ])

  const handleImportFolderClick = React.useCallback(() => {
    directoryInputRef.current?.click()
  }, [])

  const handleImportFolderChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files

      event.currentTarget.value = ""

      if (!files?.length) {
        return
      }

      setSkillImportScanning(true)
      setError("")

      try {
        const data = await parseSkillFolderFiles(files)
        setSkillImportSource("upload")
        setSkillImportFiles(files)
        setSkillImportData(data)
        setSkillImportSelected(
          new Set(data.candidates.map((candidate) => candidate.sourcePath))
        )
        setSkillImportOpen(true)
      } catch (importError) {
        if (redirectToLoginIfNeeded(importError)) {
          return
        }

        setError(
          importError instanceof Error ? importError.message : t.requestFailed
        )
      } finally {
        setSkillImportScanning(false)
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed]
  )

  const handleInstallSkill = React.useCallback(
    async (skill: SkillMeta) => {
      const slug = skill.Slug?.trim()

      if (!slug) {
        return
      }

      setInstallingSlug(slug)
      setError("")

      try {
        const installedSkill = await installSkill(skill)
        upsertInstalledSkill(installedSkill)

        if (selectedSkill?.Slug?.trim() === slug) {
          setDetail({
            skill: installedSkill.skill,
            skillMd: installedSkill.skillMd,
          })
        }
      } catch (installError) {
        if (redirectToLoginIfNeeded(installError)) {
          return
        }

        const message =
          installError instanceof Error ? installError.message : t.requestFailed

        setError(message)
        setDetailError(message)
      } finally {
        setInstallingSlug("")
      }
    },
    [
      redirectToLoginIfNeeded,
      selectedSkill,
      t.requestFailed,
      upsertInstalledSkill,
    ]
  )

  const handleToggleInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill, enabled: boolean) => {
      setUpdatingSlug(installedSkill.slug)
      setError("")

      try {
        const updatedSkill = await updateInstalledSkill(
          installedSkill.slug,
          enabled
        )
        upsertInstalledSkill(updatedSkill)
      } catch (updateError) {
        if (redirectToLoginIfNeeded(updateError)) {
          return
        }

        setError(
          updateError instanceof Error ? updateError.message : t.requestFailed
        )
      } finally {
        setUpdatingSlug("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed, upsertInstalledSkill]
  )

  const handleRemoveInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill) => {
      setRemovingSlug(installedSkill.slug)
      setError("")

      try {
        await removeInstalledSkill(installedSkill.slug)
        setInstalledSkills((current) =>
          current.filter((item) => item.slug !== installedSkill.slug)
        )

        if (selectedSkill?.Slug?.trim() === installedSkill.slug) {
          setDetailOpen(false)
        }
      } catch (removeError) {
        if (redirectToLoginIfNeeded(removeError)) {
          return
        }

        setError(
          removeError instanceof Error ? removeError.message : t.requestFailed
        )
      } finally {
        setRemovingSlug("")
      }
    },
    [redirectToLoginIfNeeded, selectedSkill, t.requestFailed]
  )

  const upsertInstalledMcpServer = React.useCallback(
    (server: InstalledMcpServer) => {
      setInstalledMcpServers((current) => {
        const existingIndex = current.findIndex((item) => item.id === server.id)

        if (existingIndex < 0) {
          return [server, ...current]
        }

        return current.map((item) => (item.id === server.id ? server : item))
      })
    },
    []
  )

  const openManualMcpDialog = React.useCallback(
    (draft?: McpManualFormState) => {
      setMcpEditingId("")
      setMcpManualForm(draft ?? createEmptyMcpForm())
      setMcpManualError("")
      setMcpManualOpen(true)
    },
    []
  )

  const openEditMcpDialog = React.useCallback((server: InstalledMcpServer) => {
    setMcpEditingId(server.id)
    setMcpManualForm(createMcpEditDraft(server))
    setMcpManualError("")
    setMcpManualOpen(true)
  }, [])

  const createMcpPayloadFromForm = React.useCallback((): InstallMcpPayload => {
    const name = mcpManualForm.name.trim()

    if (!name) {
      throw new Error(t.mcpName)
    }

    if (mcpManualForm.transport === "stdio") {
      return {
        id: mcpManualForm.id || normalizeMcpServerId(name),
        name,
        title: mcpManualForm.title.trim() || name,
        description: mcpManualForm.description,
        source: mcpManualForm.source,
        registryName: mcpManualForm.registryName || null,
        registryVersion: mcpManualForm.registryVersion || null,
        enabled: true,
        localCommandConfirmed: mcpManualForm.localCommandConfirmed,
        config: {
          type: "stdio",
          command: mcpManualForm.command.trim(),
          args: parseArgumentLine(mcpManualForm.args),
          env: parseKeyValueLines(mcpManualForm.env),
          cwd: mcpManualForm.cwd.trim() || null,
        },
      }
    }

    return {
      id: mcpManualForm.id || normalizeMcpServerId(name),
      name,
      title: mcpManualForm.title.trim() || name,
      description: mcpManualForm.description,
      source: mcpManualForm.source,
      registryName: mcpManualForm.registryName || null,
      registryVersion: mcpManualForm.registryVersion || null,
      enabled: true,
      config: {
        type: mcpManualForm.transport,
        url: mcpManualForm.url.trim(),
        headers: normalizeKeyValueRows(mcpManualForm.headers),
      },
    }
  }, [mcpManualForm, t.mcpName])

  const handleSaveMcpManual = React.useCallback(async () => {
    setMcpManualError("")
    setMcpBusyId(mcpEditingId || "manual")

    try {
      const payload = createMcpPayloadFromForm()
      const installed = mcpEditingId
        ? await updateInstalledMcp(mcpEditingId, {
            name: payload.name,
            title: payload.title,
            description: payload.description,
            config: payload.config,
            localCommandConfirmed: payload.localCommandConfirmed,
          })
        : await installMcpServer(payload)

      upsertInstalledMcpServer(installed)
      setMcpManualOpen(false)
      setMcpEditingId("")
      toast.success(mcpEditingId ? t.mcpUpdated : t.mcpInstalled)
    } catch (saveError) {
      if (redirectToLoginIfNeeded(saveError)) {
        return
      }

      setMcpManualError(
        saveError instanceof Error ? saveError.message : t.requestFailed
      )
    } finally {
      setMcpBusyId("")
    }
  }, [
    createMcpPayloadFromForm,
    mcpEditingId,
    redirectToLoginIfNeeded,
    t.mcpInstalled,
    t.mcpUpdated,
    t.requestFailed,
    upsertInstalledMcpServer,
  ])

  const handlePreviousMcpPage = React.useCallback(() => {
    const previousCursor = mcpCursorStack.at(-1) ?? ""

    setMcpCursor(previousCursor)
    setMcpCursorStack((current) => current.slice(0, -1))
    setPage((currentPage) => Math.max(0, currentPage - 1))
  }, [mcpCursorStack])

  const handleNextMcpPage = React.useCallback(() => {
    if (!mcpNextCursor) {
      return
    }

    setMcpCursorStack((current) => [...current, mcpCursor])
    setMcpCursor(mcpNextCursor)
    setPage((currentPage) => currentPage + 1)
  }, [mcpCursor, mcpNextCursor])

  const handleInstallMcpFromMarket = React.useCallback(
    async (server: McpRegistryServer) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        const resolvedServer =
          Object.keys(server.serverJson).length > 0
            ? server
            : await fetchMcpDetail(server)
        const remotePayload = createMcpInstallDraft(resolvedServer)

        if (!remotePayload) {
          setMcpDetailOpen(false)
          openManualMcpDialog(createMcpStdioDraft(resolvedServer))
          return
        }

        const installed = await installMcpServer(remotePayload)
        upsertInstalledMcpServer(installed)
      } catch (installError) {
        if (redirectToLoginIfNeeded(installError)) {
          return
        }

        setError(
          installError instanceof Error ? installError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [
      openManualMcpDialog,
      redirectToLoginIfNeeded,
      t.requestFailed,
      upsertInstalledMcpServer,
    ]
  )

  const handleToggleInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer, enabled: boolean) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        const updated = await updateInstalledMcp(server.id, { enabled })
        upsertInstalledMcpServer(updated)
      } catch (updateError) {
        if (redirectToLoginIfNeeded(updateError)) {
          return
        }

        setError(
          updateError instanceof Error ? updateError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed, upsertInstalledMcpServer]
  )

  const handleTestInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        const updated = await testInstalledMcp(server.id)
        upsertInstalledMcpServer(updated)
        toast.success(t.mcpConnectionOk)
      } catch (testError) {
        if (redirectToLoginIfNeeded(testError)) {
          return
        }

        setError(
          testError instanceof Error ? testError.message : t.mcpConnectionFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [
      redirectToLoginIfNeeded,
      t.mcpConnectionFailed,
      t.mcpConnectionOk,
      upsertInstalledMcpServer,
    ]
  )

  const handleRemoveInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        await removeInstalledMcp(server.id)
        setInstalledMcpServers((current) =>
          current.filter((item) => item.id !== server.id)
        )
      } catch (removeError) {
        if (redirectToLoginIfNeeded(removeError)) {
          return
        }

        setError(
          removeError instanceof Error ? removeError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed]
  )

  const handleMcpManualOpenChange = React.useCallback((open: boolean) => {
    setMcpManualOpen(open)

    if (!open) {
      setMcpEditingId("")
      setMcpManualError("")
    }
  }, [])

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory)
    setPage(0)
  }

  function handleOrderChange(nextOrderBy: string) {
    setOrderBy(nextOrderBy as SkillOrderBy)
    setPage(0)
  }

  function handlePluginTypeChange(nextPluginType: PluginType) {
    setPluginType(nextPluginType)
    setView("market")
    setQuery("")
    setDebouncedQuery("")
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
  }

  function handleViewChange(nextView: SkillsView) {
    setView(nextView)
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
  }

  const pluginTabs = (
    <nav
      className={cn(
        "flex min-w-0 items-center gap-5",
        embedded ? "shrink-0" : "border-b"
      )}
    >
      <button
        type="button"
        className={cn(
          "-mb-px border-b-2 text-sm transition-colors",
          embedded ? "pb-1.5" : "pb-2.5",
          !isMineView && pluginType === "experts"
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePluginTypeChange("experts")}
      >
        {t.pluginTypeExperts}
      </button>
      <button
        type="button"
        className={cn(
          "-mb-px border-b-2 text-sm transition-colors",
          embedded ? "pb-1.5" : "pb-2.5",
          !isMineView && pluginType === "skills"
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePluginTypeChange("skills")}
      >
        {t.pluginTypeSkills}
      </button>
      <button
        type="button"
        className={cn(
          "-mb-px border-b-2 text-sm transition-colors",
          embedded ? "pb-1.5" : "pb-2.5",
          !isMineView && pluginType === "mcp"
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePluginTypeChange("mcp")}
      >
        {t.pluginTypeMcp}
      </button>
      <button
        type="button"
        className={cn(
          "-mb-px flex items-baseline gap-1.5 border-b-2 text-sm transition-colors",
          embedded ? "pb-1.5" : "pb-2.5",
          isMineView
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handleViewChange("mine")}
      >
        {t.pluginMine}
        <span className="text-xs text-muted-foreground">
          {totalPluginCount}
        </span>
      </button>
    </nav>
  )

  return {
    embedded,
    locale,
    t,
    pluginType,
    setPluginType,
    view,
    setView,
    query,
    setQuery,
    debouncedQuery,
    setDebouncedQuery,
    category,
    setCategory,
    orderBy,
    setOrderBy,
    page,
    setPage,
    skills,
    setSkills,
    installedSkills,
    setInstalledSkills,
    mcpServers,
    setMcpServers,
    installedMcpServers,
    setInstalledMcpServers,
    categories,
    setCategories,
    totalCount,
    setTotalCount,
    mcpCursor,
    setMcpCursor,
    mcpCursorStack,
    setMcpCursorStack,
    mcpNextCursor,
    setMcpNextCursor,
    refreshTick,
    setRefreshTick,
    loading,
    setLoading,
    mcpLoading,
    setMcpLoading,
    installedLoading,
    setInstalledLoading,
    mcpInstalledLoading,
    setMcpInstalledLoading,
    error,
    setError,
    detailOpen,
    setDetailOpen,
    selectedSkill,
    setSelectedSkill,
    detailSource,
    setDetailSource,
    detail,
    setDetail,
    detailLoading,
    setDetailLoading,
    detailError,
    setDetailError,
    mcpDetailOpen,
    setMcpDetailOpen,
    selectedMcp,
    setSelectedMcp,
    mcpDetail,
    setMcpDetail,
    mcpDetailLoading,
    setMcpDetailLoading,
    mcpDetailError,
    setMcpDetailError,
    installingSlug,
    setInstallingSlug,
    updatingSlug,
    setUpdatingSlug,
    removingSlug,
    setRemovingSlug,
    mcpBusyId,
    setMcpBusyId,
    mcpManualOpen,
    setMcpManualOpen,
    mcpEditingId,
    setMcpEditingId,
    mcpManualForm,
    setMcpManualForm,
    mcpManualError,
    setMcpManualError,
    skillImportOpen,
    setSkillImportOpen,
    skillImportData,
    setSkillImportData,
    skillImportSource,
    setSkillImportSource,
    skillImportFiles,
    setSkillImportFiles,
    skillImportSelected,
    setSkillImportSelected,
    skillImportScanning,
    setSkillImportScanning,
    skillImporting,
    setSkillImporting,
    cardSize,
    skillGridClass,
    installedGridClass,
    offset,
    totalPages,
    visibleStart,
    visibleEnd,
    normalizedQuery,
    isExpertsPlugin,
    isSkillsPlugin,
    isMineView,
    searchPlaceholder,
    installedBySlug,
    installedMcpByRegistry,
    selectedInstalledSkill,
    visibleSkills,
    visibleInstalledSkills,
    visibleInstalledMcpServers,
    enabledPluginCount,
    totalPluginCount,
    installedEmptyClass,
    marketEmptyClass,
    needsSidebarToggleOffset,
    pluginTabs,
    directoryInputRef,
    refresh,
    openSkill,
    openInstalledSkill,
    openMcpDetail,
    upsertInstalledSkill,
    applySkillImportResult,
    handleScanLocalSkills,
    handleToggleImportCandidate,
    handleToggleAllImportCandidates,
    handleImportSelectedSkills,
    handleImportFolderClick,
    handleImportFolderChange,
    handleInstallSkill,
    handleToggleInstalledSkill,
    handleRemoveInstalledSkill,
    upsertInstalledMcpServer,
    openManualMcpDialog,
    openEditMcpDialog,
    createMcpPayloadFromForm,
    handleSaveMcpManual,
    handlePreviousMcpPage,
    handleNextMcpPage,
    handleInstallMcpFromMarket,
    handleToggleInstalledMcp,
    handleTestInstalledMcp,
    handleRemoveInstalledMcp,
    handleMcpManualOpenChange,
    handleCategoryChange,
    handleOrderChange,
    handlePluginTypeChange,
    handleViewChange,
  }
}
