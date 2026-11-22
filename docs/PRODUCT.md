# Ardoise — Product specification

This document describes **behavior**, in Ardoise's own words. It is the functional
reference for the clean-room implementation (see `CLAUDE.md` §1.1). Scope markers:

- **[v1]**: part of the first release (milestones M0–M8)
- **[later]**: planned after v1 and kept in mind by the architecture, but not built now

## 1. Vision

- A complete, collaborative workspace for notes, documentation, wikis and lightweight
  project management, run on your own server.
- Free software under AGPL-3.0 with **no restricted edition**: every instance has every feature.
- Fast on large workspaces. Real-time collaboration from day one.
- Self-hosted first: one Docker image plus Postgres, Valkey and an S3-compatible store.
  A hosted offering is out of scope for now.

## 2. Glossary

| Term | Meaning |
|---|---|
| Instance | One Ardoise deployment. Managed by super-admins. |
| Workspace | Top-level container of members, teamspaces and pages. An instance hosts many workspaces. |
| Teamspace | A group of members inside a workspace with its own page tree and default access. |
| Page | A document made of blocks. Pages nest up to 40 levels deep (ADR 0007). |
| Block | A unit of content inside a page (paragraph, heading, image, database…). Blocks can contain child blocks. |
| Database | A page that holds a collection of rows with a typed schema and one or more views. |
| Row | An entry of a database. **A row is a page**: it has properties *and* its own content. |
| Property | A typed field defined by a database schema. |
| View | A saved way to display a database (layout, filters, sorts, grouping, visible properties). |
| Synced block | A block whose content is shared between several places and edited everywhere at once. |
| Template | A page (or row) blueprint used to create new pages (or rows). |

## 3. Instance and accounts [v1]

- **First start**: the server prints a one-time setup URL with a token in its logs. Opening it
  lets the operator create the first **super-admin** account. As an alternative for
  automated deployments, `ARDOISE_ADMIN_EMAIL` / `ARDOISE_ADMIN_PASSWORD` create it at boot.
- **No public sign-up.** Accounts are created only through invitations:
  - super-admins can invite anyone to the instance;
  - workspace owners/admins can invite by email to their workspace, which creates the
    instance account on acceptance. Super-admins can disable this in instance settings.
- An invitation is a single-use link with an expiry (default 7 days, configurable).
- Authentication: **email + password** [v1]. Includes password reset by email and
  session management (list and revoke sessions). SSO (OIDC, SAML) and MFA (TOTP,
  WebAuthn) are **[later]** and will ship in the free software like everything else.
- **Admin panel** (super-admins):
  - users (invite, disable, delete, promote) and workspaces (list, size);
  - SMTP settings and a test email;
  - AI providers;
  - limits: max upload size (default 100 MB), trash retention (default 30 days),
    version history retention (default unlimited), rows cached for the default view
    of each cached database for offline use (default 50), invitation expiry;
  - storage usage;
  - instance-wide toggles.
- User settings: name, avatar, email, password, language (`fr`/`en`), theme
  (light/dark/system), notification preferences, sessions and API tokens.

## 4. Workspaces, teamspaces and sidebar [v1]

- A user can belong to several workspaces and switch between them.
- **Workspace roles**: owner, admin, member, guest.
  - Owner/admin manage members, teamspaces and settings.
  - Members see teamspaces they can join.
  - Guests see only pages explicitly shared with them.
- **Teamspaces**: name, icon, description and members (teamspace owner or member).
  Every new workspace starts with one open teamspace named after it. Teamspace pages
  are accessible to the teamspace's members (at its default level; owners get full
  access), not to other workspace members unless shared with them.
  Visibility is *open* (any workspace member can join), *closed* (visible, join on
  request or invite; requests ship with notifications in M6) or *private* (hidden from
  non-members). A default access level
  applies to teamspace pages.
- **Sidebar sections**, in order: Favorites, Teamspaces (each with its page tree),
  Shared (pages shared with me outside teamspaces) and Private (my private pages).
  Footer entries give access to Templates, Import, Trash and Settings.
- Page trees in the sidebar load **lazily**, one level at a time.
  Drag and drop reorders pages and moves them across parents and sections.
