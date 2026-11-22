// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `sync` module: the mutation pipeline (ARCHITECTURE §6). Each mutation runs in its own
 * transaction: validate, check permission and invariants, apply, append change-log
 * entries with gap-free seqs, record the result for idempotency.
 */
import {
  applyMutation,
  DomainError,
  isErrorCode,
  parseMutation,
  type ApplyResult,
  type Change,
  type EntityMap,
  type EntityReader,
  type EntityType,
  type MutationArgs,
  type MutationEnvelope,
  type MutationName,
  type MutationResult,
  type PageParent,
  type Subject,
} from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import type { Clock } from '../common/clock.js';
import type { JobName, JobPayloads, JobQueue } from '../jobs/jobs.js';
import type { PermissionService } from '../permissions/permission.service.js';
import type { MemberRecord, Store, UserRecord } from '../store/store.js';
import { appendEntries } from './change-log.js';
import type { SyncEventBus } from './pokes.js';

export interface EntryScope {
  /** The page that governs access to the entity. */
  pageId?: string | null;
  /** Delivered to this user only (user-private entities). */
  userId?: string | null;
}

/** State of one mutation while it runs inside its transaction. */
export class MutationContext {
  readonly entries: { change: Change; scope: EntryScope }[] = [];
  permissionsChanged = false;
  readonly jobs: { name: JobName; data: unknown }[] = [];
  readonly events: (() => Promise<void>)[] = [];

  constructor(
    readonly store: Store,
    readonly actor: UserRecord,
    readonly member: MemberRecord,
    readonly subject: Subject,
    readonly workspaceId: string,
    readonly mutationId: string,
    readonly now: Date,
    readonly permissions: PermissionService,
    readonly logger: Logger,
  ) {}

  emit(change: Change, scope: EntryScope = {}): void {
    this.entries.push({ change, scope });
  }

  /** Signals an access change on a scope (ADR 0003 item 6) and invalidates the cache. */
  access(
    scope: 'page' | 'teamspace' | 'workspace',
    id: string,
    userIds: string[] | null = null,
  ): void {
    this.permissionsChanged = true;
    this.emit({
      type: 'access',
      id: `${this.mutationId}:${this.entries.length}`,
      op: 'upsert',
      data: { scope, id, userIds },
    });
  }

  enqueue<N extends JobName>(name: N, data: JobPayloads[N]): void {
    this.jobs.push({ name, data });
  }

  afterCommit(fn: () => Promise<void>): void {
    this.events.push(fn);
  }

  /** Runs the shared apply function over loaded entities; rejections become DomainErrors. */
  apply<N extends MutationName>(
    name: N,
    args: MutationArgs[N],
    entities: Partial<{ [T in EntityType]: EntityMap[T][] }>,
    sectionOf?: (pageId: string) => PageParent | undefined,
  ): Change[] {
    const reader = new LoadedReader(entities, sectionOf);
    const result: ApplyResult = applyMutation(
      reader,
      { name, args },
      {
        actorId: this.actor.id,
        workspaceId: this.workspaceId,
        now: this.now.toISOString(),
      },
    );
    if (!result.ok) throw new DomainError(result.code);
    return result.changes;
  }
}

const ENTITY_KEYS: { [T in EntityType]: (e: EntityMap[T]) => string } = {
  page: (e) => e.id,
  favorite: (e) => e.pageId,
  follow: (e) => e.pageId,
  grant: (e) => `${e.pageId}:${e.principalKind}:${e.principalId}`,
  publicLink: (e) => e.pageId,
  workspace: (e) => e.id,
  member: (e) => e.userId,
  teamspace: (e) => e.id,
  teamspaceMember: (e) => `${e.teamspaceId}:${e.userId}`,
  access: (e) => e.id,
};

/** The server's reader: everything a mutation touches was loaded, so absence is real. */
class LoadedReader implements EntityReader {
  readonly authoritative = true;
  private readonly map = new Map<string, unknown>();
  constructor(
    entities: Partial<{ [T in EntityType]: EntityMap[T][] }>,
    private readonly section?: (pageId: string) => PageParent | undefined,
  ) {
    for (const [type, list] of Object.entries(entities) as [
      EntityType,
      EntityMap[EntityType][],
    ][]) {
      const keyOf = ENTITY_KEYS[type] as (e: unknown) => string;
      for (const e of list) this.map.set(`${type}/${keyOf(e)}`, e);
    }
  }
  get<T extends EntityType>(type: T, id: string): EntityMap[T] | undefined {
    return this.map.get(`${type}/${id}`) as EntityMap[T] | undefined;
  }
  sectionOf(pageId: string): PageParent | undefined {
    return this.section?.(pageId);
  }
}

