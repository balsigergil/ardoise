// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

describe('WorkspaceService', () => {
  it('creates a workspace with the creator as owner and lists it', async () => {
    const h = createHarness();
    const ana = await h.createUser();
    const ws = await h.createWorkspace(ana, 'Acme');
    expect(ws).toMatchObject({ name: 'Acme', role: 'owner' });
    expect(await h.workspaces.listMine(ana.id)).toEqual([ws]);
    expect(h.store.data.permEpochs.get(ws.id)).toBe(0);
  });

  it('honors the workspace creation setting', async () => {
    const h = createHarness();
    await h.settings.update({ general: { workspaceCreation: 'super_admins' } });
    const user = await h.createUser();
    await expect(h.workspaces.create(user, { name: 'X' })).rejects.toMatchObject({
      code: 'workspace_creation_disabled',
    });
    const root = await h.createUser({ isSuperAdmin: true });
    await expect(h.workspaces.create(root, { name: 'X' })).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('hides workspaces from non-members and restricts updates to managers', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const member = await h.createUser();
    const stranger = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await h.addMember(ws.id, member, 'member');
    await expect(h.workspaces.get(stranger, ws.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(h.workspaces.update(member, ws.id, { name: 'New' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await h.workspaces.update(owner, ws.id, { name: ' New ', icon: '🚀' })).toMatchObject({
      name: 'New',
      icon: '🚀',
    });
  });

  it('lists members (not for guests)', async () => {
    const h = createHarness();
    const owner = await h.createUser({ email: 'a@x.test' });
    const guest = await h.createUser({ email: 'b@x.test' });
    const ws = await h.createWorkspace(owner);
    await h.addMember(ws.id, guest, 'guest');
    const page = await h.workspaces.listMembers(owner, ws.id, { limit: 10 });
    expect(page.items.map((m) => [m.email, m.role])).toEqual([
      ['a@x.test', 'owner'],
      ['b@x.test', 'guest'],
    ]);
    await expect(h.workspaces.listMembers(guest, ws.id, { limit: 10 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('changes roles within the rules and bumps the permission epoch', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const admin = await h.createUser();
    const member = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await h.addMember(ws.id, admin, 'admin');
    await h.addMember(ws.id, member, 'member');
    await expect(h.workspaces.changeRole(admin, ws.id, owner.id, 'member')).rejects.toMatchObject({
      code: 'owner_protected',
    });
    await expect(h.workspaces.changeRole(admin, ws.id, member.id, 'owner')).rejects.toMatchObject({
      code: 'role_not_assignable',
    });
    await expect(h.workspaces.changeRole(owner, ws.id, owner.id, 'admin')).rejects.toMatchObject({
      code: 'last_owner',
    });
    await h.workspaces.changeRole(admin, ws.id, member.id, 'admin');
    expect((await h.store.workspaces.membership(ws.id, member.id))?.role).toBe('admin');
    expect(h.store.data.permEpochs.get(ws.id)).toBe(1);
  });

  it('demoting to guest removes teamspace memberships', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const member = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await h.addMember(ws.id, member, 'member');
    const ts = await h.teamspaces.create(owner, ws.id, { name: 'Eng' });
    await h.teamspaces.join(member, ws.id, ts.id);
    await h.workspaces.changeRole(owner, ws.id, member.id, 'guest');
    expect(await h.store.teamspaces.membership(ws.id, ts.id, member.id)).toBeUndefined();
  });

  it('removes members and lets members leave, but keeps an owner', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const member = await h.createUser();
    const other = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await h.addMember(ws.id, member, 'member');
    await h.addMember(ws.id, other, 'member');
    await expect(h.workspaces.removeMember(member, ws.id, other.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await h.workspaces.removeMember(member, ws.id, member.id);
    await h.workspaces.removeMember(owner, ws.id, other.id);
    await expect(h.workspaces.removeMember(owner, ws.id, owner.id)).rejects.toMatchObject({
      code: 'last_owner',
    });
    expect((await h.workspaces.listMembers(owner, ws.id, { limit: 10 })).items).toHaveLength(1);
  });
});
