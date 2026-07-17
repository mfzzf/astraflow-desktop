import { useMemo } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import AppIcon from '@/components/AppIcon'
import { AppleLogo, WindowsLogo } from '@/components/BrandIcons'
import {
  detectPlatform,
  getDownloadUrl,
  type Platform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'

function platformLabel(platform: Platform) {
  return platform === 'windows' ? 'Windows' : 'macOS'
}

export default function Hero() {
  const platform = useMemo(() => detectPlatform(), [])
  const { links, loading } = useDownloadLinks()

  const primaryPlatform = platform === 'windows' ? 'windows' : 'mac'
  const secondaryPlatform = platform === 'windows' ? 'mac' : 'windows'

  const primary = {
    href: getDownloadUrl(links, primaryPlatform),
    label: `下载 ${platformLabel(primaryPlatform)} 版`,
    icon:
      primaryPlatform === 'windows' ? (
        <WindowsLogo className="h-4 w-4" />
      ) : (
        <AppleLogo className="h-4 w-4" />
      ),
  }

  const secondary = {
    href: getDownloadUrl(links, secondaryPlatform),
    label: `${platformLabel(secondaryPlatform)} 版`,
    icon:
      secondaryPlatform === 'windows' ? (
        <WindowsLogo className="h-4 w-4" />
      ) : (
        <AppleLogo className="h-4 w-4" />
      ),
  }

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
        <AppIcon className="h-24 w-24 drop-shadow-[0_18px_35px_rgba(0,0,0,0.25)] md:h-28 md:w-28" />

        <h1 className="mt-8 text-5xl font-semibold tracking-tight text-neutral-900 md:text-6xl">
          AstraFlow
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-500 md:text-xl">
          AI 桌面工作台：模型、技能、自动化，一站搞定
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={primary.href}
            className="inline-flex h-11 min-w-[10rem] items-center justify-center gap-2 rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white shadow-lg shadow-neutral-900/20 transition-all hover:-translate-y-0.5 hover:bg-neutral-800 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {primary.label}
          </a>
          <a
            href={secondary.href}
            className="inline-flex h-11 min-w-[10rem] items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-6 py-3 text-sm font-medium text-neutral-700 backdrop-blur transition-colors hover:border-neutral-300 hover:text-neutral-900"
          >
            {secondary.icon}
            {secondary.label}
          </a>
        </div>

        <p className="mt-4 text-xs text-neutral-400">
          支持 macOS（Apple 芯片）与 Windows 10 及以上
        </p>

        <a
          href="#preview"
          className="mt-16 inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-400 transition-colors hover:text-neutral-600"
          aria-label="向下浏览"
        >
          <ChevronDown className="h-5 w-5 animate-bounce" />
        </a>
      </div>
    </section>
  )
}
