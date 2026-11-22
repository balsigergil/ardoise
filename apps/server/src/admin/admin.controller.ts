// SPDX-License-Identifier: AGPL-3.0-only
import {
  createInvitationSchema,
  DomainError,
  paginationQuerySchema,
  setupSchema,
  smtpTestSchema,
  updateAdminUserSchema,
  updateInstanceSettingsSchema,
  updateSmtpSchema,
  type AdminUserDto,
  type AdminWorkspaceDto,
  type CreatedInvitationDto,
  type CreateInvitationInput,
  type InstanceInfoDto,
  type InstanceSettingsDto,
  type InvitationDto,
  type Page,
  type PaginationQuery,
  type SessionDto,
  type SetupInput,
  type SetupStatusDto,
  type SmtpSettingsDto,
  type UpdateAdminUserInput,
  type UpdateInstanceSettingsInput,
  type UpdateSmtpInput,
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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthContext, RequestMeta } from '../auth/auth.service.js';
import { SecretKeyring } from '../common/crypto.js';
import { RateLimiter } from '../common/rate-limit.js';
import type { Config } from '../config/config.js';
import { Auth, ClientIp, Meta, Public } from '../http/request.js';
import { sessionDto, setSessionCookie } from '../http/session-cookie.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { MailService } from '../mail/mail.service.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';
import { CONFIG } from '../tokens.js';
import { InvitationService } from '../workspaces/invitation.service.js';
import { AdminService } from './admin.service.js';
import { SetupService } from './setup.service.js';

@Controller('api/setup')
export class SetupController {
  constructor(
    @Inject(SetupService) private readonly setup: SetupService,
    @Inject(SecretKeyring) private readonly keyring: SecretKeyring,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Get()
  async status(): Promise<SetupStatusDto> {
    return { required: await this.setup.isRequired() };
  }

  @Public()
  @Post()
  async complete(
    @Body(new ZodPipe(setupSchema)) body: SetupInput & { email: string },
    @ClientIp() ip: string,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ session: SessionDto; workspaceId: string }> {
    await this.limiter.consume('setupIp', ip);
    const done = await this.setup.complete(body, meta);
    setSessionCookie(res, done.token, this.config.publicUrl);
    return { session: sessionDto(done, this.keyring), workspaceId: done.workspaceId };
  }
}

@Controller('api/instance')
export class InstanceController {
  constructor(
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  @Get()
  async info(): Promise<InstanceInfoDto> {
    const general = await this.settings.general();
    return {
      mailEnabled: await this.mail.isEnabled(),
      workspaceCreation: general.workspaceCreation,
      workspaceInvitationsEnabled: general.workspaceInvitationsEnabled,
    };
  }
}

@Controller('api/admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private requireSuperAdmin(auth: AuthContext): void {
    if (!auth.user.isSuperAdmin) throw new DomainError('forbidden');
  }

  @Get('users')
  users(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<AdminUserDto>> {
    return this.admin.listUsers(auth.user, query);
  }

  @Patch('users/:id')
  updateUser(
    @Auth() auth: AuthContext,
    @Param('id', new IdPipe()) id: string,
    @Body(new ZodPipe(updateAdminUserSchema)) body: UpdateAdminUserInput,
  ): Promise<AdminUserDto> {
    return this.admin.updateUser(auth.user, id, body);
  }

  @Delete('users/:id')
  @HttpCode(204)
  deleteUser(@Auth() auth: AuthContext, @Param('id', new IdPipe()) id: string): Promise<void> {
    return this.admin.deleteUser(auth.user, id);
  }

  @Get('invitations')
  pendingInvitations(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<InvitationDto>> {
    return this.invitations.listPending(auth.user, null, query);
  }

  @Post('invitations')
  invite(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createInvitationSchema)) body: CreateInvitationInput & { email: string },
  ): Promise<CreatedInvitationDto> {
    return this.invitations.create(auth.user, { kind: 'instance' }, body.email, body.locale);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  revokeInvitation(
    @Auth() auth: AuthContext,
    @Param('id', new IdPipe()) id: string,
  ): Promise<void> {
    return this.invitations.revoke(auth.user, null, id);
  }

  @Get('workspaces')
  workspaces(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<AdminWorkspaceDto>> {
    return this.admin.listWorkspaces(auth.user, query);
  }

  @Get('settings')
  getSettings(@Auth() auth: AuthContext): Promise<InstanceSettingsDto> {
    this.requireSuperAdmin(auth);
    return this.settings.all();
  }

  @Patch('settings')
  updateSettings(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateInstanceSettingsSchema)) body: UpdateInstanceSettingsInput,
  ): Promise<InstanceSettingsDto> {
    this.requireSuperAdmin(auth);
    return this.settings.update(body);
  }

  @Get('smtp')
  getSmtp(@Auth() auth: AuthContext): Promise<SmtpSettingsDto> {
    this.requireSuperAdmin(auth);
    return this.settings.smtpDto();
  }

  @Put('smtp')
  updateSmtp(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateSmtpSchema)) body: UpdateSmtpInput,
  ): Promise<SmtpSettingsDto> {
    this.requireSuperAdmin(auth);
    return this.settings.updateSmtp(body);
  }

  @Delete('smtp')
  clearSmtp(@Auth() auth: AuthContext): Promise<SmtpSettingsDto> {
    this.requireSuperAdmin(auth);
    return this.settings.clearSmtp();
  }

  @Post('smtp/test')
  @HttpCode(204)
  async testSmtp(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(smtpTestSchema)) body: { to: string; locale?: 'en' | 'fr' | undefined },
  ): Promise<void> {
    this.requireSuperAdmin(auth);
    await this.limiter.consume('mailTest', auth.user.id);
    await this.mail.send(body.to, { kind: 'test' }, body.locale ?? auth.user.locale ?? 'en');
  }
}
