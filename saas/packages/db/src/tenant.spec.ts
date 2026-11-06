import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type DatabaseHandle } from './client.ts';
import { withTenant } from './tenant.ts';

// Teste de isolamento (Z3.2): o rascunho da migração 0008 é aplicado num banco em memória, com um papel que NÃO é superusuário
const DRAFT = fileURLToPath(new URL('../../../docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql', import.meta.url));
const statements = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

let handle: DatabaseHandle;
const rowsOf = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows;

beforeAll(async () => {
  handle = await openDatabase({ kind: 'embedded', dataDir: IN_MEMORY });
  const db = handle.db;
  await db.execute(sql.raw(`create role dz_app nologin`));
  // Papéis que o Supabase já fornece (no banco de teste, criados aqui para o REVOKE do rascunho)
  for (const role of ['anon', 'authenticated', 'service_role']) await db.execute(sql.raw(`create role ${role} nologin`));
  await db.execute(sql.raw(`grant usage on schema app, identity to dz_app`));
  await db.execute(sql.raw(`grant select on identity.organizations to dz_app`));
  // A migração 0008 já criou a tabela sem os papéis; aqui ela é refeita com o rascunho (políticas e concessões de dz_app)
  await db.execute(sql.raw(`drop table app.inbox_social_sends`));
  for (const statement of statements(DRAFT)) await db.execute(sql.raw(statement));
  // Duas empresas (dados fictícios) com um envio cada, gravados pelo superusuário de teste
  await db.execute(sql.raw(`insert into identity.organizations (id, name, slug) values ('org_a', 'Empresa A', 'empresa-a'), ('org_b', 'Empresa B', 'empresa-b')`));
  await db.execute(sql.raw(`insert into app.inbox_social_sends (id, organization_id, account_ref, conversation_ref, client_request_id, text_length, window_mode, status) values ('send_a', 'org_a', 'acc_a', 'conv_a', 'req_a', 5, 'none', 'pending'), ('send_b', 'org_b', 'acc_b', 'conv_b', 'req_b', 5, 'none', 'pending')`));
}, 120_000);

afterAll(async () => {
  await handle?.close();
});

/** Papel da aplicação dentro da transação da empresa (set local role: desfeito ao fim da transação) */
const asApp = async <T>(orgId: string, work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) =>
  withTenant(handle.db, orgId, async (tx) => {
    await tx.execute(sql.raw(`set local role dz_app`));
    return work(tx);
  });

describe('isolamento por empresa (RLS forçada, papel da aplicação)', () => {
  it('com a empresa definida, o papel da aplicação só enxerga as linhas dela', async () => {
    const seen = await asApp('org_a', async (tx) => rowsOf(await tx.execute(sql.raw(`select id, organization_id from app.inbox_social_sends order by id`))));
    expect(seen).toEqual([{ id: 'send_a', organization_id: 'org_a' }]);
  });

  it('sem empresa definida, o papel da aplicação não enxerga nenhuma linha (falha fechada)', async () => {
    const seen = await handle.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role dz_app`));
      return rowsOf(await tx.execute(sql.raw(`select id from app.inbox_social_sends`)));
    });
    expect(seen).toEqual([]);
  });

  it('não grava linha de outra empresa: a inserção fora do contexto é recusada', async () => {
    await expect(
      asApp('org_a', (tx) => tx.execute(sql.raw(`insert into app.inbox_social_sends (id, organization_id, account_ref, conversation_ref, client_request_id, text_length, window_mode, status) values ('intrusa', 'org_b', 'x', 'y', 'req_x', 1, 'none', 'pending')`))),
    ).rejects.toThrow();
  });

  it('o contexto não vaza para a transação seguinte (set_config é local à transação)', async () => {
    await asApp('org_a', async (tx) => tx.execute(sql.raw(`select 1`)));
    const after = await handle.db.execute(sql.raw(`select coalesce(current_setting('app.org_id', true), '') as org`));
    expect(rowsOf(after)[0]?.org).toBe('');
  });

  it('identificador de empresa fora do formato não executa nada', async () => {
    await expect(withTenant(handle.db, "org_a'; drop table app.inbox_social_sends; --", async () => 'nunca')).rejects.toThrow('contexto de empresa inválido');
    const still = await handle.db.execute(sql.raw(`select count(*)::int as total from app.inbox_social_sends`));
    expect(rowsOf(still)[0]?.total).toBe(2);
  });
});
