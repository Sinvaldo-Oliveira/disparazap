CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."integration_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"last4" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "integration_credentials_kind_check" CHECK ("platform"."integration_credentials"."kind" in ('global_api_key', 'instance_token', 'api_key', 'oauth_token', 'signing_secret'))
);
--> statement-breakpoint
CREATE TABLE "platform"."provider_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credential_id" text,
	"last_check_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_detail" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_servers_provider_check" CHECK ("platform"."provider_servers"."provider" in ('evolution_go')),
	CONSTRAINT "provider_servers_status_check" CHECK ("platform"."provider_servers"."status" in ('active', 'disabled')),
	CONSTRAINT "provider_servers_last_check_status_check" CHECK ("platform"."provider_servers"."last_check_status" is null or "platform"."provider_servers"."last_check_status" in ('ok', 'unauthorized', 'unreachable', 'invalid_response', 'error'))
);
--> statement-breakpoint
ALTER TABLE "platform"."integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."integration_credentials" ADD CONSTRAINT "integration_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."provider_servers" ADD CONSTRAINT "provider_servers_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "platform"."integration_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."provider_servers" ADD CONSTRAINT "provider_servers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."provider_servers" ADD CONSTRAINT "provider_servers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credentials_organization_idx" ON "platform"."integration_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_servers_provider_name_unique" ON "platform"."provider_servers" USING btree ("provider","name");