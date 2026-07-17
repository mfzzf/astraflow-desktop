import { useEffect, useState } from 'react'
import {
  fetchLatestDownloadLinks,
  type DownloadLinks,
} from '@/lib/platform'

interface UseDownloadLinksResult {
  links: DownloadLinks | null
  loading: boolean
  error: Error | null
}

export function useDownloadLinks(): UseDownloadLinksResult {
  const [links, setLinks] = useState<DownloadLinks | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchLatestDownloadLinks()
      .then((result) => {
        if (!cancelled) {
          setLinks(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { links, loading, error }
}

/** 获取可用的下载地址；若拉取失败则回退到 GitHub Releases 页面 */
