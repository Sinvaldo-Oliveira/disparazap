import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVOLUTION_SETTINGS_PATH,
  EVOLUTION_TEST_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  evolutionSettingsSchema,
  evolutionTestResultSchema,
  problemDetailsSchema,
} from '@disparazap/contracts';
import { integrationCredentials } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createServices, type ApiServices } from '../services.ts';

// Tudo fictício: Evolution Go simulada nesta máquina, banco em memória, nenhuma chave real
const PANEL = 'http://127.0.0.1:3000';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const PASSWORD = 'senha-forte-de-teste-123';
const GOOD_KEY = 'chave-global-ficticia-AB12';
const NEW_KEY = 'outra-chave-ficticia-CD34';

const config = loadApiConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
});

let services: ApiServices;
let app: FastifyInstance;
let evolution: Server;
let evolutionUrl: string;
let closedPortUrl: string;
let superCookie: string;
let companyCookie: string;
const acceptedKeys = new Set([GOOD_KEY, NEW_KEY]);

// Simulador da Evolution Go: só a rota usada no teste de conexão
function startEvolutionSimulator(): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url ?? '';
    if (path === '/redirecionado/instance/all') {
      res.writeHead(302, { location: 'https://outro-host.exemplo.test/instance/all' }).end();
      return;
    }
    if (path === '/nao-e-evolution/instance/all') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>página qualquer</html>');
      return;
    }
    if (path !== '/instance/all') {
      res.writeHead(404).end();
      return;
    }
    if (!acceptedKeys.has(String(req.headers.apikey))) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not authorized', segredoInterno: 'nao-deve-vazar' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'success', data: [{ name: 'a', token: 'token-interno-x' }, { name: 'b' }] }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const cookieOf = (response: LightMyRequestResponse) =>
  ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

function call(method: 'GET' | 'PUT' | 'POST', url: string, { cookie, payload, origin = PANEL }: { cookie?: string; payload?: object; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  return app.inject({ method, url, headers, ...(payload ? { payload } : method === 'GET' ? {} : { payload: {} }) });
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

const settingsBody = (overrides: Record<string, unknown> = {}) => ({ name: 'Servidor principal', baseUrl: evolutionUrl, status: 'active', ...overrides });

beforeAll(async () => {
  evolution = await startEvolutionSimulator();
  evolutionUrl = `http://127.0.0.1:${(evolution.address() as AddressInfo).port}`;
  const closed = await startEvolutionSimulator();
  closedPortUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise((resolve) => closed.close(resolve));

  services = await createServices(config, () => {});
  app = await buildApp(config, { services });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, { payload: { email: SUPER_ADMIN_EMAIL, password: PASSWORD } }));
  companyCookie = cookieOf(await call('POST', SIGNUP_PATH, { payload: { name: 'Maria Teste', companyName: 'Empresa Teste', email: 'maria@empresa.test', password: PASSWORD } }));
}, 90_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await new Promise((resolve) => evolution?.close(resolve));
});

describe('acesso às configurações da plataforma', () => {
  it('sem login: 401; Admin-Empresa: 403; Super-Admin: vê a configuração vazia', async () => {
    expectProblem(await call('GET', EVOLUTION_SETTINGS_PATH), 401);
    expectProblem(await call('GET', EVOLUTION_SETTINGS_PATH, { cookie: companyCookie }), 403);
    expectProblem(await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: companyCookie, payload: settingsBody({ apiKey: GOOD_KEY }) }), 403);
    const response = await call('GET', EVOLUTION_SETTINGS_PATH, { cookie: superCookie });
    expect(response.statusCode).toBe(200);
    expect(evolutionSettingsSchema.parse(response.json())).toEqual({ server: null, vaultReady: true });
  });

  it('pedido que altera dados sem origem confiável é recusado (proteção contra outros sites)', async () => {
    expectProblem(await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ apiKey: GOOD_KEY }), origin: 'https://malicioso.test' }), 403);
    expectProblem(await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ apiKey: GOOD_KEY }), origin: null }), 403);
    expectProblem(await call('POST', SIGNUP_PATH, { payload: { name: 'X', companyName: 'Y', email: 'x@empresa.test', password: PASSWORD }, origin: null }), 403);
  });

  it('testar antes de configurar: 409', async () => {
    expectProblem(await call('POST', EVOLUTION_TEST_PATH, { cookie: superCookie }), 409);
  });
});

