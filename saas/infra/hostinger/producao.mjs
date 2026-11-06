// Operações de PRODUÇÃO feitas do seu computador (o aplicativo Node.js da Hostinger não tem terminal para isso).
//   npm run producao:segredos   mostra AUTH_SECRET e SECRETS_MASTER_KEY novos, para colar no saas/.env.producao
//   npm run producao:migrar     cria/atualiza as tabelas no banco de produção (Supabase), com confirmação
//   npm run producao:admin      cria o Super-Admin no banco de produção (nome e senha digitados, sem eco)
// Lê saas/.env.producao (ou o arquivo de --arquivo <caminho>). Nunca mostra senhas, chaves nem a string de conexão.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';

const saas = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const command = args[0];
const fileFlag = args.indexOf('--arquivo');
const envFile = fileFlag >= 0 && args[fileFlag + 1] ? resolve(args[fileFlag + 1]) : join(saas, '.env.producao');

function fail(message) {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

function loadProductionEnv() {
  if (!existsSync(envFile)) {
    fail(`Arquivo não encontrado: ${envFile}\n  Copie saas/infra/hostinger/env.hostinger.example para saas/.env.producao e preencha (veja o README).`);
  }
  const values = parseEnv(readFileSync(envFile, 'utf8'));
  // Certificado com caminho relativo = a partir da pasta saas/ (o pacote usa o mesmo caminho a partir da raiz dele)
  if (values.DATABASE_CA_FILE && !isAbsolute(values.DATABASE_CA_FILE)) values.DATABASE_CA_FILE = join(saas, values.DATABASE_CA_FILE);
  if (values.DATABASE_CA_FILE && !existsSync(values.DATABASE_CA_FILE)) fail(`Certificado do banco não encontrado em ${values.DATABASE_CA_FILE}.`);
  return values;
}

/** Só o servidor e o banco, para a pessoa conferir onde vai mexer (sem usuário nem senha) */
function describeDatabase(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname} (banco "${parsed.pathname.replace(/^\//, '') || 'postgres'}")`;
  } catch {
    fail('A string de conexão do banco não é um endereço postgresql:// válido.');
  }
}

async function confirm(question, expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === expected;
}

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (command === 'segredos') {
  // Valores novos a cada execução: aparecem só no seu terminal
  process.stdout.write('Cole no saas/.env.producao (e guarde a SECRETS_MASTER_KEY no gerenciador de senhas):\n\n');
  process.stdout.write(`AUTH_SECRET=${randomBytes(48).toString('base64url')}\n`);
  process.stdout.write(`SECRETS_MASTER_KEY=${randomBytes(32).toString('base64url')}\n`);
} else if (command === 'migrar') {
  const env = loadProductionEnv();
  const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;
  if (!url) fail('Preencha DATABASE_MIGRATION_URL (ou DATABASE_URL) no saas/.env.producao.');
  if (!env.DATABASE_CA_FILE) fail('Preencha DATABASE_CA_FILE no saas/.env.producao (a verificação TLS não pode ser desligada).');
  process.stdout.write(`Migrations do DisparaZap serão aplicadas em: ${describeDatabase(url)}\n`);
  process.stdout.write('Faça antes um backup do banco se ele já tiver dados (Supabase → Database → Backups).\n');
  if (!(await confirm('Para continuar, digite APLICAR: ', 'APLICAR'))) fail('Cancelado. Nada foi alterado.');
  const drizzleKit = join(saas, 'node_modules', 'drizzle-kit', 'bin.cjs');
  if (!existsSync(drizzleKit)) fail('drizzle-kit não encontrado. Rode npm install dentro de saas/.');
  // O drizzle.config.ts não sobrescreve variáveis já definidas: valem as do saas/.env.producao
  run([drizzleKit, 'migrate'], join(saas, 'packages', 'db'), { ...process.env, ...env, DATABASE_MIGRATION_URL: url });
} else if (command === 'admin') {
  const env = loadProductionEnv();
  if (!env.SUPER_ADMIN_EMAIL) fail('Preencha SUPER_ADMIN_EMAIL no saas/.env.producao.');
  if (env.DATABASE_URL) process.stdout.write(`Super-Admin (${env.SUPER_ADMIN_EMAIL}) será criado em: ${describeDatabase(env.DATABASE_URL)}\n`);
  // Sem --env-file: o saas/.env (desenvolvimento) não entra; só o que está no saas/.env.producao
  run(['--conditions=source', join('src', 'cli', 'create-super-admin.ts')], join(saas, 'apps', 'api'), { ...process.env, ...env });
} else {
  process.stdout.write('Use: node infra/hostinger/producao.mjs <segredos | migrar | admin> [--arquivo caminho/do/.env]\n');
  process.exit(command ? 1 : 0);
}
