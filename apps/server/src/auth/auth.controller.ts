// SPDX-License-Identifier: AGPL-3.0-only
import {
  DomainError,
  changePasswordSchema,
  loginSchema,
  resetConfirmSchema,
  resetRequestSchema,
  updateMeSchema,
  type ChangePasswordInput,
  type MeDto,
  type ResetConfirmInput,
  type ResetRequestInput,
  type SessionDto,
  type SessionListItemDto,
  type UpdateMeInput,
} from '@ardoise/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { hashToken, SecretKeyring } from '../common/crypto.js';
import { RateLimiter } from '../common/rate-limit.js';
import type { Config } from '../config/config.js';
import { clearSessionCookie, sessionDto, setSessionCookie } from '../http/session-cookie.js';
import { Auth, ClientIp, Meta, OptionalAuth, Public } from '../http/request.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { CONFIG } from '../tokens.js';
import { AuthService, toMe, type AuthContext, type RequestMeta } from './auth.service.js';

/** Emails appear in rate-limit keys only as a digest. */
const emailKey = (email: string) => hashToken(email).slice(0, 32);

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SecretKeyring) private readonly keyring: SecretKeyring,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Get('session')
  session(@OptionalAuth() auth: AuthContext | undefined): SessionDto {
    if (!auth) throw new DomainError('unauthenticated');
    return sessionDto(auth, this.keyring);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: { email: string; password: string },
    @ClientIp() ip: string,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    await this.limiter.consume('loginIp', ip);
    await this.limiter.consume('loginEmail', emailKey(body.email));
    const issued = await this.auth.login(body.email, body.password, meta);
    setSessionCookie(res, issued.token, this.config.publicUrl);
    return sessionDto(issued, this.keyring);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Auth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth.session.id);
    clearSessionCookie(res, this.config.publicUrl);
  }

  @Get('sessions')
  sessions(@Auth() auth: AuthContext): Promise<SessionListItemDto[]> {
    return this.auth.listSessions(auth.user.id, auth.session.id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(@Auth() auth: AuthContext, @Param('id', new IdPipe()) id: string): Promise<void> {
    return this.auth.revokeSession(auth.user.id, id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  revokeOthers(@Auth() auth: AuthContext): Promise<void> {
    return this.auth.revokeAllSessions(auth.user.id, auth.session.id);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(204)
  async requestReset(
    @Body(new ZodPipe(resetRequestSchema)) body: ResetRequestInput,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.limiter.consume('resetIp', ip);
    await this.limiter.consume('resetEmail', emailKey(body.email));
    await this.auth.requestPasswordReset(body.email, body.locale);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @Body(new ZodPipe(resetConfirmSchema)) body: ResetConfirmInput,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.limiter.consume('resetConfirmIp', ip);
    await this.auth.confirmPasswordReset(body.token, body.password);
  }
}

@Controller('api/me')
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Patch()
  async update(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateMeSchema)) body: UpdateMeInput,
  ): Promise<MeDto> {
    return toMe(await this.auth.updateProfile(auth.user.id, body));
  }

  @Post('password')
  @HttpCode(204)
  changePassword(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    return this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }
}
