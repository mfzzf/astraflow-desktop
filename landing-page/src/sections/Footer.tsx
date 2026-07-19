import { PRIVACY_POLICY_URL } from '@/lib/links'
import { assetUrl } from '@/lib/assets'

const COLUMNS = [
  {
    title: '产品',
    links: [
      { label: 'AstraFlow', href: '#top' },
      { label: '开放平台', href: 'https://developer.ucloud.cn/spaces' },
      {
        label: '定价',
        href: 'https://astraflow.ucloud.cn/docs/modelverse/price',
      },
    ],
  },
  {
    title: '功能',
    links: [
      { label: 'AI 智能体', href: '#features' },
      { label: '技能编排', href: '#features' },
      { label: '自动化工作流', href: '#features' },
      { label: '代码环境', href: '#features' },
      { label: '本地文件', href: '#features' },
      { label: '深度研究', href: '#features' },
    ],
  },
  {
    title: '法律',
    links: [
      { label: '隐私政策', href: PRIVACY_POLICY_URL },
      { label: '加入我们', href: '#top' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-neutral-100 bg-white text-neutral-500">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <img
              src={assetUrl('logo/en-logo.png')}
              alt="AstraFlow"
              width="530"
              height="160"
              className="h-9 w-auto"
            />
            <p className="mt-6 text-2xl font-medium leading-snug tracking-tight text-neutral-900">
              让 AI 从回答问题，走向完成工作。
            </p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              模型、技能、自动化与本地文件，在一个桌面工作台协同运转。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-medium text-neutral-900">{col.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.href.startsWith('http') ? '_blank' : undefined}
                        rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                        className="text-sm text-neutral-500 transition-colors hover:text-neutral-900"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-neutral-200/80 pt-8 text-xs text-neutral-400 sm:flex-row">
          <p>© 2026 UCloud. 保留所有权利。</p>
          <a
            href="https://ucloud.cn"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-neutral-700"
          >
            官网 ucloud.cn
          </a>
        </div>
      </div>
    </footer>
  )
}
