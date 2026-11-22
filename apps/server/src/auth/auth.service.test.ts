// SPDX-License-Identifier: AGPL-3.0-only
import { sessionPolicy } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../common/crypto.js';
import { createHarness, linkFromMail, tokenFromLink } from '../testing/harness.js';

const PASSWORD = 'correct horse battery';

describe('AuthService.login', () => {
  it('issues a session whose token is only stored hashed', async () => {
    const h = createHarness();
    const user = await h.createUser({ email: 'ana@example.test' });
    const issued = await h.auth.login('ana@example.test', PASSWORD, h.meta);
    expect(issued.user.id).toBe(user.id);
    expect(issued.token).toHaveLength(43);
    const stored = [...h.store.data.sessions.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashToken(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    expect(stored[0]!.expiresAt.getTime() - h.clock.now().getTime()).toBe(sessionPolicy.absoluteMs);
  });

  it('rejects wrong passwords and unknown emails with the same error', async () => {
    const h = createHarness();
    await h.createUser({ email: 'ana@example.test' });
    await expect(h.auth.login('ana@example.test', 'wrong', h.meta)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(h.auth.login('nobody@example.test', PASSWORD, h.meta)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('rejects disabled accounts only after a correct password', async () => {
    const h = createHarness();
    await h.createUser({ email: 'ana@example.test', disabledAt: new Date() });
    await expect(h.auth.login('ana@example.test', 'wrong', h.meta)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(h.auth.login('ana@example.test', PASSWORD, h.meta)).rejects.toMatchObject({
      code: 'account_disabled',
    });
  });
});

describe('AuthService.authenticate', () => {
  it('resolves an active session and caches it', async () => {
    const h = createHarness();
    await h.createUser({ email: 'ana@example.test' });
    const { token } = await h.auth.login('ana@example.test', PASSWORD, h.meta);
    expect((await h.auth.authenticate(token))?.user.email).toBe('ana@example.test');
    expect(h.cache.entries.has(hashToken(token))).toBe(true);
    expect(await h.auth.authenticate('not-a-token')).toBeUndefined();
  });

  it('refreshes last_seen_at at most every touch interval', async () => {
    const h = createHarness();
    await h.createUser({ email: 'ana@example.test' });
    const { token, session } = await h.auth.login('ana@example.test', PASSWORD, h.meta);
    const created = session.lastSeenAt.getTime();
    h.clock.advance(60_000);
    await h.auth.authenticate(token);
    expect(h.store.data.sessions.get(session.id)?.lastSeenAt.getTime()).toBe(created);
    h.clock.advance(sessionPolicy.touchIntervalMs);
    await h.auth.authenticate(token);
    expect(h.store.data.sessions.get(session.id)?.lastSeenAt.getTime()).toBe(
      h.clock.now().getTime(),
    );
  });

  it('rejects idle, expired, revoked sessions and disabled users', async () => {
    const h = createHarness();
    const user = await h.createUser({ email: 'ana@example.test' });
    const a = await h.auth.login(user.email, PASSWORD, h.meta);
    h.clock.advance(sessionPolicy.idleMs);
    expect(await h.auth.authenticate(a.token)).toBeUndefined();

    const b = await h.auth.login(user.email, PASSWORD, h.meta);
    await h.auth.logout(b.session.id);
    expect(await h.auth.authenticate(b.token)).toBeUndefined();

    const c = await h.auth.login(user.email, PASSWORD, h.meta);
    await h.auth.authenticate(c.token); // cached
    await h.store.users.update(user.id, { disabledAt: h.clock.now() });
    await h.auth.evictUser(user.id);
    expect(await h.auth.authenticate(c.token)).toBeUndefined();
  });

  it('expires at the absolute lifetime even with constant use', async () => {
    const h = createHarness();
    const user = await h.createUser();
    const { token } = await h.auth.login(user.email, PASSWORD, h.meta);
    for (let elapsed = 0; elapsed < sessionPolicy.absoluteMs; elapsed += sessionPolicy.idleMs / 2) {
      expect(await h.auth.authenticate(token)).toBeDefined();
      h.clock.advance(sessionPolicy.idleMs / 2);
    }
    expect(await h.auth.authenticate(token)).toBeUndefined();
  });
});

describe('session management', () => {
  it('lists live sessions with the current one marked, and revokes only own sessions', async () => {
    const h = createHarness();
    const ana = await h.createUser();
    const bob = await h.createUser();
    const a1 = await h.auth.login(ana.email, PASSWORD, h.meta);
    h.clock.advance(1000);
    const a2 = await h.auth.login(ana.email, PASSWORD, { userAgent: 'phone', ip: null });
    const b1 = await h.auth.login(bob.email, PASSWORD, h.meta);
    const list = await h.auth.listSessions(ana.id, a1.session.id);
    expect(list.map((s) => [s.id, s.current])).toEqual([
      [a2.session.id, false],
      [a1.session.id, true],
    ]);
    await expect(h.auth.revokeSession(ana.id, b1.session.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await h.auth.revokeSession(ana.id, a2.session.id);
    expect(await h.auth.authenticate(a2.token)).toBeUndefined();
    expect(await h.auth.authenticate(a1.token)).toBeDefined();
  });

  it('changing the password requires the current one and signs out other sessions', async () => {
    const h = createHarness();
    const user = await h.createUser();
    const a = await h.auth.login(user.email, PASSWORD, h.meta);
    const b = await h.auth.login(user.email, PASSWORD, h.meta);
    const ctx = (await h.auth.authenticate(a.token))!;
    await expect(h.auth.changePassword(ctx, 'wrong', 'new password 123')).rejects.toMatchObject({
      code: 'password_incorrect',
    });
    await h.auth.changePassword(ctx, PASSWORD, 'new password 123');
    expect(await h.auth.authenticate(a.token)).toBeDefined();
    expect(await h.auth.authenticate(b.token)).toBeUndefined();
    await expect(h.auth.login(user.email, PASSWORD, h.meta)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await h.auth.login(user.email, 'new password 123', h.meta);
  });

  it('updates the profile and refreshes cached sessions', async () => {
    const h = createHarness();
    const user = await h.createUser();
    const { token } = await h.auth.login(user.email, PASSWORD, h.meta);
    await h.auth.authenticate(token);
    await h.auth.updateProfile(user.id, { name: 'Ana', locale: 'fr', theme: 'dark' });
    expect((await h.auth.authenticate(token))?.user).toMatchObject({
      name: 'Ana',
      locale: 'fr',
      theme: 'dark',
    });
  });
});

describe('password reset', () => {
  it('emails a one-hour single-use link in the user language', async () => {
    const h = createHarness();
    const user = await h.createUser({ email: 'ana@example.test', locale: 'fr' });
    const other = await h.auth.login(user.email, PASSWORD, h.meta);
    await h.auth.requestPasswordReset('ana@example.test', 'en');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe('ana@example.test');
    expect(h.sent[0]?.subject).toContain('mot de passe');
    const token = tokenFromLink(linkFromMail(h.sent[0]!.text));
    expect(linkFromMail(h.sent[0]!.text)).toContain('/reset-password#token=');

    await h.auth.confirmPasswordReset(token, 'brand new password');
    await h.auth.login(user.email, 'brand new password', h.meta);
    expect(await h.auth.authenticate(other.token)).toBeUndefined();
    await expect(h.auth.confirmPasswordReset(token, 'another password!')).rejects.toMatchObject({
      code: 'reset_token_invalid',
    });
  });

  it('does nothing visible for unknown or disabled accounts', async () => {
    const h = createHarness();
    await h.createUser({ email: 'off@example.test', disabledAt: new Date() });
    await h.auth.requestPasswordReset('nobody@example.test', undefined);
    await h.auth.requestPasswordReset('off@example.test', undefined);
    expect(h.sent).toHaveLength(0);
  });

  it('rejects expired links and invalidates older links once one is used', async () => {
    const h = createHarness();
    const user = await h.createUser();
    await h.auth.requestPasswordReset(user.email, undefined);
    await h.auth.requestPasswordReset(user.email, undefined);
    const first = tokenFromLink(linkFromMail(h.sent[0]!.text));
    const second = tokenFromLink(linkFromMail(h.sent[1]!.text));
    await h.auth.confirmPasswordReset(second, 'brand new password');
    await expect(h.auth.confirmPasswordReset(first, 'brand new password')).rejects.toMatchObject({
      code: 'reset_token_invalid',
    });

    await h.auth.requestPasswordReset(user.email, undefined);
    const third = tokenFromLink(linkFromMail(h.sent[2]!.text));
    h.clock.advance(60 * 60_000);
    await expect(h.auth.confirmPasswordReset(third, 'brand new password')).rejects.toMatchObject({
      code: 'reset_token_invalid',
    });
  });

  it('keeps the response identical when mail is not configured', async () => {
    const h = createHarness({ smtp: undefined });
    const user = await h.createUser();
    await expect(h.auth.requestPasswordReset(user.email, undefined)).resolves.toBeUndefined();
  });
});
