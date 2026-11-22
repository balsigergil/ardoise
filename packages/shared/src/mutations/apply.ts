// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure apply functions (ARCHITECTURE §8.2): the client runs them optimistically and the
 * server runs them to validate invariants and compute the post-change entities.
 * Permission checks happen on the server only, before `apply`.
 *
 * Subtree effects (path rewrite, trash, purge, duplicate of descendants) are not
 * expressed here: the server does them in SQL, the client derives them from parent_id.
 */
import type { ErrorCode } from '../errors.js';
import { MAX_PAGE_DEPTH, type PageDto, type PageParent } from '../pages.js';
import {
  entityIds,
  type Change,
  type EntityMap,
  type EntityType,
  type TeamspaceEntityDto,
} from '../sync.js';
import type { AnyMutation, MutationArgs, MutationName, MutationParent } from './catalog.js';

export interface EntityReader {
  /**
   * True on the server, which loads everything a mutation touches: a missing entity
   * then really is missing. The client store only holds a partial cache.
   */
  readonly authoritative: boolean;
  get<T extends EntityType>(type: T, id: string): EntityMap[T] | undefined;
  /**
   * The section (teamspace or private) a page belongs to, when known. Used for the
   * restore fallback; the client may not know it.
   */
  sectionOf?(pageId: string): PageParent | undefined;
}

export interface ApplyContext {
  actorId: string;
  workspaceId: string;
  /** ISO timestamp (server time on the server, local time for optimistic apply). */
  now: string;
}

export type ApplyResult = { ok: true; changes: Change[] } | { ok: false; code: ErrorCode };

const ok = (...changes: Change[]): ApplyResult => ({ ok: true, changes });
const reject = (code: ErrorCode): ApplyResult => ({ ok: false, code });

function livePage(reader: EntityReader, id: string): PageDto | ErrorCode {
  const page = reader.get('page', id);
  if (!page) return 'not_found';
  if (page.deletedAt) return 'page_in_trash';
  return page;
}

