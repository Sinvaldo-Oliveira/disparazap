CREATE TABLE "app"."zernio_connections" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_name" text NOT NULL,
	"account_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_check_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zernio_connections_status_check" CHECK ("app"."zernio_connections"."status" in ('active', 'invalid'))
);
--> statement-breakpoint
ALTER TABLE "app"."zernio_connections" ADD CONSTRAINT "zernio_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."zernio_connections" ADD CONSTRAINT "zernio_connections_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "platform"."integration_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."zernio_connections" ADD CONSTRAINT "zernio_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_connections_credential_unique" ON "app"."zernio_connections" USING btree ("credential_id");