export interface MutationHandler<N extends MutationName> {
  /**
   * Lock the workspace counter row before running, so tree and membership invariants
   * are checked against a stable state (ADR 0006 item 6). Otherwise it is locked last.
   */
  lockFirst: boolean;
  run(ctx: MutationContext, args: MutationArgs[N]): Promise<void>;
}

export type MutationHandlers = { [N in MutationName]: MutationHandler<N> };

class DuplicateMutation extends Error {}

export class MutationService {
  constructor(
    private readonly store: Store,
    private readonly handlers: MutationHandlers,
    private readonly permissions: PermissionService,
    private readonly jobs: JobQueue,
    private readonly bus: SyncEventBus,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Processes an ordered batch; every mutation gets its own transaction. */
  async push(actor: UserRecord, envelopes: readonly MutationEnvelope[]): Promise<MutationResult[]> {
    const results: MutationResult[] = [];
    const pokes = new Map<string, number>();
    for (const envelope of envelopes) {
      const result = await this.processOne(actor, envelope);
      results.push(result);
      if (result.seq !== undefined) pokes.set(envelope.workspaceId, result.seq);
    }
    for (const [workspaceId, seq] of pokes) {
      await this.bus.publish({ type: 'poke', workspaceId, seq }).catch((error: unknown) => {
        this.logger.warn({ err: error, workspaceId }, 'poke publish failed');
      });
    }
    return results;
  }

  private async processOne(actor: UserRecord, envelope: MutationEnvelope): Promise<MutationResult> {
    const { workspaceId, id } = envelope;
    const previous = await this.recorded(workspaceId, id);
    if (previous) return previous;

    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    // Non-members learn nothing about the workspace, and nothing is recorded.
    if (!member) return { id, status: 'rejected', code: 'not_found' };

    const mutation = parseMutation(envelope);
    if (!mutation) return this.reject(workspaceId, actor, id, 'validation_failed');

    try {
      const { result, ctx } = await this.store.transaction(async (store) => {
        const handler = this.handlers[mutation.name] as MutationHandler<MutationName>;
        if (handler.lockFirst) await store.changeLog.lockCounter(workspaceId);
        const subject = await this.permissions.subject(workspaceId, actor.id, member.role, store);
        const ctx = new MutationContext(
          store,
          actor,
          member,
          subject,
          workspaceId,
          id,
          this.clock.now(),
          this.permissions,
          this.logger,
        );
        await handler.run(ctx, mutation.args);
        if (ctx.permissionsChanged) await store.workspaces.bumpPermEpoch(workspaceId);
        const seq = await appendEntries(store, workspaceId, ctx.entries, {
          mutationId: id,
          actorId: actor.id,
          at: ctx.now,
        });
        const result: MutationResult = { id, status: 'applied', ...(seq !== undefined && { seq }) };
        if (!(await store.appliedMutations.insert(workspaceId, id, actor.id, result, ctx.now)))
          throw new DuplicateMutation();
        return { result, ctx };
      });
      for (const job of ctx.jobs) {
        await this.jobs.enqueue(job.name, job.data as never).catch((error: unknown) => {
          this.logger.error({ err: error, job: job.name }, 'job enqueue failed');
        });
      }
      for (const event of ctx.events) await event().catch(() => undefined);
      return result;
    } catch (error) {
      if (error instanceof DuplicateMutation) {
        return (
          (await this.recorded(workspaceId, id)) ?? {
            id,
            status: 'rejected',
            code: 'internal_error',
          }
        );
      }
      if (error instanceof DomainError) return this.reject(workspaceId, actor, id, error.code);
      throw error;
    }
  }

  private async recorded(workspaceId: string, id: string): Promise<MutationResult | undefined> {
    const stored = await this.store.appliedMutations.find(workspaceId, id);
    return stored ? (stored as MutationResult) : undefined;
  }

  /** Rejections are recorded too, so a retry gets the same answer. */
  private async reject(
    workspaceId: string,
    actor: UserRecord,
    id: string,
    code: string,
  ): Promise<MutationResult> {
    const result: MutationResult = {
      id,
      status: 'rejected',
      code: isErrorCode(code) ? code : 'internal_error',
    };
    const inserted = await this.store.appliedMutations.insert(
      workspaceId,
      id,
      actor.id,
      result,
      this.clock.now(),
    );
    return inserted ? result : ((await this.recorded(workspaceId, id)) ?? result);
  }
}
