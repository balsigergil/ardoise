// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AdminUserDto,
  AdminWorkspaceDto,
  InstanceSettingsDto,
  SmtpSettingsDto,
  UpdateAdminUserInput,
  UpdateSmtpInput,
} from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/app-shell';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues, useErrorMessage } from '@/lib/form';
import { PagedList } from '@/components/paged-list';
import { usePagedList } from '@/hooks/use-paged-list';
import { OptionSelect } from '@/components/role-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { instanceInfoQuery, useMe } from '@/auth/session';
import { api } from '@/lib/api';
import { InviteForm, PendingInvitations } from '@/routes/workspace/settings';
import { adminTabs, type AdminTab } from './tabs';

function UsersTab() {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const message = useErrorMessage();
  const [q, setQ] = useState('');
  const [toDelete, setToDelete] = useState<AdminUserDto | null>(null);
  const list = usePagedList<AdminUserDto>(['admin', 'users'], '/api/admin/users', q);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateAdminUserInput & { id: string }) =>
      api.patch(`/api/admin/users/${id}`, body),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/users/${id}`),
    onSettled: refresh,
  });
  const error = update.error ?? remove.error;
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
        render={(users) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auth.fields.name')}</TableHead>
                <TableHead>{t('admin.users.status')}</TableHead>
                <TableHead className="sr-only">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`admin-user-${u.email}`}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {u.isSuperAdmin && <Badge>{t('admin.users.superAdmin')}</Badge>}
                    {u.disabled ? (
                      <Badge variant="destructive">{t('admin.users.disabled')}</Badge>
                    ) : (
                      <Badge variant="outline">{t('admin.users.active')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {u.id !== me.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update.mutate({ id: u.id, isSuperAdmin: !u.isSuperAdmin })}
                        >
                          {u.isSuperAdmin ? t('admin.users.demote') : t('admin.users.promote')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update.mutate({ id: u.id, disabled: !u.disabled })}
                        >
                          {u.disabled ? t('admin.users.enable') : t('admin.users.disable')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setToDelete(u)}
                        >
                          {t('common.delete')}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      />
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('admin.users.deleteTitle', { name: toDelete?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('admin.users.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) remove.mutate(toDelete.id);
                setToDelete(null);
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvitationsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const info = useQuery(instanceInfoQuery).data;
  const queryKey = ['admin', 'invitations'] as const;
  return (
    <div className="grid gap-8">
      {info && !info.mailEnabled && <FormNotice>{t('invitations.mailDisabled')}</FormNotice>}
      <p className="text-sm text-muted-foreground">{t('admin.invitations.description')}</p>
      <InviteForm
        path="/api/admin/invitations"
        onCreated={() => void queryClient.invalidateQueries({ queryKey })}
      />
      <section className="grid gap-3">
        <h2 className="font-semibold">{t('invitations.pending')}</h2>
        <PendingInvitations queryKey={queryKey} path="/api/admin/invitations" />
      </section>
    </div>
  );
}

function WorkspacesTab() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const list = usePagedList<AdminWorkspaceDto>(['admin', 'workspaces'], '/api/admin/workspaces', q);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  return (
    <div className="grid gap-4">
      <Field
        label={t('common.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />
      <PagedList
        list={list}
        empty={t('common.noResults')}
        render={(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workspace.fields.name')}</TableHead>
                <TableHead>{t('admin.workspaces.members')}</TableHead>
                <TableHead>{t('admin.workspaces.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    {w.icon && (
                      <span aria-hidden className="mr-2">
                        {w.icon}
                      </span>
                    )}
                    {w.name}
                  </TableCell>
                  <TableCell>{w.memberCount}</TableCell>
                  <TableCell>{date.format(new Date(w.createdAt))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      />
    </div>
  );
}

function EmailTab() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const smtp = useQuery({
    queryKey: ['admin', 'smtp'],
    queryFn: () => api.get<SmtpSettingsDto>('/api/admin/smtp'),
  });
  const [secure, setSecure] = useState<boolean | undefined>(undefined);
  const onSaved = (data: SmtpSettingsDto) => {
    queryClient.setQueryData(['admin', 'smtp'], data);
    void queryClient.invalidateQueries({ queryKey: instanceInfoQuery.queryKey });
  };
  const save = useMutation({
    mutationFn: (body: UpdateSmtpInput) => api.put<SmtpSettingsDto>('/api/admin/smtp', body),
    onSuccess: onSaved,
  });
  const clear = useMutation({
    mutationFn: () => api.delete<SmtpSettingsDto>('/api/admin/smtp'),
    onSuccess: onSaved,
  });
  const test = useMutation({
    mutationFn: (to: string) => api.post('/api/admin/smtp/test', { to, locale: i18n.language }),
  });
  if (smtp.isPending) return <Skeleton className="h-40" />;
  if (smtp.error) return <FormError error={smtp.error} />;
  const current = smtp.data.settings;
  const isSecure = secure ?? current?.secure ?? false;
  return (
    <div className="grid gap-6">
      <FormNotice>{t(`admin.email.source.${smtp.data.source}`)}</FormNotice>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.email.smtp')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            key={JSON.stringify(current)}
            className="grid max-w-md gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const v = formValues(event.currentTarget, 'host', 'port', 'user', 'password', 'from');
              save.mutate({
                host: v.host,
                port: Number(v.port),
                secure: isSecure,
                user: v.user || undefined,
                from: v.from,
                ...(v.password && { password: v.password }),
              });
            }}
          >
            <FormError error={save.error ?? clear.error} />
            {save.isSuccess && <FormNotice>{t('common.saved')}</FormNotice>}
            <Field
              label={t('admin.email.host')}
              name="host"
              defaultValue={current?.host}
              required
            />
            <Field
              label={t('admin.email.port')}
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={current?.port ?? 587}
              required
            />
            <div className="flex items-center gap-3">
              <Switch id="smtp-secure" checked={isSecure} onCheckedChange={setSecure} />
              <Label htmlFor="smtp-secure">{t('admin.email.secure')}</Label>
            </div>
            <Field
              label={t('admin.email.user')}
              name="user"
              defaultValue={current?.user}
              autoComplete="off"
            />
            <Field
              label={t('admin.email.password')}
              name="password"
              type="password"
              autoComplete="new-password"
              hint={smtp.data.hasPassword ? t('admin.email.passwordKept') : undefined}
            />
            <Field
              label={t('admin.email.from')}
              name="from"
              defaultValue={current?.from}
              required
              hint={t('admin.email.fromHint')}
            />
            <div className="flex flex-wrap gap-2">
              <SubmitButton pending={save.isPending}>{t('common.save')}</SubmitButton>
              {smtp.data.source === 'admin' && (
                <Button type="button" variant="outline" onClick={() => clear.mutate()}>
                  {t('admin.email.reset')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.email.test')}</CardTitle>
          <CardDescription>{t('admin.email.testHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              test.mutate(formValues(event.currentTarget, 'to').to);
            }}
          >
            <div className="min-w-56 flex-1">
              <Field label={t('admin.email.recipient')} name="to" type="email" required />
            </div>
            <SubmitButton pending={test.isPending} disabled={smtp.data.source === 'none'}>
              {t('admin.email.sendTest')}
            </SubmitButton>
          </form>
          <div className="mt-3">
            <FormError error={test.error} />
            {test.isSuccess && <FormNotice>{t('admin.email.testSent')}</FormNotice>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<InstanceSettingsDto>('/api/admin/settings'),
  });
  const [general, setGeneral] = useState<InstanceSettingsDto['general'] | null>(null);
  const save = useMutation({
    mutationFn: (body: InstanceSettingsDto) =>
      api.patch<InstanceSettingsDto>('/api/admin/settings', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'settings'], data);
      void queryClient.invalidateQueries({ queryKey: instanceInfoQuery.queryKey });
    },
  });
  if (settings.isPending) return <Skeleton className="h-40" />;
  if (settings.error) return <FormError error={settings.error} />;
  const { limits } = settings.data;
  const toggles = general ?? settings.data.general;
  const num = (v: string) => Number(v);
  return (
    <form
      className="grid max-w-md gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const v = formValues(
          event.currentTarget,
          'maxUploadSizeMb',
          'trashRetentionDays',
          'historyRetentionDays',
          'offlineRowsPerDatabase',
          'invitationExpiryDays',
        );
        save.mutate({
          limits: {
            maxUploadSizeMb: num(v.maxUploadSizeMb),
            trashRetentionDays: num(v.trashRetentionDays),
            historyRetentionDays: v.historyRetentionDays ? num(v.historyRetentionDays) : null,
            offlineRowsPerDatabase: num(v.offlineRowsPerDatabase),
            invitationExpiryDays: num(v.invitationExpiryDays),
          },
          general: toggles,
        });
      }}
    >
      <FormError error={save.error} />
      {save.isSuccess && <FormNotice>{t('common.saved')}</FormNotice>}
      <section className="grid gap-4">
        <h2 className="font-semibold">{t('admin.settings.limits')}</h2>
        <Field
          label={t('admin.settings.maxUploadSizeMb')}
          name="maxUploadSizeMb"
          type="number"
          min={1}
          max={10240}
          defaultValue={limits.maxUploadSizeMb}
          required
        />
        <Field
          label={t('admin.settings.trashRetentionDays')}
          name="trashRetentionDays"
          type="number"
          min={1}
          max={3650}
          defaultValue={limits.trashRetentionDays}
          required
        />
        <Field
          label={t('admin.settings.historyRetentionDays')}
          name="historyRetentionDays"
          type="number"
          min={1}
          defaultValue={limits.historyRetentionDays ?? ''}
          hint={t('admin.settings.unlimitedHint')}
        />
        <Field
          label={t('admin.settings.offlineRowsPerDatabase')}
          name="offlineRowsPerDatabase"
          type="number"
          min={0}
          max={1000}
          defaultValue={limits.offlineRowsPerDatabase}
          required
        />
        <Field
          label={t('admin.settings.invitationExpiryDays')}
          name="invitationExpiryDays"
          type="number"
          min={1}
          max={90}
          defaultValue={limits.invitationExpiryDays}
          required
        />
      </section>
      <section className="grid gap-4">
        <h2 className="font-semibold">{t('admin.settings.toggles')}</h2>
        <div className="flex items-center gap-3">
          <Switch
            id="workspace-invitations"
            checked={toggles.workspaceInvitationsEnabled}
            onCheckedChange={(checked) =>
              setGeneral({ ...toggles, workspaceInvitationsEnabled: checked })
            }
          />
          <Label htmlFor="workspace-invitations">
            {t('admin.settings.workspaceInvitationsEnabled')}
          </Label>
        </div>
        <div className="grid gap-2">
          <Label>{t('admin.settings.workspaceCreation')}</Label>
          <OptionSelect
            value={toggles.workspaceCreation}
            options={['all_users', 'super_admins'] as const}
            labelPrefix="admin.settings.workspaceCreationOptions"
            ariaLabel={t('admin.settings.workspaceCreation')}
            onChange={(workspaceCreation) => setGeneral({ ...toggles, workspaceCreation })}
          />
        </div>
      </section>
      <SubmitButton pending={save.isPending}>{t('common.save')}</SubmitButton>
    </form>
  );
}

export function AdminPage({
  tab,
  onTabChange,
}: {
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  if (!me.isSuperAdmin)
    return (
      <PageContainer title={t('admin.title')}>
        <FormNotice>{t('errors.codes.forbidden')}</FormNotice>
      </PageContainer>
    );
  return (
    <PageContainer title={t('admin.title')}>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as AdminTab)}>
        <TabsList className="mb-6 flex-wrap">
          {adminTabs.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`admin.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTab />
        </TabsContent>
        <TabsContent value="workspaces">
          <WorkspacesTab />
        </TabsContent>
        <TabsContent value="email">
          <EmailTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
