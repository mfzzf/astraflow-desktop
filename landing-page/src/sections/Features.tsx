import type { ComponentType } from 'react'
import { ArrowRight, Bot, Clock, Cpu, FolderOpen } from 'lucide-react'

/* ---------- 插图 1：统一模型广场 ---------- */
function ModelSquareVisual() {
  const models = [
    { name: 'GPT-4o', tag: 'OpenAI' },
    { name: 'Claude 3.7', tag: 'Anthropic' },
    { name: 'DeepSeek-V3', tag: 'DeepSeek' },
    { name: 'Qwen3', tag: 'Alibaba' },
  ]
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-100 via-violet-50 to-sky-100 p-8">
      <div className="w-full max-w-sm rounded-xl bg-white/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-indigo-600" />
          <p className="text-sm font-semibold text-neutral-800">模型广场</p>
        </div>
        <div className="mt-4 space-y-2.5">
          {models.map((m) => (
            <div
              key={m.name}
              className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2.5"
            >
              <span className="text-sm font-medium text-neutral-700">{m.name}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                {m.tag}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
          <span className="text-[11px] text-indigo-700">OpenAI 兼容 · 一键切换模型</span>
        </div>
      </div>
      <span className="absolute -bottom-8 -right-8 h-40 w-40 rounded-full bg-white/10" />
      <span className="absolute -left-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
    </div>
  )
}

/* ---------- 插图 2：技能市场与智能体 ---------- */
function SkillsVisual() {
  const skills = [
    { name: '研报助手', color: 'bg-emerald-500' },
    { name: '代码审查', color: 'bg-blue-500' },
    { name: 'PPT 生成', color: 'bg-orange-500' },
  ]
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-100 p-8">
      <div className="w-full max-w-sm rounded-xl bg-white/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold text-neutral-800">技能市场</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {skills.map((s) => (
            <div key={s.name} className="rounded-xl bg-neutral-50 p-3 text-center">
              <span className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold text-white ${s.color}`}>
                {s.name.slice(0, 1)}
              </span>
              <p className="mt-2 text-[11px] font-medium text-neutral-700">{s.name}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
          <p className="text-[11px] text-emerald-700">
            多智能体协同：自动拆解任务并调度最合适的技能
          </p>
        </div>
      </div>
      <span className="absolute -bottom-10 -left-10 h-44 w-44 rounded-full bg-white/10" />
    </div>
  )
}

/* ---------- 插图 3：自动化工作流 ---------- */
function AutomationVisual() {
  const steps = ['触发器', '调用技能', '生成报告', '发送通知']
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 p-8">
      <div className="w-full max-w-md rounded-xl bg-white/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600" />
          <p className="text-sm font-semibold text-neutral-800">自动化编排</p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-medium text-amber-700">
                {step}
              </span>
              {i < steps.length - 1 && (
                <ArrowRight className="h-3 w-3 text-neutral-300" />
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
            <span className="text-xs text-neutral-600">每日 09:00 行业简报</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              运行中
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
            <span className="text-xs text-neutral-600">每周一数据汇总</span>
            <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
              已暂停
            </span>
          </div>
        </div>
      </div>
      <span className="absolute -bottom-8 -right-8 h-40 w-40 rounded-full bg-white/10" />
      <span className="absolute -left-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
    </div>
  )
}

/* ---------- 插图 4：本地代码与文件 ---------- */
function LocalWorkspaceVisual() {
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-slate-200 via-sky-50 to-blue-100 p-8">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2.5">
          <FolderOpen className="h-3.5 w-3.5 text-neutral-400" />
          <span className="text-[11px] text-neutral-500">~/AstraFlow/workspace</span>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs text-neutral-600">scripts/analyze.py</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs text-neutral-600">reports/weekly.md</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-neutral-600">output/summary.xlsx</span>
          </div>
          <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
            <p className="text-[11px] text-sky-700">
              代码框已就绪：在隔离沙箱中运行 Python / Node 脚本
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- 特性区 ---------- */
interface Feature {
  title: string
  desc: string
  visual: ComponentType
  reverse?: boolean
}

const FEATURES: Feature[] = [
  {
    title: '统一模型广场，想用谁就用谁',
    desc: 'AstraFlow 接入 UCloud ModelVerse、OpenAI 兼容 API 及多种主流大模型。不同任务切换不同模型，无需在多个客户端之间来回跳转，一个桌面工作台统管全部对话与调用。',
    visual: ModelSquareVisual,
  },
  {
    title: '技能市场 + 多智能体协同',
    desc: '从技能市场安装即用型能力，或编排自定义技能。复杂任务自动拆分给多个专业智能体并行处理，调研、写作、制表、审代码各取所长。',
    visual: SkillsVisual,
    reverse: true,
  },
  {
    title: '自动化工作流，一次配置长期运行',
    desc: '内置 Cron 触发器与可视化编排，让报告生成、数据抓取、文件整理等任务按计划自动执行。客户端在线时即可后台运行，醒来就能看到成果。',
    visual: AutomationVisual,
  },
  {
    title: '本地代码框与文件工作区',
    desc: '在桌面直接挂载本地文件夹，配合隔离沙箱运行 Python / Node 脚本。输入、输出、代码与报告都沉淀在你的工作区，数据不上云，安全可控。',
    visual: LocalWorkspaceVisual,
    reverse: true,
  },
]

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl space-y-24 px-6 pb-28">
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className={`flex flex-col items-center gap-10 md:gap-14 ${
            f.reverse ? 'md:flex-row-reverse' : 'md:flex-row'
          }`}
        >
          <div className="w-full md:w-[46%]">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900 md:text-3xl">
              {f.title}
            </h3>
            <p className="mt-4 leading-relaxed text-neutral-500">{f.desc}</p>
          </div>
          <div className="w-full md:w-[54%]">
            <f.visual />
          </div>
        </div>
      ))}
    </section>
  )
}
