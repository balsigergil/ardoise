// SPDX-License-Identifier: AGPL-3.0-only
/** REST contracts shared by the server (validation) and the web client (types). */
import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema } from '../auth.js';
import {
  teamspaceDefaultLevels,
  teamspaceRoles,
  teamspaceVisibilities,
  workspaceRoles,
  type TeamspaceDefaultLevel,
  type TeamspaceRole,
  type TeamspaceVisibility,
  type WorkspaceRole,
} from '../roles.js';
import { generalSettingsSchema, limitsSchema, smtpSettingsSchema } from '../settings.js';

export const languageSchema = z.enum(['en', 'fr']);
export const themeSchema = z.enum(['light', 'dark', 'system']);
const tokenSchema = z.string().min(16).max(128);
const iconSchema = z.string().trim().max(16).nullable();
const idSchema = z.uuid();

export const paginationQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const teamspaceListQuerySchema = paginationQuerySchema.extend({
  /** Only teamspaces the caller is a member of (sidebar). */
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type TeamspaceListQuery = z.infer<typeof teamspaceListQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// --- users and sessions -------------------------------------------------------

export interface MeDto {
  id: string;
  email: string;
  name: string;
  locale: 'en' | 'fr' | null;
  theme: 'light' | 'dark' | 'system';
  isSuperAdmin: boolean;
}

export interface SessionDto {
  user: MeDto;
  csrfToken: string;
}

export interface SessionListItemDto {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(1024) });
export type LoginInput = z.input<typeof loginSchema>;

export const updateMeSchema = z
  .object({ name: nameSchema, locale: languageSchema.nullable(), theme: themeSchema })
  .partial();
export type UpdateMeInput = z.input<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const resetRequestSchema = z.object({
  email: emailSchema,
  locale: languageSchema.optional(),
});
export type ResetRequestInput = z.input<typeof resetRequestSchema>;

export const resetConfirmSchema = z.object({ token: tokenSchema, password: passwordSchema });
export type ResetConfirmInput = z.input<typeof resetConfirmSchema>;

// --- setup ---------------------------------------------------------------------

export interface SetupStatusDto {
  required: boolean;
}

export const setupSchema = z.object({
  token: tokenSchema,
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  workspaceName: nameSchema,
  locale: languageSchema.optional(),
});
export type SetupInput = z.input<typeof setupSchema>;

// --- invitations ---------------------------------------------------------------

export interface InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole | null;
  workspaceId: string | null;
  createdAt: string;
  expiresAt: string;
  inviterName: string | null;
}

/** Returned once to the inviter: the link carries the token (shown to copy). */
export interface CreatedInvitationDto {
  invitation: InvitationDto;
  link: string;
  emailSent: boolean;
}

export const createInvitationSchema = z.object({
  email: emailSchema,
  locale: languageSchema.optional(),
});
export const createWorkspaceInvitationSchema = createInvitationSchema.extend({
  role: z.enum(workspaceRoles).default('member'),
});
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
export type CreateWorkspaceInvitationInput = z.input<typeof createWorkspaceInvitationSchema>;

export interface InvitationPreviewDto {
  email: string;
  workspaceName: string | null;
  inviterName: string | null;
  role: WorkspaceRole | null;
  /** An account already exists for this email: accept by signing in. */
  hasAccount: boolean;
}

export const invitationTokenSchema = z.object({ token: tokenSchema });

export const acceptInvitationSchema = z.object({
  token: tokenSchema,
  name: nameSchema.optional(),
  password: passwordSchema.optional(),
  locale: languageSchema.optional(),
});
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export interface AcceptedInvitationDto {
  workspaceId: string | null;
  session: SessionDto;
}

// --- workspaces ----------------------------------------------------------------

export interface WorkspaceDto {
  id: string;
  name: string;
  icon: string | null;
  role: WorkspaceRole;
}

export const createWorkspaceSchema = z.object({ name: nameSchema, icon: iconSchema.optional() });
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({ name: nameSchema, icon: iconSchema }).partial();
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;

export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export const updateMemberSchema = z.object({ role: z.enum(workspaceRoles) });
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

// --- teamspaces ----------------------------------------------------------------

export interface TeamspaceDto {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  visibility: TeamspaceVisibility;
  defaultLevel: TeamspaceDefaultLevel;
  /** The caller's role, or null when not a member. */
  myRole: TeamspaceRole | null;
  canManage: boolean;
  memberCount: number;
}

export const createTeamspaceSchema = z.object({
  name: nameSchema,
  icon: iconSchema.optional(),
  description: z.string().trim().max(1000).default(''),
  visibility: z.enum(teamspaceVisibilities).default('open'),
  defaultLevel: z.enum(teamspaceDefaultLevels).default('can_edit'),
});
export type CreateTeamspaceInput = z.input<typeof createTeamspaceSchema>;

export const updateTeamspaceSchema = createTeamspaceSchema
  .extend({ icon: iconSchema, description: z.string().trim().max(1000) })
  .partial();
export type UpdateTeamspaceInput = z.input<typeof updateTeamspaceSchema>;

export interface TeamspaceMemberDto {
  userId: string;
  email: string;
  name: string;
  role: TeamspaceRole;
}

export const addTeamspaceMemberSchema = z.object({
  userId: idSchema,
  role: z.enum(teamspaceRoles).default('member'),
});
export type AddTeamspaceMemberInput = z.input<typeof addTeamspaceMemberSchema>;

export const updateTeamspaceMemberSchema = z.object({ role: z.enum(teamspaceRoles) });

// --- admin ---------------------------------------------------------------------

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  disabled: boolean;
  createdAt: string;
}

export const updateAdminUserSchema = z
  .object({ isSuperAdmin: z.boolean(), disabled: z.boolean() })
  .partial();
export type UpdateAdminUserInput = z.input<typeof updateAdminUserSchema>;

export interface AdminWorkspaceDto {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  createdAt: string;
}

export interface SmtpSettingsDto {
  /** Where the active settings come from. */
  source: 'admin' | 'env' | 'none';
  settings: z.infer<typeof smtpSettingsSchema> | null;
  hasPassword: boolean;
}

export const updateSmtpSchema = smtpSettingsSchema.extend({
  /** undefined keeps the stored password, null clears it. */
  password: z.string().max(1024).nullable().optional(),
});
export type UpdateSmtpInput = z.input<typeof updateSmtpSchema>;

export const smtpTestSchema = z.object({ to: emailSchema, locale: languageSchema.optional() });

export const instanceSettingsSchema = z.object({
  limits: limitsSchema,
  general: generalSettingsSchema,
});
export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>;
export const updateInstanceSettingsSchema = z
  .object({ limits: limitsSchema.partial(), general: generalSettingsSchema.partial() })
  .partial();
export type UpdateInstanceSettingsInput = z.input<typeof updateInstanceSettingsSchema>;

/** Instance information any signed-in user may read. */
export interface InstanceInfoDto {
  mailEnabled: boolean;
  workspaceCreation: 'all_users' | 'super_admins';
  workspaceInvitationsEnabled: boolean;
}
export * from './pages.js';
export * from './content.js';
