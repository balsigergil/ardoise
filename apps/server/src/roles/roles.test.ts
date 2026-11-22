// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { featuresForRole, roles } from './roles.js';

describe('featuresForRole', () => {
  it('runs everything in role=all', () => {
    expect(featuresForRole('all')).toEqual({ api: true, collab: true, worker: true });
  });

  it.each([
    ['api', 'api'],
    ['collab', 'collab'],
    ['worker', 'worker'],
  ] as const)('role=%s enables only %s', (role, feature) => {
    const features = featuresForRole(role);
    expect(
      Object.entries(features)
        .filter(([, on]) => on)
        .map(([name]) => name),
    ).toEqual([feature]);
  });

  it('covers every role', () => {
    for (const role of roles) expect(featuresForRole(role)).toBeDefined();
  });
});
