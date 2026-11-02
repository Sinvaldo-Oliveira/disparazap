CREATE TABLE "app"."contact_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contacts" (
	"organization_id" text NOT NULL,
	"list_id" text NOT NULL,
	"phone_e164" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "contacts_pkey" PRIMARY KEY("list_id","phone_e164"),
	CONSTRAINT "contacts_phone_check" CHECK ("app"."contacts"."phone_e164" ~ '^[0-9]{10,15}$')
);
--> statement-breakpoint
ALTER TABLE "app"."contact_lists" ADD CONSTRAINT "contact_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."contact_lists" ADD CONSTRAINT "contact_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_lists_org_id_unique" ON "app"."contact_lists" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_lists_org_name_unique" ON "app"."contact_lists" USING btree ("organization_id",lower("name"));
--> statement-breakpoint
CREATE INDEX "contacts_list_position_idx" ON "app"."contacts" USING btree ("list_id","position");
--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_list_fk" FOREIGN KEY ("organization_id","list_id") REFERENCES "app"."contact_lists"("organization_id","id") ON DELETE cascade ON UPDATE no action;
