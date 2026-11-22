// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  atLeast,
  evaluateAccess,
  grantableLevels,
  levelRank,
  maxLevel,
  publicLinkCovers,
  type ChainNode,
  type GrantRecord,
  type PageRootRef,
  type Subject,
} from './permissions.js';
import {
  permissionLevels,
  teamspaceDefaultLevels,
  workspaceRoles,
  type PermissionLevel,
  type TeamspaceDefaultLevel,
  type TeamspaceRole,
  type WorkspaceRole,
} from './roles.js';

const ME = 'u-me';
const OTHER = 'u-other';
const TS = 'ts-1';
const OTHER_TS = 'ts-2';

function subject(
  workspaceRole: WorkspaceRole | undefined,
  teamspaces: [string, TeamspaceRole][] = [],
): Subject {
  return { userId: ME, workspaceRole, teamspaceRoles: new Map(teamspaces) };
}

function grant(
  pageId: string,
  kind: GrantRecord['principalKind'],
  id: string,
  level: GrantRecord['level'],
): GrantRecord {
  return { pageId, principalKind: kind, principalId: id, level };
}

/** Chain [p3 (target), p2, p1 (top)]. */
function chain(
  options: { restrict?: string[]; grants?: Record<string, GrantRecord[]> } = {},
): ChainNode[] {
  return ['p3', 'p2', 'p1'].map((id) => ({
    id,
    restrictInheritance: options.restrict?.includes(id) ?? false,
    grants: options.grants?.[id] ?? [],
  }));
}

const teamspaceRoot = (defaultLevel: TeamspaceDefaultLevel = 'can_edit'): PageRootRef => ({
  kind: 'teamspace',
  teamspaceId: TS,
  defaultLevel,
});

describe('level helpers', () => {
  it('orders levels', () => {
    for (let i = 0; i < permissionLevels.length - 1; i++) {
      expect(levelRank(permissionLevels[i]!)).toBeGreaterThan(levelRank(permissionLevels[i + 1]!));
    }
    expect(atLeast('can_edit', 'can_view')).toBe(true);
    expect(atLeast('can_view', 'can_edit')).toBe(false);
    expect(maxLevel('can_view', 'can_comment')).toBe('can_comment');
    expect(grantableLevels).not.toContain('no_access');
  });
});

describe('evaluateAccess: root rules', () => {
  it('gives nothing to non-members, whatever the grants', () => {
    const c = chain({ grants: { p3: [grant('p3', 'user', ME, 'full_access')] } });
    expect(evaluateAccess(subject(undefined), c, teamspaceRoot()).level).toBe('no_access');
  });

  it('gives nothing on an empty chain', () => {
    expect(evaluateAccess(subject('member'), [], null).level).toBe('no_access');
  });

  it('applies the teamspace default level to members and full access to owners', () => {
    for (const d of teamspaceDefaultLevels) {
      expect(
        evaluateAccess(subject('member', [[TS, 'member']]), chain(), teamspaceRoot(d)).level,
      ).toBe(d);
      expect(
        evaluateAccess(subject('member', [[TS, 'owner']]), chain(), teamspaceRoot(d)).level,
      ).toBe('full_access');
    }
  });

  it('gives workspace owners and admins no implicit access (ADR 0006)', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(evaluateAccess(subject(role), chain(), teamspaceRoot()).level).toBe('no_access');
      expect(
        evaluateAccess(subject(role, [[OTHER_TS, 'owner']]), chain(), teamspaceRoot()).level,
      ).toBe('no_access');
    }
  });

  it('gives private pages to their owner only', () => {
    const mine: PageRootRef = { kind: 'private', userId: ME };
    const theirs: PageRootRef = { kind: 'private', userId: OTHER };
    expect(evaluateAccess(subject('member'), chain(), mine).level).toBe('full_access');
    expect(evaluateAccess(subject('owner'), chain(), theirs).level).toBe('no_access');
  });

  it('never applies root rules to guests', () => {
    expect(evaluateAccess(subject('guest', [[TS, 'owner']]), chain(), teamspaceRoot()).level).toBe(
      'no_access',
    );
    expect(evaluateAccess(subject('guest'), chain(), { kind: 'private', userId: ME }).level).toBe(
      'no_access',
    );
  });
});

