-- SPDX-License-Identifier: AGPL-3.0-only
-- Extensions required by the data model (ARCHITECTURE §4). All three are "trusted"
-- extensions, so the database owner can create them without superuser rights.
CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
