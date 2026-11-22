// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { flattenKeys, lookup, placeholders, resources, supportedLanguages } from './index.js';

const reference = resources.en;

describe('i18n completeness', () => {
  for (const language of supportedLanguages) {
    for (const [namespace, messages] of Object.entries(resources[language])) {
      const ref = reference[namespace as keyof typeof reference];

      it(`${language}/${namespace} has exactly the same keys as en`, () => {
        expect(flattenKeys(messages)).toEqual(flattenKeys(ref));
      });

      it(`${language}/${namespace} has no empty strings`, () => {
        const empty = flattenKeys(messages).filter((k) => !lookup(messages, k)?.trim());
        expect(empty).toEqual([]);
      });

      it(`${language}/${namespace} uses the same placeholders as en`, () => {
        for (const key of flattenKeys(ref)) {
          expect(placeholders(lookup(messages, key) ?? ''), key).toEqual(
            placeholders(lookup(ref, key) ?? ''),
          );
        }
      });
    }
  }

  it('every language has the same namespaces', () => {
    for (const language of supportedLanguages) {
      expect(Object.keys(resources[language]).sort()).toEqual(Object.keys(reference).sort());
    }
  });
});
