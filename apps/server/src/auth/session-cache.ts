// SPDX-License-Identifier: AGPL-3.0-only
import type { Redis } from 'ioredis';
import type { SessionRecord, UserRecord } from '../store/store.js';

export interface CachedSession {
  session: SessionRecord;
  user: UserRecord;
}

/** Hot session lookup (ARCHITECTURE §4.1). Entries are short-lived and evicted on change. */
export interface SessionCache {
  get(tokenHash: string): Promise<CachedSession | undefined>;
  set(tokenHash: string, value: CachedSession): Promise<void>;
  delete(tokenHashes: string[]): Promise<void>;
}

const DATE_FIELDS = ['createdAt', 'lastSeenAt', 'expiresAt', 'revokedAt', 'disabledAt'] as const;

function revive<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const field of DATE_FIELDS)
    if (typeof copy[field] === 'string') copy[field] = new Date(copy[field]);
  return copy as T;
}

export function encodeCachedSession(value: CachedSession): string {
  return JSON.stringify(value);
}

export function decodeCachedSession(raw: string): CachedSession | undefined {
  try {
    const parsed = JSON.parse(raw) as CachedSession;
    if (!parsed.session?.id || !parsed.user?.id) return undefined;
    return { session: revive(parsed.session), user: revive(parsed.user) };
  } catch {
    return undefined;
  }
}

export class ValkeySessionCache implements SessionCache {
  constructor(
    private readonly valkey: Redis,
    private readonly ttlSeconds = 60,
  ) {}

  private key(tokenHash: string) {
    return `session:${tokenHash}`;
  }

  async get(tokenHash: string) {
    const raw = await this.valkey.get(this.key(tokenHash));
    return raw ? decodeCachedSession(raw) : undefined;
  }

  async set(tokenHash: string, value: CachedSession) {
    await this.valkey.set(this.key(tokenHash), encodeCachedSession(value), 'EX', this.ttlSeconds);
  }

  async delete(tokenHashes: string[]) {
    if (tokenHashes.length > 0) await this.valkey.del(...tokenHashes.map((h) => this.key(h)));
  }
}

export class MemorySessionCache implements SessionCache {
  readonly entries = new Map<string, string>();
  get(tokenHash: string) {
    const raw = this.entries.get(tokenHash);
    return Promise.resolve(raw ? decodeCachedSession(raw) : undefined);
  }
  set(tokenHash: string, value: CachedSession) {
    this.entries.set(tokenHash, encodeCachedSession(value));
    return Promise.resolve();
  }
  delete(tokenHashes: string[]) {
    for (const h of tokenHashes) this.entries.delete(h);
    return Promise.resolve();
  }
}
