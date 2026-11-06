CREATE OR REPLACE FUNCTION "app"."current_org_id"() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, app
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "app"."current_org_id"() FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_app') THEN GRANT EXECUTE ON FUNCTION "app"."current_org_id"() TO "dz_app"; END IF; END $$;--> statement-breakpoint
CREATE TABLE "app"."inbox_social_sends" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "account_ref" text NOT NULL,
  "conversation_ref" text NOT NULL,
  "client_request_id" text NOT NULL,
  "actor_user_id" text,
  "text_length" integer NOT NULL,
  "window_mode" text NOT NULL,
  "status" text NOT NULL,
  "provider_message_id" text,
  "error_category" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "reconciled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_social_sends_org_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "inbox_social_sends_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  CONSTRAINT "inbox_social_sends_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'unknown')),
  CONSTRAINT "inbox_social_sends_window_check" CHECK ("window_mode" IN ('none', 'human_agent')),
  CONSTRAINT "inbox_social_sends_text_check" CHECK ("text_length" >= 0 AND "text_length" <= 1000),
  CONSTRAINT "inbox_social_sends_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "inbox_social_sends_provider_check" CHECK ("status" <> 'sent' OR "provider_message_id" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_social_sends_org_request_unique" ON "app"."inbox_social_sends" ("organization_id", "client_request_id");--> statement-breakpoint
CREATE INDEX "inbox_social_sends_org_created_idx" ON "app"."inbox_social_sends" ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX "inbox_social_sends_conversation_idx" ON "app"."inbox_social_sends" ("organization_id", "conversation_ref");--> statement-breakpoint
CREATE INDEX "inbox_social_sends_unknown_idx" ON "app"."inbox_social_sends" ("organization_id") WHERE "status" = 'unknown';--> statement-breakpoint
ALTER TABLE "app"."inbox_social_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."inbox_social_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_app') THEN
    CREATE POLICY "inbox_social_sends_select" ON "app"."inbox_social_sends" FOR SELECT TO "dz_app" USING ("organization_id" = "app"."current_org_id"());
    CREATE POLICY "inbox_social_sends_insert" ON "app"."inbox_social_sends" FOR INSERT TO "dz_app" WITH CHECK ("organization_id" = "app"."current_org_id"());
    CREATE POLICY "inbox_social_sends_update" ON "app"."inbox_social_sends" FOR UPDATE TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
    GRANT SELECT, INSERT, UPDATE ON TABLE "app"."inbox_social_sends" TO "dz_app";
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."inbox_social_sends" FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_migrator') THEN
    ALTER TABLE "app"."inbox_social_sends" OWNER TO "dz_migrator";
  END IF;
END $$;
