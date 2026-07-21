import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '@/lib/assets'

const CHANNELS = [
  { name: '微信', logo: assetUrl('channel-logos/wechat.png') },
  { name: '飞书', logo: assetUrl('channel-logos/feishu.png') },
  { name: 'Lark', logo: assetUrl('channel-logos/lark.png') },
  { name: '企业微信', logo: assetUrl('channel-logos/wecom.png') },
  { name: '钉钉', logo: assetUrl('channel-logos/dingtalk.png') },
]

const MODELS = [
  { name: 'DeepSeek', logo: assetUrl('model-logos/deepseek.svg') },
  { name: '通义千问', logo: assetUrl('model-logos/qwen.svg') },
  { name: 'Kimi', logo: assetUrl('model-logos/kimi.svg') },
  { name: '智谱 GLM', logo: assetUrl('model-logos/zhipu.svg') },
  { name: 'MiniMax', logo: assetUrl('model-logos/minimax.svg') },
  { name: '豆包', logo: assetUrl('model-logos/doubao.svg') },
  { name: '混元', logo: assetUrl('model-logos/hunyuan.svg') },
  { name: '文心一言', logo: assetUrl('model-logos/wenxin.svg') },
  { name: '讯飞星火', logo: assetUrl('model-logos/spark.svg') },
]

/** 每半条轨道内重复的份数：保证半条轨道宽于常见最宽视口，循环时不露空档 */
const REPEAT = 3

interface MarqueeHalfProps {
  clone?: boolean
  children: ReactNode
}

function MarqueeHalf({ clone, children }: MarqueeHalfProps) {
  return (
    <div aria-hidden={clone || undefined} className="flex items-center">
      {Array.from({ length: REPEAT }, (_, i) => (
        <div
          key={i}
          aria-hidden={!clone && i > 0 ? true : undefined}
          className="flex items-center"
        >
          {children}
        </div>
      ))}
    </div>
  )
}

/**
 * 生态跑马灯：上行为消息渠道 logo，下行为大模型 logo 反向滚动。
 * 轨道由两份完全相同的半条组成，配合 translateX(-50%) 无缝循环；
 * 第二份及各半条内的重复内容均对读屏隐藏。
 */
export default function TrustMarquee() {
  const { t } = useTranslation()
  const channelItems = CHANNELS.map((channel) => (
    <div key={channel.name} className="flex items-center gap-3 pr-14">
      <img
        src={channel.logo}
        alt=""
        aria-hidden
        className="h-8 w-8 rounded-lg object-contain"
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
      />
      <span className="whitespace-nowrap text-sm font-medium text-neutral-500">
        {channel.name}
      </span>
    </div>
  ))

  const modelItems = MODELS.map((model) => (
    <div key={model.name} className="pr-4">
      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white py-1.5 pl-2.5 pr-4 text-sm text-neutral-500">
        <img
          src={model.logo}
          alt=""
          aria-hidden
          className="h-5 w-5 object-contain"
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
        />
        {model.name}
      </span>
    </div>
  ))

  return (
    <section aria-label="支持的渠道与模型" className="py-24">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="font-display text-3xl tracking-headline text-black sm:text-4xl">
          {t('marquee.pre')}
          <em className="italic text-[#4F3CD8]">{t('marquee.em')}</em>
        </h2>
        <p className="mt-3 font-kai text-sm font-medium tracking-wide text-[#6F6F6F]">
          {t('marquee.sub')}
        </p>
      </div>

      <div
        className="marquee mt-8 overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 12%, black 88%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 12%, black 88%, transparent)',
        }}
      >
        <div className="marquee-track flex w-max items-center">
          <MarqueeHalf>{channelItems}</MarqueeHalf>
          <MarqueeHalf clone>{channelItems}</MarqueeHalf>
        </div>

        <div className="marquee-track-reverse mt-6 flex w-max items-center">
          <MarqueeHalf>{modelItems}</MarqueeHalf>
          <MarqueeHalf clone>{modelItems}</MarqueeHalf>
        </div>
      </div>
    </section>
  )
}
