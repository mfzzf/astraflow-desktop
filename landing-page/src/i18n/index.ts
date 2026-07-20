import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

const stored =
  typeof window !== 'undefined'
    ? window.localStorage.getItem('astraflow-lang')
    : null
const lng = stored === 'en' || stored === 'zh' ? stored : 'zh'

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng,
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

function applyLang(l: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN'
  }
}

applyLang(lng)
i18n.on('languageChanged', (l) => {
  applyLang(l)
  try {
    window.localStorage.setItem('astraflow-lang', l)
  } catch {
    /* ignore storage errors */
  }
})

export default i18n
