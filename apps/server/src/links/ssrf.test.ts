// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { BlockedAddressError, guardedLookup, isPublicAddress } from './ssrf.js';

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, metadata and special ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('accepts public unicast addresses', () => {
    for (const ip of [
      '93.184.216.34',
      '1.1.1.1',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('guardedLookup', () => {
  const resolver =
    (addresses: { address: string; family: number }[]) =>
    (
      _h: string,
      _o: { all: true },
      cb: (e: NodeJS.ErrnoException | null, a: typeof addresses) => void,
    ) =>
      cb(null, addresses);
  const run = (addresses: { address: string; family: number }[], options = {}) =>
    new Promise<unknown>((resolve) => {
      guardedLookup(resolver(addresses))('example.test', options, (error, address) =>
        resolve(error ?? address),
      );
    });

  it('passes public hosts', async () => {
    expect(await run([{ address: '93.184.216.34', family: 4 }])).toBe('93.184.216.34');
  });

  it('blocks a host if any of its addresses is internal (DNS rebinding)', async () => {
    expect(
      await run([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).toBeInstanceOf(BlockedAddressError);
    expect(await run([])).toBeInstanceOf(BlockedAddressError);
  });
});
