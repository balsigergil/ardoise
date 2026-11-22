// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pages` module: scoped reads (ARCHITECTURE §7). Every read checks permission through
 * `PermissionService`, is bounded, and carries the seq it was read at (read first, so
 * the data is at least that recent).
 */
import {
  atLeast,
  canSeeTeamspace,
  DomainError,
  idsFromPath,
  type PageDetailDto,
  type PageListDto,
  type PageListQuery,
  type RecentDto,
  type SharingDto,
  type SharingGrantDto,
  type Subject,
  type TrashQuery,
} from '@ardoise/shared';
import type { SecretKeyring } from '../common/crypto.js';
import type { Clock } from '../common/clock.js';
import type { PermissionService } from '../permissions/permission.service.js';
import { decodeCursor, encodeCursor } from '../store/cursor.js';
import type {
  MemberRecord,
  PageRecord,
  PageWithChildren,
  PrincipalRef,
  Store,
  UserRecord,
} from '../store/store.js';
import { toPageDto } from './page-dto.js';

export const MAX_FAVORITES = 500;
export const MAX_RECENTS = 50;

export class PageService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly keyring: SecretKeyring,
    private readonly clock: Clock,
    private readonly publicUrl: string,
  ) {}

  private async context(
    actor: UserRecord,
    workspaceId: string,
  ): Promise<{ member: MemberRecord; subject: Subject }> {
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');
    const subject = await this.permissions.subject(workspaceId, actor.id, member.role);
    return { member, subject };
  }

  private async viewable(workspaceId: string, actor: UserRecord, pageId: string) {
    const ctx = await this.context(actor, workspaceId);
    const page = await this.store.pages.findById(workspaceId, pageId);
    if (!page) throw new DomainError('not_found');
    const level = await this.permissions.require(workspaceId, ctx.subject, page, 'can_view');
    return { ...ctx, page, level };
  }

  /** Keeps the rows the subject can view, preserving order. */
  private async filterViewable<T extends PageRecord>(
    workspaceId: string,
    subject: Subject,
    rows: T[],
  ): Promise<T[]> {
    const levels = await this.permissions.levels(workspaceId, subject, rows);
    return rows.filter((r) => atLeast(levels.get(r.id) ?? 'no_access', 'can_view'));
  }

  private async listChildren(
    workspaceId: string,
    subject: Subject,
    parentId: string,
    query: PageListQuery,
    seq: number,
  ): Promise<PageListDto> {
    const after = decodeCursor(query.cursor, 2);
    const rows = await this.store.pages.children(
      workspaceId,
      parentId,
      after ? { position: after[0]!, id: after[1]! } : null,
      query.limit,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const visible = await this.filterViewable(workspaceId, subject, page);
    return {
      seq,
      items: visible.map((p: PageWithChildren) => toPageDto(p, p.hasChildren)),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.position, last.id]) : null,
    };
  }

  /** Children of a page the user can view; children without access are hidden. */
  async children(
    actor: UserRecord,
    workspaceId: string,
    pageId: string,
    query: PageListQuery,
  ): Promise<PageListDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject, page } = await this.viewable(workspaceId, actor, pageId);
    if (page.deletedAt) return { seq, items: [], nextCursor: null };
    return this.listChildren(workspaceId, subject, page.id, query, seq);
  }

  /** Top-level pages of a teamspace the user can see. */
  async teamspaceRoots(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    query: PageListQuery,
  ): Promise<PageListDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { member, subject } = await this.context(actor, workspaceId);
    const teamspace = await this.store.teamspaces.findById(workspaceId, teamspaceId);
    if (
      !teamspace ||
      !canSeeTeamspace({
        workspaceRole: member.role,
        teamspaceRole: subject.teamspaceRoles.get(teamspaceId),
        visibility: teamspace.visibility,
      })
    )
      throw new DomainError('not_found');
    return this.listChildren(workspaceId, subject, teamspaceId, query, seq);
  }

  /** The user's own private pages. */
  async privateRoots(
    actor: UserRecord,
    workspaceId: string,
    query: PageListQuery,
  ): Promise<PageListDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject } = await this.context(actor, workspaceId);
    return this.listChildren(workspaceId, subject, actor.id, query, seq);
  }

  /**
   * "Shared": pages granted to the user (directly, through a teamspace or the whole
   * workspace) outside their teamspaces and private section, topmost ones only.
   */
  async shared(actor: UserRecord, workspaceId: string, query: PageListQuery): Promise<PageListDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { member, subject } = await this.context(actor, workspaceId);
    const principals: PrincipalRef[] = [
      { kind: 'user', id: actor.id },
      ...[...subject.teamspaceRoles.keys()].map((id) => ({ kind: 'teamspace' as const, id })),
      ...(member.role !== 'guest' ? [{ kind: 'workspace' as const, id: workspaceId }] : []),
    ];
    const after = decodeCursor(query.cursor, 1);
    const rows = await this.store.grants.pagesFor(
      workspaceId,
      principals,
      after?.[0] ?? null,
      query.limit,
    );
    const batch = rows.slice(0, query.limit);
    const last = batch.at(-1);
    const tops = new Map<string, PageRecord>();
    const topIds = [...new Set(batch.map((p) => idsFromPath(p.path)[0]!))];
    for (const top of await this.store.pages.findMany(workspaceId, topIds)) tops.set(top.id, top);
    const candidates = batch.filter((p) => {
      const top = tops.get(idsFromPath(p.path)[0]!);
      if (!top) return false;
      if (top.parentKind === 'teamspace') return !subject.teamspaceRoles.has(top.parentId);
      return top.parentKind === 'private' && top.parentId !== actor.id;
    });
    const ids = new Set(candidates.map((p) => p.id));
    const topmost = candidates.filter(
      (p) =>
        !idsFromPath(p.path)
          .slice(0, -1)
          .some((a) => ids.has(a)),
    );
    const visible = await this.filterViewable(workspaceId, subject, topmost);
    const withChildren = await this.store.pages.withChildren(
      workspaceId,
      visible.map((p) => p.id),
    );
    return {
      seq,
      items: visible.map((p) => toPageDto(p, withChildren.has(p.id))),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.id]) : null,
    };
  }

  async page(actor: UserRecord, workspaceId: string, pageId: string): Promise<PageDetailDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject, page, level } = await this.viewable(workspaceId, actor, pageId);
    const ancestorIds = idsFromPath(page.path).slice(0, -1);
    const ancestors = await this.store.pages.findMany(workspaceId, ancestorIds);
    const levels = await this.permissions.levels(workspaceId, subject, ancestors);
    const byId = new Map(ancestors.map((a) => [a.id, a]));
    const top = ancestorIds.length > 0 ? byId.get(ancestorIds[0]!) : page;
    let section: PageDetailDto['section'] = null;
    if (top?.parentKind === 'teamspace') {
      const teamspace = await this.store.teamspaces.findById(workspaceId, top.parentId);
      section = { kind: 'teamspace', id: top.parentId, name: teamspace?.name ?? null };
    } else if (top?.parentKind === 'private') {
      section = { kind: 'private', id: top.parentId, name: null };
    }
    const hasChildren = (await this.store.pages.withChildren(workspaceId, [page.id])).has(page.id);
    return {
      seq,
      page: toPageDto(page, hasChildren),
      ancestors: ancestorIds.flatMap((id) => {
        const a = byId.get(id);
        if (!a) return [];
        const accessible = atLeast(levels.get(id) ?? 'no_access', 'can_view');
        return [
          { id, title: accessible ? a.title : '', icon: accessible ? a.icon : null, accessible },
        ];
      }),
      section,
      level,
      isFavorite:
        (await this.store.userPages.favorite(workspaceId, actor.id, page.id)) !== undefined,
      isFollowing: await this.store.userPages.isFollowing(workspaceId, actor.id, page.id),
    };
  }

  /** Who has access and why (PRODUCT §13), for users who can view the page. */
  async sharing(actor: UserRecord, workspaceId: string, pageId: string): Promise<SharingDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { member, subject, page } = await this.viewable(workspaceId, actor, pageId);
    const evaluation = await this.permissions.evaluate(workspaceId, subject, page);
    const titles = new Map(evaluation.pages.map((p) => [p.id, p.title]));
    const grants: SharingGrantDto[] = [];
    for (const node of evaluation.chain) {
      for (const grant of node.grants) {
        if (
          grant.principalKind !== 'user' &&
          grant.principalKind !== 'teamspace' &&
          grant.principalKind !== 'workspace'
        )
          continue;
        const principal = await this.principal(workspaceId, grant.principalKind, grant.principalId);
        if (!principal) continue;
        grants.push({
          principal,
          level: grant.level,
          inheritedFrom:
            node.id === page.id ? null : { id: node.id, title: titles.get(node.id) ?? '' },
        });
      }
      if (node.restrictInheritance) break;
    }
    let root: SharingDto['root'] = null;
    if (evaluation.restrictedAt === null && evaluation.root) {
      if (evaluation.root.kind === 'teamspace') {
        const ts = await this.store.teamspaces.findById(workspaceId, evaluation.root.teamspaceId);
        if (ts)
          root = { kind: 'teamspace', id: ts.id, name: ts.name, defaultLevel: ts.defaultLevel };
      } else {
        const owner = await this.store.users.findById(evaluation.root.userId);
        root = { kind: 'private', userId: evaluation.root.userId, name: owner?.name ?? '' };
      }
    }
    const link = await this.store.publicLinks.active(workspaceId, page.id);
    const full = atLeast(evaluation.level, 'full_access');
    return {
      seq,
      pageId: page.id,
      myLevel: evaluation.level,
      restrictInheritance: page.restrictInheritance,
      restrictedAt:
        evaluation.restrictedAt && evaluation.restrictedAt !== page.id
          ? { id: evaluation.restrictedAt, title: titles.get(evaluation.restrictedAt) ?? '' }
          : null,
      grants,
      root,
      mySources: evaluation.sources,
      publicLink: {
        enabled: link !== undefined,
        includeSubpages: link?.includeSubpages ?? false,
        url:
          link && full
            ? `${this.publicUrl}/share/${this.keyring.decrypt(link.tokenEncrypted)}`
            : null,
      },
      canRecover: member.role === 'owner' && evaluation.root?.kind === 'teamspace' && !full,
    };
  }

  private async principal(
    workspaceId: string,
    kind: 'user' | 'teamspace' | 'workspace',
    id: string,
  ) {
    if (kind === 'user') {
      const user = await this.store.users.findById(id);
      return user && { kind, id, name: user.name, email: user.email };
    }
    if (kind === 'teamspace') {
      const ts = await this.store.teamspaces.findById(workspaceId, id);
      return ts && { kind, id, name: ts.name, email: null };
    }
    const ws = await this.store.workspaces.findById(workspaceId);
    return ws && { kind, id, name: ws.name, email: null };
  }

  /** Trash roots the user can view, most recently deleted first. */
  async trash(actor: UserRecord, workspaceId: string, query: TrashQuery): Promise<PageListDto> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject } = await this.context(actor, workspaceId);
    const after = decodeCursor(query.cursor, 2);
    const rows = await this.store.pages.trashRoots(
      workspaceId,
      after ? { deletedAt: new Date(after[0]!), id: after[1]! } : null,
      query.limit,
      query.q,
    );
    const batch = rows.slice(0, query.limit);
    const last = batch.at(-1);
    const visible = await this.filterViewable(workspaceId, subject, batch);
    return {
      seq,
      items: visible.map((p) => toPageDto(p, false)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor([last.deletedAt!.toISOString(), last.id])
          : null,
    };
  }

  /** The user's favorites (bounded), live and viewable pages only. */
  async favorites(
    actor: UserRecord,
    workspaceId: string,
  ): Promise<PageListDto & { positions: Record<string, string> }> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject } = await this.context(actor, workspaceId);
    const favorites = await this.store.userPages.favorites(workspaceId, actor.id, MAX_FAVORITES);
    const pages = new Map(
      (
        await this.store.pages.findMany(
          workspaceId,
          favorites.map((f) => f.pageId),
        )
      ).map((p) => [p.id, p]),
    );
    const ordered = favorites
      .map((f) => pages.get(f.pageId))
      .filter((p): p is PageRecord => !!p && !p.deletedAt);
    const visible = await this.filterViewable(workspaceId, subject, ordered);
    const withChildren = await this.store.pages.withChildren(
      workspaceId,
      visible.map((p) => p.id),
    );
    return {
      seq,
      items: visible.map((p) => toPageDto(p, withChildren.has(p.id))),
      nextCursor: null,
      positions: Object.fromEntries(favorites.map((f) => [f.pageId, f.position])),
    };
  }

  /** Records a visit (direct upsert, outside the change log: ADR 0003 item 4). */
  async touchRecent(actor: UserRecord, workspaceId: string, pageId: string): Promise<void> {
    const { page } = await this.viewable(workspaceId, actor, pageId);
    await this.store.userPages.touchRecent(
      workspaceId,
      actor.id,
      page.id,
      this.clock.now(),
      MAX_RECENTS,
    );
  }

  async recents(
    actor: UserRecord,
    workspaceId: string,
  ): Promise<{ seq: number; items: RecentDto[] }> {
    const seq = await this.store.changeLog.currentSeq(workspaceId);
    const { subject } = await this.context(actor, workspaceId);
    const recents = await this.store.userPages.recents(workspaceId, actor.id, MAX_RECENTS);
    const pages = new Map(
      (
        await this.store.pages.findMany(
          workspaceId,
          recents.map((r) => r.pageId),
        )
      ).map((p) => [p.id, p]),
    );
    const live = recents.flatMap((r) => {
      const p = pages.get(r.pageId);
      return p && !p.deletedAt ? [{ page: p, visitedAt: r.visitedAt }] : [];
    });
    const levels = await this.permissions.levels(
      workspaceId,
      subject,
      live.map((l) => l.page),
    );
    const withChildren = await this.store.pages.withChildren(
      workspaceId,
      live.map((l) => l.page.id),
    );
    return {
      seq,
      items: live
        .filter((l) => atLeast(levels.get(l.page.id) ?? 'no_access', 'can_view'))
        .map((l) => ({
          page: toPageDto(l.page, withChildren.has(l.page.id)),
          visitedAt: l.visitedAt.toISOString(),
        })),
    };
  }
}