describe('evaluateAccess: grants', () => {
  it('matches user, teamspace and workspace principals', () => {
    const cases: [GrantRecord, Subject, PermissionLevel][] = [
      [grant('p1', 'user', ME, 'can_comment'), subject('member'), 'can_comment'],
      [grant('p1', 'user', OTHER, 'can_comment'), subject('member'), 'no_access'],
      [
        grant('p1', 'teamspace', OTHER_TS, 'can_view'),
        subject('member', [[OTHER_TS, 'member']]),
        'can_view',
      ],
      [grant('p1', 'teamspace', OTHER_TS, 'can_view'), subject('member'), 'no_access'],
      [grant('p1', 'workspace', 'ws', 'can_edit'), subject('member'), 'can_edit'],
      [grant('p1', 'workspace', 'ws', 'can_edit'), subject('guest'), 'no_access'],
      [grant('p1', 'user', ME, 'can_view'), subject('guest'), 'can_view'],
      [grant('p1', 'integration', ME, 'can_view'), subject('member'), 'no_access'],
      [grant('p1', 'public_link', ME, 'can_view'), subject('member'), 'no_access'],
    ];
    for (const [g, s, expected] of cases) {
      const c = chain({ grants: { p1: [g] } });
      expect(evaluateAccess(s, c, null).level, JSON.stringify(g) + s.workspaceRole).toBe(expected);
    }
  });

  it('takes the maximum of grants and root rules', () => {
    const c = chain({
      grants: {
        p3: [grant('p3', 'user', ME, 'can_view')],
        p1: [grant('p1', 'workspace', 'ws', 'can_comment')],
      },
    });
    const e = evaluateAccess(subject('member', [[TS, 'member']]), c, teamspaceRoot('can_edit'));
    expect(e.level).toBe('can_edit');
    expect(e.sources.map((s) => s.via)).toEqual(['grant', 'grant', 'teamspace_default']);
    expect(e.restrictedAt).toBeNull();
  });

  it('a lower grant never lowers inherited access (strict maximum)', () => {
    const c = chain({ grants: { p3: [grant('p3', 'teamspace', TS, 'can_view')] } });
    expect(
      evaluateAccess(subject('member', [[TS, 'member']]), c, teamspaceRoot('can_edit')).level,
    ).toBe('can_edit');
  });
});

describe('evaluateAccess: restrict inheritance', () => {
  it('stops after the restricted page and skips root rules', () => {
    const c = chain({
      restrict: ['p2'],
      grants: {
        p3: [grant('p3', 'user', ME, 'can_view')],
        p2: [grant('p2', 'user', ME, 'can_comment')],
        p1: [grant('p1', 'user', ME, 'full_access')],
      },
    });
    const e = evaluateAccess(subject('member', [[TS, 'owner']]), c, teamspaceRoot());
    expect(e.level).toBe('can_comment');
    expect(e.restrictedAt).toBe('p2');
  });

  it('restricting the page itself keeps only its own grants', () => {
    const c = chain({
      restrict: ['p3'],
      grants: { p1: [grant('p1', 'user', ME, 'full_access')] },
    });
    expect(evaluateAccess(subject('member', [[TS, 'member']]), c, teamspaceRoot()).level).toBe(
      'no_access',
    );
  });

  it('cuts the private owner too (they keep only explicit grants)', () => {
    const c = chain({ restrict: ['p3'] });
    expect(evaluateAccess(subject('member'), c, { kind: 'private', userId: ME }).level).toBe(
      'no_access',
    );
  });
});

