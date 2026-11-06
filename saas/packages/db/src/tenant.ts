import { sql } from 'drizzle-orm';
import type { AppDatabase } from './client.ts';

/**
 * Contexto da empresa para a RLS (Z3.2). Define app.org_id só dentro da transação atual: set_config(..., true) desfaz
 * ao fim dela, então nada vaza para a próxima requisição que reaproveitar a conexão do pool.
 * A empresa vem sempre da sessão (member.organizationId), nunca do navegador. Sem empresa válida, não executa.
 */
const ORG_ID = /^[A-Za-z0-9_-]{1,100}$/;

export async function withTenant<T>(db: AppDatabase, organizationId: string, work: (tx: AppDatabase) => Promise<T>): Promise<T> {
  if (!ORG_ID.test(organizationId)) throw new Error('contexto de empresa inválido');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return work(tx as unknown as AppDatabase);
  });
}
