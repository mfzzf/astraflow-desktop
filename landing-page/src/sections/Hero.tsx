import { useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { AppleLogo, LinuxLogo, WindowsLogo } from '@/components/BrandIcons'
import HeroVideo from '@/components/HeroVideo'
import Snowfall from '@/components/Snowfall'
import { assetUrl } from '@/lib/assets'
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
    <section
      id="top"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white"
    >
      {/* z-0：视频背景层，定位在首屏下半部分 */}
      <div className="absolute inset-x-0 bottom-0 top-[42vh] z-0 md:top-[300px]">
        <HeroVideo
          src={assetUrl('videos/hero-loop.mp4')}
          poster={assetUrl('videos/hero-poster.jpg')}
        />
      </div>
      {/* z-[1]：上下白色渐变遮罩，保证标题与视频过渡自然、文字可读 */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-white via-transparent to-white" />
      {/* z-[2]：蓝紫粒子飘落层，呼应星轨主题 */}
      <div className="pointer-events-none absolute inset-0 z-[2]">
        <Snowfall
          count={1027}
          wind={0}
          windVariation={1.2}
          sizeMin={1}
          sizeMax={2}
          speedMin={0.6}
          speedMax={2.4}
          color="#5B73E2"
        />
      </div>

      {/* z-10：首屏内容 */}
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 pb-40 pt-32 text-center md:pt-40">
        <h1 className="animate-fade-rise font-display text-5xl font-normal leading-[0.95] tracking-headline text-black sm:text-7xl md:text-8xl">
          Beyond{' '}
          <em className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text italic text-transparent">
            answers
          </em>
          ,
          <br />
          toward{' '}
          <em className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text italic text-transparent">
            finished work.
          </em>
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-xl font-kai text-base leading-relaxed text-[#6F6F6F] sm:text-lg">
          让 AI 从回答问题，走向完成工作。为聪明的头脑打造一处完成深度工作的数字工作台。
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
              {index === 0 ? `下载 ${platformLabel(item)} 版` : `${platformLabel(item)} 版`}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
