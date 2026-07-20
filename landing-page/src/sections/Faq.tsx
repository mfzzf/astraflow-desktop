import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const FAQS = [
  {
    q: 'AstraFlow 客户端与网页版有什么区别？',
    a: '网页版适合快速对话，而 AstraFlow 客户端是为复杂 AI 工作流打造的桌面工作台：它支持多模型调用、技能市场、自动化编排、代码框与本地文件管理，能把多模型、多技能组合成可长期运行的系统级工作流。',
  },
  {
    q: '访问本地文件时，AstraFlow 如何保护我的隐私？',
    a: '所有文件读写都需要你明确授权，且仅在你指定的工作目录内进行。本地数据默认保留在你的设备上，未经你的许可不会上传，你可以随时在设置中查看和收回授权。',
  },
  {
    q: 'AstraFlow 支持哪些模型提供商？',
    a: 'AstraFlow 可接入 UCloud ModelVerse、OpenAI 兼容 API 及多种主流大模型。你可以在不同会话中自由切换模型，也可以使用统一接口调用 skills 与 automations。',
  },
  {
    q: '自动化任务能做什么？电脑休眠时还会运行吗？',
    a: '可以让 AstraFlow 定时生成报告、处理数据、整理文件、调用技能等。只要客户端保持运行（电脑未关机），即使锁屏也会按计划执行；深度休眠或关机时错过的任务，将在下次启动后提示你补跑。',
  },
]

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-neutral-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24 md:flex-row md:gap-20">
        <div className="md:w-1/3">
          <h2 className="font-display text-4xl tracking-headline text-black">
            Questions, <em className="italic text-[#6F6F6F]">answered.</em>
          </h2>
          <p className="mt-3 font-kai text-sm leading-relaxed text-[#6F6F6F]">
            关于下载、安装与使用的疑问，都可以在这里找到答案。
          </p>
        </div>
        <div className="md:w-2/3">
          <Accordion type="single" collapsible defaultValue="item-0">
            {FAQS.map((item, i) => (
              <AccordionItem key={item.q} value={`item-${i}`}>
                <AccordionTrigger className="text-left font-kai text-[15px] font-medium text-neutral-800">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="leading-relaxed text-[#6F6F6F]">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
