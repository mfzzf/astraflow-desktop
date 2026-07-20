import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
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
  title: string
  /** 追加在版本号前的简短环境说明；能从按钮读出的信息不重复 */
  requirement: string | null
  primary: { platform: DownloadPlatform; label: string }
  secondary?: { platform: DownloadPlatform; label: string }
}

const GROUPS: GroupConfig[] = [
  {
    id: 'mac',
    label: 'macOS',
    icon: <AppleLogo className="h-4 w-4" />,
    title: 'Mac 版 AstraFlow',
    requirement: null,
    primary: { platform: 'mac', label: '下载（Apple 芯片）' },
    secondary: { platform: 'macIntel', label: '下载 Intel 芯片版' },
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: <WindowsLogo className="h-4 w-4" />,
    title: 'Windows 版 AstraFlow',
    requirement: 'Windows 10 及以上',
    primary: { platform: 'windows', label: '下载 Windows 版' },
    secondary: { platform: 'windowsArm', label: '下载 ARM64 版' },
  },
  {
    id: 'linux',
    label: 'Linux',
    icon: <LinuxLogo className="h-4 w-4" />,
    title: 'Linux 版 AstraFlow',
    requirement: 'x86_64 AppImage',
    primary: { platform: 'linux', label: '下载 Linux 版' },
    secondary: { platform: 'linuxArm', label: '下载 ARM64 版' },
  },
]

export default function DownloadSection() {
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
  const meta = [active.requirement, version, primarySize]
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
    <section
      id="download"
      className="mx-auto max-w-5xl scroll-mt-24 px-6 pb-28"
    >
      <div className="mesh-panel relative overflow-hidden rounded-[2rem] px-6 py-14 shadow-[0_48px_96px_-44px_rgba(76,66,180,0.55)] sm:rounded-[2.5rem] sm:px-10 md:px-14 md:py-16">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-neutral-900 md:text-5xl">
            立即下载 AstraFlow
          </h2>
          <p className="mt-5 text-neutral-600">
            模型调用、技能编排、自动化执行，尽在桌面。AstraFlow 让你的 AI 工作流无缝落地。
          </p>
        </div>

        {/* 平台分段选择：默认选中访问者所在平台，其余平台一步可达 */}
        <div
          role="tablist"
          aria-label="选择下载平台"
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
          className="material-card mt-8 rounded-3xl"
        >
          <div className="flex flex-col items-center gap-8 p-8 text-center md:flex-row md:justify-between md:p-10 md:text-left">
            <div className="flex flex-col items-center gap-5 md:flex-row md:gap-6">
              <AppIcon className="h-20 w-20 object-contain drop-shadow-[0_12px_24px_rgba(55,67,236,0.22)]" />
              <div>
                <p className="text-xl font-semibold tracking-[-0.01em] text-neutral-900">
                  {active.title}
                </p>
                <p className="mt-1.5 min-h-5 text-sm text-neutral-500">{meta}</p>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 md:items-end">
              <a
                href={getDownloadUrl(links, active.primary.platform)}
                className="inline-flex h-12 min-w-[12rem] items-center justify-center gap-2 rounded-full bg-neutral-900 px-8 text-sm font-medium text-white shadow-lg shadow-neutral-900/20 transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60 focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.97] active:duration-100"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {active.primary.label}
              </a>
              {/* 固定占位：各平台卡片等高，切换时下方内容不跳动 */}
              <div className="flex h-9 items-center">
                {active.secondary ? (
                  <a
                    href={getDownloadUrl(links, active.secondary.platform)}
                    className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-neutral-500 transition duration-150 ease-out hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 active:scale-[0.97]"
                  >
                    {active.secondary.label}
                    {secondarySize ? `（${secondarySize}）` : ''}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          下载即代表你同意《用户协议》与
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-neutral-800"
          >
            《隐私政策》
          </a>
        </p>
      </div>
    </section>
  )
}
