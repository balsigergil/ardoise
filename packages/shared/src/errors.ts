// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stable API error codes (CLAUDE.md §4). The client maps each code to a localized
 * message (`errors.codes.<code>`); the server never sends stack traces.
 */
export const errorCodes = [
  'validation_failed',
  'unauthenticated',
  'csrf_invalid',
  'origin_invalid',
  'forbidden',
  'not_found',
  'rate_limited',
  'internal_error',
  'invalid_credentials',
  'account_disabled',
  'password_incorrect',
  'email_taken',
  'setup_unavailable',
  'setup_token_invalid',
  'reset_token_invalid',
  'invitation_not_found',
  'invitation_expired',
  'invitation_revoked',
  'invitation_used',
  'invitation_email_mismatch',
  'invitations_disabled',
  'already_member',
  'role_not_assignable',
  'owner_protected',
  'last_owner',
  'last_teamspace_owner',
  'teamspace_join_forbidden',
  'self_action',
  'last_super_admin',
  'sole_workspace_owner',
  'workspace_creation_disabled',
  'mail_not_configured',
  'mail_failed',
  'page_locked',
  'page_moving',
  'page_in_trash',
  'page_not_in_trash',
  'move_cycle',
  'invalid_parent',
  'too_deep',
  'resync_required',
  'file_too_large',
  'preview_unavailable',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; issues?: { path: string; message: string }[] };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (errorCodes as readonly string[]).includes(value);
}

/** HTTP status for each code. */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'validation_failed':
    case 'setup_token_invalid':
    case 'reset_token_invalid':
      return 400;
    case 'unauthenticated':
    case 'invalid_credentials':
      return 401;
    case 'csrf_invalid':
    case 'origin_invalid':
    case 'forbidden':
    case 'account_disabled':
    case 'invitations_disabled':
    case 'invitation_email_mismatch':
    case 'teamspace_join_forbidden':
    case 'owner_protected':
    case 'role_not_assignable':
    case 'workspace_creation_disabled':
      return 403;
    case 'not_found':
    case 'invitation_not_found':
      return 404;
    case 'invitation_expired':
    case 'invitation_revoked':
    case 'invitation_used':
    case 'resync_required':
      return 410;
    case 'file_too_large':
      return 413;
    case 'preview_unavailable':
      return 422;
    case 'rate_limited':
      return 429;
    case 'internal_error':
    case 'mail_failed':
      return 500;
    case 'mail_not_configured':
      return 503;
    default:
      return 409;
  }
}

/** A typed domain error. Services throw it; the HTTP layer maps it to `ApiErrorBody`. */
export class DomainError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}
