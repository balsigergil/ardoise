// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness, PUBLIC_URL, tokenFromLink } from '../testing/harness.js';

const input = (token: string) => ({
  token,
  name: 'Root',
  email: 'root@example.test',
  password: 'a very long password',
  workspaceName: 'Acme',
});

describe('SetupService', () => {
  it('prints the same setup URL on every node until setup completes', async () => {
    const h = createHarness();
    const first = await h.setup.prepare();
    const second = await h.setup.prepare();
    expect(first.kind).toBe('pending');
    expect(second).toEqual(first);
    if (first.kind !== 'pending') throw new Error('expected pending');
    expect(first.url.startsWith(`${PUBLIC_URL}/setup#token=`)).toBe(true);
    // Stored encrypted, never in clear text.
    expect(JSON.stringify([...h.store.data.settings.values()])).not.toContain(
      tokenFromLink(first.url),
    );
    expect(await h.setup.isRequired()).toBe(true);
  });

  it('creates the super-admin and the first workspace, then closes setup', async () => {
    const h = createHarness();
    const state = await h.setup.prepare();
    if (state.kind !== 'pending') throw new Error('expected pending');
    const token = tokenFromLink(state.url);
    const done = await h.setup.complete(input(token), h.meta);
    expect(done.user).toMatchObject({ email: 'root@example.test', isSuperAdmin: true });
    expect(await h.store.workspaces.membership(done.workspaceId, done.user.id)).toMatchObject({
      role: 'owner',
    });
    expect(await h.auth.authenticate(done.token)).toBeDefined();
    expect(await h.setup.isRequired()).toBe(false);
    await expect(h.setup.complete(input(token), h.meta)).rejects.toMatchObject({
      code: 'setup_unavailable',
    });
    expect(await h.setup.prepare()).toEqual({ kind: 'complete' });
  });

  it('rejects a wrong token', async () => {
    const h = createHarness();
    await h.setup.prepare();
    await expect(h.setup.complete(input('x'.repeat(43)), h.meta)).rejects.toMatchObject({
      code: 'setup_token_invalid',
    });
  });

  it('is unavailable before a token exists', async () => {
    const h = createHarness();
    await expect(h.setup.complete(input('x'.repeat(43)), h.meta)).rejects.toMatchObject({
      code: 'setup_unavailable',
    });
  });

  it('bootstraps the super-admin from the environment instead', async () => {
    const h = createHarness();
    await h.setup.prepare();
    const state = await h.setup.prepare({
      email: ' Root@Example.test ',
      password: 'a very long password',
    });
    expect(state).toEqual({ kind: 'bootstrapped', email: 'root@example.test' });
    expect(h.store.data.settings.has('setup')).toBe(false);
    await h.auth.login('root@example.test', 'a very long password', h.meta);
    // Idempotent on restart.
    expect(
      await h.setup.prepare({ email: 'root@example.test', password: 'a very long password' }),
    ).toEqual({
      kind: 'complete',
    });
  });
});
