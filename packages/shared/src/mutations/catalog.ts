// SPDX-License-Identifier: AGPL-3.0-only
/** The mutation catalog (ARCHITECTURE §6): one zod schema per named mutation. */
import { z } from 'zod';
import { nameSchema } from '../auth.js';
import {
  pageCoverSchema,
  pageFonts,
  pageIconSchema,
  pageTitleSchema,
  pageWidths,
} from '../pages.js';
import { grantableLevels, grantPrincipalKinds } from '../permissions.js';
import { positionSchema } from '../position.js';
import {
  teamspaceDefaultLevels,
  teamspaceRoles,
  teamspaceVisibilities,
  workspaceRoles,
} from '../roles.js';

const id = z.uuid();
/** Ids created by clients are UUIDv7 (CLAUDE.md §4). */
const newId = z.uuid({ version: 'v7' });
const shortIcon = z.string().trim().max(16).nullable();

const parentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('teamspace'), id }),
  z.object({ kind: z.literal('private'), id }),
  z.object({ kind: z.literal('page'), id }),
]);
export type MutationParent = z.infer<typeof parentSchema>;

const principalSchema = z.object({ kind: z.enum(grantPrincipalKinds), id });

const teamspaceFields = {
  name: nameSchema,
  icon: shortIcon,
  description: z.string().trim().max(1000),
  visibility: z.enum(teamspaceVisibilities),
  defaultLevel: z.enum(teamspaceDefaultLevels),
};

const pagePatch = z
  .object({
    title: pageTitleSchema,
    icon: pageIconSchema,
    cover: pageCoverSchema,
    width: z.enum(pageWidths),
    font: z.enum(pageFonts),
    isLocked: z.boolean(),
  })
  .partial();

export const mutationArgs = {
  'page.create': z.object({
    id: newId,
    parent: parentSchema,
    position: positionSchema,
    title: pageTitleSchema.default(''),
    icon: pageIconSchema.default(null),
  }),
  'page.update': pagePatch.extend({ id }).refine((v) => Object.keys(v).length > 1, {
    message: 'nothing to update',
  }),
  'page.move': z.object({ id, parent: parentSchema, position: positionSchema }),
  'page.trash': z.object({ id }),
  'page.restore': z.object({ id }),
  'page.purge': z.object({ id }),
  'page.duplicate': z.object({ id, newId, position: positionSchema }),

  'favorite.add': z.object({ pageId: id, position: positionSchema }),
  'favorite.remove': z.object({ pageId: id }),
  'favorite.move': z.object({ pageId: id, position: positionSchema }),
  'follow.add': z.object({ pageId: id }),
  'follow.remove': z.object({ pageId: id }),

  'permission.grant': z.object({
    pageId: id,
    principal: principalSchema,
    level: z.enum(grantableLevels),
  }),
  'permission.revoke': z.object({ pageId: id, principal: principalSchema }),
  'permission.setRestrict': z.object({ pageId: id, restrict: z.boolean() }),
  'permission.recover': z.object({ pageId: id }),
  'publicLink.set': z.object({
    pageId: id,
    enabled: z.boolean(),
    includeSubpages: z.boolean().default(false),
  }),

  'workspace.update': z
    .object({ name: nameSchema, icon: shortIcon })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' }),
  'teamspace.create': z.object({
    id: newId,
    name: teamspaceFields.name,
    icon: teamspaceFields.icon.default(null),
    description: teamspaceFields.description.default(''),
    visibility: teamspaceFields.visibility.default('open'),
    defaultLevel: teamspaceFields.defaultLevel.default('can_edit'),
  }),
  'teamspace.update': z
    .object(teamspaceFields)
    .partial()
    .extend({ id })
    .refine((v) => Object.keys(v).length > 1, { message: 'nothing to update' }),
  'teamspace.join': z.object({ teamspaceId: id }),
  'teamspace.addMember': z.object({
    teamspaceId: id,
    userId: id,
    role: z.enum(teamspaceRoles).default('member'),
  }),
  'teamspace.setMemberRole': z.object({
    teamspaceId: id,
    userId: id,
    role: z.enum(teamspaceRoles),
  }),
  /** Also used to leave (userId = the actor). */
  'teamspace.removeMember': z.object({ teamspaceId: id, userId: id }),
  'member.setRole': z.object({ userId: id, role: z.enum(workspaceRoles) }),
  /** Also used to leave the workspace (userId = the actor). */
  'member.remove': z.object({ userId: id }),
} as const;

export type MutationName = keyof typeof mutationArgs;
export const mutationNames = Object.keys(mutationArgs) as MutationName[];

/** Parsed (output) args, as the apply functions see them. */
export type MutationArgs = { [N in MutationName]: z.output<(typeof mutationArgs)[N]> };
/** Args as a client writes them (defaults optional). */
export type MutationInput = { [N in MutationName]: z.input<(typeof mutationArgs)[N]> };

/** Mutations allowed while offline (§6); used by M5. */
export const offlineMutations: readonly MutationName[] = ['page.create', 'page.update'];

export interface Mutation<N extends MutationName = MutationName> {
  id: string;
  workspaceId: string;
  name: N;
  args: MutationArgs[N];
  clientTime: string;
}

export type AnyMutation = { [N in MutationName]: Mutation<N> }[MutationName];

/** The wire envelope; `args` are validated per mutation so one bad mutation does not fail a batch. */
export const mutationEnvelopeSchema = z.object({
  id: newId,
  workspaceId: id,
  name: z.enum(mutationNames as [MutationName, ...MutationName[]]),
  args: z.unknown(),
  clientTime: z.string().max(40),
});
export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;

export const pushRequestSchema = z.object({
  mutations: z.array(mutationEnvelopeSchema).min(1).max(100),
});

export function parseMutation(envelope: MutationEnvelope): AnyMutation | undefined {
  const parsed = mutationArgs[envelope.name].safeParse(envelope.args);
  if (!parsed.success) return undefined;
  return { ...envelope, args: parsed.data } as AnyMutation;
}
