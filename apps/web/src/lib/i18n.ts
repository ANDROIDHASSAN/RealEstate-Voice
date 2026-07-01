import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
import es from './locales/es.json';
import ht from './locales/ht.json';
import pt from './locales/pt.json';

export const RTL_LOCALES = ['ar'];

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ar: { translation: ar },
    pt: { translation: pt },
    ht: { translation: ht },
  },
  lng: localStorage.getItem('cf-locale') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLocale(locale: string): void {
  void i18n.changeLanguage(locale);
  localStorage.setItem('cf-locale', locale);
  applyDirection(locale);
}

export function applyDirection(locale: string): void {
  const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', locale);
}

applyDirection(i18n.language);

export default i18n;
