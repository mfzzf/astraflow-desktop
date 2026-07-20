import { useTranslation } from 'react-i18next'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const FAQ_KEYS = ['1', '2', '3', '4'] as const

export default function Faq() {
  const { t } = useTranslation()
  return (
    <section id="faq" className="scroll-mt-24 border-t border-neutral-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24 md:flex-row md:gap-20">
        <div className="md:w-1/3">
          <h2 className="font-display text-4xl tracking-headline text-black">
            {t('faq.pre')}
            <em className="italic text-[#4F3CD8]">{t('faq.em')}</em>
          </h2>
          <p className="mt-3 font-kai text-sm leading-relaxed text-[#6F6F6F]">
            {t('faq.sub')}
          </p>
        </div>
        <div className="md:w-2/3">
          <Accordion type="single" collapsible defaultValue="item-0">
            {FAQ_KEYS.map((k, i) => (
              <AccordionItem key={k} value={`item-${i}`}>
                <AccordionTrigger className="text-left font-kai text-[15px] font-medium text-neutral-800">
                  {t(`faq.q${k}`)}
                </AccordionTrigger>
                <AccordionContent className="leading-relaxed text-[#6F6F6F]">
                  {t(`faq.a${k}`)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