/** Ancestors of a page known to the reader, nearest first (the page excluded). */
export function knownAncestors(reader: EntityReader, page: PageDto): PageDto[] {
  const out: PageDto[] = [];
  let current = page;
  while (current.parentKind === 'page' || current.parentKind === 'database') {
    const parent = reader.get('page', current.parentId);
    if (!parent || out.length > MAX_PAGE_DEPTH) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

function isMoving(reader: EntityReader, page: PageDto): boolean {
  return (
    page.moveState === 'moving' ||
    knownAncestors(reader, page).some((p) => p.moveState === 'moving')
  );
}

/** Checks that `parent` can receive a child; returns the parent page if it is one. */
function checkParent(
  reader: EntityReader,
  parent: MutationParent,
  ctx: ApplyContext,
): PageDto | null | ErrorCode {
  if (parent.kind === 'private') return parent.id === ctx.actorId ? null : 'forbidden';
  if (parent.kind === 'teamspace') {
    if (reader.authoritative && !reader.get('teamspace', parent.id)) return 'not_found';
    return null;
  }
  const page = livePage(reader, parent.id);
  if (typeof page === 'string') return page;
  if (page.kind !== 'page') return 'invalid_parent';
  if (page.isLocked) return 'page_locked';
  if (knownAncestors(reader, page).length + 2 > MAX_PAGE_DEPTH) return 'too_deep';
  return page;
}

/** Where a page goes when its parent is gone (ADR 0006): its section root, else the actor's private section. */
function fallbackSection(reader: EntityReader, pageId: string, ctx: ApplyContext): PageParent {
  const section = reader.sectionOf?.(pageId);
  if (section?.kind === 'private') return section;
  if (section?.kind === 'teamspace' && reader.get('teamspace', section.id)) return section;
  return { kind: 'private', id: ctx.actorId };
}

function touch(page: PageDto, ctx: ApplyContext, patch: Partial<PageDto>): PageDto {
  return { ...page, ...patch, updatedBy: ctx.actorId, updatedAt: ctx.now };
}

function pageChange(page: PageDto): Change {
  return { type: 'page', id: page.id, op: 'upsert', data: page };
}

type Handler<N extends MutationName> = (
  reader: EntityReader,
  args: MutationArgs[N],
  ctx: ApplyContext,
) => ApplyResult;

const handlers: { [N in MutationName]: Handler<N> } = {
  'page.create': (reader, args, ctx) => {
    if (reader.get('page', args.id)) return reject('validation_failed');
    const parent = checkParent(reader, args.parent, ctx);
    if (typeof parent === 'string') return reject(parent);
    const page: PageDto = {
      id: args.id,
      kind: 'page',
      parentKind: args.parent.kind,
      parentId: args.parent.id,
      position: args.position,
      title: args.title,
      icon: args.icon,
      cover: null,
      width: 'normal',
      font: 'default',
      isLocked: false,
      restrictInheritance: false,
      isInline: false,
      isTemplate: false,
      moveState: null,
      createdBy: ctx.actorId,
      createdAt: ctx.now,
      updatedBy: ctx.actorId,
      updatedAt: ctx.now,
      deletedAt: null,
      deletedRootId: null,
      hasChildren: false,
    };
    return ok(pageChange(page));
  },

  'page.update': (reader, args, ctx) => {
    const page = livePage(reader, args.id);
    if (typeof page === 'string') return reject(page);
    const { id: _id, ...patch } = args;
    const editsBesidesLock = Object.keys(patch).some((k) => k !== 'isLocked');
    if (page.isLocked && patch.isLocked !== false && editsBesidesLock) return reject('page_locked');
    return ok(pageChange(touch(page, ctx, patch)));
  },

  'page.move': (reader, args, ctx) => {
    const page = livePage(reader, args.id);
    if (typeof page === 'string') return reject(page);
    if (page.isLocked) return reject('page_locked');
    if (isMoving(reader, page)) return reject('page_moving');
    if (args.parent.kind === 'page' && args.parent.id === page.id) return reject('move_cycle');
    const oldParent = page.parentKind === 'page' ? reader.get('page', page.parentId) : undefined;
    if (oldParent?.isLocked) return reject('page_locked');
    const parent = checkParent(reader, args.parent, ctx);
    if (typeof parent === 'string') return reject(parent);
    if (parent) {
      if (parent.moveState === 'moving') return reject('page_moving');
      for (const ancestor of knownAncestors(reader, parent)) {
        if (ancestor.id === page.id) return reject('move_cycle');
        if (ancestor.moveState === 'moving') return reject('page_moving');
      }
    }
    return ok(
      pageChange(
        touch(page, ctx, {
          parentKind: args.parent.kind,
          parentId: args.parent.id,
          position: args.position,
        }),
      ),
    );
  },

  'page.trash': (reader, args, ctx) => {
    const page = livePage(reader, args.id);
    if (typeof page === 'string') return reject(page);
    if (page.isLocked) return reject('page_locked');
    if (isMoving(reader, page)) return reject('page_moving');
    const parent = page.parentKind === 'page' ? reader.get('page', page.parentId) : undefined;
    if (parent?.isLocked) return reject('page_locked');
    return ok(pageChange(touch(page, ctx, { deletedAt: ctx.now, deletedRootId: page.id })));
  },

  'page.restore': (reader, args, ctx) => {
    const page = reader.get('page', args.id);
    if (!page) return reject('not_found');
    if (!page.deletedAt || page.deletedRootId !== page.id) return reject('page_not_in_trash');
    let target: PageParent = { kind: page.parentKind, id: page.parentId };
    if (page.parentKind === 'page') {
      const parent = reader.get('page', page.parentId);
      // The server knows the whole tree; the client keeps the parent when it does not know it.
      const parentGone = parent ? parent.deletedAt !== null : reader.authoritative;
      if (parentGone) target = fallbackSection(reader, page.id, ctx);
    }
    return ok(
      pageChange(
        touch(page, ctx, {
          deletedAt: null,
          deletedRootId: null,
          parentKind: target.kind,
          parentId: target.id,
        }),
      ),
    );
  },

  'page.purge': (reader, args) => {
    const page = reader.get('page', args.id);
    if (!page) return reject('not_found');
    if (!page.deletedAt || page.deletedRootId !== page.id) return reject('page_not_in_trash');
    return ok({ type: 'page', id: page.id, op: 'delete' });
  },

  'page.duplicate': (reader, args, ctx) => {
    const page = livePage(reader, args.id);
    if (typeof page === 'string') return reject(page);
    if (reader.get('page', args.newId)) return reject('validation_failed');
    const parent = page.parentKind === 'page' ? reader.get('page', page.parentId) : undefined;
    if (parent?.isLocked) return reject('page_locked');
    if (isMoving(reader, page)) return reject('page_moving');
    return ok(
      pageChange({
        ...page,
        id: args.newId,
        position: args.position,
        isLocked: false,
        moveState: null,
        createdBy: ctx.actorId,
        createdAt: ctx.now,
        updatedBy: ctx.actorId,
        updatedAt: ctx.now,
      }),
    );
  },

  'favorite.add': (reader, args) => {
    const page = reader.get('page', args.pageId);
    if (page?.deletedAt) return reject('page_in_trash');
    return ok({ type: 'favorite', id: args.pageId, op: 'upsert', data: { ...args } });
  },
  'favorite.remove': (_reader, args) => ok({ type: 'favorite', id: args.pageId, op: 'delete' }),
  'favorite.move': (reader, args) => {
    if (!reader.get('favorite', args.pageId)) return reject('not_found');
    return ok({ type: 'favorite', id: args.pageId, op: 'upsert', data: { ...args } });
  },
  'follow.add': (reader, args) => {
    const page = reader.get('page', args.pageId);
    if (page?.deletedAt) return reject('page_in_trash');
    return ok({ type: 'follow', id: args.pageId, op: 'upsert', data: { pageId: args.pageId } });
  },
  'follow.remove': (_reader, args) => ok({ type: 'follow', id: args.pageId, op: 'delete' }),

  'permission.grant': (reader, args) => {
    const page = livePage(reader, args.pageId);
    if (typeof page === 'string') return reject(page);
    const grant = {
      pageId: args.pageId,
      principalKind: args.principal.kind,
      principalId: args.principal.id,
      level: args.level,
    };
    return ok({ type: 'grant', id: entityIds.grant(grant), op: 'upsert', data: grant });
  },
  'permission.revoke': (_reader, args) =>
    ok({
      type: 'grant',
      id: entityIds.grant({
        pageId: args.pageId,
        principalKind: args.principal.kind,
        principalId: args.principal.id,
      }),
      op: 'delete',
    }),
  'permission.setRestrict': (reader, args, ctx) => {
    const page = livePage(reader, args.pageId);
    if (typeof page === 'string') return reject(page);
    return ok(pageChange(touch(page, ctx, { restrictInheritance: args.restrict })));
  },
  'permission.recover': (reader, args, ctx) => {
    const page = livePage(reader, args.pageId);
    if (typeof page === 'string') return reject(page);
    const grant = {
      pageId: args.pageId,
      principalKind: 'user' as const,
      principalId: ctx.actorId,
      level: 'full_access' as const,
    };
    return ok({ type: 'grant', id: entityIds.grant(grant), op: 'upsert', data: grant });
  },
  'publicLink.set': (reader, args) => {
    const page = livePage(reader, args.pageId);
    if (typeof page === 'string') return reject(page);
    return args.enabled
      ? ok({
          type: 'publicLink',
          id: args.pageId,
          op: 'upsert',
          data: { pageId: args.pageId, includeSubpages: args.includeSubpages },
        })
      : ok({ type: 'publicLink', id: args.pageId, op: 'delete' });
  },

  'workspace.update': (reader, args, ctx) => {
    const workspace = reader.get('workspace', ctx.workspaceId);
    if (!workspace) return reject('not_found');
    return ok({
      type: 'workspace',
      id: workspace.id,
      op: 'upsert',
      data: { ...workspace, ...args },
    });
  },
  'teamspace.create': (reader, args, ctx) => {
    if (reader.get('teamspace', args.id)) return reject('validation_failed');
    const teamspace: TeamspaceEntityDto = { ...args };
    const owner = { teamspaceId: args.id, userId: ctx.actorId, role: 'owner' as const };
    return ok(
      { type: 'teamspace', id: args.id, op: 'upsert', data: teamspace },
      { type: 'teamspaceMember', id: entityIds.teamspaceMember(owner), op: 'upsert', data: owner },
    );
  },
  'teamspace.update': (reader, args) => {
    const teamspace = reader.get('teamspace', args.id);
    if (!teamspace) return reject('not_found');
    return ok({ type: 'teamspace', id: args.id, op: 'upsert', data: { ...teamspace, ...args } });
  },
  'teamspace.join': (reader, args, ctx) => {
    const member = { teamspaceId: args.teamspaceId, userId: ctx.actorId, role: 'member' as const };
    const id = entityIds.teamspaceMember(member);
    if (reader.get('teamspaceMember', id)) return reject('already_member');
    return ok({ type: 'teamspaceMember', id, op: 'upsert', data: member });
  },
  'teamspace.addMember': (reader, args) => {
    const id = entityIds.teamspaceMember(args);
    if (reader.get('teamspaceMember', id)) return reject('already_member');
    return ok({ type: 'teamspaceMember', id, op: 'upsert', data: { ...args } });
  },
  'teamspace.setMemberRole': (reader, args) => {
    const id = entityIds.teamspaceMember(args);
    if (!reader.get('teamspaceMember', id)) return reject('not_found');
    return ok({ type: 'teamspaceMember', id, op: 'upsert', data: { ...args } });
  },
  'teamspace.removeMember': (_reader, args) =>
    ok({ type: 'teamspaceMember', id: entityIds.teamspaceMember(args), op: 'delete' }),
  'member.setRole': (reader, args) => {
    const member = reader.get('member', args.userId);
    if (!member) return reject('not_found');
    return ok({
      type: 'member',
      id: args.userId,
      op: 'upsert',
      data: { ...member, role: args.role },
    });
  },
  'member.remove': (_reader, args) => ok({ type: 'member', id: args.userId, op: 'delete' }),
};

export function applyMutation(
  reader: EntityReader,
  mutation: Pick<AnyMutation, 'name' | 'args'>,
  ctx: ApplyContext,
): ApplyResult {
  const handler = handlers[mutation.name] as Handler<MutationName>;
  return handler(reader, mutation.args, ctx);
}
