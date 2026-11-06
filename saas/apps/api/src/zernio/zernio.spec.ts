import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  ZERNIO_ACCOUNTS_PATH,
  ZERNIO_CONNECT_PATH,
  ZERNIO_CONNECT_RETURN_PATH,
  ZERNIO_INBOX_ACCESS_PATH,
  ZERNIO_KEY_PATH,
  ZERNIO_PATH,
  ZERNIO_RETURN_ROUTE,
  problemDetailsSchema,
  zernioAccountPath,
  zernioAccountsResponseSchema,
  zernioConnectResultSchema,
  zernioInboxAccessResultSchema,
  zernioReturnResultSchema,
  zernioStatusSchema,
} from '@disparazap/contracts';
import { integrationCredentials, members, sessions, users, zernioConnections } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import type { Member } from '../auth/member.ts';
import { loadApiConfig } from '../config/env.ts';
import { createZernioClient } from '../integrations/zernio-client.ts';
import { createServices, type ApiServices } from '../services.ts';
import { ZernioSimulator } from '../testing/zernio-simulator.ts';
import { ZernioServiceError, createReturnToken, verifyReturnToken, type ZernioContext } from './zernio-service.ts';

// Tudo fictício: Zernio simulada nesta máquina, banco em memória, chaves inventadas
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const KEY_A = `sk_${'a1'.repeat(32)}`;
const KEY_B = `sk_${'b2'.repeat(32)}`;
const KEY_REFUSED = `sk_${'c3'.repeat(32)}`;

const baseEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
};
const config = loadApiConfig({ ...baseEnv, LOG_LEVEL: 'silent' });

const sim = new ZernioSimulator(KEY_A, KEY_B);
let services: ApiServices;
let app: FastifyInstance;
let superCookie: string;
let ownerA: string;
let ownerB: string;
let viewerA: string;
let operatorA: string;
let adminA: string;
let orgA: string;

let address = 0;
const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, payload?: object, target = app) {
  const body = payload ?? (method === 'POST' || method === 'PUT' ? {} : undefined);
  return target.inject({
    method,
    url,
    remoteAddress: `10.9.0.${++address % 250}`,
    headers: { origin: PANEL, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { payload: body } : {}),
  });
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const response = await call('POST', SIGNUP_PATH, undefined, { name: `Dono ${name}`, companyName: name, email, password: PASSWORD });
  expect(response.statusCode).toBe(201);
  return { cookie: cookieOf(response), email };
}

/** Conta própria movida para a empresa do dono com outro papel */
async function memberOf(ownerName: string, role: 'viewer' | 'operator' | 'admin') {
  const account = await signupCompany(`Pessoa ${role}`);
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [org] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email));
  await db.update(members).set({ organizationId: org?.org ?? '', role }).where(eq(members.userId, user?.id ?? ''));
  await db.update(sessions).set({ activeOrganizationId: org?.org ?? '' }).where(eq(sessions.userId, user?.id ?? ''));
  return account.cookie;
}

const status = async (cookie: string) => zernioStatusSchema.parse((await call('GET', ZERNIO_PATH, cookie)).json());
const accounts = async (cookie: string) => zernioAccountsResponseSchema.parse((await call('GET', ZERNIO_ACCOUNTS_PATH, cookie)).json()).accounts;

/** Começa a conexão e devolve os parâmetros que a Zernio poria no endereço de volta */
async function connectAndReturn(cookie: string, platform: string, outcome: (sim: ZernioSimulator) => string, reconnectAccountId: string | null = null) {
  const started = await call('POST', ZERNIO_CONNECT_PATH, cookie, { platform, reconnectAccountId });
  expect(started.statusCode).toBe(200);
  zernioConnectResultSchema.parse(started.json());
  const back = new URL(outcome(sim));
  return { back, dz: back.searchParams.get('dz') ?? '' };
}

