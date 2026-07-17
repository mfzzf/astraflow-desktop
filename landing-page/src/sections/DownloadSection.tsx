import { Download, Loader2 } from 'lucide-react'
import { AppleLogo, LinuxLogo, WindowsLogo } from '@/components/BrandIcons'
import { getDownloadUrl } from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'
import { PRIVACY_POLICY_URL } from '@/lib/links'

export default function DownloadSection() {
  const { links, loading } = useDownloadLinks()

  const cards = [
    {
      title: 'Mac 版 AstraFlow',
      subtitle: 'macOS（Apple 芯片）',
      platform: 'mac' as const,
      gradient: 'from-[#f9cf9f] via-[#f7d9b4] to-[#fbe8cf]',
      iconColor: 'text-neutral-800',
      icon: <AppleLogo className="h-10 w-10" />,
    },
    {
      title: 'Mac 版 AstraFlow',
      subtitle: 'macOS（Intel 芯片）',
      platform: 'macIntel' as const,
      gradient: 'from-[#f2d6b5] via-[#f8e4cb] to-[#fff1df]',
      iconColor: 'text-neutral-800',
      icon: <AppleLogo className="h-10 w-10" />,
    },
    {
      title: 'Windows 版 AstraFlow',
      subtitle: 'Windows 10 及以上',
      platform: 'windows' as const,
      gradient: 'from-[#a9c9f5] via-[#c3d8f8] to-[#dde9fc]',
      iconColor: 'text-sky-700',
      icon: <WindowsLogo className="h-10 w-10" />,
    },
    {
      title: 'Linux 版 AstraFlow',
      subtitle: 'AppImage（x86_64）',
      platform: 'linux' as const,
      gradient: 'from-[#d8d6ff] via-[#e5e5ff] to-[#eef2ff]',
      iconColor: 'text-indigo-700',
      icon: <LinuxLogo className="h-11 w-11" />,
    },
  ]

  return (
    <section id="download" className="mx-auto max-w-4xl scroll-mt-24 px-6 pb-28">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
          立即下载 AstraFlow
        </h2>
        <p className="mt-4 text-neutral-500">
          模型调用、技能编排、自动化执行，尽在桌面。AstraFlow 让你的 AI 工作流无缝落地。
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.platform}
            className="group overflow-hidden rounded-2xl border border-neutral-200/80 bg-white transition-shadow hover:shadow-[0_24px_50px_-20px_rgba(0,0,0,0.2)]"
          >
            <div
              className={`flex h-48 items-center justify-center bg-gradient-to-br ${card.gradient}`}
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/40 shadow-inner backdrop-blur-md transition-transform duration-300 group-hover:scale-105">
                <span className={card.iconColor}>{card.icon}</span>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-5">
              <div>
                <p className="font-semibold text-neutral-900">{card.title}</p>
                <p className="mt-0.5 text-sm text-neutral-400">{card.subtitle}</p>
              </div>
              <a
                href={getDownloadUrl(links, card.platform)}
                className="inline-flex h-9 min-w-[5rem] items-center justify-center gap-1.5 rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-900 hover:text-white"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                下载
              </a>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-neutral-400">
        下载即代表你同意《用户协议》与
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-neutral-700"
        >
          《隐私政策》
        </a>
      </p>
    </section>
  )
}
