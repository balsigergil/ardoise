// SPDX-License-Identifier: AGPL-3.0-only
export type Command =
  { kind: 'serve' } | { kind: 'migrate' } | { kind: 'help' } | { kind: 'unknown'; name: string };

/** Parses `ardoise [serve|migrate|help]`. */
export function parseCommand(argv: readonly string[]): Command {
  const [name] = argv;
  switch (name) {
    case undefined:
    case 'serve':
      return { kind: 'serve' };
    case 'migrate':
      return { kind: 'migrate' };
    case 'help':
    case '--help':
    case '-h':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', name };
  }
}

export const usage = `Usage: ardoise [command]

Commands:
  serve     Start the server in the role given by ARDOISE_ROLE (default)
  migrate   Apply pending database migrations, then exit
  help      Show this message`;
