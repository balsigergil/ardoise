// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

describe('AdminService', () => {
  it('is restricted to super-admins', async () => {
    const h = createHarness();
    const user = await h.createUser();
    await expect(h.admin.listUsers(user, { limit: 10 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(h.admin.listWorkspaces(user, { limit: 10 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(h.admin.updateUser(user, user.id, { disabled: true })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('lists users with search and keyset pagination', async () => {
    const h = createHarness();
    const root = await h.createUser({ email: 'root@x.test', isSuperAdmin: true });
    for (const name of ['alice', 'bob', 'carol'])
      await h.createUser({ email: `${name}@x.test`, name });
    const first = await h.admin.listUsers(root, { limit: 2 });
    expect(first.items.map((u) => u.email)).toEqual(['alice@x.test', 'bob@x.test']);
    const second = await h.admin.listUsers(root, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((u) => u.email)).toEqual(['carol@x.test', 'root@x.test']);
    expect(second.nextCursor).toBeNull();
    expect((await h.admin.listUsers(root, { limit: 10, q: 'CAR' })).items).toHaveLength(1);
  });

  it('disables a user and signs them out; promotes and demotes', async () => {
    const h = createHarness();
    const root = await h.createUser({ isSuperAdmin: true });
    const user = await h.createUser();
    const { token } = await h.auth.login(user.email, 'correct horse battery', h.meta);
    expect((await h.admin.updateUser(root, user.id, { disabled: true })).disabled).toBe(true);
    expect(await h.auth.authenticate(token)).toBeUndefined();
    expect(
      (await h.admin.updateUser(root, user.id, { disabled: false, isSuperAdmin: true }))
        .isSuperAdmin,
    ).toBe(true);
    expect((await h.admin.updateUser(root, user.id, { isSuperAdmin: false })).isSuperAdmin).toBe(
      false,
    );
  });

  it('protects the acting admin and the last super-admin', async () => {
    const h = createHarness();
    const root = await h.createUser({ isSuperAdmin: true });
    await expect(h.admin.updateUser(root, root.id, { isSuperAdmin: false })).rejects.toMatchObject({
      code: 'self_action',
    });
    await expect(h.admin.updateUser(root, root.id, { disabled: true })).rejects.toMatchObject({
      code: 'self_action',
    });
    await expect(h.admin.deleteUser(root, root.id)).rejects.toMatchObject({ code: 'self_action' });
    // A second super-admin cannot demote the first if it would leave none active.
    const other = await h.createUser({ isSuperAdmin: true, disabledAt: new Date() });
    await expect(h.admin.updateUser(other, root.id, { isSuperAdmin: false })).rejects.toMatchObject(
      {
        code: 'last_super_admin',
      },
    );
  });

  it('deletes users unless they are the sole owner of a workspace', async () => {
    const h = createHarness();
    const root = await h.createUser({ isSuperAdmin: true });
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await expect(h.admin.deleteUser(root, owner.id)).rejects.toMatchObject({
      code: 'sole_workspace_owner',
    });
    const coOwner = await h.createUser();
    await h.addMember(ws.id, coOwner, 'owner');
    await h.admin.deleteUser(root, owner.id);
    expect(await h.store.users.findById(owner.id)).toBeUndefined();
    expect(await h.store.workspaces.membership(ws.id, owner.id)).toBeUndefined();
    await expect(h.admin.deleteUser(root, owner.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists workspaces with member counts', async () => {
    const h = createHarness();
    const root = await h.createUser({ isSuperAdmin: true });
    const ws = await h.createWorkspace(root, 'Zeta');
    await h.addMember(ws.id, await h.createUser(), 'member');
    await h.createWorkspace(root, 'Alpha');
    const page = await h.admin.listWorkspaces(root, { limit: 10 });
    expect(page.items.map((w) => [w.name, w.memberCount])).toEqual([
      ['Alpha', 1],
      ['Zeta', 2],
    ]);
  });
});
