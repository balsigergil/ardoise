// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** A small, dependency-free set of common emoji; any emoji can also be typed or pasted. */
const EMOJI = [
  '📄',
  '📝',
  '📌',
  '📎',
  '📚',
  '📘',
  '📙',
  '📗',
  '📕',
  '🗂️',
  '🗓️',
  '📊',
  '✅',
  '⭐',
  '🔥',
  '💡',
  '🚀',
  '🎯',
  '🧭',
  '🛠️',
  '⚙️',
  '🔒',
  '🔑',
  '🧪',
  '🌱',
  '🌍',
  '🏠',
  '🏢',
  '🎨',
  '🎵',
  '📷',
  '✈️',
  '🍀',
  '❤️',
  '🙂',
  '🤝',
];

export function EmojiPicker({
  trigger,
  onSelect,
  onRemove,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
  /** Controlled mode (opened from code, e.g. a callout icon in the editor). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState('');
  return (
    <DropdownMenu {...(open !== undefined && { open })} {...(onOpenChange && { onOpenChange })}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <div className="grid grid-cols-8 gap-1" role="group" aria-label={t('pages.icon.choose')}>
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="flex size-8 items-center justify-center rounded text-lg hover:bg-accent"
              aria-label={emoji}
              onClick={() => onSelect(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = custom.trim();
            if (value) onSelect(value);
            setCustom('');
          }}
        >
          <Input
            value={custom}
            maxLength={16}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t('pages.icon.custom')}
            aria-label={t('pages.icon.custom')}
          />
          <Button type="submit" variant="outline">
            {t('common.add')}
          </Button>
        </form>
        {onRemove && (
          <Button variant="ghost" className="mt-1 w-full" onClick={onRemove}>
            {t('pages.icon.remove')}
          </Button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
