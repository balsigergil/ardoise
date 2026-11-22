// SPDX-License-Identifier: AGPL-3.0-only
import en from './locales/en/common.json' with { type: 'json' };
import fr from './locales/fr/common.json' with { type: 'json' };
import type { Language } from './languages.js';

export type Messages = typeof en;

/** All UI strings, per language and namespace. `fr` must have the same keys as `en`. */
export const resources = {
  en: { common: en },
  fr: { common: fr satisfies Messages },
} as const satisfies Record<Language, { common: Messages }>;

export const defaultNamespace = 'common';

export { flattenKeys, lookup, placeholders } from './keys.js';
export { defaultLanguage, detectLanguage, isLanguage, supportedLanguages } from './languages.js';
export type { Language } from './languages.js';
