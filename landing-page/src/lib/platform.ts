export type Platform = 'mac' | 'windows' | 'linux' | 'other'

export type DownloadPlatform = 'mac' | 'macIntel' | 'windows' | 'linux'

export interface DownloadLinks {
  mac: string
  macIntel: string
  windows: string
  linux: string
}

export const LATEST_JSON_URL =
  'https://astraflow-desktop.cn-sh2.ufileos.com/latest.json'

export const FALLBACK_DOWNLOAD_LINKS: DownloadLinks = {
  mac: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.4.5-mac-arm64.dmg',
  macIntel: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.4.5-mac-x64.dmg',
  windows: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.4.5-win-x64.exe',
  linux: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.4.5-linux-x86_64.AppImage',
}

/** 根据 User-Agent 判断访问者系统，用于高亮对应的下载按钮 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Linux|X11/i.test(ua)) return 'linux'
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

/** 从 US3 的 latest.json 解析各平台最新的直接下载地址 */
export async function fetchLatestDownloadLinks(): Promise<DownloadLinks> {
  const response = await fetch(LATEST_JSON_URL, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${LATEST_JSON_URL}: ${response.status}`)
  }

  const manifest: LatestManifest = await response.json()

  const mac = manifest.files.find(
    (file) =>
      file.platform === 'mac' &&
      file.name.includes('arm64') &&
      file.name.endsWith('.dmg')
  )?.url

  const macIntel = manifest.files.find(
    (file) =>
      file.platform === 'mac' &&
      file.name.includes('x64') &&
      file.name.endsWith('.dmg')
  )?.url

  const windows = manifest.files.find(
    (file) => file.platform === 'windows' && file.name.endsWith('.exe')
  )?.url

  const linux = manifest.files.find(
    (file) => file.platform === 'linux' && file.name.endsWith('.AppImage')
  )?.url

  if (!mac || !macIntel || !windows || !linux) {
    throw new Error('Missing a platform download URL in manifest')
  }

  return { mac, macIntel, windows, linux }
}

/** 始终返回安装包地址；拉取失败时仍直接下载已发布的稳定版。 */
export function getDownloadUrl(
  links: DownloadLinks | null,
  platform: DownloadPlatform
): string {
  return links?.[platform] ?? FALLBACK_DOWNLOAD_LINKS[platform]
}
