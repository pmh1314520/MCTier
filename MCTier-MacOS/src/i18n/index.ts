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

export type AppLanguage = 'zh' | 'en';
export type LanguagePreference = 'system' | AppLanguage;

function detectSystemLanguage(): AppLanguage {
  const sys = (navigator.language || 'zh').toLowerCase();
  return sys.startsWith('zh') ? 'zh' : 'en';
}

function readStoredPreference(): LanguagePreference {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'zh' || saved === 'en' || saved === 'system' ? saved : 'system';
}

export function resolveLanguagePreference(preference: LanguagePreference): AppLanguage {
  return preference === 'system' ? detectSystemLanguage() : preference;
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: resolveLanguagePreference(readStoredPreference()),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

/** 仅在本窗口应用语言（不广播事件），供覆盖窗口收到同步事件时调用 */
export function applyLanguageLocal(lang: 'zh' | 'en'): void {
  void i18n.changeLanguage(lang);
}

export function setLanguage(lang: 'zh' | 'en'): void {
  setLanguagePreference(lang);
}

export function setLanguagePreference(preference: LanguagePreference): void {
  localStorage.setItem(LANG_KEY, preference);
  const lang = resolveLanguagePreference(preference);
  applyLanguageLocal(lang);
  // 通知其它窗口（弹幕/HUD 等独立窗口）同步语言
  void import('@tauri-apps/api/event').then(({ emit }) => { void emit('mctier-lang-changed', lang); }).catch(() => {});
}

export function getLanguagePreference(): LanguagePreference {
  return readStoredPreference();
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
