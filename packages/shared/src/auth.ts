// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Trims and lowercases an email address: emails are stored normalized (ADR 0005). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .max(320)
  .pipe(z.email())
  .transform((value) => normalizeEmail(value));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'too_short')
  .max(PASSWORD_MAX_LENGTH, 'too_long');

export const nameSchema = z.string().trim().min(1).max(100);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const sessionPolicy = {
  /** Absolute lifetime from creation. */
  absoluteMs: 90 * DAY,
  /** A session unused for this long is no longer valid. */
  idleMs: 30 * DAY,
  /** `last_seen_at` is written at most this often. */
  touchIntervalMs: 5 * MINUTE,
} as const;

export const RESET_TOKEN_TTL_MS = 60 * MINUTE;

export interface SessionTimes {
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type SessionState = 'active' | 'revoked' | 'expired' | 'idle';

export function sessionState(session: SessionTimes, now: Date): SessionState {
  if (session.revokedAt) return 'revoked';
  if (now.getTime() >= session.expiresAt.getTime()) return 'expired';
  if (now.getTime() - session.lastSeenAt.getTime() >= sessionPolicy.idleMs) return 'idle';
  return 'active';
}

/** Whether a request at `now` should refresh `last_seen_at`. */
export function shouldTouchSession(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= sessionPolicy.touchIntervalMs;
}

export function sessionExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + sessionPolicy.absoluteMs);
}

/** Single-use token (reset link) validity. */
export function isOneTimeTokenUsable(
  token: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): boolean {
  return token.usedAt === null && now.getTime() < token.expiresAt.getTime();
}
