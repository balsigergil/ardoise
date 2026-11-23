// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { findViolations, normalizePnpmLicenses } from './license-policy.mjs';

const policy = {
  allowed: ['MIT', 'Apache-2.0'],
  dataOnly: { licenses: ['CC-BY-4.0'], packages: ['caniuse-lite'] },
  exceptions: {
    'odd-pkg': { license: 'Custom', reason: 'reviewed: MIT text' },
    pinned: { license: 'UNLICENSED', versions: ['1.4.0'], reason: 'LICENSE file is MIT' },
  },
};

describe('findViolations', () => {
  it('accepts allowed licenses and reports others', () => {
    const result = findViolations(
      [
        { name: 'a', version: '1.0.0', license: 'MIT' },
        { name: 'b', version: '1.0.0', license: 'BUSL-1.1' },
      ],
      policy,
    );
    expect(result.map((p) => p.name)).toEqual(['b']);
  });

  it('accepts data-only licenses only for listed packages', () => {
    const result = findViolations(
      [
        { name: 'caniuse-lite', version: '1.0.0', license: 'CC-BY-4.0' },
        { name: 'some-lib', version: '1.0.0', license: 'CC-BY-4.0' },
      ],
      policy,
    );
    expect(result.map((p) => p.name)).toEqual(['some-lib']);
  });

  it('honours explicit exceptions only for the recorded license', () => {
    expect(findViolations([{ name: 'odd-pkg', version: '1', license: 'Custom' }], policy)).toEqual(
      [],
    );
    expect(
      findViolations([{ name: 'odd-pkg', version: '1', license: 'Other' }], policy),
    ).toHaveLength(1);
  });

  it('limits a versioned exception to the reviewed versions', () => {
    expect(
      findViolations([{ name: 'pinned', version: '1.4.0', license: 'UNLICENSED' }], policy),
    ).toEqual([]);
    expect(
      findViolations([{ name: 'pinned', version: '1.5.0', license: 'UNLICENSED' }], policy),
    ).toHaveLength(1);
  });

  it('reports packages without a license', () => {
    expect(findViolations([{ name: 'x', version: '1', license: 'Unknown' }], policy)).toHaveLength(
      1,
    );
  });
});

describe('normalizePnpmLicenses', () => {
  it('flattens license groups and versions', () => {
    const json = {
      MIT: [{ name: 'a', versions: ['1.0.0', '2.0.0'] }],
      'Apache-2.0': [{ name: 'b', version: '3.0.0', license: 'Apache-2.0' }],
    };
    expect(normalizePnpmLicenses(json)).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'a', version: '2.0.0', license: 'MIT' },
      { name: 'b', version: '3.0.0', license: 'Apache-2.0' },
    ]);
  });
});
