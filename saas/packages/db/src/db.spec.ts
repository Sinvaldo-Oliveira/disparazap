import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { IN_MEMORY, MIGRATIONS_FOLDER, openDatabase } from './client.ts';

describe('banco embutido (desenvolvimento e testes)', () => {
  it('abre numa pasta cujas pastas-mãe ainda não existem (projeto recém-baixado) e guarda os dados entre aberturas', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dz-db-'));
    const dataDir = join(base, '.data', 'pglite');
    try {
      const first = await openDatabase({ kind: 'embedded', dataDir });
      await first.db.execute(sql`insert into identity.users (id, name, email) values ('persistido', 'P', 'p@empresa.test')`);
      await first.close();
      const second = await openDatabase({ kind: 'embedded', dataDir });
      const result = await second.db.execute(sql`select count(*)::int as total from identity.users where id = 'persistido'`);
      expect((result as unknown as { rows: { total: number }[] }).rows[0]?.total).toBe(1);
      await second.close();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);

  it('aplica as migrations: tabelas nos esquemas app, identity e platform, nenhuma no public', async () => {
    const handle = await openDatabase({ kind: 'embedded', dataDir: IN_MEMORY });
    try {
      expect(await handle.ping()).toBe(true);
      const result = await handle.db.execute(sql`select table_schema, table_name from information_schema.tables where table_schema in ('app', 'identity', 'platform', 'public') order by table_schema, table_name`);
      const rows = (result as unknown as { rows: { table_schema: string; table_name: string }[] }).rows;
      expect(rows.map((row) => `${row.table_schema}.${row.table_name}`)).toEqual([
        'app.contact_lists',
        'app.contacts',
        'app.media_files',
        'app.message_templates',
        'app.whatsapp_instances',
        'identity.accounts',
        'identity.invitations',
        'identity.members',
        'identity.organizations',
        'identity.sessions',
        'identity.users',
        'identity.verifications',
        'platform.integration_credentials',
        'platform.provider_servers',
      ]);
    } finally {
      await handle.close();
    }
  }, 60_000);

  it('reaplicar as migrations não faz nada (registro em drizzle.__drizzle_migrations)', async () => {
    const handle = await openDatabase({ kind: 'embedded', dataDir: IN_MEMORY });
    try {
      await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
      const result = await handle.db.execute(sql`select count(*)::int as total from drizzle.__drizzle_migrations`);
      // Uma linha por migration do histórico do drizzle-kit, mesmo depois de reaplicar
      const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
      expect((result as unknown as { rows: { total: number }[] }).rows[0]?.total).toBe(journal.entries.length);
    } finally {
      await handle.close();
    }
  }, 60_000);

  it('o e-mail é único sem diferenciar maiúsculas, e os tipos inválidos são recusados pelo banco', async () => {
    const handle = await openDatabase({ kind: 'embedded', dataDir: IN_MEMORY });
    try {
      await handle.db.execute(sql`insert into identity.users (id, name, email) values ('u1', 'A', 'pessoa@empresa.test')`);
      await expect(handle.db.execute(sql`insert into identity.users (id, name, email) values ('u2', 'B', 'PESSOA@empresa.test')`)).rejects.toThrow();
      await expect(handle.db.execute(sql`insert into identity.users (id, name, email, platform_role) values ('u3', 'C', 'c@empresa.test', 'deus')`)).rejects.toThrow();
      await expect(handle.db.execute(sql`insert into identity.users (id, name, email, origin) values ('u4', 'D', 'd@empresa.test', 'outro')`)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  }, 60_000);
});
