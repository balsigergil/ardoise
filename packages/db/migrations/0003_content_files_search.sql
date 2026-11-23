-- SPDX-License-Identifier: AGPL-3.0-only
-- btree_gin (trusted) lets the search GIN index start with workspace_id.
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."page_link_kind" AS ENUM('link', 'mention', 'synced_ref');--> statement-breakpoint
CREATE TABLE "files" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"thumbnail_key" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "page_documents" (
	"workspace_id" uuid NOT NULL,
	"doc_name" text NOT NULL,
	"page_id" uuid NOT NULL,
	"state" "bytea" NOT NULL,
	"state_vector" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_documents_workspace_id_doc_name_pk" PRIMARY KEY("workspace_id","doc_name")
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"workspace_id" uuid NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"kind" "page_link_kind" NOT NULL,
	CONSTRAINT "page_links_workspace_id_source_page_id_target_page_id_kind_pk" PRIMARY KEY("workspace_id","source_page_id","target_page_id","kind")
);
--> statement-breakpoint
CREATE TABLE "page_mentions_users" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"block_id" text DEFAULT '' NOT NULL,
	CONSTRAINT "page_mentions_users_workspace_id_page_id_user_id_block_id_pk" PRIMARY KEY("workspace_id","page_id","user_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "page_search" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"tsv" "tsvector" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_search_workspace_id_page_id_pk" PRIMARY KEY("workspace_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_documents" ADD CONSTRAINT "page_documents_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_workspace_id_source_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_mentions_users" ADD CONSTRAINT "page_mentions_users_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_search" ADD CONSTRAINT "page_search_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_page_idx" ON "files" USING btree ("workspace_id","page_id");--> statement-breakpoint
CREATE INDEX "files_deleted_idx" ON "files" USING btree ("workspace_id","deleted_at") WHERE "files"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "page_documents_page_idx" ON "page_documents" USING btree ("workspace_id","page_id");--> statement-breakpoint
CREATE INDEX "page_links_target_idx" ON "page_links" USING btree ("workspace_id","target_page_id","source_page_id");--> statement-breakpoint
CREATE INDEX "page_mentions_users_user_idx" ON "page_mentions_users" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "page_search_tsv_idx" ON "page_search" USING gin ("workspace_id","tsv");