import { assetUrl } from '@/lib/assets'

export default function ProductPreview() {
  return (
    <section id="preview" className="mx-auto max-w-6xl px-6 pb-28 pt-4">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
          你的 AI 桌面工作台
        </h2>
        <p className="mt-4 text-base leading-relaxed text-neutral-500 md:text-lg">
          统一技能市场、自动化编排与本地代码环境，让复杂工作流在桌面一键落地。
        </p>
      </div>

      <div className="mt-14 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_40px_80px_-30px_rgba(0,0,0,0.18)]">
        <picture className="block aspect-video overflow-hidden">
          <source srcSet={assetUrl('screenshots/studio.webp')} type="image/webp" />
          <source srcSet={assetUrl('screenshots/studio.avif')} type="image/avif" />
          <img
            src={assetUrl('screenshots/studio.png')}
            alt="AstraFlow 桌面端正在完成 AI 行业趋势调研，并生成报告和数据表格"
            className="block h-full w-full origin-[100%_0%] scale-150 object-cover"
            width={3840}
            height={2160}
            decoding="async"
            fetchPriority="high"
          />
        </picture>
      </div>
    </section>
  )
}
