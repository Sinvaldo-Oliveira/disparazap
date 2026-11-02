import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit, sempre pelos scripts npm (cwd = packages/db):
 * - `generate` e `check` não acessam banco nenhum;
 * - `migrate` usa DATABASE_MIGRATION_URL (papel dz_migrator) e DATABASE_CA_FILE do saas/.env, com TLS verificado.
 * Nunca usar `drizzle-kit push` contra banco remoto (SUPABASE_CONFIGURACAO §5).
 */
const envFile = resolve(process.cwd(), '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function migrationCredentials() {
  const url = process.env.DATABASE_MIGRATION_URL?.trim();
  if (!url) return undefined;
  const caFile = process.env.DATABASE_CA_FILE?.trim();
  if (!caFile) throw new Error('DATABASE_CA_FILE é obrigatório para aplicar migrations (a verificação TLS não pode ser desligada).');
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true },
  };
}

const credentials = migrationCredentials();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['identity', 'platform', 'app'],
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
  ...(credentials ? { dbCredentials: credentials } : {}),
});
