import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { app, whatsappInstances } from './app.ts';
import { organizations, users } from './identity.ts';

// ----- Inbox multicanal (PLANO_MODULO_INBOX §E.1, etapa I1: WhatsApp) -----
// Conversas são dados pessoais de terceiros: tudo por empresa, exclusão em cascata com a empresa, nada disso vai para o log.

/** Pessoa atendida pela empresa, em qualquer canal */
export const inboxContacts = app.table(
  'inbox_contacts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    /** Só dígitos, quando o canal informa o número (WhatsApp por número; LID não tem) */
    phoneE164: text('phone_e164'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('inbox_contacts_org_id_unique').on(table.organizationId, table.id)],
);

/** Identificadores externos do contato por conta (no WhatsApp: o JID por número e o LID, que podem chegar trocados) */
export const inboxContactIdentities = app.table(
  'inbox_contact_identities',
  {
    organizationId: text('organization_id').notNull(),
    /** Conta do canal: a instância de WhatsApp (app.whatsapp_instances.id) */
    accountId: text('account_id').notNull(),
    externalId: text('external_id').notNull(),
    contactId: text('contact_id').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'inbox_contact_identities_pkey', columns: [table.accountId, table.externalId] }),
    foreignKey({ name: 'inbox_identities_contact_fk', columns: [table.organizationId, table.contactId], foreignColumns: [inboxContacts.organizationId, inboxContacts.id] }).onDelete('cascade'),
    foreignKey({ name: 'inbox_identities_account_fk', columns: [table.organizationId, table.accountId], foreignColumns: [whatsappInstances.organizationId, whatsappInstances.id] }).onDelete('cascade'),
    index('inbox_identities_contact_idx').on(table.organizationId, table.contactId),
    check('inbox_identities_kind_check', sql`${table.kind} in ('phone', 'lid', 'other')`),
  ],
);

export const inboxConversations = app.table(
  'inbox_conversations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().default('whatsapp'),
    accountId: text('account_id').notNull(),
    contactId: text('contact_id').notNull(),
    /** Identificador da conversa no canal (no WhatsApp, o JID do contato) */
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull().default('dm'),
    status: text('status').notNull().default('open'),
    // Controle do atendimento (plano §E.5): toda troca de modo aumenta a versão; resposta automática pendente com versão antiga é descartada
    controlMode: text('control_mode').notNull().default('human'),
    controlVersion: integer('control_version').notNull().default(0),
    assignedUserId: text('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Reservado para o módulo Agentes de IA */
    aiAgentId: text('ai_agent_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: text('last_message_preview'),
    lastMessageDirection: text('last_message_direction'),
    /** Última mensagem do cliente (janela de atendimento dos canais que têm janela) */
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inbox_conversations_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('inbox_conversations_account_contact_unique').on(table.accountId, table.contactId),
    index('inbox_conversations_org_last_idx').on(table.organizationId, table.lastMessageAt),
    foreignKey({ name: 'inbox_conversations_contact_fk', columns: [table.organizationId, table.contactId], foreignColumns: [inboxContacts.organizationId, inboxContacts.id] }).onDelete('cascade'),
    foreignKey({ name: 'inbox_conversations_account_fk', columns: [table.organizationId, table.accountId], foreignColumns: [whatsappInstances.organizationId, whatsappInstances.id] }).onDelete('cascade'),
    check('inbox_conversations_status_check', sql`${table.status} in ('open', 'pending', 'closed')`),
    check('inbox_conversations_control_check', sql`${table.controlMode} in ('human', 'ai', 'automation', 'waiting_human', 'closed')`),
    check('inbox_conversations_kind_check', sql`${table.kind} in ('dm', 'comment_thread', 'review')`),
  ],
);

export const inboxMessages = app.table(
  'inbox_messages',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    direction: text('direction').notNull(),
    author: text('author').notNull(),
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Id da mensagem no canal (WhatsApp: Info.ID); null enquanto o envio não confirma */
    externalId: text('external_id'),
    /** Identificador do pedido do painel (envio sem duplicar) */
    clientRequestId: text('client_request_id'),
    contentType: text('content_type').notNull().default('text'),
    mediaKind: text('media_kind'),
    body: text('body'),
    status: text('status').notNull(),
    errorReason: text('error_reason'),
    /** Versão de controle em que uma resposta automática foi gerada (IA e automações, etapas futuras) */
    controlVersion: integer('control_version'),
    /** Hora informada pelo canal: a ordem da conversa segue esta hora, não a de chegada */
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inbox_messages_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('inbox_messages_conversation_external_unique').on(table.conversationId, table.externalId),
    uniqueIndex('inbox_messages_org_request_unique').on(table.organizationId, table.clientRequestId),
    index('inbox_messages_conversation_sent_idx').on(table.conversationId, table.sentAt),
    foreignKey({ name: 'inbox_messages_conversation_fk', columns: [table.organizationId, table.conversationId], foreignColumns: [inboxConversations.organizationId, inboxConversations.id] }).onDelete('cascade'),
    check('inbox_messages_direction_check', sql`${table.direction} in ('inbound', 'outbound')`),
    check('inbox_messages_author_check', sql`${table.author} in ('contact', 'user', 'phone', 'api', 'ai', 'automation', 'system')`),
    check('inbox_messages_status_check', sql`${table.status} in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')`),
    check('inbox_messages_content_check', sql`${table.contentType} in ('text', 'media', 'unsupported')`),
  ],
);

/** Recibo (entregue/lida) que chegou antes da mensagem: aplicado quando ela chegar */
export const inboxPendingReceipts = app.table(
  'inbox_pending_receipts',
  {
    accountId: text('account_id').notNull(),
    externalId: text('external_id').notNull(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'inbox_pending_receipts_pkey', columns: [table.accountId, table.externalId] }),
    check('inbox_pending_receipts_status_check', sql`${table.status} in ('delivered', 'read')`),
  ],
);

/** Período em que o DisparaZap não recebeu eventos de uma conta (mensagens do intervalo podem faltar) */
export const inboxReceptionGaps = app.table(
  'inbox_reception_gaps',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reason: text('reason').notNull(),
  },
  (table) => [
    index('inbox_gaps_org_started_idx').on(table.organizationId, table.startedAt),
    check('inbox_gaps_reason_check', sql`${table.reason} in ('disconnected', 'auth_failed', 'error')`),
  ],
);

/** Eventos do atendimento (troca de modo, responsável, reabertura): linha do tempo e auditoria */
export const inboxConversationEvents = app.table(
  'inbox_conversation_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    type: text('type').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, string | number | null>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inbox_events_conversation_idx').on(table.conversationId, table.createdAt),
    foreignKey({ name: 'inbox_events_conversation_fk', columns: [table.organizationId, table.conversationId], foreignColumns: [inboxConversations.organizationId, inboxConversations.id] }).onDelete('cascade'),
  ],
);
