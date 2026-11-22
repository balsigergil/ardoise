// SPDX-License-Identifier: AGPL-3.0-only
/** Handlers for `permission.*` and `publicLink.set` (ARCHITECTURE §9, ADR 0004/0006). */
import { DomainError, newId, type GrantDto, type PageDto } from '@ardoise/shared';
import { randomToken, type SecretKeyring } from '../common/crypto.js';
import type { MutationContext, MutationHandlers } from '../sync/mutation.service.js';
import type { PrincipalRef } from '../store/store.js';
import { patchFromDto, toPageDto } from './page-dto.js';
import { requirePage } from './page-mutations.js';

type SharingHandlers = Pick<
  MutationHandlers,
  | 'permission.grant'
  | 'permission.revoke'
  | 'permission.setRestrict'
  | 'permission.recover'
  | 'publicLink.set'
>;

/** Grants go to members, existing teamspaces or this workspace only. */
async function checkPrincipal(ctx: MutationContext, principal: PrincipalRef): Promise<void> {
  const ok =
    principal.kind === 'user'
      ? (await ctx.store.workspaces.membership(ctx.workspaceId, principal.id)) !== undefined
      : principal.kind === 'teamspace'
        ? (await ctx.store.teamspaces.findById(ctx.workspaceId, principal.id)) !== undefined
        : principal.kind === 'workspace' && principal.id === ctx.workspaceId;
  if (!ok) throw new DomainError('not_found');
}

function emitGrant(ctx: MutationContext, grant: GrantDto): void {
  ctx.emit(
    {
      type: 'grant',
      id: `${grant.pageId}:${grant.principalKind}:${grant.principalId}`,
      op: 'upsert',
      data: grant,
    },
    { pageId: grant.pageId },
  );
  ctx.access('page', grant.pageId);
}

export function sharingHandlers(keyring: SecretKeyring): SharingHandlers {
  return {
    'permission.grant': {
      lockFirst: false,
      async run(ctx, args) {
        const page = await requirePage(ctx, args.pageId, 'full_access');
        await checkPrincipal(ctx, args.principal);
        const [change] = ctx.apply('permission.grant', args, { page: [toPageDto(page, false)] });
        const grant = (change as { data: GrantDto }).data;
        await ctx.store.grants.upsert(ctx.workspaceId, {
          ...grant,
          createdBy: ctx.actor.id,
          createdAt: ctx.now,
        });
        emitGrant(ctx, grant);
      },
    },
    'permission.revoke': {
      lockFirst: false,
      async run(ctx, args) {
        await requirePage(ctx, args.pageId, 'full_access');
        const [change] = ctx.apply('permission.revoke', args, {});
        if (await ctx.store.grants.delete(ctx.workspaceId, args.pageId, args.principal)) {
          ctx.emit(change!, { pageId: args.pageId });
          ctx.access('page', args.pageId);
        }
      },
    },
    'permission.setRestrict': {
      lockFirst: false,
      async run(ctx, args) {
        const page = await requirePage(ctx, args.pageId, 'full_access');
        const [change] = ctx.apply('permission.setRestrict', args, {
          page: [toPageDto(page, false)],
        });
        const dto = (change as { data: PageDto }).data;
        await ctx.store.pages.update(ctx.workspaceId, page.id, patchFromDto(dto));
        const hasChildren = (await ctx.store.pages.withChildren(ctx.workspaceId, [page.id])).has(
          page.id,
        );
        ctx.emit(
          { type: 'page', id: page.id, op: 'upsert', data: { ...dto, hasChildren } },
          { pageId: page.id },
        );
        ctx.access('page', page.id);
        // Restricting never locks out the person doing it: they keep Full access.
        if (args.restrict) {
          const after = await ctx.permissions.level(
            ctx.workspaceId,
            ctx.subject,
            { ...page, restrictInheritance: true },
            ctx.store,
          );
          if (after !== 'full_access') {
            const grant: GrantDto = {
              pageId: page.id,
              principalKind: 'user',
              principalId: ctx.actor.id,
              level: 'full_access',
            };
            await ctx.store.grants.upsert(ctx.workspaceId, {
              ...grant,
              createdBy: ctx.actor.id,
              createdAt: ctx.now,
            });
            emitGrant(ctx, grant);
          }
        }
      },
    },
    /** Workspace owners only, for non-private pages; explicit and logged (PRODUCT §13). */
    'permission.recover': {
      lockFirst: false,
      async run(ctx, args) {
        if (ctx.member.role !== 'owner') throw new DomainError('forbidden');
        const page = await ctx.store.pages.findById(ctx.workspaceId, args.pageId);
        if (!page) throw new DomainError('not_found');
        const { root } = await ctx.permissions.evaluate(
          ctx.workspaceId,
          ctx.subject,
          page,
          ctx.store,
        );
        if (root?.kind !== 'teamspace') throw new DomainError('forbidden');
        const [change] = ctx.apply('permission.recover', args, { page: [toPageDto(page, false)] });
        const grant = (change as { data: GrantDto }).data;
        await ctx.store.grants.upsert(ctx.workspaceId, {
          ...grant,
          createdBy: ctx.actor.id,
          createdAt: ctx.now,
        });
        ctx.logger.warn(
          {
            audit: 'access_recovered',
            workspaceId: ctx.workspaceId,
            pageId: page.id,
            actorId: ctx.actor.id,
          },
          'workspace owner recovered access to a page',
        );
        emitGrant(ctx, grant);
      },
    },
    'publicLink.set': {
      lockFirst: false,
      async run(ctx, args) {
        const page = await requirePage(ctx, args.pageId, 'full_access');
        const [change] = ctx.apply('publicLink.set', args, { page: [toPageDto(page, false)] });
        const active = await ctx.store.publicLinks.active(ctx.workspaceId, page.id);
        if (!args.enabled) {
          if (!active) return;
          await ctx.store.publicLinks.revoke(ctx.workspaceId, page.id, ctx.now);
        } else if (active) {
          await ctx.store.publicLinks.update(ctx.workspaceId, active.id, {
            includeSubpages: args.includeSubpages,
          });
        } else {
          const token = randomToken();
          await ctx.store.publicLinks.insert({
            workspaceId: ctx.workspaceId,
            id: newId(),
            pageId: page.id,
            tokenHash: keyring.lookupHash(token),
            tokenEncrypted: keyring.encrypt(token),
            includeSubpages: args.includeSubpages,
            createdBy: ctx.actor.id,
            createdAt: ctx.now,
            revokedAt: null,
          });
        }
        ctx.emit(change!, { pageId: page.id });
      },
    },
  };
}
