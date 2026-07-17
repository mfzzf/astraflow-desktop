import { Bot, Clock3, Code2, FolderKanban, Layers, MessageSquare, Plus, Puzzle, ArrowUp, Sparkles } from 'lucide-react'

const SIDEBAR_ITEMS = [
  { icon: Plus, label: '新任务' },
  { icon: Layers, label: '模型广场' },
  { icon: Puzzle, label: '技能市场' },
  { icon: Bot, label: '智能体' },
  { icon: Clock3, label: '自动化' },
  { icon: Code2, label: '代码框' },
]

const PROJECTS = ['整理桌面文档', '行业趋势调研']
const TASKS = ['报告素材归档', 'API 接口调试', 'Vibe Coding 入门']

export default function ProductPreview() {
  return (
    <section id="preview" className="mx-auto max-w-6xl px-6 pb-28 pt-4">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
          你的 AI 桌面工作台
        </h2>
        <p className="mt-4 text-base leading-relaxed text-neutral-500 md:text-lg">
          统一模型广场、技能市场、自动化编排与本地代码环境，让复杂工作流在桌面一键落地。
        </p>
      </div>

      {/* 客户端界面示意 */}
      <div className="mt-14 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_40px_80px_-30px_rgba(0,0,0,0.18)]">
        {/* 窗口标题栏 */}
        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/80 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs font-medium text-neutral-400">AstraFlow</span>
        </div>

        <div className="flex min-h-[380px]">
          {/* 侧边栏 */}
          <aside className="hidden w-56 shrink-0 flex-col border-r border-neutral-100 bg-neutral-50/60 p-3 sm:flex">
            <div className="mb-3 flex rounded-lg bg-neutral-200/50 p-0.5 text-xs font-medium">
              <span className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white py-1.5 text-neutral-900 shadow-sm">
                <Layers className="h-3.5 w-3.5" /> 工作
              </span>
              <span className="flex flex-1 items-center justify-center gap-1 py-1.5 text-neutral-500">
                <MessageSquare className="h-3.5 w-3.5" /> 对话
              </span>
            </div>

            <ul className="space-y-0.5">
              {SIDEBAR_ITEMS.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-neutral-600 hover:bg-neutral-100"
                >
                  <item.icon className="h-4 w-4 text-neutral-400" />
                  {item.label}
                </li>
              ))}
            </ul>

            <p className="mt-5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              项目
            </p>
            <ul className="mt-1 space-y-0.5">
              {PROJECTS.map((p) => (
                <li key={p} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-neutral-500">
                  <FolderKanban className="h-3.5 w-3.5 text-neutral-300" />
                  {p}
                </li>
              ))}
            </ul>

            <p className="mt-4 px-2.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              任务
            </p>
            <ul className="mt-1 space-y-0.5">
              {TASKS.map((t) => (
                <li key={t} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-neutral-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  {t}
                </li>
              ))}
            </ul>

            <div className="mt-auto flex items-center gap-2 rounded-lg px-2.5 py-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">
                A
              </span>
              <span className="text-[13px] text-neutral-600">AstraFlow</span>
            </div>
          </aside>

          {/* 主区域 */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <h3 className="text-xl font-semibold text-neutral-800 md:text-2xl">
                今天想构建什么工作流？
              </h3>
            </div>
            <p className="mt-2 text-xs text-neutral-400">Beta Preview</p>

            <div className="mt-8 w-full max-w-xl rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <p className="px-1 pb-6 text-left text-sm text-neutral-400">
                调用技能「行业研报助手」，搜索最新 AI 趋势报告，提取前 3 页关键信息，整理成 Excel 保存到 ~/Documents/AstraFlow
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100">
                    <Plus className="h-4 w-4" />
                  </button>
                  <span className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500">
                    Ask
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-600">
                    Agent
                  </span>
                  <span className="hidden rounded-full px-3 py-1 text-xs text-neutral-400 sm:inline">
                    Agent Swarm
                  </span>
                  <button className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
