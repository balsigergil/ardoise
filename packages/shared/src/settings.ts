// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/** Instance limits (PRODUCT §3). Stored under `instance_settings.limits`. */
export const limitsSchema = z.object({
  maxUploadSizeMb: z.number().int().min(1).max(10_240).default(100),
  /** Cap on a page's encoded Yjs document (ADR 0009 §4). */
  maxDocumentSizeMb: z.number().int().min(1).max(100).default(10),
  trashRetentionDays: z.number().int().min(1).max(3650).default(30),
  /** null = unlimited */
  historyRetentionDays: z.number().int().min(1).max(36_500).nullable().default(null),
  offlineRowsPerDatabase: z.number().int().min(0).max(1000).default(50),
  invitationExpiryDays: z.number().int().min(1).max(90).default(7),
});
export type Limits = z.infer<typeof limitsSchema>;

/** Instance-wide toggles. Stored under `instance_settings.general`. */
export const generalSettingsSchema = z.object({
  workspaceInvitationsEnabled: z.boolean().default(true),
  workspaceCreation: z.enum(['all_users', 'super_admins']).default('all_users'),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

/** SMTP settings as exposed to the admin UI (the password is never returned). */
export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  user: z.string().trim().max(255).optional(),
  from: z.string().trim().min(3).max(320),
});
export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;

/** Parses a stored settings value, filling defaults and dropping invalid values. */
export function parseSettings<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}
