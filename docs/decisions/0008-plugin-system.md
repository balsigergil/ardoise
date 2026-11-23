# 0008 — Plugin system: tiers, reserved editor nodes, generic records, seams in M3–M8

- Status: accepted (decided by the maintainer, 2026-11-23). The reserved editor types
  (decision 2, PLUGINS.md Q4) are binding from M3. The trust model, license policy and
  timing (decisions 1 and 6, the M9 placement; PLUGINS.md Q1–Q3) are the working
  assumption and must be confirmed before M9 starts.
- Date: 2026-11-23
- Milestone: M3 (seams), M9 (runtime)

## Context
The maintainer wants Ardoise to be extensible through plugins, without reworking M2 (done)
or the milestones that come after it. Constraints:
- AGPL-3.0-only, no open core (CLAUDE.md §1.2), clean-room (§1.1);
- server-authoritative structured data through a closed, typed mutation catalog with
  pure apply functions (ARCHITECTURE §6), and seq serialization per workspace (§4.8);
- one ProseMirror schema shared by every collaborator and decoded on the server
  (projection, Markdown, history);
- performance budgets (§12) and offline support (§8).

ARCHITECTURE did not mention extensibility until now. The full design is in `docs/PLUGINS.md`.

## Options considered
1. **Plugins define their own ProseMirror nodes and mutations.** This is the most
   flexible option. But documents then depend on installed plugins (content loss when
   one is disabled, because y-prosemirror cannot keep unknown nodes), and the mutation
   catalog, its typed handlers and the rebase become open-ended.
2. **Only out-of-process integrations** (API, MCP, webhooks). This is simple and safe,
   but it cannot add blocks, property types or views, which is what users expect from plugins.
3. **Tiered model with stable persisted formats** (chosen): Tier 0 integrations, Tier 1
   trusted in-process plugins, Tier 2 sandboxed plugins later. Plugins extend through
   registries that the core itself uses, store content in reserved generic nodes and
   store data in generic records written by two core mutations.
4. **Build the plugin runtime now, before M3.** This would freeze an API before the
   editor and databases exist, and delay Notion parity.

## Decision
Option 3, with the runtime built in M9 (after v1) and the seams built during M3–M8:
1. **Tiers**: 0 = API, MCP, webhooks; 1 = trusted in-process packages installed by a
   super-admin from `ARDOISE_PLUGINS_DIR` and enabled per workspace; 2 = sandboxed, later,
   with its own ADR.
2. **Reserved editor types** in the M3 schema (PLUGINS.md §6). Plugins never add node or
   mark types:
   - nodes `pluginBlock` (atom), `pluginContainer` (`block+`), `pluginText` (`inline*`)
     and `pluginInline` (inline atom), with `plugin`, `type`, `version`, `data` (JSON,
     ≤ 16 KB) and a `text` fallback;
   - the mark `pluginMark` (`excludes: ""`), whose overlap behavior with `y-prosemirror`
     is verified in M3, with a fixed set of mark names as the fallback;
   - a global `ext` attribute (`{ [pluginId]: JSON }`, capped) on every block node, for
     plugin data attached to core blocks;
   - the `plugin:<blockId>` Yjs subdocument name, for state that several people edit at
     once, with access following the containing page. The prefix is reserved in M3 and
     served in M9.
3. **Plugin data** goes in `plugin_records`, governed by page, user or workspace (which
   matches the existing change-log `page_id`/`user_id` delivery). It is written only by
   the core mutations `pluginRecord.set` and `pluginRecord.delete`, with schemas
   provided by the plugin. **Plugins never add mutation names.**
4. **No synchronous hooks** in the mutation transaction. Automations are change consumers
   in the worker role, reading the change log through the plugin's integration
   principal and the pull delivery rules.
5. **Dogfooding**: core blocks, property types (via a value kind), layouts, notification
   types, Markdown serializers, MCP tools, AI providers and commands, and importers are
   registered through internal registries from M3–M8 onwards. Extensible
   identifiers are strings, not `pgEnum`.
6. **Licensing**: Tier 1 plugins must use an allowlisted license (ADR 0001), and the SDK
   is `AGPL-3.0-only`. Pending maintainer confirmation (PLUGINS.md Q2).

## Consequences
- M2: nothing is redone. `change_log.entity_type` is already `text`, the
  `integration` principal kind exists, and M9 adds one entity type, two mutations and one
  job entry.
- M3–M8 each get a small "extension seams" task (ROADMAP, PLUGINS.md §11). Each
  milestone summary reports the state of its seams.
- The reserved types, `ext` and the `plugin:` prefix are a persisted format from M3
  onwards. Changing them later needs a document migration.
- `data` and `ext` are last-writer-wins per attribute. Fine-grained concurrent state
  needs a subdocument, so history, export, duplication and deletion must handle a page's
  subdocuments together (M9).
- Plugins cannot constrain the content of their containers in the schema. They
  normalize it where they are loaded.
- Plugins that want custom SQL, custom node or mark types, synchronous validation or
  sandboxing are not supported in the first version. Each of these needs a later ADR.
- New docs: `docs/PLUGINS.md`; ARCHITECTURE §15; PRODUCT §21; ROADMAP M9.
