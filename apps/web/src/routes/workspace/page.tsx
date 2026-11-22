// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page view (PRODUCT §5). Content blocks arrive with the editor in M3; M2 edits the page
 * metadata and lists subpages. Everything is read from the sync store, so changes from
 * other users show up live.
 */
import {
  coverColors,
  coverGradients,
  pageFonts,
  type PageDetailDto,
  type PageDto,
} from '@ardoise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Bell,
  BellOff,
  ChevronRight,
  Copy,
  FolderInput,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Share2,
  SmilePlus,
  Star,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmojiPicker } from '@/components/emoji-picker';
import { MovePageDialog } from '@/components/page-tree/move-dialog';
import { usePageActions } from '@/components/page-tree/page-actions';
import { PageIcon } from '@/components/page-tree/page-icon';
import { ShareDialog } from '@/components/share-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/auth/session';
import { ApiError } from '@/lib/api';
import { loadChildren, pageDetailQuery, pageTitle, touchRecent } from '@/lib/pages';
import { workspaceQuery } from '@/lib/queries';
import { COVER_CLASSES, coverClass } from '@/lib/covers';
import { cn } from '@/lib/utils';
import { useSyncContext } from '@/sync/context';
import { useMutate, useSyncSelector } from '@/sync/hooks';

const FONT_CLASSES = { default: '', serif: 'font-serif', mono: 'font-mono' } as const;