const returnBody = (back: URL) => ({ dz: back.searchParams.get('dz'), connected: back.searchParams.get('connected'), accountId: back.searchParams.get('accountId'), error: back.searchParams.get('error') });

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  app = await buildApp(config, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, undefined, { email: SUPER_ADMIN_EMAIL, password: PASSWORD }));
  ownerA = (await signupCompany('Empresa A')).cookie;
  ownerB = (await signupCompany('Empresa B')).cookie;
  viewerA = await memberOf('Dono Empresa A', 'viewer');
  operatorA = await memberOf('Dono Empresa A', 'operator');
  adminA = await memberOf('Dono Empresa A', 'admin');
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'Dono Empresa A'));
  const [membership] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  orgA = membership?.org ?? '';
}, 120_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

describe('Integrações: conta Zernio da empresa', () => {
  it('sem chave: "não configurada", dizendo quem pode configurar; as redes pedem a configuração', async () => {
    expect(await status(ownerA)).toEqual({ available: true, configured: false, status: null, keyLast4: null, accountName: null, profileName: null, lastCheckAt: null, canManage: true });
    expect((await status(viewerA)).canManage).toBe(false);
    expect((await status(operatorA)).canManage).toBe(false);
    expect(expectProblem(await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA), 409).detail).toContain('não foi configurada');
  });

  it('chave em formato errado não chega à Zernio; chave recusada pela Zernio não é guardada', async () => {
    const before = sim.seenKeys.length;
    expect(expectProblem(await call('PUT', ZERNIO_KEY_PATH, ownerA, { apiKey: 'chave errada' }), 400).detail).toContain('sk_');
    expect(sim.seenKeys.length).toBe(before);
    expect(expectProblem(await call('PUT', ZERNIO_KEY_PATH, ownerA, { apiKey: KEY_REFUSED }), 400).detail).toContain('recusou');
    const db = services.database.db;
    const [saved] = await db.select({ total: count() }).from(integrationCredentials).where(and(eq(integrationCredentials.organizationId, orgA), eq(integrationCredentials.provider, 'zernio')));
    expect(saved?.total).toBe(0);
    expect((await status(ownerA)).configured).toBe(false);
  });

  it('chave aceita: guardada cifrada e nunca devolvida; perfil "DisparaZap — empresa" criado com o id da empresa; trocar a chave não duplica nada', async () => {
    const response = await call('PUT', ZERNIO_KEY_PATH, ownerA, { apiKey: `  ${KEY_A}  ` });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(KEY_A.slice(3, 40));
    expect(zernioStatusSchema.parse(response.json())).toMatchObject({ configured: true, status: 'active', keyLast4: KEY_A.slice(-4), accountName: 'Conta Zernio de Teste', profileName: 'DisparaZap — Empresa A' });
    const profiles = [...sim.profiles.values()];
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.externalId).toBe(orgA);
    expect(sim.seenKeys.at(-1)).toBe(`Bearer ${KEY_A}`);

    const db = services.database.db;
    const credentials = await db.select().from(integrationCredentials).where(and(eq(integrationCredentials.organizationId, orgA), eq(integrationCredentials.provider, 'zernio')));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.kind).toBe('api_key');
    expect(JSON.stringify(credentials[0])).not.toContain(KEY_A.slice(3, 40));

    // Trocar a chave: o mesmo perfil, uma credencial só (a anterior sai do cofre)
    expect((await call('PUT', ZERNIO_KEY_PATH, adminA, { apiKey: KEY_A })).statusCode).toBe(200);
    expect(sim.profiles.size).toBe(1);
    const after = await db.select().from(integrationCredentials).where(and(eq(integrationCredentials.organizationId, orgA), eq(integrationCredentials.provider, 'zernio')));
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(credentials[0]?.id);
  });

  it('conectar: link de autorização com volta assinada para o painel; na volta, a conta é relida na Zernio e aparece na lista', async () => {
    const { back } = await connectAndReturn(ownerA, 'instagram', (s) => s.authorize('loja_exemplo'));
    const request = sim.connectRequests.at(-1);
    expect(request?.platform).toBe('instagram');
    // Nomes exatos dos parâmetros (a Zernio ignora nomes errados em silêncio)
    expect(Object.keys(request?.query ?? {}).sort()).toEqual(['profileId', 'redirect_url']);
    expect(request?.query.profileId).toBe([...sim.profiles.values()][0]?._id);
    expect(request?.query.redirect_url).toMatch(new RegExp(`^${PANEL}${ZERNIO_RETURN_ROUTE}\\?dz=instagram\\.\\d+\\.[A-Za-z0-9_-]{43}$`));
    // O X limita o endereço de volta (codificado) a 258 caracteres
    expect(encodeURIComponent(request?.query.redirect_url ?? '').length).toBeLessThanOrEqual(258);

    const result = zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, returnBody(back))).json());
    expect(result).toMatchObject({ ok: true, platform: 'instagram', message: 'Instagram conectado: Loja Exemplo (instagram).' });
    const list = await accounts(viewerA);
    expect(list).toEqual([{ id: result.account?.id, platform: 'instagram', username: 'loja_exemplo', displayName: 'Loja Exemplo (instagram)', profileUrl: 'https://social.exemplo.test/loja_exemplo', state: 'ok' }]);
  });

  it('volta com erro: motivo fixo, sem nada do texto que a Zernio pôs na URL', async () => {
    const denied = await connectAndReturn(ownerA, 'facebook', (s) => s.deny('no_facebook_pages'));
    const response = await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, returnBody(denied.back));
    expect(zernioReturnResultSchema.parse(response.json())).toEqual({ ok: false, platform: 'facebook', account: null, message: expect.stringContaining('não administra nenhuma Página') });
    expect(response.body).not.toContain('texto livre');
    const unknown = await connectAndReturn(ownerA, 'tiktok', (s) => s.deny('erro_que_ainda_nao_existe'));
    expect(zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, returnBody(unknown.back))).json()).message).toContain('não concluiu a conexão');
  });

  it('comprovante da volta: alterado, de outra empresa ou de outro usuário é recusado', async () => {
    const { back, dz } = await connectAndReturn(ownerA, 'linkedin', (s) => s.authorize('empresa_linkedin'));
    const body = returnBody(back);
    const tampered = `${dz.slice(0, -1)}${dz.endsWith('A') ? 'B' : 'A'}`;
    expect(expectProblem(await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, { ...body, dz: tampered }), 400).detail).toContain('não é válido');
    expect(expectProblem(await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, { ...body, dz: dz.replace('linkedin', 'facebook') }), 400).detail).toContain('não é válido');
    expectProblem(await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerB, body), 400);
    expectProblem(await call('POST', ZERNIO_CONNECT_RETURN_PATH, adminA, body), 400);
    expect(zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, body)).json()).ok).toBe(true);
  });

  it('código de erro com nome especial (constructor, __proto__) recebe a mensagem geral, sem quebrar a resposta', async () => {
    // Empresa própria: as tentativas não disputam o limite por minuto da Empresa A
    const ownerE = (await signupCompany('Empresa E')).cookie;
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerE, { apiKey: KEY_A })).statusCode).toBe(200);
    for (const error of ['constructor', '__proto__', 'toString']) {
      const { back } = await connectAndReturn(ownerE, 'threads', (s) => s.deny(error));
      const result = zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerE, returnBody(back))).json());
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining('não concluiu a conexão') });
    }
  });

  it('comprovante vence em 15 minutos', () => {
    let now = Date.UTC(2026, 10, 2, 12, 0, 0);
    const ctx: ZernioContext = { db: services.database.db, vault: services.vault, clientFactory: () => { throw new Error('não usado'); }, panelOrigin: PANEL, now: () => now };
    const member: Member = { userId: 'usuario-1', organizationId: 'empresa-1', role: 'owner' };
    const token = createReturnToken(ctx, member, 'youtube');
    now += 14 * 60_000;
    expect(verifyReturnToken(ctx, member, token)).toBe('youtube');
    now += 2 * 60_000;
    expect(() => verifyReturnToken(ctx, member, token)).toThrow(ZernioServiceError);
  });

  it('reconectar e desconectar: só contas do perfil da própria empresa', async () => {
    const instagram = (await accounts(ownerA)).find((account) => account.platform === 'instagram');
    const simAccount = sim.accounts.get(instagram?.id ?? '');
    if (simAccount) simAccount.needsReconnection = true;
    expect((await accounts(ownerA)).find((account) => account.id === instagram?.id)?.state).toBe('needs_reconnect');

    const { back } = await connectAndReturn(ownerA, 'instagram', (s) => s.authorize(), instagram?.id ?? null);
    expect(sim.connectRequests.at(-1)?.query.reconnectAccountId).toBe(instagram?.id);
    expect(zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerA, returnBody(back))).json()).account?.state).toBe('ok');
    expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerA, { platform: 'instagram', reconnectAccountId: 'acc_inexistente' }), 404);

    // Empresa B com a própria conta Zernio e uma rede
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerB, { apiKey: KEY_B })).statusCode).toBe(200);
    const fromB = await connectAndReturn(ownerB, 'youtube', (s) => s.authorize('canal_b'));
    const accountB = zernioReturnResultSchema.parse((await call('POST', ZERNIO_CONNECT_RETURN_PATH, ownerB, returnBody(fromB.back))).json()).account;
    expect((await accounts(ownerA)).some((account) => account.id === accountB?.id)).toBe(false);
    expectProblem(await call('DELETE', zernioAccountPath(accountB?.id ?? ''), ownerA), 404);
    expect(sim.accounts.has(accountB?.id ?? '')).toBe(true);

    // Mesmo que a Zernio devolva contas de outros perfis, só as do perfil da empresa contam
    sim.leakAllAccounts = true;
    try {
      expect((await accounts(ownerA)).some((account) => account.id === accountB?.id)).toBe(false);
      expectProblem(await call('DELETE', zernioAccountPath(accountB?.id ?? ''), ownerA), 404);
      expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerA, { platform: 'youtube', reconnectAccountId: accountB?.id }), 404);
    } finally {
      sim.leakAllAccounts = false;
    }
    expect(sim.accounts.has(accountB?.id ?? '')).toBe(true);

    expect((await call('DELETE', zernioAccountPath(instagram?.id ?? ''), ownerA)).statusCode).toBe(204);
    expect(sim.deleted).toContain(instagram?.id);
    expectProblem(await call('DELETE', zernioAccountPath(instagram?.id ?? ''), ownerA), 404);
  });

  it('redes conectadas trazem o total da conta Zernio inteira e as redes fora do perfil do DisparaZap, com o nome do perfil', async () => {
    const full = zernioAccountsResponseSchema.parse((await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA)).json());
    // Contado na lista de contas da Zernio (o /v1/usage simulado responde 0, como na conta real)
    expect(full.teamAccountCount).toBe([...sim.accounts.values()].filter((account) => account.isActive).length);
    // Na Zernio simulada, a rede da Empresa B fica na mesma conta: aparece como fora do perfil da Empresa A
    expect(full.teamAccountCount).toBeGreaterThan(full.accounts.length);
    expect(full.outsideAccounts).toContainEqual({ platform: 'youtube', username: 'canal_b', profileName: 'DisparaZap — Empresa B' });
    expect(full.outsideAccounts.some((account) => full.accounts.some((own) => own.username === account.username && own.platform === account.platform && account.profileName === 'DisparaZap — Empresa A'))).toBe(false);
    sim.teamListUnavailable = true;
    try {
      const partial = await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA);
      expect(partial.statusCode).toBe(200);
      expect(zernioAccountsResponseSchema.parse(partial.json())).toMatchObject({ teamAccountCount: null, outsideAccounts: [], accounts: full.accounts });
    } finally {
      sim.teamListUnavailable = false;
    }
  });

  it('papéis: operador e visualizador só veem; Super-Admin sem empresa e outro site são recusados', async () => {
    for (const cookie of [viewerA, operatorA]) {
      expect((await call('GET', ZERNIO_PATH, cookie)).statusCode).toBe(200);
      expect((await call('GET', ZERNIO_ACCOUNTS_PATH, cookie)).statusCode).toBe(200);
      expectProblem(await call('PUT', ZERNIO_KEY_PATH, cookie, { apiKey: KEY_A }), 403);
      expectProblem(await call('DELETE', ZERNIO_KEY_PATH, cookie), 403);
      expectProblem(await call('POST', ZERNIO_CONNECT_PATH, cookie, { platform: 'instagram' }), 403);
      expectProblem(await call('POST', ZERNIO_CONNECT_RETURN_PATH, cookie, { dz: 'instagram.1.x' }), 403);
      expectProblem(await call('DELETE', zernioAccountPath('qualquer'), cookie), 403);
    }
    expect(expectProblem(await call('GET', ZERNIO_PATH, superCookie), 403).detail).toContain('empresa');
    expectProblem(await call('GET', ZERNIO_PATH, undefined), 401);
    const foreign = await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, headers: { origin: 'https://malicioso.test', cookie: ownerA, 'content-type': 'application/json' }, payload: { apiKey: KEY_A } });
    expectProblem(foreign, 403);
  });

  it('falhas da Zernio viram mensagens fixas; chave revogada marca a integração e volta a valer quando a chave funciona', async () => {
    sim.failNext = { status: 429, body: { error: 'Rate limit exceeded', details: { retryAfterSeconds: 30 } } };
    expect(expectProblem(await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA), 429).detail).toContain('pausa');
    sim.failNext = { status: 402, body: { error: 'Payment required (detalhe interno)', type: 'permission_error', code: 'PAYMENT_REQUIRED', reason: 'free_tier_exceeded' } };
    const payment = expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerA, { platform: 'pinterest' }), 402);
    expect(payment.detail).toContain('plano grátis da Zernio permite 2 redes');
    expect(payment.detail).not.toContain('detalhe interno');
    sim.failNext = { status: 503, body: { error: 'Service unavailable', type: 'api_error', code: 'service_unavailable' } };
    expectProblem(await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA), 502);

    sim.keys.delete(KEY_A);
    expect(expectProblem(await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA), 409).detail).toContain('recusou a chave guardada');
    expect((await status(ownerA)).status).toBe('invalid');
    sim.keys.add(KEY_A);
    expect((await call('GET', ZERNIO_ACCOUNTS_PATH, ownerA)).statusCode).toBe(200);
    expect((await status(ownerA)).status).toBe('active');
  });

  it('cobrança da Zernio (402): cada motivo tem a sua mensagem, com os números da Zernio; o motivo vai para o log', async () => {
    let logs = '';
    const logStream = new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    const ownerF = (await signupCompany('Empresa F')).cookie;
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerF, { apiKey: KEY_A }, logged)).statusCode).toBe(200);
    sim.enforceBilling = true;
    try {
      const x = expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerF, { platform: 'twitter' }, logged), 402);
      expect(x.title).toBe('Pagamento necessário');
      expect(x.detail).toContain('O X (Twitter) exige um cartão');
      expect(x.detail).toContain('as 2 redes grátis não valem para o X');

      const free = expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerF, { platform: 'instagram' }, logged), 402);
      expect(free.detail).toContain(`permite 2 redes conectadas na conta Zernio inteira, e a sua já tem ${sim.accounts.size}`);
      expect(free.detail).toContain('direto no painel da Zernio ou em outros perfis');

      sim.failNext = { status: 402, body: { error: 'Card flagged', code: 'PAYMENT_REQUIRED', reason: 'card_verification_required', details: { verification_amount_cents: 1000 } } };
      expect(expectProblem(await call('POST', ZERNIO_CONNECT_PATH, ownerF, { platform: 'facebook' }, logged), 402).detail).toContain('US$ 10,00');

      // Com cartão cadastrado na Zernio, conecta normalmente
      sim.hasPaymentMethod = true;
      expect((await call('POST', ZERNIO_CONNECT_PATH, ownerF, { platform: 'instagram' }, logged)).statusCode).toBe(200);
    } finally {
      sim.enforceBilling = false;
      sim.hasPaymentMethod = false;
      sim.connectRequests.pop();
    }
    expect(logs).toContain('zernio.recusa');
    expect(logs).toContain('twitter_passthrough');
    expect(logs).toContain('free_tier_exceeded');
    expect(logs).toContain('"rede":"twitter"');
    expect(logs).not.toContain(KEY_A.slice(3, 40));
    await logged.close();
  });

  it('duas pessoas salvando a chave ao mesmo tempo: as duas recebem resposta e fica uma ligação e uma credencial só', async () => {
    const ownerD = (await signupCompany('Empresa D')).cookie;
    const adminD = await memberOf('Dono Empresa D', 'admin');
    const results = await Promise.all([call('PUT', ZERNIO_KEY_PATH, ownerD, { apiKey: KEY_B }), call('PUT', ZERNIO_KEY_PATH, adminD, { apiKey: KEY_B })]);
    expect(results.map((response) => response.statusCode)).toEqual([200, 200]);
    const db = services.database.db;
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'Dono Empresa D'));
    const [membership] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
    const [credentials] = await db.select({ total: count() }).from(integrationCredentials).where(and(eq(integrationCredentials.organizationId, membership?.org ?? ''), eq(integrationCredentials.provider, 'zernio')));
    const [connections] = await db.select({ total: count() }).from(zernioConnections).where(eq(zernioConnections.organizationId, membership?.org ?? ''));
    expect([credentials?.total, connections?.total]).toEqual([1, 1]);
  });

  it('Zernio fora do ar: mensagem fixa, nada guardado', async () => {
    const offline = await buildApp(config, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: 'http://127.0.0.1:9/api/v1', timeoutMs: 2000 }) });
    const ownerC = (await signupCompany('Empresa C')).cookie;
    expect(expectProblem(await call('PUT', ZERNIO_KEY_PATH, ownerC, { apiKey: KEY_A }, offline), 502).detail).toContain('não respondeu');
    expect(zernioStatusSchema.parse((await call('GET', ZERNIO_PATH, ownerC, undefined, offline)).json()).configured).toBe(false);
    await offline.close();
  });

  it('a chave nunca vai para o log; a ação fica registrada com a empresa', async () => {
    let logs = '';
    const logStream = new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerA, { apiKey: KEY_A }, logged)).statusCode).toBe(200);
    expect((await call('POST', ZERNIO_CONNECT_PATH, ownerA, { platform: 'threads' }, logged)).statusCode).toBe(200);
    expect(logs).toContain('zernio.chave.salva');
    expect(logs).toContain(orgA);
    expect(logs).not.toContain(KEY_A.slice(3, 40));
    await logged.close();
  });

  it('remover a integração tira a chave do DisparaZap e não mexe na conta da Zernio', async () => {
    const before = sim.accounts.size;
    expect((await call('DELETE', ZERNIO_KEY_PATH, ownerA)).statusCode).toBe(204);
    expect((await status(ownerA)).configured).toBe(false);
    const db = services.database.db;
    const [left] = await db.select({ total: count() }).from(integrationCredentials).where(and(eq(integrationCredentials.organizationId, orgA), eq(integrationCredentials.provider, 'zernio')));
    expect(left?.total).toBe(0);
    const [connection] = await db.select({ total: count() }).from(zernioConnections).where(eq(zernioConnections.organizationId, orgA));
    expect(connection?.total).toBe(0);
    expect(sim.accounts.size).toBe(before);
    expectProblem(await call('DELETE', ZERNIO_KEY_PATH, ownerA), 404);
    // A Empresa B continua com a integração dela
    expect((await status(ownerB)).configured).toBe(true);
  });

  it('chave guardada que não abre mais (chave-mestra trocada ou dado alterado): pede para cadastrar de novo, sem erro interno', async () => {
    const db = services.database.db;
    const [connectionB] = await db.select().from(zernioConnections).where(eq(zernioConnections.profileName, 'DisparaZap — Empresa B'));
    await db.update(integrationCredentials).set({ authTag: randomBytes(16).toString('base64') }).where(eq(integrationCredentials.id, connectionB?.credentialId ?? ''));
    expect(expectProblem(await call('GET', ZERNIO_ACCOUNTS_PATH, ownerB), 409).detail).toContain('não pôde ser aberta');
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerB, { apiKey: KEY_B })).statusCode).toBe(200);
    expect((await call('GET', ZERNIO_ACCOUNTS_PATH, ownerB)).statusCode).toBe(200);
  });
});

