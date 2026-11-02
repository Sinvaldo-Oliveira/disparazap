import { createConnection } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { ConfigError } from '@disparazap/shared';
import { SuperAdminError, createSuperAdmin } from '../auth/super-admin.ts';
import { databaseOptions, loadApiConfig } from '../config/env.ts';
import { createServices } from '../services.ts';

/**
 * `npm run admin:create` (dentro de saas/): cria o Super-Admin com o e-mail de SUPER_ADMIN_EMAIL.
 * Nome e senha são digitados no terminal; a senha não aparece na tela e não é gravada em arquivo.
 */

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

// Entrada redirecionada (sem terminal): nome, senha e confirmação chegam em três linhas
async function readPipedAnswers(): Promise<[string, string, string]> {
  const lines: string[] = [];
  for await (const line of createInterface({ input: process.stdin })) {
    lines.push(line);
    if (lines.length === 3) break;
  }
  return [lines[0] ?? '', lines[1] ?? '', lines[2] ?? ''];
}

// Leitura de senha sem eco no terminal
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function portInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

let config;
try {
  config = loadApiConfig();
} catch (err) {
  if (err instanceof ConfigError) fail(`Configuração: ${err.message}`);
  throw err;
}
if (!config.SUPER_ADMIN_EMAIL) fail('Preencha SUPER_ADMIN_EMAIL no saas/.env com o e-mail do Super-Admin.');

// O banco embutido aceita um processo por vez: com a API ligada, os dados poderiam se corromper
if (databaseOptions(config).kind === 'embedded' && (await portInUse(config.API_HOST, config.API_PORT))) {
  fail('A API está em execução com o banco embutido. Pare a API (Ctrl+C) e rode este comando de novo.');
}

process.stdout.write(`Criando o Super-Admin ${config.SUPER_ADMIN_EMAIL}\n`);
let name: string;
let password: string;
let confirmation: string;
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  name = (await rl.question('Nome: ')).trim();
  rl.close();
  password = await readHidden('Senha (mínimo de 12 caracteres): ');
  confirmation = await readHidden('Repita a senha: ');
} else {
  [name, password, confirmation] = await readPipedAnswers();
  name = name.trim();
}
if (password !== confirmation) fail('As senhas não conferem.');

const services = await createServices(config, () => {});
try {
  const outcome = await createSuperAdmin({ auth: services.auth, db: services.database.db, email: config.SUPER_ADMIN_EMAIL, name, password });
  process.stdout.write(outcome === 'created' ? '✔ Super-Admin criado. Entre pelo painel com este e-mail e a senha digitada.\n' : '✔ Este e-mail já é Super-Admin. Nada foi alterado.\n');
} catch (err) {
  if (err instanceof SuperAdminError) fail(err.message);
  fail('Não foi possível criar o Super-Admin.');
} finally {
  await services.database.close();
}