describe('integração global com a Evolution Go', () => {
  // Os dados são montados na hora do teste: o endereço do simulador só existe depois do beforeAll
  it.each([
    ['primeira gravação sem chave', () => settingsBody(), 'chave global'],
    ['http em domínio público', () => settingsBody({ baseUrl: 'http://evolution.exemplo.test', apiKey: GOOD_KEY }), 'https'],
    ['usuário e senha no endereço', () => settingsBody({ baseUrl: 'https://u:s@evolution.exemplo.test', apiKey: GOOD_KEY }), 'usuário ou senha'],
    ['chave curta', () => settingsBody({ apiKey: 'curta' }), '8 caracteres'],
  ])('recusa %s', async (_caso, makePayload, motivo) => {
    const problem = expectProblem(await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: makePayload() }), 400);
    expect(problem.detail).toContain(motivo);
  });

  it('salva cifrando a chave: a resposta mostra só os 4 últimos caracteres e o banco não guarda o texto', async () => {
    const response = await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ baseUrl: `${evolutionUrl}/`, apiKey: GOOD_KEY }) });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(GOOD_KEY);
    const settings = evolutionSettingsSchema.parse(response.json());
    expect(settings.server).toMatchObject({ name: 'Servidor principal', baseUrl: evolutionUrl, status: 'active', apiKey: { configured: true, last4: 'AB12' } });

    const rows = await services.database.db.select().from(integrationCredentials);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(GOOD_KEY);
  });

  it('testa a conexão (só leitura): confirma a chave e conta as instâncias, sem repassar a resposta da Evolution', async () => {
    const response = await call('POST', EVOLUTION_TEST_PATH, { cookie: superCookie });
    expect(response.statusCode).toBe(200);
    const result = evolutionTestResultSchema.parse(response.json());
    expect(result).toMatchObject({ status: 'ok', instances: 2 });
    expect(response.body).not.toMatch(/token-interno|segredoInterno|AB12/);
    const settings = evolutionSettingsSchema.parse((await call('GET', EVOLUTION_SETTINGS_PATH, { cookie: superCookie })).json());
    expect(settings.server?.lastCheck.status).toBe('ok');
  });

  it('salvar sem informar a chave mantém a chave guardada', async () => {
    const response = await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ name: 'Servidor Evolution', apiKey: '' }) });
    const settings = evolutionSettingsSchema.parse(response.json());
    expect(settings.server).toMatchObject({ name: 'Servidor Evolution', apiKey: { configured: true, last4: 'AB12' } });
    expect(settings.server?.lastCheck.status).toBe('ok');
    expect(await services.database.db.select().from(integrationCredentials)).toHaveLength(1);
  });

  it('trocar a chave revoga a anterior e zera o último teste', async () => {
    const response = await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ apiKey: NEW_KEY }) });
    const settings = evolutionSettingsSchema.parse(response.json());
    expect(settings.server).toMatchObject({ apiKey: { configured: true, last4: 'CD34' }, lastCheck: { status: null, at: null } });
    const rows = await services.database.db.select().from(integrationCredentials);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(rows.find((row) => row.revokedAt === null)?.last4).toBe('CD34');
  });

  it.each([
    ['chave recusada', () => ({ baseUrl: evolutionUrl, apiKey: 'chave-que-a-evolution-recusa' }), 'unauthorized'],
    ['redirecionamento', () => ({ baseUrl: `${evolutionUrl}/redirecionado`, apiKey: GOOD_KEY }), 'error'],
    ['resposta que não é da Evolution', () => ({ baseUrl: `${evolutionUrl}/nao-e-evolution`, apiKey: GOOD_KEY }), 'invalid_response'],
    ['servidor desligado', () => ({ baseUrl: closedPortUrl, apiKey: GOOD_KEY }), 'unreachable'],
  ])('resultado do teste: %s', async (_caso, makeOverrides, expected) => {
    expect((await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody(makeOverrides()) })).statusCode).toBe(200);
    const response = await call('POST', EVOLUTION_TEST_PATH, { cookie: superCookie });
    const result = evolutionTestResultSchema.parse(response.json());
    expect(result.status).toBe(expected);
    expect(result.instances).toBeNull();
    expect(response.body).not.toMatch(/segredoInterno|not authorized|página qualquer|outro-host|127\.0\.0\.1/);
  });

  it('desativar o servidor fica registrado', async () => {
    const response = await call('PUT', EVOLUTION_SETTINGS_PATH, { cookie: superCookie, payload: settingsBody({ status: 'disabled' }) });
    expect(evolutionSettingsSchema.parse(response.json()).server?.status).toBe('disabled');
  });
});

describe('sem a chave-mestra do cofre', () => {
  it('não salva a chave (503) e avisa a tela', async () => {
    const noVaultApp = await buildApp(config, { services: { ...services, vault: null } });
    const get = await noVaultApp.inject({ method: 'GET', url: EVOLUTION_SETTINGS_PATH, headers: { cookie: superCookie } });
    expect(evolutionSettingsSchema.parse(get.json()).vaultReady).toBe(false);
    const put = await noVaultApp.inject({ method: 'PUT', url: EVOLUTION_SETTINGS_PATH, headers: { cookie: superCookie, origin: PANEL }, payload: settingsBody({ apiKey: GOOD_KEY }) });
    expect(put.statusCode).toBe(503);
    expect(problemDetailsSchema.parse(put.json()).detail).toContain('SECRETS_MASTER_KEY');
    await noVaultApp.close();
  });

  it('a credencial guardada continua cifrada no banco', async () => {
    const rows = await services.database.db.select().from(integrationCredentials).where(eq(integrationCredentials.provider, 'evolution_go'));
    for (const row of rows) {
      expect(row.ciphertext).not.toContain('chave');
      expect(row.keyVersion).toBe(1);
    }
  });
});
