// SPDX-License-Identifier: AGPL-3.0-only
import {
  acceptInvitationSchema,
  addTeamspaceMemberSchema,
  createTeamspaceSchema,
  createWorkspaceInvitationSchema,
  createWorkspaceSchema,
  invitationTokenSchema,
  paginationQuerySchema,
  teamspaceListQuerySchema,
  updateMemberSchema,
  updateTeamspaceMemberSchema,
  updateTeamspaceSchema,
  updateWorkspaceSchema,
  type AcceptedInvitationDto,
  type AcceptInvitationInput,
  type AddTeamspaceMemberInput,
  type CreatedInvitationDto,
  type CreateTeamspaceInput,
  type CreateWorkspaceInput,
  type InvitationDto,
  type InvitationPreviewDto,
  type MemberDto,
  type Page,
  type PaginationQuery,
  type TeamspaceDto,
  type TeamspaceListQuery,
  type TeamspaceMemberDto,
  type TeamspaceRole,
  type UpdateTeamspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceDto,
  type WorkspaceRole,
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
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthContext, RequestMeta } from '../auth/auth.service.js';
import { SecretKeyring } from '../common/crypto.js';
import { RateLimiter } from '../common/rate-limit.js';
import type { Config } from '../config/config.js';
import { Auth, ClientIp, Meta, OptionalAuth, Public } from '../http/request.js';
import { sessionDto, setSessionCookie } from '../http/session-cookie.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { CONFIG } from '../tokens.js';
import { InvitationService } from './invitation.service.js';
import { TeamspaceService } from './teamspace.service.js';
import { WorkspaceService } from './workspace.service.js';

const page = new ZodPipe(paginationQuerySchema);
const id = () => new IdPipe();

@Controller('api/workspaces')
export class WorkspacesController {
  constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
  ) {}

  @Get()
  list(@Auth() auth: AuthContext): Promise<WorkspaceDto[]> {
    return this.workspaces.listMine(auth.user.id);
  }

  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ): Promise<WorkspaceDto> {
    return this.workspaces.create(auth.user, body);
  }

  @Get(':ws')
  get(@Auth() auth: AuthContext, @Param('ws', id()) ws: string): Promise<WorkspaceDto> {
    return this.workspaces.get(auth.user, ws);
  }

  @Patch(':ws')
  update(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Body(new ZodPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ): Promise<WorkspaceDto> {
    return this.workspaces.update(auth.user, ws, body);
  }

  @Get(':ws/members')
  members(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(page) query: PaginationQuery,
  ): Promise<Page<MemberDto>> {
    return this.workspaces.listMembers(auth.user, ws, query);
  }

  @Patch(':ws/members/:user')
  @HttpCode(204)
  changeRole(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('user', id()) user: string,
    @Body(new ZodPipe(updateMemberSchema)) body: { role: WorkspaceRole },
  ): Promise<void> {
    return this.workspaces.changeRole(auth.user, ws, user, body.role);
  }

  @Delete(':ws/members/:user')
  @HttpCode(204)
  removeMember(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('user', id()) user: string,
  ): Promise<void> {
    return this.workspaces.removeMember(auth.user, ws, user);
  }

  @Get(':ws/invitations')
  pendingInvitations(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(page) query: PaginationQuery,
  ): Promise<Page<InvitationDto>> {
    return this.invitations.listPending(auth.user, ws, query);
  }

  @Post(':ws/invitations')
  invite(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Body(new ZodPipe(createWorkspaceInvitationSchema))
    body: { email: string; role: WorkspaceRole; locale?: 'en' | 'fr' | undefined },
  ): Promise<CreatedInvitationDto> {
    return this.invitations.create(
      auth.user,
      { kind: 'workspace', workspaceId: ws, role: body.role },
      body.email,
      body.locale,
    );
  }

  @Delete(':ws/invitations/:invitation')
  @HttpCode(204)
  revokeInvitation(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('invitation', id()) invitation: string,
  ): Promise<void> {
    return this.invitations.revoke(auth.user, ws, invitation);
  }
}

@Controller('api/workspaces/:ws/teamspaces')
export class TeamspacesController {
  constructor(@Inject(TeamspaceService) private readonly teamspaces: TeamspaceService) {}

  @Get()
  list(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(new ZodPipe(teamspaceListQuerySchema)) query: TeamspaceListQuery,
  ): Promise<Page<TeamspaceDto>> {
    return this.teamspaces.list(auth.user, ws, query);
  }

  @Post()
  create(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Body(new ZodPipe(createTeamspaceSchema)) body: CreateTeamspaceInput,
  ): Promise<TeamspaceDto> {
    return this.teamspaces.create(auth.user, ws, body);
  }

  @Get(':ts')
  get(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
  ): Promise<TeamspaceDto> {
    return this.teamspaces.get(auth.user, ws, ts);
  }

  @Patch(':ts')
  update(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Body(new ZodPipe(updateTeamspaceSchema)) body: UpdateTeamspaceInput,
  ): Promise<TeamspaceDto> {
    return this.teamspaces.update(auth.user, ws, ts, body);
  }

  @Post(':ts/join')
  @HttpCode(204)
  join(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
  ): Promise<void> {
    return this.teamspaces.join(auth.user, ws, ts);
  }

  @Get(':ts/members')
  members(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Query(page) query: PaginationQuery,
  ): Promise<Page<TeamspaceMemberDto>> {
    return this.teamspaces.listMembers(auth.user, ws, ts, query);
  }

  @Post(':ts/members')
  @HttpCode(204)
  addMember(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Body(new ZodPipe(addTeamspaceMemberSchema)) body: AddTeamspaceMemberInput,
  ): Promise<void> {
    return this.teamspaces.addMember(auth.user, ws, ts, body);
  }

  @Patch(':ts/members/:user')
  @HttpCode(204)
  changeRole(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Param('user', id()) user: string,
    @Body(new ZodPipe(updateTeamspaceMemberSchema)) body: { role: TeamspaceRole },
  ): Promise<void> {
    return this.teamspaces.changeRole(auth.user, ws, ts, user, body.role);
  }

  @Delete(':ts/members/:user')
  @HttpCode(204)
  removeMember(
    @Auth() auth: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Param('user', id()) user: string,
  ): Promise<void> {
    return this.teamspaces.removeMember(auth.user, ws, ts, user);
  }
}

@Controller('api/invitations')
export class InvitationsController {
  constructor(
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(SecretKeyring) private readonly keyring: SecretKeyring,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** POST so the token never appears in a URL. */
  @Public()
  @Post('preview')
  @HttpCode(200)
  async preview(
    @Body(new ZodPipe(invitationTokenSchema)) body: { token: string },
    @ClientIp() ip: string,
  ): Promise<InvitationPreviewDto> {
    await this.limiter.consume('invitationIp', ip);
    return this.invitations.preview(body.token);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @OptionalAuth() auth: AuthContext | undefined,
    @ClientIp() ip: string,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedInvitationDto> {
    await this.limiter.consume('invitationIp', ip);
    const result = await this.invitations.accept(body, auth, meta);
    const session = result.issued ?? auth;
    if (!session) throw new Error('accepted invitation without a session');
    if (result.issued) setSessionCookie(res, result.issued.token, this.config.publicUrl);
    return { workspaceId: result.workspaceId, session: sessionDto(session, this.keyring) };
  }
}
