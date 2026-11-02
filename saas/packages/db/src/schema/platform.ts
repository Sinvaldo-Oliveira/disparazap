import { sql } from 'drizzle-orm';
import { check, index, integer, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity.ts';

/**
 * Esquema `platform`: configurações globais, administradas só pelo Super-Admin.
 * Segredos ficam em `integration_credentials`, sempre cifrados (AES-256-GCM, chave-mestra fora do banco).
 */
export const platform = pgSchema('platform');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const integrationCredentials = platform.table(
  'integration_credentials',
  {
    id: text('id').primaryKey(),
    // Nulo = credencial da plataforma (ex.: chave global da Evolution Go); preenchido = de uma empresa (fases seguintes)
    organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    // Valor cifrado (base64) + vetor de inicialização e etiqueta de autenticação do AES-256-GCM
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    keyVersion: integer('key_version').notNull(),
    // Só para identificar na tela qual chave está guardada
    last4: text('last4').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('integration_credentials_organization_idx').on(table.organizationId),
    check('integration_credentials_kind_check', sql`${table.kind} in ('global_api_key', 'instance_token', 'api_key', 'oauth_token', 'signing_secret')`),
  ],
);

export const providerServers = platform.table(
  'provider_servers',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    status: text('status').notNull().default('active'),
    credentialId: text('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastCheckStatus: text('last_check_status'),
    lastCheckDetail: text('last_check_detail'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_servers_provider_name_unique').on(table.provider, table.name),
    check('provider_servers_provider_check', sql`${table.provider} in ('evolution_go')`),
    check('provider_servers_status_check', sql`${table.status} in ('active', 'disabled')`),
    check(
      'provider_servers_last_check_status_check',
      sql`${table.lastCheckStatus} is null or ${table.lastCheckStatus} in ('ok', 'unauthorized', 'unreachable', 'invalid_response', 'error')`,
    ),
  ],
);
