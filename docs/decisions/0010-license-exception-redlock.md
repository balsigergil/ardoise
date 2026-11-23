# 0010 — License exception for `@sesamecare-oss/redlock`

- Status: accepted (approved by the maintainer during M3)
- Date: 2026-11-23
- Milestone: M3

## Context
ARCHITECTURE §5 uses `@hocuspocus/extension-redis` (MIT) so any collab node can serve
any document. It depends on `@sesamecare-oss/redlock@1.4.0`, whose `package.json`
declares `"license": "UNLICENSED"`. The license check (ADR 0001) rejects it.

The package ships a `LICENSE.md` with the MIT license text (copyright 2015 Mike
Marcacci): it is a maintained fork of `node-redlock`, which is MIT. Only the metadata
field is wrong.

The maintainer also asked whether `AGPL-3.0-only` was the cause. It is not:
`UNLICENSED` means "no license granted" and would be rejected under any project license.
The project license stays `AGPL-3.0-only`.

## Options considered
1. Exception for this package, limited to the reviewed version: keeps the official
   extension; the review must be redone when the version changes.
2. Our own Yjs and awareness relay over Valkey: no exception, but more code to maintain
   for something the extension already does.
3. A single collab node in v1: contradicts ARCHITECTURE §1 (horizontally scalable).

## Decision
Option 1. `scripts/license-policy.json` gets an exception for
`@sesamecare-oss/redlock` with license `UNLICENSED` and versions `["1.4.0"]`. The
checker now honours a `versions` list, so an upgrade fails the check until it is
reviewed again. The MIT notice is added to `THIRD_PARTY_NOTICES.md`.

## Consequences
- Upgrading `@hocuspocus/extension-redis` may pull another redlock version; the check
  then fails and the license file must be reviewed again (or the upstream metadata
  fixed).
- No change to the allowlist itself.
