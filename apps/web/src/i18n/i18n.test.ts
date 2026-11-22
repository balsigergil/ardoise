// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { changeLanguage, createI18n, initialLanguage, LANGUAGE_STORAGE_KEY } from './i18n';

describe('initialLanguage', () => {
  it('prefers a valid stored choice', () => {
    expect(initialLanguage('fr', ['en-US'])).toBe('fr');
  });
  it('falls back to the browser languages, then English', () => {
    expect(initialLanguage(null, ['fr-CH', 'en'])).toBe('fr');
    expect(initialLanguage('de', ['de-DE'])).toBe('en');
  });
});

describe('createI18n', () => {
  it('translates synchronously and sets <html lang>', () => {
    const i18n = createI18n('fr');
    expect(i18n.t('sidebar.sections.private')).toBe('Privé');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('switches language, persists it and updates <html lang>', async () => {
    const i18n = createI18n('en');
    await changeLanguage(i18n, 'fr');
    expect(i18n.t('sidebar.footer.trash')).toBe('Corbeille');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
  });
});
