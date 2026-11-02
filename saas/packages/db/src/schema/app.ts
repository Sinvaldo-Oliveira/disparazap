import { sql } from 'drizzle-orm';
import { check, customType, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Bytes crus (o Drizzle não tem bytea pronto): Buffer no driver pg, Uint8Array no PGlite */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });
import { organizations, users } from './identity.ts';
import { integrationCredentials, providerServers } from './platform.ts';

/**
 * Esquema `app`: dados das empresas. Toda tabela tem `organization_id` e chave composta (organization_id, id).
 * O RLS do banco entra com a conexão ao Supabase (SUPABASE_CONFIGURACAO §6); até lá, a API filtra pela empresa da sessão.
 */
export const app = pgSchema('app');

export const whatsappInstances = app.table(
  'whatsapp_instances',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    providerServerId: text('provider_server_id').notNull().references(() => providerServers.id, { onDelete: 'restrict' }),
    // Nome na Evolution Go (dz_<empresa>_<aleatório>) e o ID que ela atribui (usado para excluir)
    providerInstanceName: text('provider_instance_name').notNull(),
    providerInstanceId: text('provider_instance_id'),
    displayName: text('display_name').notNull(),
    phoneE164: text('phone_e164'),
    status: text('status').notNull().default('created'),
    // Token da instância, cifrado no cofre (platform.integration_credentials)
    credentialId: text('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
    lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('whatsapp_instances_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('whatsapp_instances_server_name_unique').on(table.providerServerId, table.providerInstanceName),
    index('whatsapp_instances_org_status_idx').on(table.organizationId, table.status),
    check('whatsapp_instances_status_check', sql`${table.status} in ('created', 'connecting', 'connected', 'disconnected', 'error')`),
    check('whatsapp_instances_name_prefix_check', sql`${table.providerInstanceName} like 'dz\\_%'`),
  ],
);

/**
 * Listas de contatos da empresa (Envio de Mensagens). Contatos são dado pessoal: a exclusão é definitiva (sem deleted_at).
 */
export const contactLists = app.table(
  'contact_lists',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_lists_org_id_unique').on(table.organizationId, table.id),
    // Nome único por empresa, sem diferenciar maiúsculas
    uniqueIndex('contact_lists_org_name_unique').on(table.organizationId, sql`lower(${table.name})`),
  ],
);

export const contacts = app.table(
  'contacts',
  {
    organizationId: text('organization_id').notNull(),
    listId: text('list_id').notNull(),
    /** Só dígitos, validado pela regra de telefone (packages/contracts/src/phone.ts) */
    phoneE164: text('phone_e164').notNull(),
    name: text('name').notNull().default(''),
    /** Ordem da lista (a de inclusão) */
    position: integer('position').notNull(),
  },
  (table) => [
    // Um número aparece uma vez por lista
    primaryKey({ name: 'contacts_pkey', columns: [table.listId, table.phoneE164] }),
    // Chave composta: o contato só pode apontar para uma lista da mesma empresa
    foreignKey({ name: 'contacts_list_fk', columns: [table.organizationId, table.listId], foreignColumns: [contactLists.organizationId, contactLists.id] }).onDelete('cascade'),
    index('contacts_list_position_idx').on(table.listId, table.position),
    check('contacts_phone_check', sql`${table.phoneE164} ~ '^[0-9]{10,15}$'`),
  ],
);

/**
 * Imagens das mensagens (Envio de Mensagens): guardadas no banco e enviadas à Evolution em base64.
 * Conteúdo de marketing da empresa; o tipo é conferido pelos primeiros bytes, nunca pelo que o navegador declara.
 */
export const mediaFiles = app.table(
  'media_files',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('media_files_org_id_unique').on(table.organizationId, table.id),
    check('media_files_mime_check', sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check('media_files_size_check', sql`${table.sizeBytes} between 1 and 5242880`),
  ],
);

/** Modelos de mensagem reutilizáveis: imagem + texto + CTA + variações (Teste A/B) */
export const messageTemplates = app.table(
  'message_templates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    variations: jsonb('variations').$type<string[]>().notNull().default([]),
    mediaId: text('media_id'),
    ctaText: text('cta_text'),
    ctaUrl: text('cta_url'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_templates_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('message_templates_org_name_unique').on(table.organizationId, sql`lower(${table.name})`),
    // A imagem do modelo só pode ser da mesma empresa
    foreignKey({ name: 'message_templates_media_fk', columns: [table.organizationId, table.mediaId], foreignColumns: [mediaFiles.organizationId, mediaFiles.id] }).onDelete('restrict'),
    check('message_templates_cta_check', sql`(${table.ctaText} is null) = (${table.ctaUrl} is null)`),
  ],
);
