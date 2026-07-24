import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/components/AppIcon'
import { AppleLogo, LinuxLogo, WindowsLogo } from '@/components/BrandIcons'
import {
  detectPlatform,
  formatFileSize,
  getDownloadUrl,
  type DownloadPlatform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'
import { PRIVACY_POLICY_URL } from '@/lib/links'

type PlatformGroup = 'mac' | 'windows' | 'linux'

interface GroupConfig {
  id: PlatformGroup
  label: string
  icon: ReactNode
  titleKey: string
  /** 追加在版本号前的简短环境说明；能从按钮读出的信息不重复 */
  requirementKey: string | null
  primary: { platform: DownloadPlatform; labelKey: string }
  secondary?: { platform: DownloadPlatform; labelKey: string }
}

const GROUPS: GroupConfig[] = [
  {
    id: 'mac',
    label: 'macOS',
    icon: <AppleLogo className="h-4 w-4" />,
    titleKey: 'download.macTitle',
    requirementKey: null,
    primary: { platform: 'mac', labelKey: 'download.macPrimary' },
    secondary: { platform: 'macIntel', labelKey: 'download.macSecondary' },
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: <WindowsLogo className="h-4 w-4" />,
    titleKey: 'download.winTitle',
    requirementKey: 'download.winReq',
    primary: { platform: 'windows', labelKey: 'download.winPrimary' },
  },
  {
    id: 'linux',
    label: 'Linux',
    icon: <LinuxLogo className="h-4 w-4" />,
    titleKey: 'download.linuxTitle',
    requirementKey: 'download.linuxReq',
    primary: { platform: 'linux', labelKey: 'download.linuxPrimary' },
  },
]

export default function DownloadSection() {
  const { t } = useTranslation()
  const { links, version, sizes, loading } = useDownloadLinks()

  const detected = useMemo(() => detectPlatform(), [])
  const [group, setGroup] = useState<PlatformGroup>(
    detected === 'other' ? 'mac' : detected
  )
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const activeIndex = GROUPS.findIndex((item) => item.id === group)
  const active = GROUPS[activeIndex]

  const primarySize = formatFileSize(sizes[active.primary.platform])
  const secondarySize = active.secondary
    ? formatFileSize(sizes[active.secondary.platform])
    : null
  const meta = [active.requirementKey ? t(active.requirementKey) : null, version, primarySize]
    .filter(Boolean)
    .join(' · ')

  function handleTablistKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = (activeIndex + delta + GROUPS.length) % GROUPS.length
    setGroup(GROUPS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <section id="download" className="mx-auto max-w-5xl scroll-mt-24 px-6 pb-28">
      <div className="mesh-panel relative overflow-hidden rounded-[2rem] px-6 py-14 shadow-[0_48px_96px_-44px_rgba(76,66,180,0.55)] sm:rounded-[2.5rem] sm:px-10 md:px-14 md:py-16">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-4xl leading-[1.05] tracking-headline text-black md:text-6xl">
            {t('download.pre')}
            <em className="italic text-[#4F3CD8]">{t('download.em')}</em>
          </h2>
          <p className="mt-5 font-kai text-[#6F6F6F]">{t('download.sub')}</p>
        </div>

        {/* 平台分段选择：默认选中访问者所在平台，其余平台一步可达 */}
        <div
          role="tablist"
          aria-label={t('nav.download')}
          onKeyDown={handleTablistKeyDown}
          className="relative mx-auto mt-10 grid w-full max-w-sm grid-cols-3 rounded-full bg-white/50 p-1 backdrop-blur-sm"
        >
          <span
            aria-hidden
            className="segment-thumb absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.08)]"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {GROUPS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              type="button"
              role="tab"
              id={`download-tab-${item.id}`}
              aria-selected={item.id === group}
              aria-controls="download-panel"
              tabIndex={item.id === group ? 0 : -1}
              onClick={() => setGroup(item.id)}
              className={`relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-none transition duration-150 ease-out focus-visible:ring-2 focus-visible:ring-neutral-900/60 active:scale-[0.96] ${
                item.id === group
                  ? 'text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="download-panel"
          aria-labelledby={`download-tab-${active.id}`}
          className="mt-8 rounded-3xl border border-neutral-200 bg-white shadow-[0_24px_60px_-40px_rgba(0,0,0,0.25)]"
        >
          <div className="flex flex-col items-center gap-8 p-8 text-center md:flex-row md:justify-between md:p-10 md:text-left">
            <div className="flex flex-col items-center gap-5 md:flex-row md:gap-6">
              <AppIcon className="h-20 w-20 object-contain" />
              <div>
                <p className="text-xl font-semibold tracking-[-0.01em] text-neutral-900">
                  {t(active.titleKey)}
                </p>
                <p className="mt-1.5 min-h-5 text-sm text-neutral-500">{meta}</p>
              </div>
            </div>

            <div className="flex w-full max-w-[16rem] flex-col items-stretch gap-3">
              <a
                href={getDownloadUrl(links, active.primary.platform)}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-medium text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60 focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.97] active:duration-100"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t(active.primary.labelKey)}
              </a>
              {active.secondary ? (
                <a
                  href={getDownloadUrl(links, active.secondary.platform)}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-6 text-sm font-medium text-neutral-700 transition duration-150 ease-out hover:border-neutral-300 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 active:scale-[0.97]"
                >
                  {t(active.secondary.labelKey)}
                  {secondarySize ? `（${secondarySize}）` : ''}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          {t('download.agreement')}
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-[#4338ca]"
          >
            {t('download.agreementPrivacy')}
          </a>
        </p>
      </div>
    </section>
  )
}
