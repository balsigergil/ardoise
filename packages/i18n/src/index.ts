// SPDX-License-Identifier: AGPL-3.0-only
import en from './locales/en/common.json' with { type: 'json' };
import enEmail from './locales/en/email.json' with { type: 'json' };
import fr from './locales/fr/common.json' with { type: 'json' };
import frEmail from './locales/fr/email.json' with { type: 'json' };
import type { Language } from './languages.js';

export type Messages = typeof en;
export type EmailMessages = typeof enEmail;

/** All UI strings, per language and namespace. `fr` must have the same keys as `en`. */
export const resources = {
  en: { common: en, email: enEmail },
  fr: { common: fr satisfies Messages, email: frEmail satisfies EmailMessages },
} as const satisfies Record<Language, { common: Messages; email: EmailMessages }>;

export const defaultNamespace = 'common';

export { flattenKeys, interpolate, lookup, placeholders } from './keys.js';
export { defaultLanguage, detectLanguage, isLanguage, supportedLanguages } from './languages.js';
export type { Language } from './languages.js';
