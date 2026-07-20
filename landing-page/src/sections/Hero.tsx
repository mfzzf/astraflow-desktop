import { useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppleLogo, LinuxLogo, WindowsLogo } from '@/components/BrandIcons'
import HeroVideo from '@/components/HeroVideo'
import DottedBackground from '@/components/DottedBackground'
import LetterSwap from '@/components/LetterSwap'
import { assetUrl } from '@/lib/assets'
import {
  detectPlatform,
  getDownloadUrl,
  type DownloadPlatform,
} from '@/lib/platform'
import { useDownloadLinks } from '@/hooks/use-download-links'

const PLATFORMS: DownloadPlatform[] = ['mac', 'macIntel', 'windows', 'linux']

function platformIcon(platform: DownloadPlatform) {
  if (platform === 'windows') return <WindowsLogo className="h-4 w-4" />
  if (platform === 'linux') return <LinuxLogo className="h-4 w-4" />
  return <AppleLogo className="h-4 w-4" />
}

export default function Hero() {
  const { t, i18n } = useTranslation()
  const platform = useMemo(() => detectPlatform(), [])
  const { links, loading } = useDownloadLinks()

  const primaryPlatform: DownloadPlatform =
    platform === 'other' ? 'mac' : platform
  const orderedPlatforms = [
    primaryPlatform,
    ...PLATFORMS.filter((item) => item !== primaryPlatform),
  ]

  const isEn = i18n.language === 'en'

  return (
    <section
      id="top"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white"
    >
      {/* z-0：视频置底，定位在首屏下半部分；顶部渐隐消除硬边 */}
      <div className="absolute inset-x-0 bottom-0 top-[42vh] z-0 [mask-image:linear-gradient(to_bottom,transparent,#000_18%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_18%)] md:top-[300px]">
        <HeroVideo
          src={assetUrl('videos/hero-loop.mp4')}
          poster={assetUrl('videos/hero-poster.jpg')}
        />
      </div>
      {/* z-[1]：点阵叠在视频之上，multiply 混合；mask 限制在首屏上半区留白处，
          到视频区域前渐隐——只做点缀，不全页覆盖 */}
      <div className="pointer-events-none absolute inset-0 z-[1] opacity-60 mix-blend-multiply [mask-image:linear-gradient(to_bottom,#000_18%,transparent_55%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_18%,transparent_55%)]">
        <DottedBackground
          speed={1}
          cellSize={2}
          gamma={4}
          paletteBias={0}
          mouseRadius={220}
          mouseStrength={0.9}
          bgColor="transparent"
        />
      </div>
      {/* z-[2]：仅顶部向下压白，盖住导航区与点阵顶部；下半保持透明让视频清晰 */}
      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-white via-transparent to-transparent" />

      {/* z-10：首屏内容 */}
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 pb-40 pt-32 text-center md:pt-40">
        <h1 className="animate-fade-rise font-display text-5xl font-normal leading-[0.95] tracking-headline text-black sm:text-7xl md:text-8xl">
          {t('hero.pre1')}
          {/* 字母翻转动效只用于英文；中文单字翻转观感怪异，用静态强调 */}
          {isEn ? (
            <LetterSwap label={t('hero.em1')} className="italic text-[#4F3CD8]" />
          ) : (
            <em className="italic text-[#4F3CD8]">{t('hero.em1')}</em>
          )}
          {t('hero.comma')}
          {/* 英文标语两行，中文四字对仗一行排开 */}
          {isEn ? <br /> : null}
          {t('hero.mid')}
          {isEn ? (
            <LetterSwap label={t('hero.em2')} className="italic text-[#4F3CD8]" />
          ) : (
            <em className="italic text-[#4F3CD8]">{t('hero.em2')}</em>
          )}
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-xl font-kai text-base leading-relaxed text-[#6F6F6F] sm:text-lg">
          {t('hero.subtitle')}
        </p>

        <div className="animate-fade-rise-delay-2 mt-12 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
          {orderedPlatforms.map((item, index) => (
            <a
              key={item}
              href={getDownloadUrl(links, item)}
              className={
                index === 0
                  ? 'inline-flex h-12 min-w-[11rem] items-center justify-center gap-2 rounded-full bg-black px-8 py-3 text-sm font-medium text-white transition-transform duration-200 hover:scale-[1.03]'
                  : 'inline-flex h-12 min-w-[9rem] items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:text-black'
              }
            >
              {loading && index === 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : index === 0 ? (
                <Download className="h-4 w-4" />
              ) : (
                platformIcon(item)
              )}
              {index === 0
                ? t('hero.downloadPrimary', { name: t(`platform.${item}`) })
                : t('hero.downloadSecondary', { name: t(`platform.${item}`) })}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
