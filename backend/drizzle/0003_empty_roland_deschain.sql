DELETE FROM "sources";--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_identity_uniq";--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_ats_has_board_and_slug";--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_url_only_for_non_ats";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "selectors" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "blocked_title_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "blocked_description_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "board";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_url_uniq" UNIQUE("url");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_name_uniq" UNIQUE("name");--> statement-breakpoint
DROP TYPE "public"."source_kind";
