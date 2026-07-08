"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { getStudioExpertDraftPromptStorageKey } from "@/lib/studio-expert-draft"

import {
  fetchExpertDetail,
  fetchExpertsCatalog,
  summonExpert,
} from "./api"
import type {
  ExpertCategory,
  ExpertDetail,
  ExpertListItem,
  ExpertOrderBy,
  ExpertTypeFilter,
} from "./types"
import { isExpertRuntimeAvailable } from "./types"

export const allExpertCategoriesValue = "__all__"
const pageSize = 50

export function useExperts({
  query,
  refreshKey,
}: {
  query: string
  refreshKey: number
}) {
  const router = useRouter()
  const { t } = useI18n()
  const [categoryId, setCategoryId] = React.useState(allExpertCategoriesValue)
  const [typeFilter, setTypeFilter] = React.useState<ExpertTypeFilter>("all")
  const [orderBy, setOrderBy] = React.useState<ExpertOrderBy>("recent")
  const [pageToken, setPageToken] = React.useState("")
  const [pageTokenStack, setPageTokenStack] = React.useState<string[]>([])
  const [nextPageToken, setNextPageToken] = React.useState("")
  const [experts, setExperts] = React.useState<ExpertListItem[]>([])
  const [categories, setCategories] = React.useState<ExpertCategory[]>([])
  const [totalSize, setTotalSize] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [selectedExpert, setSelectedExpert] =
    React.useState<ExpertListItem | null>(null)
  const [detail, setDetail] = React.useState<ExpertDetail | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState("")
  const [summoningId, setSummoningId] = React.useState("")

  const resetPagination = React.useCallback(() => {
    setPageToken("")
    setPageTokenStack([])
    setNextPageToken("")
  }, [])

  const handleCategoryIdChange = React.useCallback(
    (value: string) => {
      setCategoryId(value)
      resetPagination()
    },
    [resetPagination]
  )

  const handleTypeFilterChange = React.useCallback(
    (value: ExpertTypeFilter) => {
      setTypeFilter(value)
      resetPagination()
    },
    [resetPagination]
  )

  const handleOrderByChange = React.useCallback(
    (value: ExpertOrderBy) => {
      setOrderBy(value)
      resetPagination()
    },
    [resetPagination]
  )

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setLoading(true)
      setError("")

      void fetchExpertsCatalog({
        categoryId,
        orderBy,
        pageSize,
        pageToken,
        query,
        signal: controller.signal,
        type: typeFilter,
      })
        .then((data) => {
          setExperts(data.experts)
          setCategories(data.categories)
          setTotalSize(data.totalSize)
          setNextPageToken(data.nextPageToken)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
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
    categoryId,
    orderBy,
    pageToken,
    query,
    refreshKey,
    t.requestFailed,
    typeFilter,
  ])

  const openExpert = React.useCallback((expert: ExpertListItem) => {
    setSelectedExpert(expert)
    setDetail(null)
    setDetailError("")
    setDetailOpen(true)
  }, [])

  React.useEffect(() => {
    const expertId = selectedExpert?.id?.trim()

    if (!detailOpen || !expertId) {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setDetailLoading(true)
      setDetailError("")

      void fetchExpertDetail(expertId, controller.signal)
        .then((data) => {
          setDetail(data.expert)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
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
  }, [detailOpen, selectedExpert, t.requestFailed])

  const summon = React.useCallback(
    async (expert: ExpertListItem, prompt?: string) => {
      const expertId = expert.id?.trim()

      if (!expertId || !isExpertRuntimeAvailable(expert)) {
        toast.error(t.expertUnavailable)
        return
      }

      setSummoningId(expertId)

      try {
        const data = await summonExpert(expertId, prompt)
        if (data.draftPrompt && typeof window !== "undefined") {
          window.localStorage.setItem(
            getStudioExpertDraftPromptStorageKey(data.sessionId),
            data.draftPrompt
          )
        }
        toast.success(t.expertSummoned)
        router.push(data.sessionPath)
      } catch (summonError) {
        toast.error(
          summonError instanceof Error ? summonError.message : t.requestFailed
        )
      } finally {
        setSummoningId("")
      }
    },
    [router, t.expertSummoned, t.expertUnavailable, t.requestFailed]
  )

  const goPrevious = React.useCallback(() => {
    const previousToken = pageTokenStack.at(-1) ?? ""
    setPageToken(previousToken)
    setPageTokenStack((current) => current.slice(0, -1))
  }, [pageTokenStack])

  const goNext = React.useCallback(() => {
    if (!nextPageToken) {
      return
    }

    setPageTokenStack((current) => [...current, pageToken])
    setPageToken(nextPageToken)
  }, [nextPageToken, pageToken])

  const availableCount = experts.filter(isExpertRuntimeAvailable).length
  const metadataOnlyCount = experts.filter(
    (expert) => !isExpertRuntimeAvailable(expert)
  ).length

  return {
    availableCount,
    categories,
    categoryId,
    detail,
    detailError,
    detailLoading,
    detailOpen,
    error,
    experts,
    goNext,
    goPrevious,
    hasNext: Boolean(nextPageToken),
    hasPrevious: pageTokenStack.length > 0,
    loading,
    metadataOnlyCount,
    openExpert,
    orderBy,
    selectedExpert,
    setCategoryId: handleCategoryIdChange,
    setDetailOpen,
    setOrderBy: handleOrderByChange,
    setTypeFilter: handleTypeFilterChange,
    summon,
    summoningId,
    totalSize,
    typeFilter,
  }
}
