// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseCommand } from './command.js';

describe('parseCommand', () => {
  it.each([
    [[], { kind: 'serve' }],
    [['serve'], { kind: 'serve' }],
    [['migrate'], { kind: 'migrate' }],
    [['--help'], { kind: 'help' }],
    [['-h'], { kind: 'help' }],
    [['seed'], { kind: 'unknown', name: 'seed' }],
  ])('%j', (argv, expected) => {
    expect(parseCommand(argv)).toEqual(expected);
  });
});
