import { useTranslation } from 'react-i18next'
import { PRIVACY_POLICY_URL } from '@/lib/links'
import { assetUrl } from '@/lib/assets'

const COLUMNS = [
  {
    titleKey: 'footer.colProduct',
    links: [
      { labelKey: 'footer.linkAstraflow', href: '#top' },
      { labelKey: 'footer.linkOpen', href: 'https://developer.ucloud.cn/spaces' },
      {
        labelKey: 'footer.linkPricing',
        href: 'https://astraflow.ucloud.cn/docs/modelverse/price',
      },
    ],
  },
  {
    titleKey: 'footer.colFeatures',
    links: [
      { labelKey: 'footer.linkAgent', href: '#features' },
      { labelKey: 'footer.linkSkills', href: '#features' },
      { labelKey: 'footer.linkAuto', href: '#features' },
      { labelKey: 'footer.linkCode', href: '#features' },
      { labelKey: 'footer.linkFiles', href: '#features' },
      { labelKey: 'footer.linkResearch', href: '#features' },
    ],
  },
  {
    titleKey: 'footer.colLegal',
    links: [
      { labelKey: 'footer.linkPrivacy', href: PRIVACY_POLICY_URL },
      { labelKey: 'footer.linkJoin', href: '#top' },
    ],
  },
]

export default function Footer() {
  const { t } = useTranslation()
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
            <p className="mt-6 font-kai text-2xl font-medium leading-snug tracking-tight text-neutral-900">
              {t('footer.tagline')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              {t('footer.desc')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.titleKey}>
                <p className="text-sm font-medium text-neutral-900">
                  {t(col.titleKey)}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.labelKey}>
                      <a
                        href={link.href}
                        target={link.href.startsWith('http') ? '_blank' : undefined}
                        rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                        className="text-sm text-[#6F6F6F] transition-colors hover:text-black"
                      >
                        {t(link.labelKey)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-neutral-200/80 pt-8 text-xs text-neutral-400 sm:flex-row">
          <p>{t('footer.copyright')}</p>
          <a
            href="https://ucloud.cn"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-neutral-700"
          >
            {t('footer.site')}
          </a>
        </div>
      </div>
    </footer>
  )
}
