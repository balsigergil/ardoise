// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MemoryCounterStore, RateLimiter, rateRules } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows the budget, then rejects until the window resets', async () => {
    let now = 0;
    const limiter = new RateLimiter(new MemoryCounterStore(() => now), {
      ...rateRules,
      loginIp: { limit: 2, windowMs: 1000 },
    });
    await limiter.consume('loginIp', '1.2.3.4');
    await limiter.consume('loginIp', '1.2.3.4');
    await expect(limiter.consume('loginIp', '1.2.3.4')).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await limiter.consume('loginIp', '5.6.7.8');
    now = 1000;
    await expect(limiter.consume('loginIp', '1.2.3.4')).resolves.toBeUndefined();
  });

  it('defines a budget for every sensitive endpoint (ARCHITECTURE §13)', () => {
    for (const bucket of [
      'loginIp',
      'loginEmail',
      'resetIp',
      'resetEmail',
      'setupIp',
      'invitationIp',
    ] as const)
      expect(rateRules[bucket].limit).toBeGreaterThan(0);
  });
});
