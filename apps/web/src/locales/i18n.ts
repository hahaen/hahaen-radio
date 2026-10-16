import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  zh: {
    translation: {
      brand: '声屿',
      pageTitle: '声屿 HAEN · 嗯，听听世界。',
      category: '全球电台',
      tagline: '嗯，听听世界。',
      headline: '把世界，听近一点。',
      preparing: '电台目录正在准备中。',
      ready: '连接已就绪',
      connecting: '正在连接',
      unavailable: '暂时无法连接，请稍后重试。',
      retry: '重试',
      language: '界面语言',
      skip: '跳到主要内容',
    },
  },
  en: {
    translation: {
      brand: '声屿',
      pageTitle: 'HAEN · Listen to the world.',
      category: 'WORLD RADIO',
      tagline: 'Listen to the world.',
      headline: 'A wider world. A closer listen.',
      preparing: 'The station directory is being prepared.',
      ready: 'Connected',
      connecting: 'Connecting',
      unavailable: 'Unable to connect. Please try again.',
      retry: 'Retry',
      language: 'Interface language',
      skip: 'Skip to main content',
    },
  },
};

function initialLanguage() {
  try {
    const saved = localStorage.getItem('haen:language:v1');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* Storage is optional. */
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh';
}
export async function setLanguage(language: 'zh' | 'en') {
  await i18n.changeLanguage(language);
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = i18n.t('pageTitle');
  try {
    localStorage.setItem('haen:language:v1', language);
  } catch {
    /* Keep the in-memory language. */
  }
}
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language === 'en' ? 'en' : 'zh-CN';
document.title = i18n.t('pageTitle');
export default i18n;
