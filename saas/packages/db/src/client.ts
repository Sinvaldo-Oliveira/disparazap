import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type DbSchema = typeof schema;
export type AppDatabase = PgDatabase<PgQueryResultHKT, DbSchema>;

/** Pasta das migrations geradas pelo drizzle-kit (mesmo caminho a partir de src/ e de dist/) */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Valor especial de `embeddedDir`: banco embutido só em memória (testes) */
export const IN_MEMORY = 'memory://';

export type DatabaseOptions =
  | {
      kind: 'postgres';
      /** Endereço PostgreSQL (papel restrito, nunca o administrador) */
      url: string;
      /** Certificado raiz do provedor (Supabase): a verificação TLS é sempre obrigatória */
      caFile: string;
      poolMax: number;
      applicationName: string;
    }
  | {
      kind: 'embedded';
      /** Pasta do banco embutido (PGlite) ou IN_MEMORY */
      dataDir: string;
    };

export interface DatabaseHandle {
  readonly db: AppDatabase;
  readonly kind: DatabaseOptions['kind'];
  /** Consulta mínima para saber se o banco responde */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Remove do endereço os parâmetros de TLS: o node-postgres deixaria o `sslmode` da URL sobrescrever
 * a configuração explícita abaixo (e o certificado raiz se perderia).
 */
function withoutTlsParams(url: string): string {
  const parsed = new URL(url);
  for (const param of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) parsed.searchParams.delete(param);
  return parsed.toString();
}

export async function openDatabase(options: DatabaseOptions): Promise<DatabaseHandle> {
  if (options.kind === 'postgres') {
    const pool = new pg.Pool({
      connectionString: withoutTlsParams(options.url),
      max: options.poolMax,
      application_name: options.applicationName,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // TLS com verificação completa do certificado e do nome do servidor. Nunca desligar.
      ssl: { ca: readFileSync(options.caFile, 'utf8'), rejectUnauthorized: true },
    });
    // Erros de conexões ociosas não derrubam o processo; a próxima consulta recebe o erro
    pool.on('error', () => {});
    const db = drizzleNodePg(pool, { schema }) as unknown as AppDatabase;
    return {
      db,
      kind: 'postgres',
      ping: () => ping(db),
      close: () => pool.end(),
    };
  }

  // O PGlite cria só a última pasta do caminho: num projeto recém-baixado, saas/.data ainda não existe
  if (options.dataDir !== IN_MEMORY) mkdirSync(dirname(options.dataDir), { recursive: true });
  const client = options.dataDir === IN_MEMORY ? new PGlite() : new PGlite(options.dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  // Só o banco embutido recebe migrations automáticas. No PostgreSQL real, elas são aplicadas à mão (SUPABASE_CONFIGURACAO §5).
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db: db as unknown as AppDatabase,
    kind: 'embedded',
    ping: () => ping(db as unknown as AppDatabase),
    close: () => client.close(),
  };
}

async function ping(db: AppDatabase): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