function TitleInput({ page, disabled }: { page: PageDto; disabled: boolean }) {
  const { t } = useTranslation();
  const { store } = useSyncContext();
  const [draft, setDraft] = useState(page.title);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Follow remote renames unless the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(page.title);
  }, [page.title]);
  const commit = (value: string) => {
    if (value !== page.title) store.mutate('page.update', { id: page.id, title: value });
  };
  return (
    <textarea
      aria-label={t('pages.title')}
      className="w-full resize-none overflow-hidden bg-transparent text-4xl font-bold leading-tight outline-none placeholder:text-muted-foreground/60 disabled:cursor-default"
      rows={1}
      value={draft}
      placeholder={t('pages.untitled')}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        clearTimeout(timer.current);
        commit(draft);
      }}
      onChange={(e) => {
        const value = e.target.value.replace(/\n/g, '');
        setDraft(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(value), 400);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Breadcrumb({
  workspaceId,
  detail,
  page,
}: {
  workspaceId: string;
  detail: PageDetailDto;
  page: PageDto;
}) {
  const { t } = useTranslation();
  const live = useSyncSelector((s) =>
    detail.ancestors.map((a) => ({ ...a, page: s.get('page', a.id) })),
  );
  return (
    <nav
      aria-label={t('pages.breadcrumb')}
      className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      {detail.section && (
        <span className="truncate">
          {detail.section.kind === 'private'
            ? t('sidebar.sections.private')
            : (detail.section.name ?? '')}
        </span>
      )}
      {live.map((a) => (
        <span key={a.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
          {a.accessible ? (
            <Link
              to="/w/$workspaceId/p/$pageId"
              params={{ workspaceId, pageId: a.id }}
              className="truncate hover:underline"
            >
              {pageTitle(a.page ?? a, t('pages.untitled'))}
            </Link>
          ) : (
            <span>…</span>
          )}
        </span>
      ))}
      <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate text-foreground">{pageTitle(page, t('pages.untitled'))}</span>
    </nav>
  );
}

function Subpages({
  workspaceId,
  page,
  editable,
}: {
  workspaceId: string;
  page: PageDto;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { store, refreshToken } = useSyncContext();
  const actions = usePageActions();
  const parent = { kind: 'page' as const, id: page.id };
  const first = useQuery({
    queryKey: ['workspaces', workspaceId, 'pages', page.id, 'children', refreshToken],
    queryFn: () => loadChildren(store, parent, null),
  });
  const [more, setMore] = useState<{ after: string | null; next: string | null }>({
    after: null,
    next: null,
  });
  const next = more.after !== null ? more.next : (first.data ?? null);
  const children = useSyncSelector((s) => s.children(parent));
  return (
    <section aria-label={t('pages.subpages')} className="mt-8 grid gap-1">
      <h2 className="text-sm font-medium text-muted-foreground">{t('pages.subpages')}</h2>
      {first.isPending && children.length === 0 && <Skeleton className="h-8 w-full" />}
      {!first.isPending && children.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('pages.noSubpages')}</p>
      )}
      <ul className="grid gap-0.5" data-testid="subpages">
        {children.map((child) => (
          <li key={child.id}>
            <Link
              to="/w/$workspaceId/p/$pageId"
              params={{ workspaceId, pageId: child.id }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <PageIcon icon={child.icon} />
              <span className="truncate">{pageTitle(child, t('pages.untitled'))}</span>
            </Link>
          </li>
        ))}
      </ul>
      {next && (
        <Button
          variant="link"
          className="justify-self-start"
          onClick={() =>
            void loadChildren(store, parent, next).then((after) =>
              setMore({ after: next, next: after }),
            )
          }
        >
          {t('pages.loadMore')}
        </Button>
      )}
      {editable && (
        <Button
          variant="ghost"
          className="justify-self-start text-muted-foreground"
          onClick={() => actions.create(parent)}
        >
          <Plus />
          {t('pages.newSubpage')}
        </Button>
      )}
    </section>
  );
}

function NoAccess({
  workspaceId,
  pageId,
  canRecover,
}: {
  workspaceId: string;
  pageId: string;
  canRecover: boolean;
}) {
  const { t } = useTranslation();
  const mutate = useMutate();
  const queryClient = useQueryClient();
  const [error, setError] = useState(false);
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t('pages.notFound')}</h1>
      <p className="text-sm text-muted-foreground">{t('pages.notFoundHint')}</p>
      {canRecover && (
        <div className="grid gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void mutate('permission.recover', { pageId })
                .then(() =>
                  queryClient.invalidateQueries({
                    queryKey: pageDetailQuery(workspaceId, pageId).queryKey,
                  }),
                )
                .catch(() => setError(true))
            }
          >
            {t('share.recover')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {error ? t('errors.codes.not_found') : t('share.recoverHint')}
          </p>
        </div>
      )}
    </div>
  );
}

export function PageView({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const { t } = useTranslation();
  const { store, refreshToken } = useSyncContext();
  const actions = usePageActions();
  const mutate = useMutate();
  const queryClient = useQueryClient();
  const workspace = useQuery(workspaceQuery(workspaceId)).data;
  const me = useMe();
  const detail = useQuery({
    ...pageDetailQuery(workspaceId, pageId),
    // A page just created here may not have reached the server yet: retry while the
    // store holds it (the create mutation is ahead in the queue).
    retry: (count, error) =>
      count < 8 &&
      error instanceof ApiError &&
      error.status === 404 &&
      store.get('page', pageId) !== undefined,
    retryDelay: 250,
  });
  const [sharing, setSharing] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const { page: dto, seq, isFollowing } = detail.data;
    store.ingest(
      [
        { type: 'page', id: dto.id, op: 'upsert', data: dto },
        isFollowing
          ? { type: 'follow', id: dto.id, op: 'upsert', data: { pageId: dto.id } }
          : { type: 'follow', id: dto.id, op: 'delete' },
      ],
      seq,
    );
  }, [detail.data, store]);
  useEffect(() => {
    void touchRecent(workspaceId, pageId).catch(() => undefined);
  }, [workspaceId, pageId]);
  useEffect(() => {
    if (refreshToken > 0)
      void queryClient.invalidateQueries({
        queryKey: pageDetailQuery(workspaceId, pageId).queryKey,
      });
  }, [refreshToken, queryClient, workspaceId, pageId]);

  const page = useSyncSelector((s) => s.get('page', pageId));
  const isFavorite = useSyncSelector((s) => !!s.get('favorite', pageId));
  const followed = useSyncSelector((s) => s.get('follow', pageId));
  const trashed = useSyncSelector((s) => s.isTrashed(pageId));

  if (detail.error) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <NoAccess
        workspaceId={workspaceId}
        pageId={pageId}
        canRecover={missing && workspace?.role === 'owner'}
      />
    );
  }
  // Until the server answers, a page created by this user is shown from the store.
  const data: PageDetailDto | undefined =
    detail.data ??
    (page && page.createdBy === me.id && store.pendingCount > 0
      ? {
          seq: 0,
          page,
          ancestors: store
            .ancestors(page.id)
            .reverse()
            .map((a) => ({ id: a.id, title: a.title, icon: a.icon, accessible: true })),
          section: null,
          level: 'full_access',
          isFavorite: false,
          isFollowing: false,
        }
      : undefined);
  if (!data || !page) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="mb-4 h-10 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  const level = data.level;
  const canEdit = level === 'full_access' || level === 'can_edit';
  const canShare = level === 'full_access';
  const editable = canEdit && !page.isLocked && !trashed;
  const following = followed !== undefined;
  const update = (patch: Omit<Parameters<typeof store.mutate<'page.update'>>[1], 'id'>) =>
    actions.report(store.mutate('page.update', { id: page.id, ...patch }));
  const copyLink = () =>
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/w/${workspaceId}/p/${page.id}`)
      .then(() => toast(t('pages.linkCopied')));

  return (
    <article className={cn('pb-16', FONT_CLASSES[page.font])} data-testid="page-view">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Breadcrumb workspaceId={workspaceId} detail={data} page={page} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {page.isLocked && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" />
              {t('pages.locked')}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSharing(true)}>
            <Share2 />
            {t('share.button')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isFavorite ? t('pages.removeFavorite') : t('pages.addFavorite')}
            aria-pressed={isFavorite}
            onClick={() => actions.toggleFavorite(page)}
          >
            <Star className={cn(isFavorite && 'fill-current text-yellow-500')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('pages.options')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>{t('pages.style')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={page.font}
                onValueChange={(font) => update({ font: font as PageDto['font'] })}
              >
                {pageFonts.map((font) => (
                  <DropdownMenuRadioItem key={font} value={font} disabled={!editable}>
                    {t(`pages.fonts.${font}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuCheckboxItem
                checked={page.width === 'full'}
                disabled={!editable}
                onCheckedChange={(full) => update({ width: full ? 'full' : 'normal' })}
              >
                {t('pages.fullWidth')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {canShare && !trashed && (
                <DropdownMenuItem onSelect={() => update({ isLocked: !page.isLocked })}>
                  {page.isLocked ? <Unlock /> : <Lock />}
                  {page.isLocked ? t('pages.unlock') : t('pages.lock')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  actions.report(
                    store.mutate(following ? 'follow.remove' : 'follow.add', { pageId: page.id }),
                  )
                }
              >
                {following ? <BellOff /> : <Bell />}
                {following ? t('pages.unfollow') : t('pages.follow')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyLink}>
                <LinkIcon />
                {t('pages.copyLink')}
              </DropdownMenuItem>
              {canEdit && !trashed && (
                <>
                  <DropdownMenuItem onSelect={() => actions.duplicate(page)}>
                    <Copy />
                    {t('pages.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMoving(true)} disabled={page.isLocked}>
                    <FolderInput />
                    {t('pages.moveTo')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={page.isLocked}
                    onSelect={() => actions.trash(page)}
                  >
                    <Trash2 />
                    {t('pages.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {trashed && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('pages.inTrash')}
            {page.deletedRootId === page.id && canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutate('page.restore', { id: page.id }).catch(() => undefined)}
              >
                <RotateCcw />
                {t('trash.restore')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {page.cover && (
        <div className={cn('h-40 w-full', coverClass(page.cover))} data-testid="page-cover" />
      )}

      <div
        className={cn('mx-auto px-6 sm:px-12', page.width === 'full' ? 'max-w-none' : 'max-w-3xl')}
      >
        <div className={cn('flex items-end gap-2', page.cover ? '-mt-8' : 'mt-10')}>
          {page.icon && (
            <EmojiPicker
              trigger={
                <button
                  type="button"
                  className="text-6xl leading-none disabled:cursor-default"
                  disabled={!editable}
                  aria-label={t('pages.icon.change')}
                >
                  {page.icon.value}
                </button>
              }
              onSelect={(value) => update({ icon: { type: 'emoji', value } })}
              onRemove={() => update({ icon: null })}
            />
          )}
        </div>
        {editable && (
          <div className="mt-2 flex gap-1 text-muted-foreground">
            {!page.icon && (
              <EmojiPicker
                trigger={
                  <Button variant="ghost" size="sm">
                    <SmilePlus />
                    {t('pages.icon.add')}
                  </Button>
                }
                onSelect={(value) => update({ icon: { type: 'emoji', value } })}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {page.cover ? t('pages.cover.change') : t('pages.cover.add')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-2">
                <div className="grid grid-cols-5 gap-1">
                  {coverColors.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={cn('h-8 rounded', COVER_CLASSES[value])}
                      aria-label={t(`pages.cover.colors.${value}`)}
                      onClick={() => update({ cover: { type: 'color', value } })}
                    />
                  ))}
                  {coverGradients.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={cn('h-8 rounded', COVER_CLASSES[value])}
                      aria-label={t(`pages.cover.gradients.${value}`)}
                      onClick={() => update({ cover: { type: 'gradient', value } })}
                    />
                  ))}
                </div>
                {page.cover && (
                  <DropdownMenuItem className="mt-2" onSelect={() => update({ cover: null })}>
                    {t('pages.cover.remove')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="mt-2">
          <TitleInput key={page.id} page={page} disabled={!editable} />
        </div>
        {!editable && canEdit && page.isLocked && (
          <p className="text-sm text-muted-foreground">{t('pages.lockedHint')}</p>
        )}
        <p className="mt-6 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t('pages.contentSoon')}
        </p>
        <Subpages workspaceId={workspaceId} page={page} editable={editable} />
      </div>

      {workspace && (
        <ShareDialog
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          pageId={page.id}
          open={sharing}
          onOpenChange={setSharing}
        />
      )}
      {moving && <MovePageDialog page={page} onClose={() => setMoving(false)} />}
    </article>
  );
}
