// SPDX-License-Identifier: AGPL-3.0-only
import { sessionPolicy, type SessionDto } from '@ardoise/shared';
import type { Response } from 'express';
import { toMe, type AuthContext } from '../auth/auth.service.js';
import { serializeCookie, SESSION_COOKIE } from '../common/cookies.js';
import type { SecretKeyring } from '../common/crypto.js';

export function isSecureUrl(publicUrl: string): boolean {
  return publicUrl.startsWith('https:');
}

export function setSessionCookie(res: Response, token: string, publicUrl: string): void {
  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      secure: isSecureUrl(publicUrl),
      maxAgeSeconds: sessionPolicy.absoluteMs / 1000,
    }),
  );
}

export function clearSessionCookie(res: Response, publicUrl: string): void {
  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', { secure: isSecureUrl(publicUrl), maxAgeSeconds: 0 }),
  );
}

export function sessionDto(
  ctx: Pick<AuthContext, 'session' | 'user'>,
  keyring: SecretKeyring,
): SessionDto {
  return { user: toMe(ctx.user), csrfToken: keyring.csrfToken(ctx.session.id) };
}