describe('teste de acesso à Inbox (Z1, só leitura, administradores)', () => {
  const INBOX = ZERNIO_INBOX_ACCESS_PATH;
  let profileOfA = '';
  // Aplicação própria: o limite de tentativas da rota (30/min por empresa) não é gasto pelos testes anteriores
  let probeApp: FastifyInstance;
  const requests = () => sim.inboxRequests.length;
  const probe = (cookie: string | undefined, payload: object = { confirmed: true }, target = probeApp) => call('POST', INBOX, cookie, payload, target);

  beforeAll(async () => {
    probeApp = await buildApp(config, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await probeApp.ready();
    expect((await call('PUT', ZERNIO_KEY_PATH, ownerA, { apiKey: KEY_A })).statusCode).toBe(200);
    const [row] = await services.database.db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, orgA));
    profileOfA = row?.profileId ?? '';
    sim.inboxMode = 'ok';
    sim.inboxConversations = 0;
  });

  afterAll(async () => {
    sim.inboxMode = 'ok';
    sim.inboxConversations = 0;
    await probeApp?.close();
  });

  it('só dono e administradores; atendente e visualizador recebem 403 e a Zernio não é chamada', async () => {
    const before = requests();
    expectProblem(await probe(viewerA), 403);
    expectProblem(await probe(operatorA), 403);
    expect(requests()).toBe(before);
    expectProblem(await probe(undefined), 401);
  });

  it('sem confirmação explícita, nada é consultado', async () => {
    const before = requests();
    expectProblem(await probe(adminA, {}), 400);
    expectProblem(await probe(adminA, { confirmed: false }), 400);
    expect(requests()).toBe(before);
  });

  it('administrador: acesso confirmado com 1 conversa no máximo, no perfil da empresa; nenhum conteúdo volta', async () => {
    sim.inboxMode = 'ok';
    sim.inboxConversations = 1;
    const response = await probe(adminA);
    expect(response.statusCode).toBe(200);
    const result = zernioInboxAccessResultSchema.parse(response.json());
    expect(result).toMatchObject({ outcome: 'confirmed', code: null, hasConversations: true });
    const last = sim.inboxRequests.at(-1);
    expect(last).toEqual({ profileId: profileOfA, limit: '1' });
    expect(response.body).not.toContain('conv_sim');
    expect(response.body).not.toContain(KEY_A);
  });

  it('sem conversas: acesso confirmado e "sem conversas"', async () => {
    sim.inboxConversations = 0;
    const result = zernioInboxAccessResultSchema.parse((await probe(adminA)).json());
    expect(result).toMatchObject({ outcome: 'confirmed', hasConversations: false });
  });

  it('403 com código de complemento: recurso indisponível, com o código da Zernio (sem tirar conclusão sozinho)', async () => {
    sim.inboxMode = 'addon';
    const result = zernioInboxAccessResultSchema.parse((await probe(adminA)).json());
    expect(result).toMatchObject({ outcome: 'unavailable', code: 'feature_not_available', hasConversations: null });
    expect(result.message).toContain('falta de permissão ou de complemento');
  });

  it('403 sem código conhecido: também "recurso indisponível", sem código inventado', async () => {
    sim.inboxMode = 'forbidden';
    const result = zernioInboxAccessResultSchema.parse((await probe(adminA)).json());
    expect(result).toMatchObject({ outcome: 'unavailable', code: 'forbidden' });
  });

  it('cobrança (402): recurso indisponível', async () => {
    sim.inboxMode = 'payment';
    expect(zernioInboxAccessResultSchema.parse((await probe(adminA)).json()).outcome).toBe('unavailable');
  });

  it('chave recusada (401): falha de autenticação, e a integração não muda de situação', async () => {
    const before = (await status(ownerA)).status;
    sim.inboxMode = 'unauthorized';
    expect(zernioInboxAccessResultSchema.parse((await probe(adminA)).json()).outcome).toBe('auth_failed');
    expect((await status(ownerA)).status).toBe(before);
  });

  it('limite (429) e erro do servidor (500): falha temporária', async () => {
    sim.inboxMode = 'rate_limit';
    expect(zernioInboxAccessResultSchema.parse((await probe(adminA)).json()).outcome).toBe('temporary');
    sim.inboxMode = 'server';
    expect(zernioInboxAccessResultSchema.parse((await probe(adminA)).json()).outcome).toBe('temporary');
  });

  it('resposta fora do formato: diagnóstico inconclusivo', async () => {
    sim.inboxMode = 'odd';
    expect(zernioInboxAccessResultSchema.parse((await probe(adminA)).json())).toMatchObject({ outcome: 'inconclusive', code: null });
  });

  it('isolamento: a empresa B consulta só o próprio perfil (ou recebe 409 se não tem a Zernio), nunca o da empresa A', async () => {
    sim.inboxMode = 'ok';
    const response = await probe(ownerB);
    if (response.statusCode === 200) {
      expect(sim.inboxRequests.at(-1)?.profileId).toBeTruthy();
      expect(sim.inboxRequests.at(-1)?.profileId).not.toBe(profileOfA);
    } else {
      expectProblem(response, 409);
    }
  });

  it('formato fora do esperado: o log registra só os nomes das chaves de topo, nunca os valores', async () => {
    let logs = '';
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await logged.ready();
    sim.inboxMode = 'odd';
    const result = zernioInboxAccessResultSchema.parse((await probe(adminA, { confirmed: true }, logged)).json());
    expect(result.outcome).toBe('inconclusive');
    expect(logs).toContain('"forma":"ok,items"');
    expect(logs).not.toContain('formato inesperado');
    await logged.close();
    sim.inboxMode = 'ok';
  });

  it('o log registra o resultado e o status, sem chave, perfil, conversa ou texto', async () => {
    let logs = '';
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await logged.ready();
    sim.inboxMode = 'addon';
    sim.inboxConversations = 1;
    expect((await probe(adminA, { confirmed: true }, logged)).statusCode).toBe(200);
    expect(logs).toContain('zernio.inbox.teste');
    expect(logs).toContain('"resultado":"unavailable"');
    expect(logs).toContain('"status_servidor":403');
    for (const secret of [KEY_A, profileOfA, 'conv_sim']) expect(logs).not.toContain(secret);
    await logged.close();
    sim.inboxMode = 'ok';
    sim.inboxConversations = 0;
  });
});
