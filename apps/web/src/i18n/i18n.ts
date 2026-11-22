// SPDX-License-Identifier: AGPL-3.0-only
import {
  defaultLanguage,
  defaultNamespace,
  detectLanguage,
  isLanguage,
  resources,
  type Language,
} from '@ardoise/i18n';
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { safeStorage } from '@/lib/storage';

export const LANGUAGE_STORAGE_KEY = 'ardoise.language';

/** Stored choice first, then the browser languages (PRODUCT §19), then English. */
export function initialLanguage(
  stored: string | null,
  browserLanguages: readonly string[],
): Language {
  return isLanguage(stored) ? stored : detectLanguage(browserLanguages);
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: defaultLanguage,
    defaultNS: defaultNamespace,
    ns: [defaultNamespace],
    interpolation: { escapeValue: false }, // React escapes.
    initAsync: false,
    returnNull: false,
  });
  instance.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = language;
  return instance;
}

export function browserI18n(): i18n {
  return createI18n(
    initialLanguage(safeStorage.get(LANGUAGE_STORAGE_KEY), navigator.languages ?? []),
  );
}

export async function changeLanguage(instance: i18n, language: Language): Promise<void> {
  safeStorage.set(LANGUAGE_STORAGE_KEY, language);
  await instance.changeLanguage(language);
}
