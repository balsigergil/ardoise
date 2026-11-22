// SPDX-License-Identifier: AGPL-3.0-only
/** Wires the framework-free services over in-memory fakes for unit tests. */
import { newId } from '@ardoise/shared';
import { AdminService } from '../admin/admin.service.js';
import { SetupService } from '../admin/setup.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import { MemorySessionCache } from '../auth/session-cache.js';
import { SecretKeyring } from '../common/crypto.js';
import type { Config } from '../config/config.js';
import { MailService, type OutgoingMail } from '../mail/mail.service.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';
import { MemoryStore } from '../store/memory-store.js';
import type { UserRecord } from '../store/store.js';
import { InvitationService } from '../workspaces/invitation.service.js';
import { TeamspaceService } from '../workspaces/teamspace.service.js';
import { WorkspaceService } from '../workspaces/workspace.service.js';

export const PUBLIC_URL = 'https://ardoise.test';

/** Cheap, deterministic stand-in for argon2. */
export const fakeHasher: PasswordHasher = {
  hash: (password) => Promise.resolve(`hashed:${password}`),
  verify: (hash, password) => Promise.resolve(hash === `hashed:${password}`),
};

export class FixedClock {
  constructor(public current = new Date('2026-03-01T10:00:00Z')) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface HarnessOptions {
  smtp?: Config['smtp'];
  failMail?: boolean;
}

export function createHarness(options: HarnessOptions = {}) {
  const store = new MemoryStore();
  const clock = new FixedClock();
  const keyring = new SecretKeyring('unit-test-secret-key-unit-test-secret-key');
  const cache = new MemorySessionCache();
  const sent: OutgoingMail[] = [];
  const smtp =
    'smtp' in options
      ? options.smtp
      : {
          host: 'smtp.test',
          port: 587,
          secure: false,
          user: undefined,
          password: undefined,
          from: 'Ardoise <a@test>',
        };
  const settings = new InstanceSettingsService(store, keyring, smtp, PUBLIC_URL);
  const warnings: string[] = [];
  const mail = new MailService(
    settings,
    PUBLIC_URL,
    (_smtp, message) => {
      if (options.failMail) return Promise.reject(new Error('connection refused'));
      sent.push(message);
      return Promise.resolve();
    },
    { warn: (m) => warnings.push(m) },
  );
  const auth = new AuthService(store, fakeHasher, cache, mail, clock, PUBLIC_URL);
  const setup = new SetupService(store, keyring, fakeHasher, auth, clock, PUBLIC_URL);
  const admin = new AdminService(store, auth, clock);
  const workspaces = new WorkspaceService(store, settings, clock);
  const teamspaces = new TeamspaceService(store, workspaces, clock);
  const invitations = new InvitationService(
    store,
    settings,
    mail,
    auth,
    fakeHasher,
    clock,
    PUBLIC_URL,
  );

  async function createUser(overrides: Partial<UserRecord> = {}): Promise<UserRecord> {
    const id = newId();
    const user: UserRecord = {
      id,
      email: `${id.slice(-8)}@example.test`,
      name: `User ${id.slice(-4)}`,
      passwordHash: 'hashed:correct horse battery',
      locale: null,
      theme: 'system',
      isSuperAdmin: false,
      disabledAt: null,
      createdAt: clock.now(),
      ...overrides,
    };
    await store.users.insert(user);
    return user;
  }

  async function createWorkspace(owner: UserRecord, name = 'Acme') {
    return workspaces.create(owner, { name });
  }

  /** Adds `user` to the workspace with `role`. */
  async function addMember(
    workspaceId: string,
    user: UserRecord,
    role: 'owner' | 'admin' | 'member' | 'guest',
  ) {
    await store.workspaces.addMember({
      workspaceId,
      userId: user.id,
      role,
      createdAt: clock.now(),
    });
  }

  const meta = { userAgent: 'vitest', ip: '127.0.0.1' };

  return {
    store,
    clock,
    keyring,
    cache,
    sent,
    warnings,
    settings,
    mail,
    auth,
    setup,
    admin,
    workspaces,
    teamspaces,
    invitations,
    createUser,
    createWorkspace,
    addMember,
    meta,
  };
}

/** Extracts the token from a link of the form `…#token=<token>`. */
export function tokenFromLink(link: string): string {
  const token = /#token=([\w-]+)/.exec(link)?.[1];
  if (!token) throw new Error(`no token in ${link}`);
  return token;
}

/** Extracts the first link to the instance from an email body. */
export function linkFromMail(text: string): string {
  const link = new RegExp(`${PUBLIC_URL}/[\\w/-]+#token=[\\w-]+`).exec(text)?.[0];
  if (!link) throw new Error('no link in email');
  return link;
}
