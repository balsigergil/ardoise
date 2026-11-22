// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { detectLanguage, isLanguage } from './languages.js';

describe('detectLanguage', () => {
  it.each([
    [['fr-CH', 'en'], 'fr'],
    [['de-DE', 'en-US'], 'en'],
    [['FR'], 'fr'],
    [['pt_BR', 'fr_FR'], 'fr'],
    [['de', 'it'], 'en'],
    [[], 'en'],
    [[null, undefined, ''], 'en'],
  ])('%j → %s', (candidates, expected) => {
    expect(detectLanguage(candidates)).toBe(expected);
  });
});

describe('isLanguage', () => {
  it('accepts only supported languages', () => {
    expect(isLanguage('fr')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage(1)).toBe(false);
  });
});
