CREATE TYPE "public"."run_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('STRONG', 'MAYBE', 'NO');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"score_id" integer NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"employment_type" text,
	"description" text NOT NULL,
	"raw" jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" "run_status" NOT NULL,
	"postings_seen" integer DEFAULT 0 NOT NULL,
	"error" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"rubric_version" text NOT NULL,
	"total" integer NOT NULL,
	"verdict" "verdict" NOT NULL,
	"subscores" jsonb NOT NULL,
	"reasoning" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_score_id_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scores_posting_idx" ON "scores" USING btree ("posting_id");--> statement-breakpoint
CREATE INDEX "scores_total_idx" ON "scores" USING btree ("total");