// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Effective permission evaluation (ARCHITECTURE §9, ADR 0003 and 0006). Pure: the
 * server loads the ancestor chain, grants and memberships, then calls these functions.
 */
import {
  permissionLevels,
  type PermissionLevel,
  type TeamspaceDefaultLevel,
  type TeamspaceRole,
  type WorkspaceRole,
} from './roles.js';

export const principalKinds = [
  'user',
  'teamspace',
  'workspace',
  'integration',
  'public_link',
] as const;
export type PrincipalKind = (typeof principalKinds)[number];

/** Principals the share menu can grant to (integrations arrive in M7). */
export const grantPrincipalKinds = ['user', 'teamspace', 'workspace'] as const;
export type GrantPrincipalKind = (typeof grantPrincipalKinds)[number];

/** `no_access` is the absence of a grant (ADR 0006). */
export const grantableLevels = permissionLevels.filter(
  (l): l is Exclude<PermissionLevel, 'no_access'> => l !== 'no_access',
);
export type GrantableLevel = Exclude<PermissionLevel, 'no_access'>;

const RANK: Record<PermissionLevel, number> = {
  full_access: 5,
  can_edit: 4,
  can_edit_content: 3,
  can_comment: 2,
  can_view: 1,
  no_access: 0,
};

export function levelRank(level: PermissionLevel): number {
  return RANK[level];
}

export function atLeast(level: PermissionLevel, required: PermissionLevel): boolean {
  return RANK[level] >= RANK[required];
}

export function maxLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/** What each action needs (M2 plan). */
export const requiredLevels = {
  view: 'can_view',
  comment: 'can_comment',
  editContent: 'can_edit_content',
  edit: 'can_edit',
  share: 'full_access',
} as const satisfies Record<string, PermissionLevel>;

export interface GrantRecord {
  pageId: string;
  principalKind: PrincipalKind;
  principalId: string;
  level: GrantableLevel;
}

/** One page of the ancestor chain, nearest first (the page itself comes first). */
export interface ChainNode {
  id: string;
  restrictInheritance: boolean;
  grants: readonly GrantRecord[];
}

export type PageRootRef =
  | { kind: 'teamspace'; teamspaceId: string; defaultLevel: TeamspaceDefaultLevel }
  | { kind: 'private'; userId: string };

export interface Subject {
  userId: string;
  /** Undefined when not a member of the workspace. */
  workspaceRole: WorkspaceRole | undefined;
  /** The user's teamspace memberships in this workspace. */
  teamspaceRoles: ReadonlyMap<string, TeamspaceRole>;
}

export type AccessSource =
  | {
      via: 'grant';
      pageId: string;
      principalKind: PrincipalKind;
      principalId: string;
      level: GrantableLevel;
    }
  | { via: 'teamspace_default'; teamspaceId: string; level: PermissionLevel }
  | { via: 'teamspace_owner'; teamspaceId: string; level: 'full_access' }
  | { via: 'private_owner'; level: 'full_access' };

export interface Evaluation {
  level: PermissionLevel;
  /** Every rule that matched, nearest first. */
  sources: AccessSource[];
  /** The page where inheritance stopped, or null when the root rules applied. */
  restrictedAt: string | null;
}

function grantMatches(subject: Subject, grant: GrantRecord): boolean {
  switch (grant.principalKind) {
    case 'user':
      return grant.principalId === subject.userId;
    case 'teamspace':
      return subject.teamspaceRoles.has(grant.principalId);
    case 'workspace':
      // Guests only get explicit grants (§9.6).
      return subject.workspaceRole !== undefined && subject.workspaceRole !== 'guest';
    default:
      return false;
  }
}

/**
 * Effective access of `subject` to the first page of `chain`:
 * 1. union the matching grants walking up, nearest first;
 * 2. stop after the first page that restricts inheritance;
 * 3. otherwise apply the root rules (teamspace membership, private owner);
 * 4. take the maximum. Guests get explicit grants only.
 */
export function evaluateAccess(
  subject: Subject,
  chain: readonly ChainNode[],
  root: PageRootRef | null,
): Evaluation {
  const none: Evaluation = { level: 'no_access', sources: [], restrictedAt: null };
  if (!subject.workspaceRole || chain.length === 0) return none;
  const sources: AccessSource[] = [];
  let level: PermissionLevel = 'no_access';
  let restrictedAt: string | null = null;
  for (const node of chain) {
    for (const grant of node.grants) {
      if (!grantMatches(subject, grant)) continue;
      sources.push({
        via: 'grant',
        pageId: node.id,
        principalKind: grant.principalKind,
        principalId: grant.principalId,
        level: grant.level,
      });
      level = maxLevel(level, grant.level);
    }
    if (node.restrictInheritance) {
      restrictedAt = node.id;
      break;
    }
  }
  if (restrictedAt === null && root && subject.workspaceRole !== 'guest') {
    if (root.kind === 'teamspace') {
      const role = subject.teamspaceRoles.get(root.teamspaceId);
      if (role === 'owner') {
        sources.push({
          via: 'teamspace_owner',
          teamspaceId: root.teamspaceId,
          level: 'full_access',
        });
        level = 'full_access';
      } else if (role === 'member') {
        sources.push({
          via: 'teamspace_default',
          teamspaceId: root.teamspaceId,
          level: root.defaultLevel,
        });
        level = maxLevel(level, root.defaultLevel);
      }
    } else if (root.userId === subject.userId) {
      sources.push({ via: 'private_owner', level: 'full_access' });
      level = 'full_access';
    }
  }
  return { level, sources, restrictedAt };
}

export interface PublicLinkRef {
  pageId: string;
  includeSubpages: boolean;
}

/**
 * True when a public link on one of the chain's pages covers the first page: the link
 * page itself, or a descendant when subpages are included and no page between them
 * restricts inheritance.
 */
export function publicLinkCovers(link: PublicLinkRef, chain: readonly ChainNode[]): boolean {
  const index = chain.findIndex((n) => n.id === link.pageId);
  if (index < 0) return false;
  if (index === 0) return true;
  if (!link.includeSubpages) return false;
  for (let i = 0; i < index; i++) if (chain[i]!.restrictInheritance) return false;
  return true;
}
