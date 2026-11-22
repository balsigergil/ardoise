// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { hasHeader, requiresHeader } from './spdx-header.mjs';

describe('requiresHeader', () => {
  it.each([
    ['apps/server/src/main.ts', true],
    ['apps/web/src/App.tsx', true],
    ['apps/web/src/index.css', true],
    ['packages/db/migrations/0000_init.sql', true],
    ['docker/Dockerfile', true],
    ['scripts/dev.mjs', true],
    ['package.json', false],
    ['README.md', false],
    ['docker/docker-compose.yml', false],
    ['packages/db/migrations/meta/_journal.json', false],
    ['apps/web/src/routeTree.gen.ts', false],
    ['apps/web/dist/assets/index.js', false],
    ['node_modules/x/index.js', false],
    ['apps/web/src/vite-env.d.ts', false],
  ])('%s → %s', (path, expected) => {
    expect(requiresHeader(path)).toBe(expected);
  });
});

describe('hasHeader', () => {
  it('finds the header on the first line', () => {
    expect(hasHeader('// SPDX-License-Identifier: AGPL-3.0-only\nexport {};\n')).toBe(true);
  });
  it('accepts a shebang first', () => {
    expect(hasHeader('#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-only\n')).toBe(
      true,
    );
  });
  it('accepts SQL and CSS comment styles', () => {
    expect(hasHeader('-- SPDX-License-Identifier: AGPL-3.0-only\n')).toBe(true);
    expect(hasHeader('/* SPDX-License-Identifier: AGPL-3.0-only */\n')).toBe(true);
  });
  it('rejects a missing or different header', () => {
    expect(hasHeader('export {};\n')).toBe(false);
    expect(hasHeader('// SPDX-License-Identifier: MIT\n')).toBe(false);
    expect(hasHeader('a\nb\nc\n// SPDX-License-Identifier: AGPL-3.0-only\n')).toBe(false);
  });
});
