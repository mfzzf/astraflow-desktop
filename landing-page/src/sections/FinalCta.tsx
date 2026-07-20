import { useMemo } from 'react'
import { ArrowRight, Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  detectPlatform,
  getDownloadUrl,
  type DownloadPlatform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'

/** 首尾呼应的收尾 CTA：FAQ 之后、页脚之前再给一次下载入口 */
export default function FinalCta() {
  const { t } = useTranslation()
  const platform = useMemo(() => detectPlatform(), [])
  const { links, loading } = useDownloadLinks()

  const primaryPlatform: DownloadPlatform =
    platform === 'other' ? 'mac' : platform

  return (
    <section className="mx-auto max-w-6xl px-6 pb-28">
      <div className="mesh-panel relative overflow-hidden rounded-[2rem] px-6 py-20 text-center shadow-[0_48px_96px_-44px_rgba(76,66,180,0.55)] sm:rounded-[2.5rem] md:py-24">
        <h2 className="mx-auto max-w-3xl font-display text-5xl leading-[1.02] tracking-headline text-black md:text-7xl">
          {t('finalCta.pre')}
          <em className="italic text-[#4F3CD8]">{t('finalCta.em')}</em>
        </h2>
        <p className="mx-auto mt-6 max-w-xl font-kai text-neutral-600">
          {t('finalCta.sub')}
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
            {t('finalCta.btnPrimary')}
          </a>
          <a
            href="#download"
            className="group inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-medium text-neutral-700 transition duration-150 ease-out hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 active:scale-[0.97]"
          >
            {t('finalCta.btnSecondary')}
            <ArrowRight className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  )
}
