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
    <section className="mx-auto max-w-6xl px-6 pb-28">
      <div className="relative isolate overflow-hidden rounded-3xl bg-neutral-950 px-6 py-20 text-center md:py-24">
        {/* 深色卡片内的环境光，与下载区的氛围保持一致 */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-[70%] -translate-y-1/3 rounded-full bg-[#5b6bff]/25 blur-3xl" />
          <div className="absolute left-1/2 bottom-0 h-56 w-[30rem] -translate-x-[10%] translate-y-1/3 rounded-full bg-[#f7cf9b]/15 blur-3xl" />
        </div>

        <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white md:text-5xl">
          现在，让 AI 开始完成工作
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">
          下载 AstraFlow，把模型、技能与自动化装进你的桌面。
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={getDownloadUrl(links, primaryPlatform)}
            className="inline-flex h-12 min-w-[11rem] items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-medium text-neutral-900 shadow-lg shadow-black/30 transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:translate-y-0 active:scale-[0.97] active:duration-100"
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
            className="group inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-medium text-neutral-300 transition duration-150 ease-out hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.97]"
          >
            查看全部平台
            <ArrowRight className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  )
}
