import { Github, Globe, MessageCircle, Twitter } from 'lucide-react'

const COLUMNS = [
  {
    title: '产品',
    links: ['AstraFlow', '模型广场', '技能市场', '开放平台', '定价'],
  },
  {
    title: '功能',
    links: ['AI 智能体', '技能编排', '自动化工作流', '代码环境', '本地文件', '深度研究'],
  },
  {
    title: '资源',
    links: ['帮助中心', '研究博客', '开发者文档', '更新日志'],
  },
  {
    title: '法律',
    links: ['用户协议', '隐私政策', '加入我们'],
  },
]

const SOCIALS = [
  { icon: Twitter, label: 'X' },
  { icon: MessageCircle, label: 'Discord' },
  { icon: Github, label: 'GitHub' },
  { icon: Globe, label: '官网' },
]

export default function Footer() {
  return (
    <footer className="bg-[#0a0a0b] text-neutral-400">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div>
            <p className="text-2xl font-black tracking-[0.12em] text-white">AstraFlow</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-500">
              AstraFlow —— AI 桌面工作台，让模型、技能与自动化融为一体。
            </p>
            <div className="mt-6 flex gap-3">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href="#top"
                  aria-label={s.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800/80 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white"
                >
                  <s.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-medium text-white">{col.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a href="#top" className="text-sm text-neutral-500 transition-colors hover:text-white">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-neutral-800/80 pt-8 text-xs text-neutral-600 sm:flex-row">
          <p>© 2026 AstraFlow. 保留所有权利。</p>
          <p>AstraFlow 客户端下载页</p>
        </div>
      </div>
    </footer>
  )
}
