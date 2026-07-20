import { assetUrl } from '@/lib/assets'

export default function ProductPreview() {
  return (
    <section id="preview" className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-28 pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-4xl tracking-headline text-black md:text-6xl">
          Your desk, <em className="italic text-[#6F6F6F]">reimagined.</em>
        </h2>
        <p className="mt-4 font-kai text-base leading-relaxed text-[#6F6F6F] md:text-lg">
          统一技能市场、自动化编排与本地代码环境，让复杂工作流在桌面一键落地。
        </p>
      </div>

      <div className="mt-14 rounded-[2rem] border border-neutral-200 bg-white p-3 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.28)] sm:rounded-[2.5rem] sm:p-6 md:p-10">
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.25)] ring-1 ring-black/5">
          {/* macOS 窗口栏：让截图呈现为悬浮的应用窗口 */}
          <div aria-hidden className="flex items-center gap-2 border-b border-neutral-100 bg-white px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
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
      </div>
    </section>
  )
}
