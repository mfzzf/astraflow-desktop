import type { ComponentType } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { assetUrl } from '@/lib/assets'

const MOBILE_CHANNELS = [
  {
    name: '微信',
    logo: assetUrl('channel-logos/wechat.png'),
    badge: null,
    description: '扫码登录，支持图片任务和生成视频回传。',
  },
  {
    name: '飞书',
    logo: assetUrl('channel-logos/feishu.png'),
    badge: 'CN',
    description: '扫码创建应用，支持图片和生成视频回传。',
  },
  {
    name: '企业微信',
    logo: assetUrl('channel-logos/wecom.png'),
    badge: null,
    description: '官方智能机器人，支持图片和生成视频回传。',
  },
  {
    name: '钉钉',
    logo: assetUrl('channel-logos/dingtalk.png'),
    badge: null,
    description: 'Stream 模式连接，支持图片和生成视频回传。',
  },
  {
    name: 'Lark',
    logo: assetUrl('channel-logos/lark.png'),
    badge: 'Global',
    description: '使用 Lark 扫码接入，支持文字、图片和生成视频回传。',
  },
] as const

function MobileChannelsVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[42rem] overflow-hidden rounded-3xl border border-neutral-200/80 bg-[#f5f6f8] p-3 shadow-[0_28px_65px_-36px_rgba(0,0,0,0.38)] sm:p-4">
      <div
        aria-hidden
        className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-blue-100/70 blur-3xl"
      />

      <div className="relative mb-3 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white/80 px-4 py-3.5 shadow-sm backdrop-blur">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <Plus className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-neutral-900">新建机器人</span>
        <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-blue-600">
          移动接入
        </span>
      </div>

      <div className="relative rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6">
        <h4 className="text-lg font-semibold tracking-tight text-neutral-900">
          选择消息渠道
        </h4>
        <p className="mt-1.5 text-xs leading-5 text-neutral-500 sm:text-sm">
          绑定常用聊天应用，配置凭据后即可连接当前工作区。
        </p>

        <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          {MOBILE_CHANNELS.map((channel) => (
            <li
              key={channel.name}
              className="group flex min-h-28 items-start gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
            >
              <img
                src={channel.logo}
                alt=""
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-xl object-contain"
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900">
                    {channel.name}
                  </span>
                  {channel.badge ? (
                    <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                      {channel.badge}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-neutral-500">
                  {channel.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

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

interface Feature {
  title: string
  desc: string
  visual: ComponentType
  reverse?: boolean
}

const FEATURES: Feature[] = [
  {
    title: '把 AstraFlow 装进常用聊天应用',
    desc: '连接微信、飞书与 Lark、企业微信或钉钉，把桌面端工作区绑定到熟悉的消息渠道。离开电脑也能发起文字、图片与媒体任务，处理结果直接回传到聊天窗口。',
    visual: MobileChannelsVisual,
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
      {FEATURES.map((feature) => (
        <div
          key={feature.title}
          className={`flex flex-col items-center gap-10 md:gap-14 ${
            feature.reverse ? 'md:flex-row-reverse' : 'md:flex-row'
          }`}
        >
          <div className="w-full md:w-[46%]">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900 md:text-3xl">
              {feature.title}
            </h3>
            <p className="mt-4 leading-relaxed text-neutral-500">{feature.desc}</p>
          </div>
          <div className="w-full md:w-[54%]">
            <feature.visual />
          </div>
        </div>
      ))}
    </section>
  )
}
