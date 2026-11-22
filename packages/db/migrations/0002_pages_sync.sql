-- SPDX-License-Identifier: AGPL-3.0-only
CREATE TYPE "public"."change_op" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TYPE "public"."move_state" AS ENUM('moving');--> statement-breakpoint
CREATE TYPE "public"."page_font" AS ENUM('default', 'serif', 'mono');--> statement-breakpoint
CREATE TYPE "public"."page_kind" AS ENUM('page', 'database', 'row');--> statement-breakpoint
CREATE TYPE "public"."page_width" AS ENUM('normal', 'full');--> statement-breakpoint
CREATE TYPE "public"."parent_kind" AS ENUM('teamspace', 'private', 'page', 'database');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('user', 'teamspace', 'workspace', 'integration', 'public_link');--> statement-breakpoint
CREATE TABLE "applied_mutations" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applied_mutations_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"workspace_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"page_id" uuid,
	"user_id" uuid,
	"op" "change_op" NOT NULL,
	"data" jsonb,
	"mutation_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_workspace_id_seq_pk" PRIMARY KEY("workspace_id","seq")
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	CONSTRAINT "favorites_workspace_id_user_id_page_id_pk" PRIMARY KEY("workspace_id","user_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "page_follows" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	CONSTRAINT "page_follows_workspace_id_user_id_page_id_pk" PRIMARY KEY("workspace_id","user_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "page_permissions" (
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"principal_kind" "principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"level" "permission_level" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_permissions_workspace_id_page_id_principal_kind_principal_id_pk" PRIMARY KEY("workspace_id","page_id","principal_kind","principal_id")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" "page_kind" DEFAULT 'page' NOT NULL,
	"parent_kind" "parent_kind" NOT NULL,
	"parent_id" uuid NOT NULL,
	"path" "ltree" NOT NULL,
	"is_inline" boolean DEFAULT false NOT NULL,
	"move_state" "move_state",
	"position" text COLLATE "C" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon" jsonb,
	"cover" jsonb,
	"properties" jsonb,
	"restrict_inheritance" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"width" "page_width" DEFAULT 'normal' NOT NULL,
	"font" "page_font" DEFAULT 'default' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_root_id" uuid,
	CONSTRAINT "pages_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "public_links" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"include_subpages" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "public_links_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "recents" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recents_workspace_id_user_id_page_id_pk" PRIMARY KEY("workspace_id","user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "applied_mutations" ADD CONSTRAINT "applied_mutations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_user_id_workspace_members_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_follows" ADD CONSTRAINT "page_follows_workspace_id_user_id_workspace_members_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_follows" ADD CONSTRAINT "page_follows_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recents" ADD CONSTRAINT "recents_workspace_id_user_id_workspace_members_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recents" ADD CONSTRAINT "recents_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applied_mutations_created_idx" ON "applied_mutations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "change_log_created_idx" ON "change_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "favorites_order_idx" ON "favorites" USING btree ("workspace_id","user_id","position","page_id");--> statement-breakpoint
CREATE INDEX "page_follows_page_idx" ON "page_follows" USING btree ("workspace_id","page_id");--> statement-breakpoint
CREATE INDEX "page_permissions_principal_idx" ON "page_permissions" USING btree ("workspace_id","principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "pages_children_idx" ON "pages" USING btree ("workspace_id","parent_id","position","id");--> statement-breakpoint
CREATE INDEX "pages_path_gist" ON "pages" USING gist ("path");--> statement-breakpoint
CREATE INDEX "pages_title_trgm" ON "pages" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pages_moving_idx" ON "pages" USING btree ("workspace_id") WHERE "pages"."move_state" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pages_trash_idx" ON "pages" USING btree ("workspace_id","deleted_at") WHERE "pages"."deleted_root_id" = "pages"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "public_links_token_key" ON "public_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "public_links_active_key" ON "public_links" USING btree ("workspace_id","page_id") WHERE "public_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recents_order_idx" ON "recents" USING btree ("workspace_id","user_id","visited_at");