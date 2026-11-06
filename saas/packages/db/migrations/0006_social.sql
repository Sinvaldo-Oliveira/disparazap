CREATE TABLE "app"."social_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"zernio_post_id" text NOT NULL,
	"idempotency_key" text,
	"status" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"occurs_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_in_app" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"zernio_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_status_check" CHECK ("app"."social_posts"."status" in ('draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "identity"."organizations" ADD COLUMN "timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."media_files" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "app"."zernio_connections" ADD COLUMN "posts_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."social_posts" ADD CONSTRAINT "social_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."social_posts" ADD CONSTRAINT "social_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_org_id_unique" ON "app"."social_posts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_org_zernio_unique" ON "app"."social_posts" USING btree ("organization_id","zernio_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_org_idempotency_unique" ON "app"."social_posts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "social_posts_org_occurs_idx" ON "app"."social_posts" USING btree ("organization_id","occurs_at");