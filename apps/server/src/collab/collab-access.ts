// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Access to collaborative documents (ADR 0009 §4–§6): who may open a document, and
 * whether the connection is read-only. Framework-free, used by the Hocuspocus hooks and
 * by the re-check after access or lock changes.
 */
import {
  atLeast,
  COLLAB_REASONS,
  parseCollabDocumentName,
  type CollabDocRef,
  type CollabReason,
} from '@ardoise/shared';
import type { PermissionService } from '../permissions/permission.service.js';
import type { Store, UserRecord } from '../store/store.js';

export class CollabDenied extends Error {
  constructor(readonly reason: CollabReason) {
    super(reason);
  }
}

export interface CollabIdentity {
  userId: string;
  name: string;
}

export interface CollabGrant {
  ref: CollabDocRef;
  /** The page that governs access (ADR 0009 §4). */
  pageId: string;
  readOnly: boolean;
}

/** Resolves a session token to its user (AuthService.authenticate). */
export type Authenticate = (token: string) => Promise<{ user: UserRecord } | undefined>;

export class CollabAccess {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly authenticate: Authenticate,
  ) {}

  /** The user behind a session token, or null. */
  async identify(token: string | undefined): Promise<CollabIdentity | null> {
    if (!token) return null;
    const auth = await this.authenticate(token);
    return auth ? { userId: auth.user.id, name: auth.user.name } : null;
  }

  /**
   * Checks a document for a user. Throws `CollabDenied`:
   * - `unsupported_document` for malformed names and reserved prefixes (`synced:` until
   *   M6, `plugin:` until M9);
   * - `not_found` when the page does not exist or the user cannot see it (ids do not leak);
   * Read-only unless the user can edit, the page is not locked and not in the trash.
   */
  async authorize(identity: CollabIdentity, documentName: string): Promise<CollabGrant> {
    const ref = parseCollabDocumentName(documentName);
    if (!ref || ref.kind !== 'page') throw new CollabDenied(COLLAB_REASONS.unsupported);
    const member = await this.store.workspaces.membership(ref.workspaceId, identity.userId);
    if (!member) throw new CollabDenied(COLLAB_REASONS.notFound);
    const page = await this.store.pages.findById(ref.workspaceId, ref.id);
    if (!page) throw new CollabDenied(COLLAB_REASONS.notFound);
    const subject = await this.permissions.subject(ref.workspaceId, identity.userId, member.role);
    const level = await this.permissions.level(ref.workspaceId, subject, page);
    if (!atLeast(level, 'can_view')) throw new CollabDenied(COLLAB_REASONS.notFound);
    const readOnly = !atLeast(level, 'can_edit') || page.isLocked || page.deletedAt !== null;
    return { ref, pageId: page.id, readOnly };
  }
}
