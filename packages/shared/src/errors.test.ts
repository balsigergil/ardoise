// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DomainError, errorCodes, httpStatusFor, isErrorCode } from './errors.js';

describe('error codes', () => {
  it('are unique snake_case identifiers', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
    for (const code of errorCodes) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
  it('map to client or server HTTP statuses', () => {
    for (const code of errorCodes) {
      const status = httpStatusFor(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
    expect(httpStatusFor('unauthenticated')).toBe(401);
    expect(httpStatusFor('forbidden')).toBe(403);
    expect(httpStatusFor('last_owner')).toBe(409);
    expect(httpStatusFor('invitation_expired')).toBe(410);
    expect(httpStatusFor('rate_limited')).toBe(429);
  });
  it('recognizes codes', () => {
    expect(isErrorCode('forbidden')).toBe(true);
    expect(isErrorCode('nope')).toBe(false);
    expect(new DomainError('not_found').code).toBe('not_found');
  });
});
