import { useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import AppIcon from '@/components/AppIcon'
import { AppleLogo, LinuxLogo, WindowsLogo } from '@/components/BrandIcons'
import {
  detectPlatform,
  getDownloadUrl,
  type DownloadPlatform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'

const PLATFORMS: DownloadPlatform[] = ['mac', 'macIntel', 'windows', 'linux']

function platformLabel(platform: DownloadPlatform) {
  if (platform === 'windows') return 'Windows'
  if (platform === 'linux') return 'Linux'
  if (platform === 'macIntel') return 'macOS Intel'
  return 'macOS'
}

function platformIcon(platform: DownloadPlatform) {
  if (platform === 'windows') return <WindowsLogo className="h-4 w-4" />
  if (platform === 'linux') return <LinuxLogo className="h-4 w-4" />
  return <AppleLogo className="h-4 w-4" />
}

export default function Hero() {
  const platform = useMemo(() => detectPlatform(), [])
  const { links, loading } = useDownloadLinks()

  const primaryPlatform: DownloadPlatform =
    platform === 'other' ? 'mac' : platform
  const orderedPlatforms = [
    primaryPlatform,
    ...PLATFORMS.filter((item) => item !== primaryPlatform),
  ]

  return (
    <section id="top" className="relative overflow-hidden pt-16">
      {/* 点阵背景 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #d9d9de 1.1px, transparent 1.1px)',
          backgroundSize: '26px 26px',
          maskImage:
            'radial-gradient(ellipse 90% 65% at 50% 38%, black 30%, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 90% 65% at 50% 38%, black 30%, transparent 78%)',
        }}
      />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-24 text-center md:pt-32">
        <AppIcon className="h-24 w-24 object-contain drop-shadow-[0_18px_35px_rgba(55,67,236,0.24)] md:h-28 md:w-28" />

        <h1 className="brand-wordmark mt-8 text-[3.5rem] leading-none text-neutral-950 md:text-[4.5rem]">
          AstraFlow
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-500 md:text-xl">
          让 AI 从回答问题，走向完成工作。
        </p>

        <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
          {orderedPlatforms.map((item, index) => (
            <a
              key={item}
              href={getDownloadUrl(links, item)}
              className={
                index === 0
                  ? 'inline-flex h-11 min-w-[10rem] items-center justify-center gap-2 rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white shadow-lg shadow-neutral-900/20 transition-all hover:-translate-y-0.5 hover:bg-neutral-800'
                  : 'inline-flex h-11 min-w-[9rem] items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-5 py-3 text-sm font-medium text-neutral-700 backdrop-blur transition-colors hover:border-neutral-300 hover:text-neutral-900'
              }
            >
              {loading && index === 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : index === 0 ? (
                <Download className="h-4 w-4" />
              ) : (
                platformIcon(item)
              )}
              {index === 0 ? `下载 ${platformLabel(item)} 版` : `${platformLabel(item)} 版`}
            </a>
          ))}
        </div>

        <p className="mt-4 text-xs text-neutral-400">
          支持 macOS（Apple 芯片与 Intel）、Windows 10 及以上与 Linux x86_64
        </p>
      </div>
    </section>
  )
}
