import { getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { getAuthTables } from 'better-auth/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HEALTH_READY_PATH,
  PROBLEM_CONTENT_TYPE,
  SESSION_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  SIGNUP_PATH,
  healthReadySchema,
  problemDetailsSchema,
  sessionInfoSchema,
} from '@disparazap/contracts';
import { accounts, invitations, members, organizations, sessions, users, verifications } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { loadApiConfig } from '../config/env.ts';
import { createServices, type ApiServices } from '../services.ts';
import { SuperAdminError, createSuperAdmin } from './super-admin.ts';

// Tudo fictício: domínios .test, banco embutido em memória, nenhuma rede
const PANEL = 'http://127.0.0.1:3000';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const PASSWORD = 'senha-forte-de-teste-123';

const config = loadApiConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
});

let services: ApiServices;
let app: FastifyInstance;

beforeAll(async () => {
  services = await createServices(config, () => {});
  app = await buildApp(config, { services });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
});

let counter = 0;
const uniqueEmail = (prefix = 'pessoa') => `${prefix}.${Date.now()}.${++counter}@empresa.test`;

/** Converte os Set-Cookie da resposta no cabeçalho Cookie da próxima requisição */
function cookieHeader(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

function post(url: string, payload: unknown, headers: Record<string, string> = {}, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { origin: PANEL, 'content-type': 'application/json', ...headers },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

// Cada cadastro de teste vem de um endereço diferente: o limite de cadastros por IP (auditoria A3) tem teste próprio
let addressCounter = 0;
function signup(overrides: Record<string, unknown> = {}) {
  return post(SIGNUP_PATH, { name: 'Maria Teste', companyName: 'Clínica Exemplo', email: uniqueEmail(), password: PASSWORD, ...overrides }, {}, `10.0.${Math.floor(++addressCounter / 250)}.${addressCounter % 250}`);
}

function me(cookie?: string) {
  return app.inject({ method: 'GET', url: SESSION_PATH, headers: cookie ? { cookie } : {} });
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

describe('compatibilidade do schema com o Better Auth', () => {
  it('toda tabela e todo campo que o Better Auth usa existem no schema Drizzle', () => {
    const ours: Record<string, object> = { user: users, session: sessions, account: accounts, verification: verifications, organization: organizations, member: members, invitation: invitations };
    const expected = getAuthTables(services.auth.options);
    for (const [model, table] of Object.entries(expected)) {
      if (model === 'rateLimit') continue; // limitador em memória
      expect(ours[model], `tabela ${model}`).toBeDefined();
      const columns = Object.keys(getTableColumns(ours[model] as typeof users));
      for (const field of Object.keys(table.fields)) expect(columns, `${model}.${field}`).toContain(field);
    }
  });
});

describe('cadastro (Admin-Empresa)', () => {
  it('cria a conta, a empresa e a sessão; /me mostra Admin-Empresa como dono da empresa', async () => {
    const email = uniqueEmail();
    const response = await signup({ email, companyName: 'Clínica São José' });
    expect(response.statusCode).toBe(201);
    const info = sessionInfoSchema.parse(response.json());
    expect(info).toMatchObject({ user: { email, name: 'Maria Teste' }, userType: 'company_admin', organization: { name: 'Clínica São José', role: 'owner' } });

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/dz\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(response.body).not.toMatch(/password|argon2|"token"/i);

    const session = await me(cookieHeader(response));
    expect(session.statusCode).toBe(200);
    expect(sessionInfoSchema.parse(session.json())).toEqual(info);
  });

  it('guarda a senha só como hash argon2id', async () => {
    const email = uniqueEmail();
    await signup({ email });
    const [row] = await services.database.db
      .select({ password: accounts.password })
      .from(accounts)
      .innerJoin(users, sql`${users.id} = ${accounts.userId}`)
      .where(sql`${users.email} = ${email}`);
    expect(row?.password).toMatch(/^\$argon2id\$/);
    expect(row?.password).not.toContain(PASSWORD);
  });

  it.each([
    ['senha curta', { password: 'curta-123' }, '12 caracteres'],
    ['sem empresa', { companyName: '' }, 'empresa'],
    ['e-mail inválido', { email: 'sem-arroba' }, 'e-mail'],
    ['campo não permitido', { platformRole: 'super_admin' }, undefined],
  ])('recusa %s em RFC 9457 e não cria nada', async (_caso, overrides, detail) => {
    const email = (overrides as { email?: string }).email ?? uniqueEmail();
    const problem = expectProblem(await signup({ ...overrides, email }), 400);
    if (detail) expect(problem.detail).toContain(detail);
    const found = await services.database.db.select().from(users).where(sql`${users.email} = ${email}`);
    expect(found).toHaveLength(0);
  });

  it('e-mail já cadastrado e e-mail reservado do Super-Admin recebem a mesma recusa', async () => {
    const email = uniqueEmail();
    expect((await signup({ email })).statusCode).toBe(201);
    const repeated = expectProblem(await signup({ email: email.toUpperCase() }), 409);
    const reserved = expectProblem(await signup({ email: SUPER_ADMIN_EMAIL }), 409);
    expect(repeated.detail).toBe(reserved.detail);
  });

  it('o cadastro direto pelo Better Auth está desativado (só existe o cadastro com empresa)', async () => {
    const response = await post('/api/auth/sign-up/email', { name: 'Sem Empresa', email: uniqueEmail(), password: PASSWORD });
    expect(response.statusCode).toBe(404);
  });

  it('com o cadastro desativado, responde 403', async () => {
    const closedConfig = { ...config, AUTH_SIGNUP_ENABLED: false };
    const closedApp = await buildApp(closedConfig, { services });
    const response = await closedApp.inject({ method: 'POST', url: SIGNUP_PATH, payload: { name: 'X', companyName: 'Y', email: uniqueEmail(), password: PASSWORD }, headers: { origin: PANEL } });
    expectProblem(response, 403);
    await closedApp.close();
  });
});

describe('entrar e sair', () => {
  it('login certo abre a sessão; o token não aparece no corpo da resposta', async () => {
    const email = uniqueEmail();
    await signup({ email });
    const response = await post(SIGN_IN_PATH, { email: email.toUpperCase(), password: PASSWORD });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('token');
    expect(response.body).not.toMatch(/argon2|password/i);
    expect((await me(cookieHeader(response))).statusCode).toBe(200);
  });

  it('senha errada e e-mail desconhecido recebem a mesma resposta', async () => {
    const email = uniqueEmail();
    await signup({ email });
    const wrongPassword = await post(SIGN_IN_PATH, { email, password: 'senha-errada-mas-longa' });
    const unknownEmail = await post(SIGN_IN_PATH, { email: uniqueEmail('ninguem'), password: PASSWORD });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(cookieHeader(wrongPassword)).not.toMatch(/session_token=[^;]+/);
  });

  it('/me sem sessão ou com cookie inventado responde 401', async () => {
    expectProblem(await me(), 401);
    expectProblem(await me('dz.session_token=cookie-inventado'), 401);
  });

  it('sair encerra a sessão: o mesmo cookie deixa de valer', async () => {
    const response = await signup();
    const cookie = cookieHeader(response);
    expect((await post(SIGN_OUT_PATH, {}, { cookie })).statusCode).toBe(200);
    expectProblem(await me(cookie), 401);
  });

  it('requisição com cookie vinda de outro site é recusada', async () => {
    const cookie = cookieHeader(await signup());
    const response = await post(SIGN_OUT_PATH, {}, { cookie, origin: 'https://malicioso.test' });
    expect(response.statusCode).toBe(403);
    expect((await me(cookie)).statusCode).toBe(200);
  });
});

describe('o navegador não promove a própria conta', () => {
  it('atualizar o perfil com papel de Super-Admin não muda o tipo de usuário', async () => {
    const cookie = cookieHeader(await signup());
    await post('/api/auth/update-user', { name: 'Novo Nome', platformRole: 'super_admin', origin: 'mylinksss' }, { cookie });
    const info = sessionInfoSchema.parse((await me(cookie)).json());
    expect(info.userType).toBe('company_admin');
  });

  it('não cria empresas por chamada direta à biblioteca', async () => {
    const cookie = cookieHeader(await signup());
    const before = await services.database.db.select().from(organizations);
    const response = await post('/api/auth/organization/create', { name: 'Empresa Extra', slug: `extra-${Date.now()}` }, { cookie });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await services.database.db.select().from(organizations)).toHaveLength(before.length);
  });
});

describe('Super-Admin', () => {
  it('é criado pelo comando, entra e aparece como Super-Admin sem empresa', async () => {
    const outcome = await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
    expect(outcome).toBe('created');
    const login = await post(SIGN_IN_PATH, { email: SUPER_ADMIN_EMAIL, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const info = sessionInfoSchema.parse((await me(cookieHeader(login))).json());
    expect(info).toMatchObject({ userType: 'super_admin', organization: null });

    expect(await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Outro', password: PASSWORD })).toBe('already_super_admin');
  });

  it('não promove uma conta comum já existente e recusa senha curta', async () => {
    const email = uniqueEmail();
    await signup({ email });
    await expect(createSuperAdmin({ auth: services.auth, db: services.database.db, email, name: 'Tentativa', password: PASSWORD })).rejects.toBeInstanceOf(SuperAdminError);
    await expect(createSuperAdmin({ auth: services.auth, db: services.database.db, email: uniqueEmail(), name: 'Tentativa', password: 'curta' })).rejects.toBeInstanceOf(SuperAdminError);
  });
});

describe('GET /health/ready', () => {
  it('responde ok quando o banco responde, sem dizer qual banco é', async () => {
    const response = await app.inject({ method: 'GET', url: HEALTH_READY_PATH });
    expect(response.statusCode).toBe(200);
    expect(healthReadySchema.parse(response.json())).toMatchObject({ status: 'ok', database: 'ok' });
  });
});

describe('correções da auditoria do login', () => {
  it('A1: as rotas que devolviam o token da sessão estão desativadas', async () => {
    const cookie = cookieHeader(await signup());
    for (const url of ['/api/auth/get-session', '/api/auth/list-sessions']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode, url).toBe(404);
      expect(response.body).not.toMatch(/"token"/);
    }
  });

  it('A3: o cadastro tem limite por endereço (o 11º seguido é recusado)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await post(SIGNUP_PATH, { name: 'Robo Teste', companyName: 'Robo', email: uniqueEmail('robo'), password: PASSWORD }, {}, '192.0.2.10');
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('A4: em desenvolvimento, o painel aberto por localhost consegue entrar', async () => {
    const email = uniqueEmail();
    await signup({ email });
    const response = await post(SIGN_IN_PATH, { email, password: PASSWORD }, { origin: 'http://localhost:3000' });
    expect(response.statusCode).toBe(200);
  });

  it('A5: os convites estão desativados até existir verificação de e-mail', async () => {
    const cookie = cookieHeader(await signup());
    const invite = await post('/api/auth/organization/invite-member', { email: 'convidado@empresa.test', role: 'admin' }, { cookie });
    expect(invite.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/auth/organization/list-user-invitations', headers: { cookie } });
    expect(list.statusCode).toBe(404);
  });
});
