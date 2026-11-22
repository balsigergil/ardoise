#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/** Fails when a source file lacks the AGPL SPDX header (ADR 0001). */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hasHeader, requiresHeader } from './lib/spdx-header.mjs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => existsSync(f) && requiresHeader(f));

const missing = files.filter((f) => !hasHeader(readFileSync(f, 'utf8')));

if (missing.length > 0) {
  console.error(`SPDX check failed: ${missing.length} file(s) without the AGPL-3.0-only header.`);
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`SPDX check passed (${files.length} files).`);
