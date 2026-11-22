// SPDX-License-Identifier: AGPL-3.0-only
/** Handlers for `page.*`, `favorite.*` and `follow.*` mutations (M2 plan: required levels). */
import {
  atLeast,
  DomainError,
  MAX_PAGE_DEPTH,
  idsFromPath,
  type Change,
  type MutationParent,
  type PageDto,
  type PageParent,
  type PermissionLevel,
  type TeamspaceEntityDto,
} from '@ardoise/shared';
import type {
  MutationContext,
  MutationHandler,
  MutationHandlers,
} from '../sync/mutation.service.js';
import type { PageRecord } from '../store/store.js';
import { toTeamspaceEntity } from '../workspaces/workspace-mutations.js';
import { patchFromDto, toPageDto } from './page-dto.js';
import { assertNotBusy, childPath, copyDescendants, SUBTREE_INLINE_LIMIT } from './page-tree.js';

type PageHandlers = Pick<
  MutationHandlers,
  | 'page.create'
  | 'page.update'
  | 'page.move'
  | 'page.trash'
  | 'page.restore'
  | 'page.purge'
  | 'page.duplicate'
  | 'favorite.add'
  | 'favorite.remove'
  | 'favorite.move'
  | 'follow.add'
  | 'follow.remove'
>;

async function loadPage(ctx: MutationContext, id: string): Promise<PageRecord> {
  const page = await ctx.store.pages.findById(ctx.workspaceId, id);
  if (!page) throw new DomainError('not_found');
  return page;
}

/** Loads a page and checks the actor's level on it (fresh, inside the transaction). */
export async function requirePage(
  ctx: MutationContext,
  id: string,
  required: PermissionLevel,
): Promise<PageRecord> {
  const page = await loadPage(ctx, id);
  await ctx.permissions.require(ctx.workspaceId, ctx.subject, page, required, ctx.store);
  return page;
}

/**
 * Checks that the actor may add a child under `parent`: Can edit on a parent page, the
 * root's level on a teamspace (members), their own private section. Guests cannot
 * create top-level pages. Returns the parent page and its ancestors, if any.
 */
async function requireParent(
  ctx: MutationContext,
  parent: MutationParent | PageParent,
): Promise<{ page: PageRecord | null; ancestors: PageRecord[]; teamspace?: TeamspaceEntityDto }> {
  if (parent.kind === 'page') {
    const page = await loadPage(ctx, parent.id);
    const evaluation = await ctx.permissions.evaluate(
      ctx.workspaceId,
      ctx.subject,
      page,
      ctx.store,
    );
    if (!atLeast(evaluation.level, 'can_view')) throw new DomainError('not_found');
    if (!atLeast(evaluation.level, 'can_edit')) throw new DomainError('forbidden');
    return { page, ancestors: evaluation.pages.slice(1) };
  }
  if (ctx.member.role === 'guest') throw new DomainError('forbidden');
  if (parent.kind === 'private') {
    if (parent.id !== ctx.actor.id) throw new DomainError('forbidden');
    return { page: null, ancestors: [] };
  }
  if (parent.kind === 'teamspace') {
    const teamspace = await ctx.store.teamspaces.findById(ctx.workspaceId, parent.id);
    if (!teamspace) throw new DomainError('not_found');
    const level = ctx.permissions.rootLevel(ctx.subject, {
      kind: 'teamspace',
      teamspaceId: teamspace.id,
      defaultLevel: teamspace.defaultLevel,
    });
    if (!atLeast(level, 'can_edit')) throw new DomainError('forbidden');
    return { page: null, ancestors: [], teamspace: toTeamspaceEntity(teamspace) };
  }
  throw new DomainError('invalid_parent');
}

const dtos = (pages: readonly PageRecord[]) => pages.map((p) => toPageDto(p, false));

/** The section (teamspace or private) of a page, from the top of its path. */
async function sectionOf(ctx: MutationContext, page: PageRecord): Promise<PageParent | undefined> {
  const topId = idsFromPath(page.path)[0]!;
  const top = topId === page.id ? page : await ctx.store.pages.findById(ctx.workspaceId, topId);
  if (!top) return undefined;
  if (top.parentKind === 'teamspace' || top.parentKind === 'private')
    return { kind: top.parentKind, id: top.parentId };
  return undefined;
}

function pageResult(changes: Change[]): PageDto {
  const change = changes.find((c) => c.type === 'page');
  if (!change || change.op !== 'upsert') throw new DomainError('internal_error');
  return change.data;
}

async function emitPage(ctx: MutationContext, dto: PageDto): Promise<void> {
  const hasChildren = (await ctx.store.pages.withChildren(ctx.workspaceId, [dto.id])).has(dto.id);
  ctx.emit(
    { type: 'page', id: dto.id, op: 'upsert', data: { ...dto, hasChildren } },
    { pageId: dto.id },
  );
}

/**
 * Re-roots a subtree after a move or a restore elsewhere: inline below the threshold,
 * otherwise flags the root `moving` and leaves the rewrite to a job.
 */
