// SPDX-License-Identifier: AGPL-3.0-only
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, RequestMeta } from '../auth/auth.service.js';

export interface ApiRequest extends Request {
  auth?: AuthContext;
}

export const PUBLIC_ROUTE = 'ardoise:public';
/** The route works without a session (a session, when present, is still resolved). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** The authenticated context; only on non-public routes. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<ApiRequest>().auth;
  if (!auth) throw new Error('Auth used on a public route');
  return auth;
});

/** The session if any, for public routes. */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<ApiRequest>().auth,
);

export function requestMeta(req: Request): RequestMeta {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

export const Meta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<Request>()),
);

export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<Request>().ip ?? 'unknown',
);
