CREATE TABLE "app"."inbox_contact_identities" (
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_contact_identities_pkey" PRIMARY KEY("account_id","external_id"),
	CONSTRAINT "inbox_identities_kind_check" CHECK ("app"."inbox_contact_identities"."kind" in ('phone', 'lid', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"display_name" text,
	"phone_e164" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_conversation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"account_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text DEFAULT 'dm' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"control_mode" text DEFAULT 'human' NOT NULL,
	"control_version" integer DEFAULT 0 NOT NULL,
	"assigned_user_id" text,
	"ai_agent_id" text,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_message_direction" text,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_conversations_status_check" CHECK ("app"."inbox_conversations"."status" in ('open', 'pending', 'closed')),
	CONSTRAINT "inbox_conversations_control_check" CHECK ("app"."inbox_conversations"."control_mode" in ('human', 'ai', 'automation', 'waiting_human', 'closed')),
	CONSTRAINT "inbox_conversations_kind_check" CHECK ("app"."inbox_conversations"."kind" in ('dm', 'comment_thread', 'review'))
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"author" text NOT NULL,
	"author_user_id" text,
	"external_id" text,
	"client_request_id" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"media_kind" text,
	"body" text,
	"status" text NOT NULL,
	"error_reason" text,
	"control_version" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_messages_direction_check" CHECK ("app"."inbox_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "inbox_messages_author_check" CHECK ("app"."inbox_messages"."author" in ('contact', 'user', 'phone', 'api', 'ai', 'automation', 'system')),
	CONSTRAINT "inbox_messages_status_check" CHECK ("app"."inbox_messages"."status" in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
	CONSTRAINT "inbox_messages_content_check" CHECK ("app"."inbox_messages"."content_type" in ('text', 'media', 'unsupported'))
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_pending_receipts" (
	"account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pending_receipts_pkey" PRIMARY KEY("account_id","external_id"),
	CONSTRAINT "inbox_pending_receipts_status_check" CHECK ("app"."inbox_pending_receipts"."status" in ('delivered', 'read'))
);
--> statement-breakpoint
CREATE TABLE "app"."inbox_reception_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "inbox_gaps_reason_check" CHECK ("app"."inbox_reception_gaps"."reason" in ('disconnected', 'auth_failed', 'error'))
);
--> statement-breakpoint
ALTER TABLE "app"."whatsapp_instances" ADD COLUMN "inbox_enabled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_contacts_org_id_unique" ON "app"."inbox_contacts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversations_org_id_unique" ON "app"."inbox_conversations" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_org_id_unique" ON "app"."inbox_messages" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."inbox_contact_identities" ADD CONSTRAINT "inbox_identities_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "app"."inbox_contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_contact_identities" ADD CONSTRAINT "inbox_identities_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "app"."whatsapp_instances"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_contacts" ADD CONSTRAINT "inbox_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversation_events" ADD CONSTRAINT "inbox_conversation_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversation_events" ADD CONSTRAINT "inbox_events_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "app"."inbox_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversations" ADD CONSTRAINT "inbox_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversations" ADD CONSTRAINT "inbox_conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversations" ADD CONSTRAINT "inbox_conversations_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "app"."inbox_contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_conversations" ADD CONSTRAINT "inbox_conversations_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "app"."whatsapp_instances"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_messages" ADD CONSTRAINT "inbox_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_messages" ADD CONSTRAINT "inbox_messages_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "app"."inbox_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_pending_receipts" ADD CONSTRAINT "inbox_pending_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inbox_reception_gaps" ADD CONSTRAINT "inbox_reception_gaps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_identities_contact_idx" ON "app"."inbox_contact_identities" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "inbox_events_conversation_idx" ON "app"."inbox_conversation_events" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversations_account_contact_unique" ON "app"."inbox_conversations" USING btree ("account_id","contact_id");--> statement-breakpoint
CREATE INDEX "inbox_conversations_org_last_idx" ON "app"."inbox_conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_conversation_external_unique" ON "app"."inbox_messages" USING btree ("conversation_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_org_request_unique" ON "app"."inbox_messages" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE INDEX "inbox_messages_conversation_sent_idx" ON "app"."inbox_messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX "inbox_gaps_org_started_idx" ON "app"."inbox_reception_gaps" USING btree ("organization_id","started_at");