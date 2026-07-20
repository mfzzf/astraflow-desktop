export type Platform = 'mac' | 'windows' | 'linux' | 'other'

export type DownloadPlatform =
  | 'mac'
  | 'macIntel'
  | 'windows'
  | 'windowsArm'
  | 'linux'
  | 'linuxArm'

export interface DownloadLinks {
  mac: string
  macIntel: string
  windows: string
  windowsArm: string
  linux: string
  linuxArm: string
}

/**
 * latest.json 的候选地址：优先同源路径（开发环境走 Vite 代理、线上走 Nginx 代理，
 * 均不受 US3 桶未开启 CORS 的影响），失败时再尝试直连桶地址。
 */
export const LATEST_JSON_URLS = [
  `${import.meta.env.BASE_URL}latest.json`,
  'https://astraflow-desktop.cn-sh2.ufileos.com/latest.json',
]

export const FALLBACK_DOWNLOAD_LINKS: DownloadLinks = {
  mac: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-mac-arm64.dmg',
  macIntel: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-mac-x64.dmg',
  windows: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-win-x64.exe',
  windowsArm: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-win-arm64.exe',
  linux: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-linux-x86_64.AppImage',
  linuxArm: 'https://astraflow-desktop.cn-sh2.ufileos.com/AstraFlow-1.5.1-linux-arm64.AppImage',
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

export interface LatestDownloadInfo {
  links: DownloadLinks
  version: string | null
  sizes: Partial<Record<DownloadPlatform, number>>
}

/** 从 US3 的 latest.json 解析各平台最新的直接下载地址、版本号与安装包体积 */
export async function fetchLatestDownloadLinks(): Promise<LatestDownloadInfo> {
  let manifest: LatestManifest | null = null
  let lastError: unknown = null

  for (const url of LATEST_JSON_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`)
      }
      manifest = await response.json()
      break
    } catch (err) {
      lastError = err
    }
  }

  if (!manifest) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to fetch latest.json')
  }

  // 同一 platform（mac/windows/linux）下会同时存在 x64 与 arm64 两个包，必须按
  // 架构精确匹配文件名，否则 find() 只会拿到 files 数组里排序靠前的那个（按
  // localeCompare 排序时 "arm64" 字母序在 "x64" 之前），导致 x64 用户被误发到
  // arm64 安装包。
  const findByArch = (
    platform: string,
    extension: string,
    arch: 'x64' | 'arm64'
  ) =>
    manifest.files.find(
      (file) =>
        file.platform === platform &&
        file.name.endsWith(extension) &&
        (arch === 'arm64'
          ? file.name.includes('arm64')
          : !file.name.includes('arm64'))
    )

  const mac = findByArch('mac', '.dmg', 'arm64')
  const macIntel = findByArch('mac', '.dmg', 'x64')
  const windows = findByArch('windows', '.exe', 'x64')
  const windowsArm = findByArch('windows', '.exe', 'arm64')
  const linux = findByArch('linux', '.AppImage', 'x64')
  const linuxArm = findByArch('linux', '.AppImage', 'arm64')

  if (
    !mac?.url ||
    !macIntel?.url ||
    !windows?.url ||
    !windowsArm?.url ||
    !linux?.url ||
    !linuxArm?.url
  ) {
    throw new Error('Missing a platform download URL in manifest')
  }

  return {
    links: {
      mac: mac.url,
      macIntel: macIntel.url,
      windows: windows.url,
      windowsArm: windowsArm.url,
      linux: linux.url,
      linuxArm: linuxArm.url,
    },
    version: manifest.version || null,
    sizes: {
      mac: mac.size,
      macIntel: macIntel.size,
      windows: windows.size,
      windowsArm: windowsArm.size,
      linux: linux.size,
      linuxArm: linuxArm.size,
    },
  }
}

/** 以 MB/GB 展示安装包体积；缺失时返回 null 以隐藏对应文案 */
export function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return null
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

/** 始终返回安装包地址；拉取失败时仍直接下载已发布的稳定版。 */
export function getDownloadUrl(
  links: DownloadLinks | null,
  platform: DownloadPlatform
): string {
  return links?.[platform] ?? FALLBACK_DOWNLOAD_LINKS[platform]
}
