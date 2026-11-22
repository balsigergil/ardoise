// SPDX-License-Identifier: AGPL-3.0-only
import { isLanguage, type Language } from '@ardoise/i18n';
import {
  DomainError,
  isOneTimeTokenUsable,
  newId,
  RESET_TOKEN_TTL_MS,
  sessionExpiry,
  sessionState,
  shouldTouchSession,
  type MeDto,
  type SessionListItemDto,
  type UpdateMeInput,
} from '@ardoise/shared';
import type { Clock } from '../common/clock.js';
import { hashToken, randomToken } from '../common/crypto.js';
import type { MailService } from '../mail/mail.service.js';
import type { SessionRecord, Store, UserRecord } from '../store/store.js';
import type { PasswordHasher } from './password-hasher.js';
import type { SessionCache } from './session-cache.js';

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface AuthContext {
  session: SessionRecord;
  user: UserRecord;
}

export interface IssuedSession {
  token: string;
  session: SessionRecord;
  user: UserRecord;
}

/** Bounded: a user rarely has more than a handful of sessions. */
export const MAX_LISTED_SESSIONS = 200;

export function toMe(user: UserRecord): MeDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    theme: user.theme,
    isSuperAdmin: user.isSuperAdmin,
  };
}

/** `auth` module (ARCHITECTURE §3): passwords, sessions, password reset. */
export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly store: Store,
    private readonly hasher: PasswordHasher,
    private readonly cache: SessionCache,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly publicUrl: string,
  ) {}

  /** Verifies against a throwaway hash so unknown emails take as long as known ones. */
  private async burnVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hasher.hash(randomToken());
    await this.hasher.verify(await this.dummyHash, password);
  }

  async createSession(
    user: UserRecord,
    meta: RequestMeta,
    store: Store = this.store,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = randomToken();
    const session: SessionRecord = {
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: sessionExpiry(now),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip,
      revokedAt: null,
    };
    await store.sessions.insert(session);
    return { token, session, user };
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.store.users.findByEmail(email);
    if (!user) {
      await this.burnVerify(password);
      throw new DomainError('invalid_credentials');
    }
    if (!(await this.hasher.verify(user.passwordHash, password)))
      throw new DomainError('invalid_credentials');
    if (user.disabledAt) throw new DomainError('account_disabled');
    return this.createSession(user, meta);
  }

  /** Resolves a session token, or undefined when it is unknown, revoked, expired or idle. */
  async authenticate(token: string): Promise<AuthContext | undefined> {
    const now = this.clock.now();
    const tokenHash = hashToken(token);
    let entry = await this.cache.get(tokenHash);
    if (!entry) {
      const session = await this.store.sessions.findByTokenHash(tokenHash);
      if (!session) return undefined;
      const user = await this.store.users.findById(session.userId);
      if (!user) return undefined;
      entry = { session, user };
    }
    const { session, user } = entry;
    if (sessionState(session, now) !== 'active' || user.disabledAt) {
      await this.cache.delete([tokenHash]);
      return undefined;
    }
    if (shouldTouchSession(session.lastSeenAt, now)) {
      await this.store.sessions.touch(session.id, now);
      session.lastSeenAt = now;
    }
    await this.cache.set(tokenHash, { session, user });
    return { session, user };
  }

  async logout(sessionId: string): Promise<void> {
    await this.revokeSessions([sessionId]);
  }

  private async revokeSessions(ids: string[], store: Store = this.store): Promise<void> {
    const hashes = await store.sessions.revoke(ids, this.clock.now());
    await this.cache.delete(hashes);
  }

  /** Drops cached entries of a user's sessions after a change to the user. */
  async evictUser(userId: string, store: Store = this.store): Promise<void> {
    const live = await store.sessions.listLive(userId, this.clock.now(), MAX_LISTED_SESSIONS);
    await this.cache.delete(live.map((s) => s.tokenHash));
  }

  async revokeAllSessions(
    userId: string,
    exceptSessionId?: string,
    store: Store = this.store,
  ): Promise<void> {
    const live = await store.sessions.listLive(userId, this.clock.now(), MAX_LISTED_SESSIONS);
    await this.revokeSessions(
      live.filter((s) => s.id !== exceptSessionId).map((s) => s.id),
      store,
    );
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionListItemDto[]> {
    const now = this.clock.now();
    const live = await this.store.sessions.listLive(userId, now, MAX_LISTED_SESSIONS);
    return live
      .filter((s) => sessionState(s, now) === 'active')
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        userAgent: s.userAgent,
        ip: s.ip,
        current: s.id === currentSessionId,
      }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.store.sessions.findById(sessionId);
    if (!session || session.userId !== userId) throw new DomainError('not_found');
    await this.revokeSessions([sessionId]);
  }

  async updateProfile(userId: string, input: UpdateMeInput): Promise<UserRecord> {
    await this.store.users.update(userId, input);
    await this.evictUser(userId);
    const user = await this.store.users.findById(userId);
    if (!user) throw new DomainError('not_found');
    return user;
  }

  /** Changing the password signs out every other session. */
  async changePassword(
    ctx: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!(await this.hasher.verify(ctx.user.passwordHash, currentPassword)))
      throw new DomainError('password_incorrect');
    await this.store.users.update(ctx.user.id, {
      passwordHash: await this.hasher.hash(newPassword),
    });
    await this.revokeAllSessions(ctx.user.id, ctx.session.id);
    await this.evictUser(ctx.user.id);
  }

  /**
   * Sends a reset link when the account exists and is active. Always resolves the same
   * way, so the response does not reveal whether an account exists.
   */
  async requestPasswordReset(email: string, locale: Language | undefined): Promise<void> {
    const user = await this.store.users.findByEmail(email);
    if (!user || user.disabledAt) return;
    const now = this.clock.now();
    const token = randomToken();
    await this.store.passwordResets.insert({
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      usedAt: null,
    });
    const language = user.locale ?? (isLanguage(locale) ? locale : 'en');
    await this.mail.trySend(
      user.email,
      {
        kind: 'passwordReset',
        email: user.email,
        link: `${this.publicUrl}/reset-password#token=${token}`,
      },
      language,
    );
  }

  /** Sets the new password, invalidates every reset link and signs out every session. */
  async confirmPasswordReset(token: string, password: string): Promise<void> {
    const now = this.clock.now();
    const newHash = await this.hasher.hash(password);
    await this.store.transaction(async (store) => {
      const reset = await store.passwordResets.findByTokenHash(hashToken(token));
      if (!reset || !isOneTimeTokenUsable(reset, now)) throw new DomainError('reset_token_invalid');
      const user = await store.users.findById(reset.userId);
      if (!user || user.disabledAt) throw new DomainError('reset_token_invalid');
      if (!(await store.passwordResets.consume(reset.id, user.id, now)))
        throw new DomainError('reset_token_invalid');
      await store.users.update(user.id, { passwordHash: newHash });
      await this.revokeAllSessions(user.id, undefined, store);
    });
  }
}
