// SPDX-License-Identifier: AGPL-3.0-only
import { isLanguage, type Language } from '@ardoise/i18n';
import {
  checkInvite,
  DomainError,
  invitationAcceptError,
  invitationExpiry,
  newId,
  type AcceptInvitationInput,
  type CreatedInvitationDto,
  type InvitationDto,
  type InvitationPreviewDto,
  type InvitationScope,
  type Page,
  type PaginationQuery,
  type WorkspaceRole,
} from '@ardoise/shared';
import type { AuthContext, AuthService, IssuedSession, RequestMeta } from '../auth/auth.service.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import type { Clock } from '../common/clock.js';
import { hashToken, randomToken } from '../common/crypto.js';
import type { MailService } from '../mail/mail.service.js';
import type { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { InvitationRecord, Store, UserRecord } from '../store/store.js';

export interface AcceptResult {
  workspaceId: string | null;
  /** A new account was created and signed in. */
  issued?: IssuedSession;
}

/** Invitations (PRODUCT §3): single use, expiring, no public sign-up. */
export class InvitationService {
  constructor(
    private readonly store: Store,
    private readonly settings: InstanceSettingsService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly publicUrl: string,
  ) {}

  private async toDto(inv: InvitationRecord): Promise<InvitationDto> {
    const inviter = inv.inviterId ? await this.store.users.findById(inv.inviterId) : undefined;
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      workspaceId: inv.workspaceId,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
      inviterName: inviter?.name ?? null,
    };
  }

  private link(token: string): string {
    return `${this.publicUrl}/invite#token=${token}`;
  }

  private async inviterRole(
    actor: UserRecord,
    scope: InvitationScope,
  ): Promise<WorkspaceRole | undefined> {
    if (scope.kind !== 'workspace') return undefined;
    return (await this.store.workspaces.membership(scope.workspaceId, actor.id))?.role;
  }

  async create(
    actor: UserRecord,
    scope: InvitationScope,
    email: string,
    locale: Language | undefined,
  ): Promise<CreatedInvitationDto> {
    const workspaceRole = await this.inviterRole(actor, scope);
    if (scope.kind === 'workspace' && !workspaceRole) throw new DomainError('not_found');
    const general = await this.settings.general();
    const error = checkInvite(scope, {
      isSuperAdmin: actor.isSuperAdmin,
      workspaceRole,
      workspaceInvitationsEnabled: general.workspaceInvitationsEnabled,
    });
    if (error) throw new DomainError(error);

    const existing = await this.store.users.findByEmail(email);
    if (scope.kind === 'instance' && existing) throw new DomainError('email_taken');
    if (
      scope.kind === 'workspace' &&
      existing &&
      (await this.store.workspaces.membership(scope.workspaceId, existing.id))
    )
      throw new DomainError('already_member');

    const now = this.clock.now();
    const token = randomToken();
    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : null;
    const invitation: InvitationRecord = {
      id: newId(),
      email,
      tokenHash: hashToken(token),
      inviterId: actor.id,
      workspaceId,
      role: scope.kind === 'workspace' ? scope.role : null,
      createdAt: now,
      expiresAt: invitationExpiry(now, (await this.settings.limits()).invitationExpiryDays),
      acceptedAt: null,
      revokedAt: null,
    };
    await this.store.transaction(async (store) => {
      await store.invitations.revokePending(email, workspaceId, now);
      await store.invitations.insert(invitation);
    });

    const link = this.link(token);
    const language = existing?.locale ?? (isLanguage(locale) ? locale : (actor.locale ?? 'en'));
    let emailSent: boolean;
    if (scope.kind === 'workspace') {
      const workspace = await this.store.workspaces.findById(scope.workspaceId);
      emailSent = await this.mail.trySend(
        email,
        {
          kind: 'invitationWorkspace',
          inviter: actor.name,
          workspace: workspace?.name ?? '',
          link,
          expiresAt: invitation.expiresAt,
        },
        language,
      );
    } else {
      emailSent = await this.mail.trySend(
        email,
        { kind: 'invitationInstance', inviter: actor.name, link, expiresAt: invitation.expiresAt },
        language,
      );
    }
    return { invitation: await this.toDto(invitation), link, emailSent };
  }

  private async requireScopeManager(actor: UserRecord, workspaceId: string | null): Promise<void> {
    if (workspaceId === null) {
      if (!actor.isSuperAdmin) throw new DomainError('forbidden');
      return;
    }
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');
    if (member.role !== 'owner' && member.role !== 'admin') throw new DomainError('forbidden');
  }

  async listPending(
    actor: UserRecord,
    workspaceId: string | null,
    query: PaginationQuery,
  ): Promise<Page<InvitationDto>> {
    await this.requireScopeManager(actor, workspaceId);
    const page = await this.store.invitations.listPending(workspaceId, this.clock.now(), query);
    return {
      items: await Promise.all(page.items.map((i) => this.toDto(i))),
      nextCursor: page.nextCursor,
    };
  }

  async revoke(actor: UserRecord, workspaceId: string | null, invitationId: string): Promise<void> {
    await this.requireScopeManager(actor, workspaceId);
    const invitation = await this.store.invitations.findById(invitationId);
    if (!invitation || invitation.workspaceId !== workspaceId) throw new DomainError('not_found');
    await this.store.invitations.revoke(invitationId, this.clock.now());
  }

  private async usable(token: string, store: Store = this.store): Promise<InvitationRecord> {
    const invitation = await store.invitations.findByTokenHash(hashToken(token));
    if (!invitation) throw new DomainError('invitation_not_found');
    const error = invitationAcceptError(invitation, this.clock.now());
    if (error) throw new DomainError(error);
    return invitation;
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const invitation = await this.usable(token);
    const [workspace, inviter, account] = await Promise.all([
      invitation.workspaceId ? this.store.workspaces.findById(invitation.workspaceId) : undefined,
      invitation.inviterId ? this.store.users.findById(invitation.inviterId) : undefined,
      this.store.users.findByEmail(invitation.email),
    ]);
    return {
      email: invitation.email,
      workspaceName: workspace?.name ?? null,
      inviterName: inviter?.name ?? null,
      role: invitation.role,
      hasAccount: account !== undefined,
    };
  }

  /**
   * New email: creates the account (and membership) and signs in. Existing account:
   * the caller must be signed in as the invited email; the membership is added.
   */
  async accept(
    input: AcceptInvitationInput,
    current: AuthContext | undefined,
    meta: RequestMeta,
  ): Promise<AcceptResult> {
    const passwordHash = input.password ? await this.hasher.hash(input.password) : undefined;
    return this.store.transaction(async (store) => {
      const invitation = await this.usable(input.token, store);
      const now = this.clock.now();
      const existing = await store.users.findByEmail(invitation.email);

      if (existing) {
        if (!invitation.workspaceId || !invitation.role) throw new DomainError('email_taken');
        if (existing.disabledAt) throw new DomainError('account_disabled');
        if (current?.user.id !== existing.id) throw new DomainError('invitation_email_mismatch');
        if (!(await store.invitations.markAccepted(invitation.id, now)))
          throw new DomainError('invitation_used');
        await store.workspaces.addMember({
          workspaceId: invitation.workspaceId,
          userId: existing.id,
          role: invitation.role,
          createdAt: now,
        });
        await store.workspaces.bumpPermEpoch(invitation.workspaceId);
        return { workspaceId: invitation.workspaceId };
      }

      if (!input.name || !passwordHash) throw new DomainError('validation_failed');
      if (!(await store.invitations.markAccepted(invitation.id, now)))
        throw new DomainError('invitation_used');
      const user: UserRecord = {
        id: newId(),
        email: invitation.email,
        name: input.name.trim(),
        passwordHash,
        locale: input.locale ?? null,
        theme: 'system',
        isSuperAdmin: false,
        disabledAt: null,
        createdAt: now,
      };
      await store.users.insert(user);
      if (invitation.workspaceId && invitation.role) {
        await store.workspaces.addMember({
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
          createdAt: now,
        });
        await store.workspaces.bumpPermEpoch(invitation.workspaceId);
      }
      const issued = await this.auth.createSession(user, meta, store);
      return { workspaceId: invitation.workspaceId, issued };
    });
  }
}
