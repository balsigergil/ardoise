// SPDX-License-Identifier: AGPL-3.0-only
/** Wires the framework-free services over in-memory fakes for unit tests. */
import {
  DomainError,
  newId,
  positionBetween,
  type ErrorCode,
  type MutationInput,
  type MutationName,
  type MutationResult,
} from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import { RecordingJobQueue } from '../jobs/jobs.js';
import { JobProcessors } from '../jobs/processors.js';
import { pageHandlers } from '../pages/page-mutations.js';
import { PageService } from '../pages/page.service.js';
import { PublicPageService } from '../pages/public.service.js';
import { sharingHandlers } from '../pages/sharing-mutations.js';
import { NoPermissionCache, PermissionService } from '../permissions/permission.service.js';
import { MutationService } from '../sync/mutation.service.js';
import { MemorySyncEventBus } from '../sync/pokes.js';
import { PullService } from '../sync/pull.service.js';
import { workspaceHandlers } from '../workspaces/workspace-mutations.js';
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

const noop = () => undefined;
export const silentLogger = {
  log: noop,
  warn: noop,
  error: noop,
  debug: noop,
} as unknown as Logger;

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

  const bus = new MemorySyncEventBus();
  const jobs = new RecordingJobQueue();
  const permissions = new PermissionService(store, new NoPermissionCache());
  const mutations = new MutationService(
    store,
    { ...pageHandlers(), ...sharingHandlers(keyring), ...workspaceHandlers(bus) },
    permissions,
    jobs,
    bus,
    clock,
    silentLogger,
  );
  const pull = new PullService(store, permissions);
  const pages = new PageService(store, permissions, keyring, clock, PUBLIC_URL);
  const publicPages = new PublicPageService(store, permissions, keyring);
  const processors = new JobProcessors(store, settings, bus, clock, silentLogger);

  /** Pushes one mutation; returns the result (rejections included). */
  async function tryMutate<N extends MutationName>(
    actor: UserRecord,
    workspaceId: string,
    name: N,
    args: MutationInput[N],
    id: string = newId(),
  ): Promise<MutationResult> {
    const [result] = await mutations.push(actor, [
      { id, workspaceId, name, args, clientTime: clock.now().toISOString() },
    ]);
    return result!;
  }

  /** Pushes one mutation and throws a DomainError when it is rejected. */
  async function mutate<N extends MutationName>(
    actor: UserRecord,
    workspaceId: string,
    name: N,
    args: MutationInput[N],
  ): Promise<MutationResult> {
    const result = await tryMutate(actor, workspaceId, name, args);
    if (result.status === 'rejected') throw new DomainError(result.code as ErrorCode);
    return result;
  }

  /** Creates a page through `page.create` and returns its id. */
  async function createPage(
    actor: UserRecord,
    workspaceId: string,
    parent: { kind: 'teamspace' | 'private' | 'page'; id: string },
    title = 'Page',
    position = positionBetween(null, null),
  ): Promise<string> {
    const id = newId();
    await mutate(actor, workspaceId, 'page.create', { id, parent, position, title });
    return id;
  }

  /** The default teamspace created with a workspace. */
  function defaultTeamspace(workspaceId: string): Promise<string> {
    const ts = store.data.teamspaces.find((t) => t.workspaceId === workspaceId);
    if (!ts) throw new Error('no teamspace');
    return Promise.resolve(ts.id);
  }

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
    bus,
    jobs,
    permissions,
    mutations,
    pull,
    pages,
    publicPages,
    processors,
    mutate,
    tryMutate,
    createPage,
    defaultTeamspace,
  };
}

export type Harness = ReturnType<typeof createHarness>;

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