describe('evaluateAccess: exhaustive matrix', () => {
  /** An independent restatement of §9 used as the oracle. */
  function oracle(
    role: WorkspaceRole | undefined,
    tsRole: TeamspaceRole | undefined,
    grantAt: 'none' | 'p3' | 'p2' | 'p1',
    grantKind: 'user' | 'teamspace' | 'workspace',
    grantLevel: GrantRecord['level'],
    restrictAt: 'none' | 'p3' | 'p2' | 'p1',
    defaultLevel: (typeof teamspaceDefaultLevels)[number],
  ): PermissionLevel {
    if (!role) return 'no_access';
    const depth = { p3: 0, p2: 1, p1: 2, none: 99 } as const;
    let level: PermissionLevel = 'no_access';
    const grantVisible = grantAt !== 'none' && depth[grantAt] <= depth[restrictAt];
    const matches =
      grantKind === 'user' ||
      (grantKind === 'teamspace' && tsRole !== undefined) ||
      (grantKind === 'workspace' && role !== 'guest');
    if (grantVisible && matches) level = grantLevel;
    if (restrictAt === 'none' && role !== 'guest' && tsRole) {
      level = maxLevel(level, tsRole === 'owner' ? 'full_access' : defaultLevel);
    }
    return level;
  }

  const roles = [...workspaceRoles, undefined];
  const tsRoles = ['owner', 'member', undefined] as const;
  const positions = ['none', 'p3', 'p2', 'p1'] as const;
  const kinds = ['user', 'teamspace', 'workspace'] as const;
  it('agrees with an independent oracle on every combination', () => {
    let count = 0;
    for (const role of roles)
      for (const tsRole of tsRoles)
        for (const grantAt of positions)
          for (const grantKind of kinds)
            for (const grantLevel of grantableLevels)
              for (const restrictAt of positions)
                for (const defaultLevel of teamspaceDefaultLevels) {
                  count++;
                  const c = chain({
                    restrict: restrictAt === 'none' ? [] : [restrictAt],
                    grants:
                      grantAt === 'none'
                        ? {}
                        : {
                            [grantAt]: [
                              grant(grantAt, grantKind, grantKind === 'user' ? ME : TS, grantLevel),
                            ],
                          },
                  });
                  const s = subject(role, tsRole && role !== 'guest' ? [[TS, tsRole]] : []);
                  const expected = oracle(
                    role,
                    role === 'guest' ? undefined : tsRole,
                    grantAt,
                    grantKind,
                    grantLevel,
                    restrictAt,
                    defaultLevel,
                  );
                  const actual = evaluateAccess(s, c, teamspaceRoot(defaultLevel)).level;
                  if (actual !== expected) {
                    throw new Error(
                      `mismatch ${JSON.stringify({ role, tsRole, grantAt, grantKind, grantLevel, restrictAt, defaultLevel })}: ${actual} != ${expected}`,
                    );
                  }
                }
    expect(count).toBe(5 * 3 * 4 * 3 * 5 * 4 * 4);
  });
});

describe('publicLinkCovers', () => {
  it('covers the link page, and subpages when included', () => {
    const c = chain();
    expect(publicLinkCovers({ pageId: 'p3', includeSubpages: false }, c)).toBe(true);
    expect(publicLinkCovers({ pageId: 'p1', includeSubpages: false }, c)).toBe(false);
    expect(publicLinkCovers({ pageId: 'p1', includeSubpages: true }, c)).toBe(true);
    expect(publicLinkCovers({ pageId: 'zz', includeSubpages: true }, c)).toBe(false);
  });

  it('stops at restricted pages below the link page', () => {
    expect(
      publicLinkCovers({ pageId: 'p1', includeSubpages: true }, chain({ restrict: ['p2'] })),
    ).toBe(false);
    expect(
      publicLinkCovers({ pageId: 'p1', includeSubpages: true }, chain({ restrict: ['p3'] })),
    ).toBe(false);
    expect(
      publicLinkCovers({ pageId: 'p1', includeSubpages: true }, chain({ restrict: ['p1'] })),
    ).toBe(true);
  });
});
