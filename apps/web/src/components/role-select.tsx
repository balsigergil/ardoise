// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A select over a fixed set of options, labelled through i18n (`<prefix>.<value>`, checked by tests). */
export function OptionSelect<T extends string>({
  value,
  options,
  labelPrefix,
  onChange,
  disabled,
  ariaLabel,
  name,
}: {
  value: T;
  options: readonly T[];
  labelPrefix: string;
  onChange?: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  name?: string;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onChange?.(v as T)} disabled={disabled} name={name}>
      <SelectTrigger aria-label={ariaLabel} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`${labelPrefix}.${option}` as never)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
