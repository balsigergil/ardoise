// SPDX-License-Identifier: AGPL-3.0-only
/** Share menu (PRODUCT §13): who has access and why, grants, restrict, public link, recovery. */
import {
  grantableLevels,
  type GrantableLevel,
  type GrantPrincipalKind,
  type MemberDto,
  type Page,
  type SharingDto,
  type SharingGrantDto,
  type TeamspaceDto,
} from '@ardoise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Globe, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyField } from '@/components/copy-field';
import { OptionSelect } from '@/components/role-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, pageQuery } from '@/lib/api';
import { useErrorMessage } from '@/lib/form';
import { sharingQuery } from '@/lib/pages';
import { useMutate } from '@/sync/hooks';

function PrincipalIcon({ kind }: { kind: GrantPrincipalKind }) {
  if (kind === 'workspace')
    return <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />;
  if (kind === 'teamspace')
    return <Users className="size-4 text-muted-foreground" aria-hidden="true" />;
  return null;
}

interface Candidate {
  kind: GrantPrincipalKind;
  id: string;
  name: string;
  detail: string | null;
}

function AddPeople({
  workspaceId,
  workspaceName,
  onAdd,
}: {
  workspaceId: string;
  workspaceName: string;
  onAdd: (c: Candidate) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const term = q.trim();
  const members = useQuery({
    queryKey: ['workspaces', workspaceId, 'members', 'search', term],
    queryFn: () =>
      api.get<Page<MemberDto>>(
        `/api/workspaces/${workspaceId}/members${pageQuery({ q: term, limit: 6 })}`,
      ),
    enabled: term.length >= 2,
  });
  const teamspaces = useQuery({
    queryKey: ['workspaces', workspaceId, 'teamspaces', 'search', term],
    queryFn: () =>
      api.get<Page<TeamspaceDto>>(
        `/api/workspaces/${workspaceId}/teamspaces${pageQuery({ q: term, limit: 4 })}`,
      ),
    enabled: term.length >= 2,
  });
  const candidates: Candidate[] =
    term.length < 2
      ? []
      : [
          ...(members.data?.items ?? []).map((m) => ({
            kind: 'user' as const,
            id: m.userId,
            name: m.name,
            detail: m.email,
          })),
          ...(teamspaces.data?.items ?? []).map((ts) => ({
            kind: 'teamspace' as const,
            id: ts.id,
            name: ts.name,
            detail: t('share.teamspace'),
          })),
          ...(workspaceName.toLowerCase().includes(term.toLowerCase())
            ? [
                {
                  kind: 'workspace' as const,
                  id: workspaceId,
                  name: t('share.everyone', { name: workspaceName }),
                  detail: null,
                },
              ]
            : []),
        ];
  return (
    <div className="grid gap-2">
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('share.addPlaceholder')}
        aria-label={t('share.add')}
      />
      {candidates.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label={t('share.suggestions')}>
          {candidates.map((c) => (
            <li key={`${c.kind}:${c.id}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setQ('');
                  onAdd(c);
                }}
              >
                <PrincipalIcon kind={c.kind} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.detail && (
                  <span className="truncate text-xs text-muted-foreground">{c.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ShareDialog({
  workspaceId,
  workspaceName,
  pageId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  workspaceName: string;
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutate = useMutate();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<unknown>(null);
  const sharing = useQuery({ ...sharingQuery(workspaceId, pageId), enabled: open });
  const data: SharingDto | undefined = sharing.data;
  const canShare = data?.myLevel === 'full_access';

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
    await queryClient.invalidateQueries({ queryKey: sharingQuery(workspaceId, pageId).queryKey });
    await queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'pages', pageId] });
  };

  const grant = (kind: GrantPrincipalKind, id: string, level: GrantableLevel) =>
    run(() => mutate('permission.grant', { pageId, principal: { kind, id }, level }));
  const revoke = (g: SharingGrantDto) =>
    run(() =>
      mutate('permission.revoke', {
        pageId,
        principal: { kind: g.principal.kind, id: g.principal.id },
      }),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription>
            {data
              ? t('share.yourAccess', { level: t(`permissions.${data.myLevel}`) })
              : t('status.loading')}
          </DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage(error)}
          </p>
        )}
        {data && (
          <div className="grid gap-4">
            {canShare && (
              <AddPeople
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                onAdd={(c) => void grant(c.kind, c.id, 'can_edit')}
              />
            )}
            <section aria-label={t('share.whoHasAccess')} className="grid gap-1">
              <h3 className="text-sm font-medium">{t('share.whoHasAccess')}</h3>
              {data.root && (
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  {data.root.kind === 'teamspace' ? (
                    <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    {data.root.kind === 'teamspace'
                      ? t('share.teamspaceMembers', { name: data.root.name })
                      : t('share.privateOwner', { name: data.root.name })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data.root.kind === 'teamspace'
                      ? t(`permissions.${data.root.defaultLevel}`)
                      : t('permissions.full_access')}
                  </span>
                </div>
              )}
              {data.grants.map((g) => (
                <div
                  key={`${g.principal.kind}:${g.principal.id}:${g.inheritedFrom?.id ?? 'here'}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  data-testid="share-grant"
                >
                  <PrincipalIcon kind={g.principal.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {g.principal.kind === 'workspace'
                        ? t('share.everyone', { name: g.principal.name })
                        : g.principal.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {g.inheritedFrom
                        ? t('share.inheritedFrom', {
                            title: g.inheritedFrom.title || t('pages.untitled'),
                          })
                        : t('share.grantedHere')}
                    </div>
                  </div>
                  {canShare && !g.inheritedFrom ? (
                    <>
                      <OptionSelect
                        value={g.level}
                        options={grantableLevels}
                        labelPrefix="permissions"
                        ariaLabel={t('share.levelFor', { name: g.principal.name })}
                        onChange={(level) => void grant(g.principal.kind, g.principal.id, level)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('share.remove', { name: g.principal.name })}
                        onClick={() => void revoke(g)}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t(`permissions.${g.level}`)}
                    </span>
                  )}
                </div>
              ))}
            </section>
            {data.restrictedAt && (
              <p className="text-xs text-muted-foreground">
                {t('share.restrictedAbove', {
                  title: data.restrictedAt.title || t('pages.untitled'),
                })}
              </p>
            )}
            {canShare && (
              <div className="flex items-start gap-3">
                <Switch
                  id="restrict"
                  checked={data.restrictInheritance}
                  onCheckedChange={(restrict) =>
                    void run(() => mutate('permission.setRestrict', { pageId, restrict }))
                  }
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="restrict">{t('share.restrict')}</Label>
                  <p className="text-xs text-muted-foreground">{t('share.restrictHint')}</p>
                </div>
              </div>
            )}
            <section className="grid gap-2 border-t pt-4" aria-label={t('share.publicLink')}>
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div className="grid flex-1 gap-0.5">
                  <Label htmlFor="public-link">{t('share.publicLink')}</Label>
                  <p className="text-xs text-muted-foreground">{t('share.publicLinkHint')}</p>
                </div>
                <Switch
                  id="public-link"
                  disabled={!canShare}
                  checked={data.publicLink.enabled}
                  onCheckedChange={(enabled) =>
                    void run(() =>
                      mutate('publicLink.set', {
                        pageId,
                        enabled,
                        includeSubpages: data.publicLink.includeSubpages,
                      }),
                    )
                  }
                />
              </div>
              {data.publicLink.enabled && data.publicLink.url && (
                <>
                  <CopyField value={data.publicLink.url} label={t('share.publicLink')} />
                  <div className="flex items-center gap-2">
                    <Switch
                      id="public-subpages"
                      checked={data.publicLink.includeSubpages}
                      onCheckedChange={(includeSubpages) =>
                        void run(() =>
                          mutate('publicLink.set', { pageId, enabled: true, includeSubpages }),
                        )
                      }
                    />
                    <Label htmlFor="public-subpages">{t('share.includeSubpages')}</Label>
                  </div>
                </>
              )}
            </section>
            {data.canRecover && (
              <div className="grid gap-2 rounded-md border border-dashed p-3">
                <p className="text-xs text-muted-foreground">{t('share.recoverHint')}</p>
                <Button
                  variant="outline"
                  onClick={() => void run(() => mutate('permission.recover', { pageId }))}
                >
                  {t('share.recover')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
