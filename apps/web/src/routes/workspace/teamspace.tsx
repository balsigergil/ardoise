// SPDX-License-Identifier: AGPL-3.0-only
import {
  teamspaceRoles,
  type MemberDto,
  type Page,
  type TeamspaceDto,
  type TeamspaceMemberDto,
  type TeamspaceRole,
} from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/app-shell';
import { Field, FormError } from '@/components/forms/form';
import { useErrorMessage } from '@/lib/form';
import { PagedList } from '@/components/paged-list';
import { usePagedList } from '@/hooks/use-paged-list';
import { OptionSelect } from '@/components/role-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMe } from '@/auth/session';
import { api, pageQuery } from '@/lib/api';
import { teamspaceQuery } from '@/lib/queries';
import { TeamspaceForm } from './settings';

function AddMember({
  workspaceId,
  teamspaceId,
  onAdded,
}: {
  workspaceId: string;
  teamspaceId: string;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const candidates = useQuery({
    queryKey: ['workspaces', workspaceId, 'members', 'search', q],
    queryFn: () =>
      api.get<Page<MemberDto>>(
        `/api/workspaces/${workspaceId}/members${pageQuery({ q, limit: 8 })}`,
      ),
    enabled: q.trim().length >= 2,
  });
  const add = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}/members`, { userId }),
    onSuccess: () => {
      setQ('');
      onAdded();
    },
  });
  return (
    <div className="grid gap-2">
      <Field
        label={t('teamspaces.addMember')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        hint={t('teamspaces.addMemberHint')}
      />
      <FormError error={add.error} />
      {candidates.data?.items
        .filter((m) => m.role !== 'guest')
        .map((m) => (
          <div key={m.userId} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.name}</div>
              <div className="truncate text-xs text-muted-foreground">{m.email}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => add.mutate(m.userId)}
              disabled={add.isPending}
            >
              {t('common.add')}
            </Button>
          </div>
        ))}
    </div>
  );
}

export function TeamspacePage({
  workspaceId,
  teamspaceId,
}: {
  workspaceId: string;
  teamspaceId: string;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const message = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const teamspace = useQuery(teamspaceQuery(workspaceId, teamspaceId));
  const base = `/api/workspaces/${workspaceId}/teamspaces/${teamspaceId}`;
  const membersKey = ['workspaces', workspaceId, 'teamspaces', teamspaceId, 'members'];
  const members = usePagedList<TeamspaceMemberDto>(membersKey, `${base}/members`);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'teamspaces'] });
  };
  const join = useMutation({ mutationFn: () => api.post(`${base}/join`), onSuccess: refresh });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamspaceRole }) =>
      api.patch(`${base}/members/${userId}`, { role }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`${base}/members/${userId}`),
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: (body: object) => api.patch<TeamspaceDto>(base, body),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });

  if (teamspace.isPending) return <Skeleton className="m-8 h-40" />;
  if (teamspace.error)
    return (
      <div className="p-8">
        <FormError error={teamspace.error} />
      </div>
    );
  const ts = teamspace.data;
  const mutationError = join.error ?? changeRole.error ?? remove.error;

  return (
    <PageContainer
      title={`${ts.icon ? `${ts.icon} ` : ''}${ts.name}`}
      actions={
        <>
          {!ts.myRole && ts.visibility === 'open' && (
            <Button onClick={() => join.mutate()} disabled={join.isPending}>
              {t('teamspaces.join')}
            </Button>
          )}
          {ts.myRole && (
            <Button variant="outline" onClick={() => remove.mutate(me.id)}>
              {t('teamspaces.leave')}
            </Button>
          )}
          {ts.canManage && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant="outline">{t(`teamspaces.visibility.${ts.visibility}`)}</Badge>
        <Badge variant="outline">
          {t('teamspaces.defaultAccess', { level: t(`permissions.${ts.defaultLevel}`) })}
        </Badge>
        {ts.myRole && <Badge variant="secondary">{t(`roles.teamspace.${ts.myRole}`)}</Badge>}
      </div>
      {ts.description && (
        <p className="mb-6 whitespace-pre-wrap text-muted-foreground">{ts.description}</p>
      )}
      {mutationError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {message(mutationError)}
        </p>
      )}
      {editing && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{t('teamspaces.settings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamspaceForm
              initial={ts}
              pending={update.isPending}
              error={update.error}
              submitLabel={t('common.save')}
              onSubmit={update.mutate}
            />
          </CardContent>
        </Card>
      )}
      <section className="grid gap-4">
        <h2 className="font-semibold">{t('teamspaces.members')}</h2>
        {ts.canManage && (
          <AddMember
            workspaceId={workspaceId}
            teamspaceId={teamspaceId}
            onAdded={() => void refresh()}
          />
        )}
        <PagedList
          list={members}
          empty={t('common.noResults')}
          render={(items) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('auth.fields.name')}</TableHead>
                  <TableHead>{t('workspace.members.role')}</TableHead>
                  <TableHead className="sr-only">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      {ts.canManage ? (
                        <OptionSelect
                          value={m.role}
                          options={teamspaceRoles}
                          labelPrefix="roles.teamspace"
                          ariaLabel={t('workspace.members.role')}
                          onChange={(role) => changeRole.mutate({ userId: m.userId, role })}
                        />
                      ) : (
                        <Badge variant="secondary">{t(`roles.teamspace.${m.role}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {ts.canManage && m.userId !== me.id && (
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)}>
                          {t('workspace.members.remove')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </section>
    </PageContainer>
  );
}
