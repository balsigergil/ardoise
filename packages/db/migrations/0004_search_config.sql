-- SPDX-License-Identifier: AGPL-3.0-only
-- Search (ADR 0009 §8): an `ardoise` text search configuration (simple + unaccent), so
-- vectors, queries and ts_headline snippets all ignore accents, and an immutable
-- unaccent wrapper usable in expression indexes.
CREATE TEXT SEARCH CONFIGURATION ardoise (COPY = simple);
--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION ardoise
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH unaccent, simple;
--> statement-breakpoint
CREATE FUNCTION ardoise_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN public.unaccent('public.unaccent'::regdictionary, $1);
--> statement-breakpoint
DROP INDEX "pages_title_trgm";--> statement-breakpoint
CREATE INDEX "pages_title_prefix_idx" ON "pages" USING btree ("workspace_id",lower(ardoise_unaccent("title")) text_pattern_ops);--> statement-breakpoint
CREATE INDEX "pages_title_trgm" ON "pages" USING gin ("workspace_id",ardoise_unaccent("title") gin_trgm_ops);
