CREATE TABLE "app"."media_files" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_files_mime_check" CHECK ("app"."media_files"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "media_files_size_check" CHECK ("app"."media_files"."size_bytes" between 1 and 5242880)
);
--> statement-breakpoint
CREATE TABLE "app"."message_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"variations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_id" text,
	"cta_text" text,
	"cta_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_cta_check" CHECK (("app"."message_templates"."cta_text" is null) = ("app"."message_templates"."cta_url" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."media_files" ADD CONSTRAINT "media_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."media_files" ADD CONSTRAINT "media_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "media_files_org_id_unique" ON "app"."media_files" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_org_id_unique" ON "app"."message_templates" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_org_name_unique" ON "app"."message_templates" USING btree ("organization_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_media_fk" FOREIGN KEY ("organization_id","media_id") REFERENCES "app"."media_files"("organization_id","id") ON DELETE restrict ON UPDATE no action;
