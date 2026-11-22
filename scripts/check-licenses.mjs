#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/** Fails when an installed dependency uses a license outside the policy (ADR 0001). */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findViolations, normalizePnpmLicenses } from './lib/license-policy.mjs';

const policy = JSON.parse(readFileSync(new URL('./license-policy.json', import.meta.url), 'utf8'));

const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--recursive'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
});
const packages = normalizePnpmLicenses(JSON.parse(raw));
const violations = findViolations(packages, policy);

if (violations.length > 0) {
  console.error(`License check failed: ${violations.length} package(s) outside the policy.`);
  for (const v of violations) console.error(`  ${v.name}@${v.version}: ${v.license}`);
  process.exit(1);
}
console.log(`License check passed (${packages.length} package versions).`);
