CREATE TYPE "public"."source_kind" AS ENUM('ats', 'djinni', 'dou');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"cv" text NOT NULL,
	"rubric_body" text NOT NULL,
	"rubric_weights" jsonb NOT NULL,
	"profile" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id"),
	CONSTRAINT "app_settings_weights_nonzero" CHECK (
    ("app_settings"."rubric_weights"->>'coreStack')::int + ("app_settings"."rubric_weights"->>'seniority')::int +
    ("app_settings"."rubric_weights"->>'domain')::int + ("app_settings"."rubric_weights"->>'logistics')::int +
    ("app_settings"."rubric_weights"->>'growth')::int > 0)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"board" text,
	"slug" text,
	"url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_identity_uniq" UNIQUE NULLS NOT DISTINCT("kind","board","slug","url"),
	CONSTRAINT "sources_ats_has_board_and_slug" CHECK (("sources"."kind" = 'ats') = ("sources"."board" IS NOT NULL) AND ("sources"."kind" = 'ats') = ("sources"."slug" IS NOT NULL)),
	CONSTRAINT "sources_url_only_for_non_ats" CHECK (("sources"."kind" = 'ats') = ("sources"."url" IS NULL))
);
