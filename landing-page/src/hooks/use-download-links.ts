import { useEffect, useState } from 'react'
import {
  fetchLatestDownloadLinks,
  type DownloadLinks,
  type DownloadPlatform,
} from '@/lib/platform'

interface UseDownloadLinksResult {
  links: DownloadLinks | null
  version: string | null
  sizes: Partial<Record<DownloadPlatform, number>>
  loading: boolean
  error: Error | null
}

export function useDownloadLinks(): UseDownloadLinksResult {
  const [links, setLinks] = useState<DownloadLinks | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [sizes, setSizes] = useState<Partial<Record<DownloadPlatform, number>>>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchLatestDownloadLinks()
      .then((result) => {
        if (!cancelled) {
          setLinks(result.links)
          setVersion(result.version)
          setSizes(result.sizes)
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

  return { links, version, sizes, loading, error }
}
