// SPDX-License-Identifier: AGPL-3.0-only
import { isExpressionAllowed } from './license-expression.mjs';

/**
 * Evaluates every installed package against the policy (ADR 0001).
 * @param {Array<{ name: string, version: string, license: string }>} packages
 * @param {{ allowed: string[], dataOnly: { licenses: string[], packages: string[] },
 *           exceptions: Record<string, { license: string, reason: string }> }} policy
 * @returns {Array<{ name: string, version: string, license: string }>} violations
 */
export function findViolations(packages, policy) {
  const allowed = new Set(policy.allowed);
  const dataOnlyLicenses = new Set(policy.dataOnly.licenses);
  const dataOnlyPackages = new Set(policy.dataOnly.packages);

  return packages.filter((pkg) => {
    const exception = policy.exceptions[pkg.name];
    if (exception && exception.license === pkg.license) return false;
    const isAllowed = (id) =>
      allowed.has(id) || (dataOnlyLicenses.has(id) && dataOnlyPackages.has(pkg.name));
    return !isExpressionAllowed(pkg.license ?? '', isAllowed);
  });
}

/**
 * Normalizes the output of `pnpm licenses list --json`: an object keyed by license
 * whose values are arrays of `{ name, versions | version, license? }`.
 */
export function normalizePnpmLicenses(json) {
  const result = [];
  for (const [license, entries] of Object.entries(json)) {
    for (const entry of entries) {
      const versions = entry.versions ?? (entry.version ? [entry.version] : ['?']);
      for (const version of versions) {
        result.push({ name: entry.name, version, license: entry.license ?? license });
      }
    }
  }
  return result;
}
