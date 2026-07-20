import { useTranslation } from 'react-i18next'
import {
  Boxes,
  CalendarClock,
  FolderLock,
  Sparkles,
  SquareTerminal,
  Telescope,
} from 'lucide-react'

const CAPABILITIES = [
  { icon: Boxes, key: 'cap1' },
  { icon: Sparkles, key: 'cap2' },
  { icon: CalendarClock, key: 'cap3' },
  { icon: SquareTerminal, key: 'cap4' },
  { icon: FolderLock, key: 'cap5' },
  { icon: Telescope, key: 'cap6' },
] as const

export default function Features() {
  const { t } = useTranslation()
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-4xl leading-[1.05] tracking-headline text-black md:text-6xl">
          {t('features.pre')}
          <em className="italic text-[#4F3CD8]">{t('features.em')}</em>
        </h2>
        <p className="mt-4 font-kai text-[#6F6F6F]">{t('features.sub')}</p>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <li
            key={item.key}
            className="group rounded-3xl border border-neutral-200 bg-white p-6 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_20px_40px_-24px_rgba(0,0,0,0.25)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-colors duration-200 group-hover:bg-black group-hover:text-white">
              <item.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 font-kai text-lg font-semibold text-neutral-900">
              {t(`features.${item.key}t`)}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#6F6F6F]">
              {t(`features.${item.key}d`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
