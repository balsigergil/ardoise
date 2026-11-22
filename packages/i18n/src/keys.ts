// SPDX-License-Identifier: AGPL-3.0-only
type Tree = { readonly [key: string]: string | Tree };

/** Flattens a nested resource object into dotted keys, sorted. */
export function flattenKeys(tree: Tree, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') keys.push(path);
    else keys.push(...flattenKeys(value, path));
  }
  return keys.sort();
}

/** Returns the string at a dotted key, or undefined. */
export function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Interpolation placeholders (`{{name}}`) used in a string, sorted. */
export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] ?? '').sort();
}

/** Replaces `{{name}}` placeholders; unknown placeholders are left as they are. */
export function interpolate(value: string, vars: Readonly<Record<string, string>>): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => vars[name] ?? match);
}
