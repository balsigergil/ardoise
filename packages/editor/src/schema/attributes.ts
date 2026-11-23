// SPDX-License-Identifier: AGPL-3.0-only
import type { Attribute } from '@tiptap/core';

/** Named color tokens (ADR 0009). Values are mapped to the UI palette by the web app. */
export const COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type Color = (typeof COLORS)[number];

/** Block colors: a text color or a background (`<color>_background`). */
export const BLOCK_COLORS = [...COLORS, ...COLORS.map((c) => `${c}_background` as const)] as const;
export type BlockColor = (typeof BLOCK_COLORS)[number];

export function isColor(value: unknown): value is Color {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value);
}

export function isBlockColor(value: unknown): value is BlockColor {
  return typeof value === 'string' && (BLOCK_COLORS as readonly string[]).includes(value);
}

/** Parses a JSON attribute, returning `fallback` when it is missing or invalid. */
export function parseJson(raw: string | null, fallback: unknown): unknown {
  if (raw === null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function dataName(name: string): string {
  return `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** A string attribute stored as `data-<name>` in HTML (copy, paste, export). */
export function stringAttr(
  name: string,
  def: string | null = null,
  html = dataName(name),
): Attribute {
  return {
    default: def,
    parseHTML: (el) => el.getAttribute(html) ?? def,
    renderHTML: (attrs) => (attrs[name] == null ? {} : { [html]: String(attrs[name]) }),
  };
}

/** An integer attribute, clamped to `[min, max]` when parsed. */
export function intAttr(name: string, def: number, min: number, max: number): Attribute {
  const html = dataName(name);
  return {
    default: def,
    parseHTML: (el) => {
      const n = Number.parseInt(el.getAttribute(html) ?? '', 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    },
    renderHTML: (attrs) => ({ [html]: String(attrs[name]) }),
  };
}

/** A number attribute that may be `null` (e.g. a width fraction). */
export function numberAttr(name: string): Attribute {
  const html = dataName(name);
  return {
    default: null,
    parseHTML: (el) => {
      const n = Number.parseFloat(el.getAttribute(html) ?? '');
      return Number.isFinite(n) ? n : null;
    },
    renderHTML: (attrs) => (attrs[name] == null ? {} : { [html]: String(attrs[name]) }),
  };
}

export function boolAttr(name: string, def = false): Attribute {
  const html = dataName(name);
  return {
    default: def,
    parseHTML: (el) => {
      const raw = el.getAttribute(html);
      return raw === null ? def : raw === 'true';
    },
    renderHTML: (attrs) => ({ [html]: attrs[name] ? 'true' : 'false' }),
  };
}

/** A JSON attribute, serialized as a JSON string in HTML. */
export function jsonAttr(name: string, def: unknown, html = dataName(name)): Attribute {
  return {
    default: def,
    parseHTML: (el) => parseJson(el.getAttribute(html), def),
    renderHTML: (attrs) => (attrs[name] == null ? {} : { [html]: JSON.stringify(attrs[name]) }),
  };
}

/** A block color (`color`): only known tokens are kept. */
export const blockColorAttr: Attribute = {
  default: null,
  parseHTML: (el) => {
    const raw = el.getAttribute('data-color');
    return isBlockColor(raw) ? raw : null;
  },
  renderHTML: (attrs) => (attrs['color'] ? { 'data-color': String(attrs['color']) } : {}),
};
