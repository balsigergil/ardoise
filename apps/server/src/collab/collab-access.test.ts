// SPDX-License-Identifier: AGPL-3.0-only
import { collabDocumentName, newId } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';
import { CollabAccess, CollabDenied } from './collab-access.js';

async function setup() {
  const h = createHarness();
  const owner = await h.createUser({ name: 'Olive' });
  const viewer = await h.createUser({ name: 'Vic' });
  const outsider = await h.createUser({ name: 'Otto' });
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, viewer, 'member');
  const page = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Doc');
  const access = new CollabAccess(h.store, h.permissions, (token) => h.auth.authenticate(token));
  const name = collabDocumentName(ws.id, page);
  const identity = (u: { id: string; name: string }) => ({ userId: u.id, name: u.name });
  const reason = (p: Promise<unknown>) =>
    p.then(
      () => 'granted',
      (e: unknown) => (e instanceof CollabDenied ? e.reason : 'other'),
    );
  return { h, owner, viewer, outsider, ws, page, access, name, identity, reason };
}

describe('CollabAccess', () => {
  it('grants write access to editors', async () => {
    const { access, owner, name, page, identity } = await setup();
    const grant = await access.authorize(identity(owner), name);
    expect(grant).toMatchObject({ pageId: page, readOnly: false, ref: { kind: 'page', id: page } });
  });

  it('is read-only for view-only users and on locked or trashed pages', async () => {
    const { h, access, owner, viewer, ws, page, name, identity } = await setup();
    await h.mutate(owner, ws.id, 'permission.grant', {
      pageId: page,
      principal: { kind: 'user', id: viewer.id },
      level: 'can_view',
    });
    // The viewer is not in the teamspace: only the explicit grant applies.
    expect((await access.authorize(identity(viewer), name)).readOnly).toBe(true);
    await h.mutate(owner, ws.id, 'page.update', { id: page, isLocked: true });
    expect((await access.authorize(identity(owner), name)).readOnly).toBe(true);
    await h.mutate(owner, ws.id, 'page.update', { id: page, isLocked: false });
    await h.mutate(owner, ws.id, 'page.trash', { id: page });
    expect((await access.authorize(identity(owner), name)).readOnly).toBe(true);
  });

  it('hides documents from non-members and users without view access', async () => {
    const { access, outsider, viewer, name, identity, reason } = await setup();
    expect(await reason(access.authorize(identity(outsider), name))).toBe('not_found');
    expect(await reason(access.authorize(identity(viewer), name))).toBe('not_found');
  });

  it('rejects unknown pages, malformed names and reserved prefixes', async () => {
    const { access, owner, ws, page, identity, reason } = await setup();
    const me = identity(owner);
    expect(await reason(access.authorize(me, collabDocumentName(ws.id, newId())))).toBe(
      'not_found',
    );
    expect(await reason(access.authorize(me, 'nonsense'))).toBe('unsupported_document');
    expect(await reason(access.authorize(me, `${ws.id}/plugin:${page}`))).toBe(
      'unsupported_document',
    );
    expect(await reason(access.authorize(me, `${ws.id}/synced:${page}`))).toBe(
      'unsupported_document',
    );
  });

  it('identifies sessions', async () => {
    const { h, access, owner } = await setup();
    const { token } = await h.auth.login(owner.email, 'correct horse battery', h.meta);
    expect(await access.identify(token)).toEqual({ userId: owner.id, name: 'Olive' });
    expect(await access.identify('bogus')).toBeNull();
    expect(await access.identify(undefined)).toBeNull();
  });
});
