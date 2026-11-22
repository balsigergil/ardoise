// SPDX-License-Identifier: AGPL-3.0-only
export const supportedLanguages = ['en', 'fr'] as const;
export type Language = (typeof supportedLanguages)[number];
export const defaultLanguage: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (supportedLanguages as readonly string[]).includes(value);
}

/**
 * Picks the first supported language from candidates such as `navigator.languages`
 * (`fr-CH` → `fr`). Falls back to the default language.
 */
export function detectLanguage(candidates: readonly (string | null | undefined)[]): Language {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = candidate.trim().toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return defaultLanguage;
}
