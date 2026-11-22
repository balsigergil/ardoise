// SPDX-License-Identifier: AGPL-3.0-only
import {
  assignableRoles,
  canManageWorkspace,
  teamspaceDefaultLevels,
  teamspaceVisibilities,
  type CreatedInvitationDto,
  type InvitationDto,
  type MemberDto,
  type TeamspaceDefaultLevel,
  type TeamspaceDto,
  type TeamspaceVisibility,
  type WorkspaceDto,
  type WorkspaceRole,
} from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/app-shell';
import { CopyField } from '@/components/copy-field';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues, useErrorMessage } from '@/lib/form';
import { PagedList } from '@/components/paged-list';
import { usePagedList } from '@/hooks/use-paged-list';
import { OptionSelect } from '@/components/role-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { instanceInfoQuery, useMe } from '@/auth/session';
import { api } from '@/lib/api';
import { workspaceQuery, workspacesQuery } from '@/lib/queries';
import { workspaceSettingsTabs, type WorkspaceSettingsTab } from './tabs';

function GeneralTab({ workspace }: { workspace: WorkspaceDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const manage = canManageWorkspace(workspace.role);
  const update = useMutation({
    mutationFn: (body: { name: string; icon: string | null }) =>
      api.patch<WorkspaceDto>(`/api/workspaces/${workspace.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspacesQuery.queryKey }),
  });
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const { name, icon } = formValues(event.currentTarget, 'name', 'icon');
        update.mutate({ name, icon: icon.trim() || null });
      }}
    >
      <FormError error={update.error} />
      {update.isSuccess && <FormNotice>{t('common.saved')}</FormNotice>}
      <Field
        label={t('workspace.fields.name')}
        name="name"
        defaultValue={workspace.name}
        required
        maxLength={100}
        disabled={!manage}
      />
      <Field
        label={t('workspace.fields.icon')}
        name="icon"
        defaultValue={workspace.icon ?? ''}
        maxLength={16}
        hint={t('workspace.fields.iconHint')}
        disabled={!manage}
      />
      {manage && <SubmitButton pending={update.isPending}>{t('common.save')}</SubmitButton>}
    </form>
  );
}

function MembersTab({ workspace }: { workspace: WorkspaceDto }) {
  const { t } = useTranslation();
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const message = useErrorMessage();
  const [q, setQ] = useState('');
  const list = usePagedList<MemberDto>(
    ['workspaces', workspace.id, 'members'],
    `/api/workspaces/${workspace.id}/members`,
    q,
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['workspaces', workspace.id, 'members'] });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.patch(`/api/workspaces/${workspace.id}/members/${userId}`, { role }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/workspaces/${workspace.id}/members/${userId}`),
    onSuccess: async (_data, userId) => {
      if (userId === me.id) {
        await queryClient.invalidateQueries({ queryKey: workspacesQuery.queryKey });
        void router.navigate({ to: '/' });
      } else await refresh();
    },
  });
  const manage = canManageWorkspace(workspace.role);
  const roles = assignableRoles(workspace.role);
  const error = changeRole.error ?? remove.error;
  return (
    <div className="grid gap-4">
      <Field
        label={t('common.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {message(error)}
        </p>
      )}
      <PagedList
        list={list}
        empty={t('common.noResults')}
        render={(members) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auth.fields.name')}</TableHead>
                <TableHead>{t('workspace.members.role')}</TableHead>
                <TableHead className="sr-only">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const editable =
                  manage &&
                  m.userId !== me.id &&
                  (m.role !== 'owner' || workspace.role === 'owner');
                return (
                  <TableRow key={m.userId} data-testid={`member-${m.email}`}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <OptionSelect
                          value={m.role}
                          options={roles.includes(m.role) ? roles : [m.role, ...roles]}
                          labelPrefix="roles.workspace"
                          ariaLabel={t('workspace.members.role')}
                          onChange={(role) => changeRole.mutate({ userId: m.userId, role })}
                        />
                      ) : (
                        <Badge variant="secondary">{t(`roles.workspace.${m.role}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.userId === me.id ? (
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)}>
                          {t('workspace.members.leave')}
                        </Button>
                      ) : (
                        editable && (
                          <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)}>
                            {t('workspace.members.remove')}
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      />
    </div>
  );
}

export function InviteForm({
  path,
  roles,
  onCreated,
}: {
  path: string;
  roles?: readonly WorkspaceRole[];
  onCreated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [role, setRole] = useState<WorkspaceRole>('member');
  const invite = useMutation({
    mutationFn: (email: string) =>
      api.post<CreatedInvitationDto>(path, {
        email,
        locale: i18n.language,
        ...(roles && { role }),
      }),
    onSuccess: onCreated,
  });
  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate(formValues(event.currentTarget, 'email').email);
          event.currentTarget.reset();
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label={t('auth.fields.email')} name="email" type="email" required />
        </div>
        {roles && (
          <div className="grid gap-2">
            <Label>{t('workspace.members.role')}</Label>
            <OptionSelect
              value={role}
              options={roles}
              labelPrefix="roles.workspace"
              ariaLabel={t('workspace.members.role')}
              onChange={setRole}
            />
          </div>
        )}
        <SubmitButton pending={invite.isPending}>{t('invitations.send')}</SubmitButton>
      </form>
      <FormError error={invite.error} />
      {invite.data && (
        <div className="grid gap-2" data-testid="invitation-created">
          <FormNotice>
            {invite.data.emailSent
              ? t('invitations.sent', { email: invite.data.invitation.email })
              : t('invitations.notSent', { email: invite.data.invitation.email })}
          </FormNotice>
          <CopyField value={invite.data.link} label={t('invitations.link')} />
        </div>
      )}
    </div>
  );
}

export function PendingInvitations({
  queryKey,
  path,
}: {
  queryKey: readonly unknown[];
  path: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = usePagedList<InvitationDto>(queryKey, path);
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`${path}/${id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  return (
    <PagedList
      list={list}
      empty={t('invitations.none')}
      render={(items) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('auth.fields.email')}</TableHead>
              <TableHead>{t('invitations.expires')}</TableHead>
              <TableHead className="sr-only">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <div>{inv.email}</div>
                  {inv.role && (
                    <div className="text-xs text-muted-foreground">
                      {t(`roles.workspace.${inv.role}`)}
                    </div>
                  )}
                </TableCell>
                <TableCell>{date.format(new Date(inv.expiresAt))}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)}>
                    {t('invitations.revoke')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    />
  );
}

function InvitationsTab({ workspace }: { workspace: WorkspaceDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const info = useQuery(instanceInfoQuery).data;
  const me = useMe();
  const queryKey = ['workspaces', workspace.id, 'invitations'] as const;
  const path = `/api/workspaces/${workspace.id}/invitations`;
  if (!canManageWorkspace(workspace.role))
    return <FormNotice>{t('errors.codes.forbidden')}</FormNotice>;
  if (info && !info.workspaceInvitationsEnabled && !me.isSuperAdmin)
    return <FormNotice>{t('errors.codes.invitations_disabled')}</FormNotice>;
  return (
    <div className="grid gap-8">
      {info && !info.mailEnabled && <FormNotice>{t('invitations.mailDisabled')}</FormNotice>}
      <InviteForm
        path={path}
        roles={assignableRoles(workspace.role)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey })}
      />
      <section className="grid gap-3">
        <h2 className="font-semibold">{t('invitations.pending')}</h2>
        <PendingInvitations queryKey={queryKey} path={path} />
      </section>
    </div>
  );
}

export function TeamspaceForm({
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initial?: TeamspaceDto;
  pending: boolean;
  error: unknown;
  submitLabel: string;
  onSubmit: (value: {
    name: string;
    icon: string | null;
    description: string;
    visibility: TeamspaceVisibility;
    defaultLevel: TeamspaceDefaultLevel;
  }) => void;
}) {
  const { t } = useTranslation();
  const [visibility, setVisibility] = useState<TeamspaceVisibility>(initial?.visibility ?? 'open');
  const [defaultLevel, setDefaultLevel] = useState<TeamspaceDefaultLevel>(
    initial?.defaultLevel ?? 'can_edit',
  );
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const { name, icon, description } = formValues(
          event.currentTarget,
          'name',
          'icon',
          'description',
        );
        onSubmit({ name, icon: icon.trim() || null, description, visibility, defaultLevel });
      }}
    >
      <FormError error={error} />
      <Field
        label={t('teamspaces.fields.name')}
        name="name"
        defaultValue={initial?.name}
        required
        maxLength={100}
      />
      <Field
        label={t('workspace.fields.icon')}
        name="icon"
        defaultValue={initial?.icon ?? ''}
        maxLength={16}
      />
      <div className="grid gap-2">
        <Label htmlFor="teamspace-description">{t('teamspaces.fields.description')}</Label>
        <Textarea
          id="teamspace-description"
          name="description"
          defaultValue={initial?.description}
          maxLength={1000}
        />
      </div>
      <div className="grid gap-2">
        <Label>{t('teamspaces.fields.visibility')}</Label>
        <OptionSelect
          value={visibility}
          options={teamspaceVisibilities}
          labelPrefix="teamspaces.visibility"
          ariaLabel={t('teamspaces.fields.visibility')}
          onChange={setVisibility}
        />
        <p className="text-xs text-muted-foreground">
          {t(`teamspaces.visibilityHint.${visibility}`)}
        </p>
      </div>
      <div className="grid gap-2">
        <Label>{t('teamspaces.fields.defaultLevel')}</Label>
        <OptionSelect
          value={defaultLevel}
          options={teamspaceDefaultLevels}
          labelPrefix="permissions"
          ariaLabel={t('teamspaces.fields.defaultLevel')}
          onChange={setDefaultLevel}
        />
      </div>
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}

function TeamspacesTab({ workspace }: { workspace: WorkspaceDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const queryKey = ['workspaces', workspace.id, 'teamspaces'] as const;
  const list = usePagedList<TeamspaceDto>(
    [...queryKey, 'all'],
    `/api/workspaces/${workspace.id}/teamspaces`,
  );
  const create = useMutation({
    mutationFn: (body: object) =>
      api.post<TeamspaceDto>(`/api/workspaces/${workspace.id}/teamspaces`, body),
    onSuccess: () => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const manage = canManageWorkspace(workspace.role);
  return (
    <div className="grid gap-6">
      {manage &&
        (creating ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('teamspaces.create')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TeamspaceForm
                pending={create.isPending}
                error={create.error}
                submitLabel={t('teamspaces.create')}
                onSubmit={create.mutate}
              />
            </CardContent>
          </Card>
        ) : (
          <div>
            <Button onClick={() => setCreating(true)}>{t('teamspaces.create')}</Button>
          </div>
        ))}
      <PagedList
        list={list}
        empty={t('sidebar.empty.teamspaces')}
        render={(items) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((ts) => (
              <Link
                key={ts.id}
                to="/w/$workspaceId/teamspaces/$teamspaceId"
                params={{ workspaceId: workspace.id, teamspaceId: ts.id }}
              >
                <Card className="h-full transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {ts.icon && <span aria-hidden>{ts.icon}</span>}
                      {ts.name}
                    </CardTitle>
                    <CardDescription className="flex flex-wrap gap-2">
                      <Badge variant="outline">{t(`teamspaces.visibility.${ts.visibility}`)}</Badge>
                      <Badge variant="outline">
                        {t('teamspaces.memberCount', { count: ts.memberCount })}
                      </Badge>
                      {ts.myRole && (
                        <Badge variant="secondary">{t(`roles.teamspace.${ts.myRole}`)}</Badge>
                      )}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      />
    </div>
  );
}

export function WorkspaceSettingsPage({
  workspaceId,
  tab,
  onTabChange,
}: {
  workspaceId: string;
  tab: WorkspaceSettingsTab;
  onTabChange: (tab: WorkspaceSettingsTab) => void;
}) {
  const { t } = useTranslation();
  const workspace = useQuery(workspaceQuery(workspaceId)).data;
  if (!workspace) return null;
  const visibleTabs = workspace.role === 'guest' ? (['general'] as const) : workspaceSettingsTabs;
  return (
    <PageContainer title={t('workspace.settings.title')}>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as WorkspaceSettingsTab)}>
        <TabsList className="mb-6">
          {visibleTabs.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`workspace.settings.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralTab workspace={workspace} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab workspace={workspace} />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTab workspace={workspace} />
        </TabsContent>
        <TabsContent value="teamspaces">
          <TeamspacesTab workspace={workspace} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
