import { useMemo } from 'react'
import { ArrowRight, Download, Loader2 } from 'lucide-react'
import {
  detectPlatform,
  getDownloadUrl,
  type DownloadPlatform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'

/** 首尾呼应的收尾 CTA：FAQ 之后、页脚之前再给一次下载入口 */
export default function FinalCta() {
  const platform = useMemo(() => detectPlatform(), [])
  const { links, loading } = useDownloadLinks()

  const primaryPlatform: DownloadPlatform =
    platform === 'other' ? 'mac' : platform

  return (
    <section className="mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
      <h2 className="mx-auto max-w-3xl font-display text-5xl leading-[1.02] tracking-headline text-black md:text-7xl">
        Now, let AI <em className="italic text-[#6F6F6F]">finish the work.</em>
      </h2>
      <p className="mx-auto mt-6 max-w-xl font-kai text-[#6F6F6F]">
        下载 AstraFlow，把模型、技能与自动化装进你的桌面。
      </p>

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={getDownloadUrl(links, primaryPlatform)}
          className="inline-flex h-12 min-w-[11rem] items-center justify-center gap-2 rounded-full bg-black px-8 text-sm font-medium text-white transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/60 active:scale-[0.97]"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          免费下载 AstraFlow
        </a>
        <a
          href="#download"
          className="group inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-medium text-[#6F6F6F] transition duration-150 ease-out hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 active:scale-[0.97]"
        >
          查看全部平台
          <ArrowRight className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
  )
}
