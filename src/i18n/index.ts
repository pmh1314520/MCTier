/**
 * 多语言国际化（i18next + react-i18next）
 * - 默认跟随系统语言，匹配不到回退中文
 * - 用户选择持久化到 localStorage
 * - 缺失翻译自动回退默认语言（zh）
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './zh';
import { en } from './en';

const LANG_KEY = 'mctier_language';

function detectDefault(): 'zh' | 'en' {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  const sys = (navigator.language || 'zh').toLowerCase();
  return sys.startsWith('zh') ? 'zh' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detectDefault(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'zh' | 'en'): void {
  localStorage.setItem(LANG_KEY, lang);
  void i18n.changeLanguage(lang);
}

export function getLanguage(): 'zh' | 'en' {
  return (i18n.language === 'en' ? 'en' : 'zh');
}

/**
 * 轻量双语取词:直接传中/英文,按当前语言返回。
 * 用于尚未抽取为 key 的零散文案。组件需通过 useTranslation() 订阅以在切换语言时重渲染。
 */
export function tl(zh: string, en: string): string {
  return i18n.language === 'en' ? en : zh;
}

export default i18n;
