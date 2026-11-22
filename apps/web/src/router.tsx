// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable react-refresh/only-export-components -- route module, not hot-reloaded */
/* eslint-disable @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown */
import type { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { usePreferenceSync } from '@/auth/preferences';
import { sessionQuery, setupStatusQuery } from '@/auth/session';
import { lastWorkspace, pickWorkspace, rememberWorkspace } from '@/lib/last-workspace';
import { workspaceQuery, workspacesQuery } from '@/lib/queries';
import { safeRedirect } from '@/lib/redirect';
import { AccountPage } from '@/routes/account/account';
import { AdminPage } from '@/routes/admin/admin';
import { adminTabs } from '@/routes/admin/tabs';
import { InvitePage } from '@/routes/auth/invite';
import { LoginPage } from '@/routes/auth/login';
import { ForgotPasswordPage, ResetPasswordPage } from '@/routes/auth/password-reset';
import { SetupPage } from '@/routes/auth/setup';
import { NotFoundPage } from '@/routes/not-found';
import { WorkspaceHomePage } from '@/routes/workspace/home';
import { NewWorkspacePage, NoWorkspacePage } from '@/routes/workspace/new-workspace';
import { WorkspaceSettingsPage } from '@/routes/workspace/settings';
import { workspaceSettingsTabs } from '@/routes/workspace/tabs';
import { TeamspacePage } from '@/routes/workspace/teamspace';

export interface RouterContext {
  queryClient: QueryClient;
}

function Root() {
  usePreferenceSync();
  return <Outlet />;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFoundPage,
});

// --- signed-out pages ------------------------------------------------------------

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(sessionQuery))
      throw redirect({ href: safeRedirect(search.redirect) ?? '/' });
    const setup = await context.queryClient
      .ensureQueryData(setupStatusQuery)
      .catch(() => ({ required: false }));
    if (setup.required) throw redirect({ to: '/setup' });
  },
  component: function Login() {
    return <LoginPage redirect={loginRoute.useSearch().redirect} />;
  },
});

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(sessionQuery),
  component: InvitePage,
});

// --- signed-in pages -------------------------------------------------------------

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) {
      const setup = await context.queryClient
        .ensureQueryData(setupStatusQuery)
        .catch(() => ({ required: false }));
      if (setup.required) throw redirect({ to: '/setup' });
      throw redirect({
        to: '/login',
        search: { redirect: location.href === '/' ? undefined : location.href },
      });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(workspacesQuery),
  component: Outlet,
});

/** Shell for pages outside a workspace: shows the last workspace in the sidebar. */
function GlobalShell({ children }: { children: React.ReactNode }) {
  const workspaces = useQuery(workspacesQuery).data ?? [];
  const last = lastWorkspace();
  return (
    <AppShell workspaceId={workspaces.some((w) => w.id === last) ? (last ?? undefined) : undefined}>
      {children}
    </AppShell>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const workspaces = await context.queryClient.ensureQueryData(workspacesQuery);
    const id = pickWorkspace(workspaces, lastWorkspace());
    if (id) throw redirect({ to: '/w/$workspaceId', params: { workspaceId: id } });
  },
  component: () => (
    <AppShell>
      <NoWorkspacePage />
    </AppShell>
  ),
});

const newWorkspaceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/new-workspace',
  component: () => (
    <GlobalShell>
      <NewWorkspacePage />
    </GlobalShell>
  ),
});

const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/account',
  component: () => (
    <GlobalShell>
      <AccountPage />
    </GlobalShell>
  ),
});

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admin',
  validateSearch: z.object({ tab: z.enum(adminTabs).optional().catch(undefined) }),
  component: function Admin() {
    const { tab } = adminRoute.useSearch();
    const navigate = adminRoute.useNavigate();
    return (
      <GlobalShell>
        <AdminPage
          tab={tab ?? 'users'}
          onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
        />
      </GlobalShell>
    );
  },
});

const workspaceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/w/$workspaceId',
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(workspaceQuery(params.workspaceId));
    rememberWorkspace(params.workspaceId);
  },
  errorComponent: NotFoundPage,
  component: function Workspace() {
    const { workspaceId } = workspaceRoute.useParams();
    return (
      <AppShell workspaceId={workspaceId}>
        <Outlet />
      </AppShell>
    );
  },
});

const workspaceHomeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: function Home() {
    return <WorkspaceHomePage workspaceId={workspaceRoute.useParams().workspaceId} />;
  },
});

const workspaceSettingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/settings',
  validateSearch: z.object({ tab: z.enum(workspaceSettingsTabs).optional().catch(undefined) }),
  component: function Settings() {
    const { workspaceId } = workspaceRoute.useParams();
    const { tab } = workspaceSettingsRoute.useSearch();
    const navigate = workspaceSettingsRoute.useNavigate();
    return (
      <WorkspaceSettingsPage
        workspaceId={workspaceId}
        tab={tab ?? 'general'}
        onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
      />
    );
  },
});

const teamspaceRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/teamspaces/$teamspaceId',
  component: function Teamspace() {
    const { workspaceId, teamspaceId } = teamspaceRoute.useParams();
    return <TeamspacePage key={teamspaceId} workspaceId={workspaceId} teamspaceId={teamspaceId} />;
  },
});

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
  authedRoute.addChildren([
    indexRoute,
    newWorkspaceRoute,
    accountRoute,
    adminRoute,
    workspaceRoute.addChildren([workspaceHomeRoute, workspaceSettingsRoute, teamspaceRoute]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
