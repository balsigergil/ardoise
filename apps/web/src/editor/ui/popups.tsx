// SPDX-License-Identifier: AGPL-3.0-only
/** Slash menu and mention popups, rendered from the suggestion stores. */
import { SLASH_GROUPS, type SlashItem } from '@ardoise/editor';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import { cn } from '@/lib/utils';
import { useStore, type Store, type SuggestionState } from '../extensions/menu-store';
import type { MentionItem } from '../extensions/suggestions';
import { RegistryIcon } from './icons';

/** A fixed popup under `rect`, flipped above when it would leave the viewport. */
function Popup({ rect, children, label }: { rect: DOMRect; children: ReactNode; label: string }) {
  const height = 320;
  const below = rect.bottom + height < window.innerHeight;
  return createPortal(
    <div
      role="listbox"
      aria-label={label}
      className="fixed z-50 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
        top: below ? rect.bottom + 4 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 4,
        maxHeight: height,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

function Option({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      {children}
    </button>
  );
}

export function SlashPopup({ store }: { store: Store<SuggestionState<SlashItem>> }) {
  const { t } = useTranslation();
  const state = useStore(store);
  if (!state.open || !state.rect) return null;
  return (
    <Popup rect={state.rect} label={t('editor.slash.label')}>
      {state.items.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('editor.slash.empty')}</p>
      )}
      {SLASH_GROUPS.map((group) => {
        const items = state.items.filter((i) => i.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="grid">
            <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {t(`editor.slashGroups.${group}`)}
            </p>
            {items.map((item) => (
              <Option
                key={item.id}
                active={state.items[state.index] === item}
                onSelect={() => state.select?.(item)}
              >
                <span className="flex size-7 items-center justify-center rounded border bg-background">
                  <RegistryIcon id={item.icon} />
                </span>
                <span className="flex-1 truncate">{t(item.labelKey as never)}</span>
                {item.shortcut && (
                  <kbd className="text-xs text-muted-foreground">{item.shortcut}</kbd>
                )}
              </Option>
            ))}
          </div>
        );
      })}
    </Popup>
  );
}

export function MentionPopup({ store }: { store: Store<SuggestionState<MentionItem>> }) {
  const { t } = useTranslation();
  const state = useStore(store);
  if (!state.open || !state.rect) return null;
  const sections: [MentionItem['kind'], string][] = [
    ['user', t('editor.mention.people')],
    ['page', t('editor.mention.pages')],
    ['date', t('editor.mention.dates')],
  ];
  return (
    <Popup rect={state.rect} label={t('editor.blocks.mentionUser')}>
      {state.items.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('editor.mention.empty')}</p>
      )}
      {sections.map(([kind, title]) => {
        const items = state.items.filter((i) => i.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} className="grid">
            <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{title}</p>
            {items.map((item) => (
              <Option
                key={`${kind}-${item.id ?? item.date}`}
                active={state.items[state.index] === item}
                onSelect={() => state.select?.(item)}
              >
                {kind === 'page' ? (
                  <PageIcon icon={null} />
                ) : (
                  <RegistryIcon id={kind === 'user' ? 'at-sign' : 'calendar'} />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.detail && (
                  <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                )}
              </Option>
            ))}
          </div>
        );
      })}
    </Popup>
  );
}
