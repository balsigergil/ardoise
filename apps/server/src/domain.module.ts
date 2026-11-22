// SPDX-License-Identifier: AGPL-3.0-only
import type { DatabaseHandle } from '@ardoise/db';
import { Global, Logger, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AdminService } from './admin/admin.service.js';
import { SetupService } from './admin/setup.service.js';
import { AuthService } from './auth/auth.service.js';
import { argon2Hasher } from './auth/password-hasher.js';
import { ValkeySessionCache } from './auth/session-cache.js';
import { systemClock } from './common/clock.js';
import { SecretKeyring } from './common/crypto.js';
import { RateLimiter, ValkeyCounterStore } from './common/rate-limit.js';
import type { Config } from './config/config.js';
import { MailService, nodemailerTransport } from './mail/mail.service.js';
import { InstanceSettingsService } from './settings/instance-settings.service.js';
import { DrizzleStore } from './store/drizzle-store.js';
import type { Store } from './store/store.js';
import { CONFIG, DATABASE, STORE, VALKEY } from './tokens.js';
import { InvitationService } from './workspaces/invitation.service.js';
import { TeamspaceService } from './workspaces/teamspace.service.js';
import { WorkspaceService } from './workspaces/workspace.service.js';

const clock = systemClock;
const hasher = argon2Hasher;

/** Framework-free services, wired once per process. */
@Global()
@Module({
  providers: [
    {
      provide: STORE,
      inject: [DATABASE],
      useFactory: (db: DatabaseHandle): Store => new DrizzleStore(db.db),
    },
    {
      provide: SecretKeyring,
      inject: [CONFIG],
      useFactory: (c: Config) => new SecretKeyring(c.secretKey),
    },
    {
      provide: RateLimiter,
      inject: [VALKEY],
      useFactory: (v: Redis) => new RateLimiter(new ValkeyCounterStore(v)),
    },
    {
      provide: InstanceSettingsService,
      inject: [STORE, SecretKeyring, CONFIG],
      useFactory: (s: Store, k: SecretKeyring, c: Config) =>
        new InstanceSettingsService(s, k, c.smtp, c.publicUrl),
    },
    {
      provide: MailService,
      inject: [InstanceSettingsService, CONFIG],
      useFactory: (settings: InstanceSettingsService, c: Config) =>
        new MailService(settings, c.publicUrl, nodemailerTransport, new Logger('mail')),
    },
    {
      provide: AuthService,
      inject: [STORE, VALKEY, MailService, CONFIG],
      useFactory: (s: Store, v: Redis, mail: MailService, c: Config) =>
        new AuthService(s, hasher, new ValkeySessionCache(v), mail, clock, c.publicUrl),
    },
    {
      provide: SetupService,
      inject: [STORE, SecretKeyring, AuthService, CONFIG],
      useFactory: (s: Store, k: SecretKeyring, auth: AuthService, c: Config) =>
        new SetupService(s, k, hasher, auth, clock, c.publicUrl),
    },
    {
      provide: AdminService,
      inject: [STORE, AuthService],
      useFactory: (s: Store, auth: AuthService) => new AdminService(s, auth, clock),
    },
    {
      provide: WorkspaceService,
      inject: [STORE, InstanceSettingsService],
      useFactory: (s: Store, settings: InstanceSettingsService) =>
        new WorkspaceService(s, settings, clock),
    },
    {
      provide: TeamspaceService,
      inject: [STORE, WorkspaceService],
      useFactory: (s: Store, w: WorkspaceService) => new TeamspaceService(s, w, clock),
    },
    {
      provide: InvitationService,
      inject: [STORE, InstanceSettingsService, MailService, AuthService, CONFIG],
      useFactory: (
        s: Store,
        settings: InstanceSettingsService,
        mail: MailService,
        auth: AuthService,
        c: Config,
      ) => new InvitationService(s, settings, mail, auth, hasher, clock, c.publicUrl),
    },
  ],
  exports: [
    STORE,
    SecretKeyring,
    RateLimiter,
    InstanceSettingsService,
    MailService,
    AuthService,
    SetupService,
    AdminService,
    WorkspaceService,
    TeamspaceService,
    InvitationService,
  ],
})
export class DomainModule {}
