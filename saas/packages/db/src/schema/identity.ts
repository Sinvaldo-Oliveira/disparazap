import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Esquema `identity`: contas, sessões, empresas e participações, usados pelo Better Auth.
 * Não usamos o esquema `auth` (pertence ao Supabase Auth) nem o `public` (SUPABASE_CONFIGURACAO §4.2).
 * Os nomes das propriedades seguem o Better Auth; as colunas no banco usam snake_case.
 */
export const identity = pgSchema('identity');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = identity.table(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Papel global: só "super_admin" por enquanto. Nunca vem do navegador (input: false no Better Auth).
    platformRole: text('platform_role'),
    // Origem da conta: cadastro direto no DisparaZap ou acesso pelo MyLinksss
    origin: text('origin').notNull().default('direct'),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    check('users_platform_role_check', sql`${table.platformRole} is null or ${table.platformRole} = 'super_admin'`),
    check('users_origin_check', sql`${table.origin} in ('direct', 'mylinksss')`),
  ],
);

export const sessions = identity.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Plugin de organizações: empresa ativa na sessão
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [uniqueIndex('sessions_token_unique').on(table.token), index('sessions_user_id_idx').on(table.userId)],
);

export const accounts = identity.table(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    // Hash argon2id da senha (nunca o texto da senha)
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId), uniqueIndex('accounts_provider_account_unique').on(table.providerId, table.accountId)],
);

export const verifications = identity.table(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const organizations = identity.table(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    createdAt: createdAt(),
    metadata: text('metadata'),
    // Empresa cadastrada direto no DisparaZap ou vinda do MyLinksss
    origin: text('origin').notNull().default('direct'),
    // Limite de instâncias de WhatsApp (decisão W1: 1 por padrão; o Super-Admin poderá ajustar)
    maxWhatsappInstances: integer('max_whatsapp_instances').notNull().default(1),
    // Fuso horário da empresa (IANA): agenda e calendário das Redes Sociais (PLANO_MODULO_REDES_SOCIAIS, decisão R3)
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  },
  (table) => [
    uniqueIndex('organizations_slug_unique').on(table.slug),
    check('organizations_origin_check', sql`${table.origin} in ('direct', 'mylinksss')`),
    check('organizations_max_whatsapp_instances_check', sql`${table.maxWhatsappInstances} between 0 and 100`),
  ],
);

export const members = identity.table(
  'members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('viewer'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('members_organization_user_unique').on(table.organizationId, table.userId),
    index('members_user_id_idx').on(table.userId),
    check('members_role_check', sql`${table.role} in ('owner', 'admin', 'operator', 'viewer')`),
  ],
);

export const invitations = identity.table(
  'invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: text('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [index('invitations_organization_id_idx').on(table.organizationId), index('invitations_email_idx').on(table.email)],
);