async function relocate(
  ctx: MutationContext,
  page: PageRecord,
  dto: PageDto,
  newParent: PageRecord | null,
): Promise<PageDto> {
  const newPath = childPath(newParent, page.id);
  if (newPath === page.path) return dto;
  // The whole subtree must still fit under the depth limit (ADR 0007).
  const height = await ctx.store.pages.subtreeHeight(ctx.workspaceId, page.path);
  if (newPath.split('.').length + height > MAX_PAGE_DEPTH) throw new DomainError('too_deep');
  ctx.access('page', page.id);
  const size = await ctx.store.pages.subtreeSize(ctx.workspaceId, page.path, SUBTREE_INLINE_LIMIT);
  if (size <= SUBTREE_INLINE_LIMIT) {
    await ctx.store.pages.rewritePaths(ctx.workspaceId, page.path, newPath);
    return dto;
  }
  ctx.enqueue('page.moveSubtree', {
    workspaceId: ctx.workspaceId,
    pageId: page.id,
    actorId: ctx.actor.id,
  });
  return { ...dto, moveState: 'moving' };
}

export function pageHandlers(): PageHandlers {
  const lockFirst = <N extends keyof PageHandlers>(
    run: MutationHandler<N>['run'],
  ): MutationHandler<N> => ({ lockFirst: true, run });
  const lockLast = <N extends keyof PageHandlers>(
    run: MutationHandler<N>['run'],
  ): MutationHandler<N> => ({ lockFirst: false, run });

  return {
    'page.create': lockFirst(async (ctx, args) => {
      if (await ctx.store.pages.findById(ctx.workspaceId, args.id))
        throw new DomainError('validation_failed');
      const parent = await requireParent(ctx, args.parent);
      const changes = ctx.apply('page.create', args, {
        page: dtos(parent.page ? [parent.page, ...parent.ancestors] : []),
        teamspace: parent.teamspace ? [parent.teamspace] : [],
      });
      const dto = pageResult(changes);
      await ctx.store.pages.insert({
        workspaceId: ctx.workspaceId,
        id: dto.id,
        kind: 'page',
        path: childPath(parent.page, dto.id),
        isInline: false,
        isTemplate: false,
        ...patchFromDto(dto),
        createdBy: ctx.actor.id,
        createdAt: ctx.now,
      });
      await emitPage(ctx, dto);
    }),

    'page.update': lockLast(async (ctx, args) => {
      const page = await requirePage(
        ctx,
        args.id,
        args.isLocked !== undefined ? 'full_access' : 'can_edit',
      );
      const dto = pageResult(ctx.apply('page.update', args, { page: dtos([page]) }));
      await ctx.store.pages.update(ctx.workspaceId, page.id, patchFromDto(dto));
      await emitPage(ctx, dto);
    }),

    'page.move': lockFirst(async (ctx, args) => {
      const page = await requirePage(ctx, args.id, 'can_edit');
      const parent = await requireParent(ctx, args.parent);
      if (
        parent.page &&
        (parent.page.path === page.path || parent.page.path.startsWith(`${page.path}.`))
      )
        throw new DomainError('move_cycle');
      await assertNotBusy(ctx.store, page);
      const oldParent =
        page.parentKind === 'page'
          ? await ctx.store.pages.findById(ctx.workspaceId, page.parentId)
          : undefined;
      const known = [
        page,
        ...(oldParent ? [oldParent] : []),
        ...(parent.page ? [parent.page, ...parent.ancestors] : []),
      ];
      const dto = pageResult(
        ctx.apply('page.move', args, {
          page: dtos([...new Map(known.map((p) => [p.id, p])).values()]),
          teamspace: parent.teamspace ? [parent.teamspace] : [],
        }),
      );
      const final = await relocate(ctx, page, dto, parent.page);
      await ctx.store.pages.update(ctx.workspaceId, page.id, patchFromDto(final));
      await emitPage(ctx, final);
    }),

    'page.trash': lockFirst(async (ctx, args) => {
      const page = await requirePage(ctx, args.id, 'can_edit');
      await assertNotBusy(ctx.store, page);
      const parent =
        page.parentKind === 'page'
          ? await ctx.store.pages.findById(ctx.workspaceId, page.parentId)
          : undefined;
      const dto = pageResult(
        ctx.apply('page.trash', args, { page: dtos(parent ? [page, parent] : [page]) }),
      );
      await ctx.store.pages.trashSubtree(ctx.workspaceId, page.path, page.id, ctx.now);
      await ctx.store.pages.update(ctx.workspaceId, page.id, patchFromDto(dto));
      await emitPage(ctx, dto);
    }),

    'page.restore': lockFirst(async (ctx, args) => {
      const page = await requirePage(ctx, args.id, 'can_edit');
      const parent =
        page.parentKind === 'page'
          ? await ctx.store.pages.findById(ctx.workspaceId, page.parentId)
          : undefined;
      const section = await sectionOf(ctx, page);
      const teamspace =
        section?.kind === 'teamspace'
          ? await ctx.store.teamspaces.findById(ctx.workspaceId, section.id)
          : undefined;
      const dto = pageResult(
        ctx.apply(
          'page.restore',
          args,
          {
            page: dtos(parent ? [page, parent] : [page]),
            teamspace: teamspace ? [toTeamspaceEntity(teamspace)] : [],
          },
          () => section,
        ),
      );
      await ctx.store.pages.restoreSubtree(ctx.workspaceId, page.path, page.id);
      const newParent = dto.parentKind === 'page' ? (parent ?? null) : null;
      const final = await relocate(ctx, page, dto, newParent);
      await ctx.store.pages.update(ctx.workspaceId, page.id, patchFromDto(final));
      await emitPage(ctx, final);
    }),

    'page.purge': lockFirst(async (ctx, args) => {
      const page = await requirePage(ctx, args.id, 'full_access');
      ctx.apply('page.purge', args, { page: dtos([page]) });
      await ctx.store.pages.purgeSubtree(ctx.workspaceId, page.path);
      ctx.emit({ type: 'page', id: page.id, op: 'delete' }, { pageId: page.id });
    }),

    'page.duplicate': lockFirst(async (ctx, args) => {
      const source = await requirePage(ctx, args.id, 'can_view');
      if (await ctx.store.pages.findById(ctx.workspaceId, args.newId))
        throw new DomainError('validation_failed');
      if (source.parentKind === 'database') throw new DomainError('invalid_parent');
      const parent = await requireParent(ctx, { kind: source.parentKind, id: source.parentId });
      await assertNotBusy(ctx.store, source);
      const dto = pageResult(
        ctx.apply('page.duplicate', args, {
          page: dtos(parent.page ? [source, parent.page] : [source]),
        }),
      );
      const copy: PageRecord = {
        ...source,
        ...patchFromDto(dto),
        id: dto.id,
        path: childPath(parent.page, dto.id),
        createdBy: ctx.actor.id,
        createdAt: ctx.now,
      };
      const size = await ctx.store.pages.subtreeSize(
        ctx.workspaceId,
        source.path,
        SUBTREE_INLINE_LIMIT,
      );
      const large = size > SUBTREE_INLINE_LIMIT;
      if (large) copy.moveState = 'moving';
      await ctx.store.pages.insert(copy);
      const grants = await ctx.store.grants.forPages(ctx.workspaceId, [source.id]);
      await ctx.store.grants.insertMany(
        ctx.workspaceId,
        grants.map((g) => ({ ...g, pageId: copy.id, createdBy: ctx.actor.id, createdAt: ctx.now })),
      );
      if (large) {
        ctx.enqueue('page.duplicateSubtree', {
          workspaceId: ctx.workspaceId,
          sourceId: source.id,
          newId: copy.id,
          actorId: ctx.actor.id,
        });
      } else if (size > 1) {
        await copyDescendants(ctx.store, source, copy, ctx.actor.id, ctx.now);
      }
      if (grants.length > 0) ctx.access('page', copy.id);
      await emitPage(ctx, toPageDto(copy, false));
    }),

    'favorite.add': lockLast(async (ctx, args) => {
      const page = await requirePage(ctx, args.pageId, 'can_view');
      const [change] = ctx.apply('favorite.add', args, { page: dtos([page]) });
      await ctx.store.userPages.setFavorite(ctx.workspaceId, ctx.actor.id, args);
      ctx.emit(change!, { pageId: page.id, userId: ctx.actor.id });
    }),
    'favorite.remove': lockLast(async (ctx, args) => {
      if (await ctx.store.userPages.removeFavorite(ctx.workspaceId, ctx.actor.id, args.pageId))
        ctx.emit({ type: 'favorite', id: args.pageId, op: 'delete' }, { userId: ctx.actor.id });
    }),
    'favorite.move': lockLast(async (ctx, args) => {
      const favorite = await ctx.store.userPages.favorite(
        ctx.workspaceId,
        ctx.actor.id,
        args.pageId,
      );
      const [change] = ctx.apply('favorite.move', args, { favorite: favorite ? [favorite] : [] });
      await ctx.store.userPages.setFavorite(ctx.workspaceId, ctx.actor.id, args);
      ctx.emit(change!, { pageId: args.pageId, userId: ctx.actor.id });
    }),
    'follow.add': lockLast(async (ctx, args) => {
      const page = await requirePage(ctx, args.pageId, 'can_view');
      const [change] = ctx.apply('follow.add', args, { page: dtos([page]) });
      await ctx.store.userPages.follow(ctx.workspaceId, ctx.actor.id, page.id);
      ctx.emit(change!, { pageId: page.id, userId: ctx.actor.id });
    }),
    'follow.remove': lockLast(async (ctx, args) => {
      if (await ctx.store.userPages.unfollow(ctx.workspaceId, ctx.actor.id, args.pageId))
        ctx.emit({ type: 'follow', id: args.pageId, op: 'delete' }, { userId: ctx.actor.id });
    }),
  };
}
