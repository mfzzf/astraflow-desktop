import {
  Boxes,
  CalendarClock,
  FolderLock,
  Sparkles,
  SquareTerminal,
  Telescope,
} from 'lucide-react'

const CAPABILITIES = [
  {
    icon: Boxes,
    title: '多模型调用',
    desc: '接入 UCloud ModelVerse 与 OpenAI 兼容 API，会话间自由切换模型。',
  },
  {
    icon: Sparkles,
    title: '技能市场',
    desc: '开箱即用的技能库，一键装进你的工作流，无需重复搭建。',
  },
  {
    icon: CalendarClock,
    title: '自动化编排',
    desc: '定时报告、数据处理、文件整理，按计划自动执行，错过可补跑。',
  },
  {
    icon: SquareTerminal,
    title: '代码框沙箱',
    desc: '在隔离环境运行 Python / Node 脚本，结果直接沉淀到工作区。',
  },
  {
    icon: FolderLock,
    title: '本地文件',
    desc: '数据默认留在本机，读写需明确授权，随时可在设置中收回。',
  },
  {
    icon: Telescope,
    title: '深度研究',
    desc: '多源检索与交叉验证，产出可追溯、带引用的研究报告。',
  },
] as const

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-4xl leading-[1.05] tracking-headline text-black md:text-6xl">
          One studio, the <em className="italic text-[#6F6F6F]">entire flow.</em>
        </h2>
        <p className="mt-4 font-kai text-[#6F6F6F]">
          模型、技能、自动化与本地环境不再分散在各处，AstraFlow 把它们放进同一个工作台。
        </p>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <li
            key={item.title}
            className="group rounded-3xl border border-neutral-200 bg-white p-6 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_20px_40px_-24px_rgba(0,0,0,0.25)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-colors duration-200 group-hover:bg-black group-hover:text-white">
              <item.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 font-kai text-lg font-semibold text-neutral-900">{item.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#6F6F6F]">
              {item.desc}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
