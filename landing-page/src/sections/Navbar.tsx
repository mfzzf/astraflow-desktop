import { useEffect, useState } from 'react'
import { Download, Menu, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '@/lib/assets'
import LanguageToggle from '@/components/LanguageToggle'

const NAV_LINKS = [
  { key: 'nav.product', href: '#preview' },
  { key: 'nav.features', href: '#features' },
  { key: 'nav.download', href: '#download' },
  { key: 'nav.faq', href: '#faq' },
]

export default function Navbar() {
  const { t } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/80 shadow-[0_1px_0_rgba(0,0,0,0.06)] backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" aria-label="AstraFlow" className="shrink-0">
          <img
            src={assetUrl('logo/en-logo.png')}
            alt="AstraFlow"
            width="530"
            height="160"
            className="h-8 w-auto"
          />
        </a>

        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.key}>
              <a
                href={link.href}
                className="text-sm font-medium text-[#6F6F6F] transition-colors hover:text-black"
              >
                {t(link.key)}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 md:gap-3">
          <LanguageToggle />
          <a
            href="#download"
            className="hidden items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 md:inline-flex"
          >
            <Download className="h-4 w-4" />
            {t('nav.cta')}
          </a>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-neutral-100 bg-white/95 backdrop-blur-xl md:hidden">
          <ul className="space-y-1 px-6 py-4">
            {NAV_LINKS.map((link) => (
              <li key={link.key}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  {t(link.key)}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#download"
                onClick={() => setOpen(false)}
                className="mt-2 flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white"
              >
                <Download className="h-4 w-4" />
                {t('nav.cta')}
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  )
}
