export type Platform = 'mac' | 'windows' | 'other'

export interface DownloadLinks {
  mac: string
  windows: string
}

export const LATEST_JSON_URL =
  'https://astraflow-desktop.cn-sh2.ufileos.com/latest.json'

export const FALLBACK_RELEASE_URL =
  'https://github.com/mfzzf/astraflow-desktop/releases/latest'

/** 根据 User-Agent 判断访问者系统，用于高亮对应的下载按钮 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Windows/i.test(ua)) return 'windows'
  return 'other'
}

interface LatestManifestFile {
  name: string
  platform: string
  sha512: string
  size: number
  url: string
}

interface LatestManifest {
  name: string
  version: string
  tagName: string
  releaseName: string
  releaseDate: string
  releaseUrl: string
  files: LatestManifestFile[]
}

/** 从 US3 的 latest.json 解析 macOS / Windows 最新下载地址 */
export async function fetchLatestDownloadLinks(): Promise<DownloadLinks> {
  const response = await fetch(LATEST_JSON_URL, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${LATEST_JSON_URL}: ${response.status}`)
  }

  const manifest: LatestManifest = await response.json()

  const mac = manifest.files.find(
    (file) => file.platform === 'mac' && file.name.endsWith('.dmg')
  )?.url

  const windows = manifest.files.find(
    (file) => file.platform === 'windows' && file.name.endsWith('.exe')
  )?.url

  if (!mac || !windows) {
    throw new Error('Missing macOS or Windows download URL in manifest')
  }

  return { mac, windows }
}

/** 获取可用的下载地址；若拉取失败则回退到 GitHub Releases 页面 */
export function getDownloadUrl(
  links: DownloadLinks | null,
  platform: 'mac' | 'windows'
): string {
  return links?.[platform] ?? FALLBACK_RELEASE_URL
}
