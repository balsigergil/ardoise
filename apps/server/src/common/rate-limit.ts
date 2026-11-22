// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from '@ardoise/shared';
import type { Redis } from 'ioredis';

export interface CounterStore {
  /** Increments the counter for `key` and returns the new value; the window starts on first hit. */
  increment(key: string, windowMs: number): Promise<number>;
}

export interface RateRule {
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

/** Attempt budgets (ARCHITECTURE §13). Keys are hashed by callers when they contain emails. */
export const rateRules = {
  loginIp: { limit: 30, windowMs: 15 * MINUTE },
  loginEmail: { limit: 10, windowMs: 15 * MINUTE },
  resetIp: { limit: 10, windowMs: 15 * MINUTE },
  resetEmail: { limit: 3, windowMs: 15 * MINUTE },
  resetConfirmIp: { limit: 20, windowMs: 15 * MINUTE },
  setupIp: { limit: 10, windowMs: 15 * MINUTE },
  invitationIp: { limit: 30, windowMs: 15 * MINUTE },
  mailTest: { limit: 10, windowMs: 15 * MINUTE },
  publicLinkIp: { limit: 300, windowMs: 5 * MINUTE },
} satisfies Record<string, RateRule>;

export type RateBucket = keyof typeof rateRules;

export class RateLimiter {
  constructor(
    private readonly store: CounterStore,
    private readonly rules: Record<RateBucket, RateRule> = rateRules,
  ) {}

  /** Throws `rate_limited` once the budget for (bucket, subject) is spent. */
  async consume(bucket: RateBucket, subject: string): Promise<void> {
    const rule = this.rules[bucket];
    const count = await this.store.increment(`rl:${bucket}:${subject}`, rule.windowMs);
    if (count > rule.limit) throw new DomainError('rate_limited');
  }
}

export class ValkeyCounterStore implements CounterStore {
  constructor(private readonly valkey: Redis) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const results = await this.valkey.multi().incr(key).pexpire(key, windowMs, 'NX').exec();
    const value = results?.[0]?.[1];
    return typeof value === 'number' ? value : Number(value);
  }
}

export class MemoryCounterStore implements CounterStore {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  increment(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return Promise.resolve(1);
    }
    entry.count += 1;
    return Promise.resolve(entry.count);
  }
}
