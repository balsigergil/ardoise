// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSRF guard for server-side fetches (bookmark previews, ADR 0009 §9): only public
 * unicast addresses, checked on every DNS lookup (so redirects and rebinding cannot
 * reach internal services).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for a public unicast address; IPv4-mapped IPv6 is checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return !blocked.check(address, 'ipv6');
  return false;
}

export class BlockedAddressError extends Error {
  constructor() {
    super('address not allowed');
  }
}

type LookupFn = (
  hostname: string,
  options: { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for `http.request` that refuses hosts resolving to any non-public address.
 * `resolve` is injectable for tests.
 */
export function guardedLookup(resolve: LookupFn = dnsLookup) {
  return (
    hostname: string,
    options: object,
    callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
        return callback(new BlockedAddressError(), '', 4);
      }
      if ((options as { all?: boolean }).all) return callback(null, addresses);
      const first = addresses[0]!;
      return callback(null, first.address, first.family);
    });
  };
}