- Quick find (`Ctrl/Cmd+K`) searches page titles first, then content, with recent pages
  shown when the query is empty.

## 5. Pages [v1]

- Every page has a title, an optional icon (emoji or uploaded image), an optional
  cover (uploaded image or solid/gradient color), content blocks and child pages.
- Page options:
  - page width (normal/full) and font style (default/serif/mono);
  - lock (prevents content and structure edits until unlocked; requires full access to toggle);
  - add to favorites, duplicate, move to, copy link;
  - make available offline;
  - version history, export, delete (to trash).
- **Trash**: deleted pages and their subtrees go to the trash. From there they can be
  restored to their original location (or to the root of their teamspace, or the
  restorer's private pages, if the parent no longer exists) or permanently deleted. Pages are purged automatically after the retention period.
- **Recents**: per user, the pages visited most recently.
- **Backlinks**: every page lists the pages that link to or mention it.
- **Public link** [v1]: "Share to web" gives a read-only public URL for a page and
  optionally its subpages. It is rendered by the SPA, is marked `noindex` and can be revoked.
  Full site publishing with SEO and custom domains is **[later]**.

## 6. Editor [v1]

### 6.1 Interaction model
- Block-based editing. Every block shows a drag handle on hover. The block menu offers
  turn into, color/background, duplicate, move to, copy link to block, comment and delete.
- The **slash menu** (`/`) inserts any block, with fuzzy search and keyboard navigation.
- **Markdown shortcuts**: `#`, `##`, `###`, `-`, `*`, `1.`, `[]`, `>`, ```` ``` ````,
  `---`, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`.
- Any block can have **child blocks**: `Tab` indents and `Shift+Tab` outdents.
- Multi-block selection lets the user move, delete, turn into or color several blocks at once.
- Inline formatting: bold, italic, underline, strikethrough, inline code, text color,
  background color, link, inline equation, mention.
- `@` mentions point to a person, a page or a date (absolute or relative, with optional reminder **[later]**).
- Pasting rich content (HTML, Markdown, plain text) converts it into blocks. Pasting a
  URL on an empty line offers to turn it into a link, a bookmark or an embed **[later]**.
- Undo/redo is per user. Under collaboration, a user only undoes their own changes.

### 6.2 Blocks in v1
Text (paragraph) · Heading 1/2/3 (each optionally toggleable) · Bulleted list ·
Numbered list · To-do (checkbox) · Toggle list · Quote · Callout (icon + background) ·
Code (language selection, syntax highlighting, wrap, copy) · Divider · Image (upload,
resize, caption) · File (upload, download) · Simple table (rows, columns, header
row/column) · Columns (2–5, resizable, created by dragging a block beside another) ·
Block equation (KaTeX) · Link to page · Inline database / full-page database ·
Synced block · Table of contents · Bookmark (URL preview card) · Child page.

**[later]**: embeds (video, maps, PDF viewer, third-party iframes), audio and video
players, breadcrumb block, buttons, forms.

### 6.3 Real-time collaboration
- Several users edit the same page at once and see each other's changes live.
- Presence shows avatars of who is viewing, plus colored cursors and selections with names.
- Conflicts on text never lose data (CRDT).

## 7. Databases [v1]

### 7.1 Structure
- A database is either **full-page** (a page that *is* the database) or **inline** (a
  database block inside a page). Linked views of another database are **[later]**.
- Each row is a page: opening a row shows its properties at the top and its content below.
  Rows open as a side peek, a centered modal or a full page (a per-view setting).
- **Property types [v1]**: title, text, number (with formats: number, percent,
  currency), select, multi-select, status (grouped options: to-do / in progress /
  done), date (with optional end date and time), person, checkbox, URL, email,
  phone, files & media, created time, created by, last edited time, last edited by, unique ID (prefix + auto-increment).
- **[later]**: relation, rollup, formula, button, verification.
- Schema editing: add, rename, reorder, hide and delete properties; change a property's
  type (with value conversion where meaningful); edit select options (name, color, order).

### 7.2 Views [v1]
- **Layouts**: table, board (grouped by select, status or person), list, calendar (by a
  date property), gallery (card preview: page cover, page content or a files property).
  **[later]**: timeline, chart.
- Every view has its own filters, sorts, grouping, visible and ordered properties,
  and card or row size.
- **Filters**: per-property operators fitting the type (is, is not, contains, starts
  with, is empty, >, <, before, after, within relative ranges…). Filters combine
  into groups with AND/OR, nested up to 2 levels.
- **Sorts**: multiple sort keys. **Grouping**: by property, with collapsed groups and hidden empty groups.
- Table: resizable columns, frozen first column, column calculations (count, count
  empty, unique, sum, average, min, max, % checked…).
- Board: drag cards between groups (updates the property) and within a group (manual order).
- Calendar: month and week display; drag to reschedule.
- Manual ordering of rows when no sort is active.
- Views load rows **page by page** with virtualized rendering. Counts and calculations
  are computed on the server.

### 7.3 Templates in databases [v1]
- Row templates per database: predefined property values and content, with a default template.

## 8. Templates [v1]

- Any page can be marked as a template within a workspace or teamspace. "New from
  template" duplicates it, its children included.
- Ardoise ships a small set of built-in templates written for the project (meeting notes,
  task tracker, wiki, journal). They are original content.

## 9. Synced blocks [v1]

- "Create synced block" wraps selected blocks. "Copy and sync" pastes a reference elsewhere.
- Editing any instance updates all instances in real time.
- Each instance shows the source page and the number of other places it appears. It can
  be **unsynced** (it becomes regular blocks) or the original can be deleted (copies
  then become regular blocks).
- Access: a reference renders only if the viewer can view the source page. Otherwise it
  shows a "no access" placeholder.

## 10. Comments [v1]

- **Page comments**: discussion threads at the top of a page.
- **Inline comments**: on a text selection or a block. The anchor follows the text as it is edited.
- Threads support replies, mentions, edit/delete of own comments, resolve/reopen and a
  "show resolved" toggle.
- Commenting requires at least the "can comment" permission.

## 11. Notifications [v1]

- **Events**:
  - mentioned in a page or comment;
  - reply in a thread I take part in;
  - comment on a page I created or follow;
  - page shared with me;
  - assigned via a person property;
  - workspace invitation.
- **Channels**: in-app inbox and email in v1 (web push **[later]**).
- **Preferences**: per user, per event type, per channel. Emails are batched over a short
  window to avoid floods (default 5 minutes).
- The inbox offers unread/archived tabs, mark as read and a link to the exact location.
- Following: users automatically follow pages they create or comment on, and can
  follow or unfollow a page manually.

## 12. Version history [v1]

- Snapshots are taken automatically after a period of editing inactivity (default 10
  minutes after the last change) and before any restore.
- The history panel lists snapshots with time and authors. Preview shows a read-only
  rendering and a highlighted diff against the current version.
- Restore replaces the content with the snapshot. The restore itself is recorded, so it
  can be undone.
- Retention follows the instance settings.

## 13. Permissions and sharing [v1]

- **Levels**, from highest to lowest: **Full access** (edit and share), **Can edit**, **Can
  edit content** (databases only: edit rows but not schema or views), **Can comment**,
  **Can view**, **No access**.
- "No access" is the absence of a grant: removing someone from the share menu deletes
  their grant. To keep people out of a subpage, restrict its inheritance.
- **Grants** target a user, a teamspace (all its members), the whole workspace or, for
  pages shared to web, "anyone with the link" (view only).
- **Inheritance**: a page inherits its parent's access. A page can add grants on top of
  inherited access or **restrict** inheritance so that only its own grants apply.
  Moving a page keeps its explicit grants. Inherited access then comes from the new parent.
- Private pages are visible only to their creator unless shared.
- Workspace owners can always recover access to any non-private page of the workspace,
  through an explicit "Recover access" action that is recorded.
- Restricting inheritance on a page also cuts the teamspace and workspace default access:
  only grants set on that page, or on pages between it and the page being opened, apply.
- The share menu shows who has access and why (inherited from X / granted here).

## 14. Search [v1]

- Full-text search over titles and content of every page the user can view, with
  filters (teamspace, created by, edited date, in titles only) and highlighted snippets.
- The engine is server-side Postgres FTS. Offline, search covers cached pages only.

## 15. Offline and PWA [v1]

- Ardoise is an installable PWA. The app shell is always available offline.
- **What is cached on a device**:
  - pages the user marked "available offline" on that device;
  - recently visited pages;
  - favorites;
  - for each cached database, the first N rows of its default view (N set in admin, default 50).
  Subpages are **not** cached automatically.
- **Available offline**:
  - read cached pages and database rows;
  - edit page content;
  - create pages;
  - edit property values of cached rows;
  - search cached content.
- **Requires a connection** (disabled in the UI with an explanation):
  - moving or reordering pages;
  - editing database schemas or views;
  - comments;
  - uploads;
  - AI features (AI runs on the server, including Ollama);
  - invitations;
  - permissions and sharing;
  - version history;
  - import/export.
- **Reconnect**: changes sync automatically.
  - Text merges without loss.
  - For a property edited by several people, the last write received by the server
    wins (device clocks are not used).
  - Any offline change the user is no longer allowed to make (for example, access was
    revoked meanwhile) is **rejected**: the change is discarded and the user sees a list
    of the rejected changes.
- A status indicator shows online, offline and syncing states, plus pending changes.
- Settings list the pages available offline on this device, their size and a remove action.
- **[later]**: offline structural edits (move, reorder, schema and view changes).

## 16. Import and export [v1]

- **Import from Notion**: upload the ZIP produced by Notion's "Markdown & CSV" export.
  Ardoise recreates:
  - the page hierarchy;
  - pages with their content (Markdown → blocks);
  - databases (CSV → rows, with property types inferred and editable before
    confirming), images and attached files.
  Internal links are rewritten. The import runs as a background job with progress and
  ends with a report (items imported, warnings, items skipped).
- **Import Markdown**: single files, or a ZIP of folders and files.
- **Export**:
  - a page or a subtree to Markdown (ZIP with assets);
  - a database to CSV;
  - a whole workspace to Markdown + CSV.

## 17. Public API and MCP server [v1]

- **REST API** (`/api/v1`) documented with an OpenAPI spec served by the instance. It
  covers pages, content (as Ardoise block JSON or Markdown), databases (schema, query,
  rows), comments, search, users and files.
- **Auth**: personal access tokens and workspace integration tokens.
  - Integration tokens have explicit page access, granted through the share menu like
    a user.
  - Tokens have scopes (read, write, comment).
  - Requests are rate-limited.
- **MCP server** exposed by the instance (Streamable HTTP transport) with the same
  token auth. Its tools let an AI agent:
  - search;
  - read a page as Markdown;
  - create a page and append to or replace its content;
  - query a database;
  - create or update rows;
  - list and add comments.
- No compatibility with Notion's API is intended.

## 18. AI [v1]

- **Providers**, bring-your-own-key: OpenAI, Anthropic, OpenRouter, and Ollama (or any
  OpenAI-compatible endpoint) reachable from the server.
- Super-admins configure providers and models at instance level. Workspace admins can
  enable/disable AI for their workspace and pick among configured models.
- **Features**:
  - in the editor, on a selection or the page: continue writing, summarize, improve,
    fix spelling and grammar, change tone, translate, make shorter or longer;
  - "Ask AI" about the current page;
  - "Ask the workspace": answers grounded in pages the user can view (server-side
    full-text retrieval), with links to sources.
  - Responses stream in, and the user can insert, replace or discard them.
- AI never sees content the requesting user cannot view.

## 19. Interface [v1]

- shadcn/ui components used as they are (neutral design), lucide icons.
- Light, dark and system themes.
- UI in French and English, chosen per user (defaults to the browser language).
- Keyboard-first: every frequent action has a shortcut, listed in a help dialog.
- Accessibility: keyboard navigation, focus states, ARIA roles from Radix, sufficient contrast.
- Responsive layout usable on phones and tablets (collapsible sidebar, touch-friendly menus).

## 20. Out of scope for v1 (planned later)

- Database property types: relation, rollup, formula, button.
- Views: timeline and chart layouts; linked views of other databases.
- Authentication: SSO (OIDC/SAML) and MFA.
- Notifications: web push.
- Offline: structural edits (move, reorder, schema and view changes).
- Content: embeds, forms, site publishing with custom domains and SEO.
- Search: a dedicated search engine (Meilisearch).
- Other: reminders on dates, a hosted offering.
