// SPDX-License-Identifier: AGPL-3.0-only
import type { DatabaseHandle } from '@ardoise/db';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
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
import { CONFIG, DATABASE, JOB_QUEUE, S3, STORE, SYNC_BUS, VALKEY } from './tokens.js';
import type { S3Client } from '@aws-sdk/client-s3';
import { FileService, sharpThumbnailer } from './files/file.service.js';
import { LinkPreviewService } from './links/link-preview.service.js';
import { PostgresSearchAdapter } from './search/postgres-search.js';
import { SearchService } from './search/search.service.js';
import { S3ObjectStorage } from './files/object-storage.js';
import { createS3Client } from './infra/s3.js';
import { BullJobQueue } from './jobs/bullmq-queue.js';
import type { JobQueue } from './jobs/jobs.js';
import { pageHandlers } from './pages/page-mutations.js';
import { PageService } from './pages/page.service.js';
import { ProjectionService } from './projection/projection.service.js';
import { PublicPageService } from './pages/public.service.js';
import { sharingHandlers } from './pages/sharing-mutations.js';
import { PermissionService, ValkeyPermissionCache } from './permissions/permission.service.js';
import { MutationService } from './sync/mutation.service.js';
import { ValkeySyncEventBus, type SyncEventBus } from './sync/pokes.js';
import { PullService } from './sync/pull.service.js';
import { workspaceHandlers } from './workspaces/workspace-mutations.js';
import { InvitationService } from './workspaces/invitation.service.js';
import { TeamspaceService } from './workspaces/teamspace.service.js';
import { WorkspaceService } from './workspaces/workspace.service.js';

const clock = systemClock;
const hasher = argon2Hasher;

class SyncLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(SYNC_BUS) private readonly bus: SyncEventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.bus instanceof ValkeySyncEventBus) this.bus.close();
    if (this.jobs instanceof BullJobQueue) await this.jobs.close();
  }
}

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
    {
      provide: SYNC_BUS,
      inject: [VALKEY],
      useFactory: (v: Redis): SyncEventBus => new ValkeySyncEventBus(v),
    },
    {
      provide: JOB_QUEUE,
      inject: [CONFIG],
      useFactory: (c: Config): JobQueue => new BullJobQueue(c.valkeyUrl),
    },
    {
      provide: PermissionService,
      inject: [STORE, VALKEY],
      useFactory: (s: Store, v: Redis) => new PermissionService(s, new ValkeyPermissionCache(v)),
    },
    {
      provide: MutationService,
      inject: [STORE, PermissionService, JOB_QUEUE, SYNC_BUS, SecretKeyring],
      useFactory: (
        s: Store,
        permissions: PermissionService,
        jobs: JobQueue,
        bus: SyncEventBus,
        keyring: SecretKeyring,
      ) =>
        new MutationService(
          s,
          { ...pageHandlers(), ...sharingHandlers(keyring), ...workspaceHandlers(bus) },
          permissions,
          jobs,
          bus,
          clock,
          new Logger('sync'),
        ),
    },
    {
      provide: PullService,
      inject: [STORE, PermissionService],
      useFactory: (s: Store, permissions: PermissionService) => new PullService(s, permissions),
    },
    {
      provide: PageService,
      inject: [STORE, PermissionService, SecretKeyring, CONFIG],
      useFactory: (s: Store, p: PermissionService, k: SecretKeyring, c: Config) =>
        new PageService(s, p, k, clock, c.publicUrl),
    },
    {
      provide: PublicPageService,
      inject: [STORE, PermissionService, SecretKeyring],
      useFactory: (s: Store, p: PermissionService, k: SecretKeyring) =>
        new PublicPageService(s, p, k),
    },
    {
      provide: ProjectionService,
      inject: [STORE, PermissionService, JOB_QUEUE],
      useFactory: (s: Store, p: PermissionService, jobs: JobQueue) =>
        new ProjectionService(s, p, jobs, new Logger('projection')),
    },
    {
      provide: SearchService,
      inject: [STORE, PermissionService, DATABASE],
      useFactory: (s: Store, p: PermissionService, db: DatabaseHandle) =>
        new SearchService(s, p, new PostgresSearchAdapter(db.db)),
    },
    {
      provide: LinkPreviewService,
      inject: [STORE, RateLimiter],
      useFactory: (s: Store, limiter: RateLimiter) => new LinkPreviewService(s, limiter),
    },
    {
      provide: FileService,
      inject: [STORE, PermissionService, S3, InstanceSettingsService, JOB_QUEUE, CONFIG],
      useFactory: (
        s: Store,
        p: PermissionService,
        s3: S3Client,
        settings: InstanceSettingsService,
        jobs: JobQueue,
        c: Config,
      ) => {
        const publicClient = c.s3.publicUrl
          ? createS3Client({ ...c.s3, endpoint: c.s3.publicUrl })
          : undefined;
        return new FileService(
          s,
          p,
          new S3ObjectStorage(s3, c.s3.bucket, publicClient),
          () => settings.limits(),
          jobs,
          clock,
          new Logger('files'),
          { presign: !!c.s3.publicUrl, thumbnailer: sharpThumbnailer },
        );
      },
    },
    SyncLifecycle,
  ],
  exports: [
    SYNC_BUS,
    JOB_QUEUE,
    PermissionService,
    MutationService,
    PullService,
    PageService,
    PublicPageService,
    ProjectionService,
    FileService,
    SearchService,
    LinkPreviewService,
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
