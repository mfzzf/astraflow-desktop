import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * 语言切换按钮：中 ⇄ 英。按钮上显示的是「目标语言」，
 * 当前中文时显示 EN（点击切到英文），当前英文时显示 中。
 */
export default function LanguageToggle({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const isEn = i18n.language === 'en'
  const next = isEn ? 'zh' : 'en'
  const label = isEn ? '中' : 'EN'

  return (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(next)}
      aria-label="切换语言 / Switch language"
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:text-black ${className ?? ''}`}
    >
      <Globe className="h-4 w-4" />
      {label}
    </button>
  )
}
