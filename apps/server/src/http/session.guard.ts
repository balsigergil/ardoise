// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from '@ardoise/shared';
import { Inject, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth/auth.service.js';
import { parseCookies, SESSION_COOKIE } from '../common/cookies.js';
import { SecretKeyring } from '../common/crypto.js';
import { isSafeMethod, isSameOriginRequest } from '../common/origin.js';
import type { Config } from '../config/config.js';
import { CONFIG } from '../tokens.js';
import { PUBLIC_ROUTE, type ApiRequest } from './request.js';

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Global guard for `/api`, `/sync` and `/files`: resolves the session cookie, requires a session unless the
 * route is public, and protects state-changing requests with a same-origin check and,
 * when a session is present, the CSRF token (ARCHITECTURE §13).
 */
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SecretKeyring) private readonly keyring: SecretKeyring,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<ApiRequest>();
    // Health checks and static files are not guarded; the API and sync endpoints are.
    if (!/^\/(api|sync|files)\//.test(req.path)) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) req.auth = await this.auth.authenticate(token);
    if (!req.auth && !isPublic) throw new DomainError('unauthenticated');

    if (!isSafeMethod(req.method)) {
      const origin = req.get('origin');
      const secFetchSite = req.get('sec-fetch-site');
      if (!isSameOriginRequest({ origin, secFetchSite }, this.config.publicUrl))
        throw new DomainError('origin_invalid');
      if (req.auth && !this.keyring.verifyCsrfToken(req.auth.session.id, req.get(CSRF_HEADER)))
        throw new DomainError('csrf_invalid');
    }
    return true;
  }
}
