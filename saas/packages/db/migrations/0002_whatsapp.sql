CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."whatsapp_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_server_id" text NOT NULL,
	"provider_instance_name" text NOT NULL,
	"provider_instance_id" text,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"status" text DEFAULT 'created' NOT NULL,
	"credential_id" text,
	"last_status_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "whatsapp_instances_status_check" CHECK ("app"."whatsapp_instances"."status" in ('created', 'connecting', 'connected', 'disconnected', 'error')),
	CONSTRAINT "whatsapp_instances_name_prefix_check" CHECK ("app"."whatsapp_instances"."provider_instance_name" like 'dz\_%')
);
--> statement-breakpoint
ALTER TABLE "identity"."organizations" ADD COLUMN "max_whatsapp_instances" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_provider_server_id_provider_servers_id_fk" FOREIGN KEY ("provider_server_id") REFERENCES "platform"."provider_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "platform"."integration_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_instances_org_id_unique" ON "app"."whatsapp_instances" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_instances_server_name_unique" ON "app"."whatsapp_instances" USING btree ("provider_server_id","provider_instance_name");--> statement-breakpoint
CREATE INDEX "whatsapp_instances_org_status_idx" ON "app"."whatsapp_instances" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "identity"."organizations" ADD CONSTRAINT "organizations_max_whatsapp_instances_check" CHECK ("identity"."organizations"."max_whatsapp_instances" between 0 and 100);