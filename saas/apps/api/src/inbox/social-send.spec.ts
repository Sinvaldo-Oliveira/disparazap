import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE, SIGNUP_PATH, SOCIAL_SEND_PATH, ZERNIO_KEY_PATH, problemDetailsSchema, socialSendResultSchema } from '@disparazap/contracts';
import { members, sessions, users, zernioConnections } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createZernioClient } from '../integrations/zernio-client.ts';
import { createServices, type ApiServices } from '../services.ts';
import { ZernioSimulator, type SimAccount, type SimInboxThread } from '../testing/zernio-simulator.ts';
import { dbSendRegistry, sendSocialReply } from './social-send.ts';
import type { Member } from '../auth/member.ts';

// Tudo fictício: Zernio simulada, banco em memória com a migração 0008 (rascunho) aplicada no teste
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const KEY_A = `sk_${'a1'.repeat(32)}`;
const KEY_B = `sk_${'b2'.repeat(32)}`;
const SECRET_TEXT = 'Resposta secreta de teste que nunca pode aparecer no log';
const DRAFT = fileURLToPath(new URL('../../../../docs/MIGRACAO_0008_SOCIAL_SENDS_RASCUNHO.sql', import.meta.url));

const baseEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
};
const config = loadApiConfig({ ...baseEnv, LOG_LEVEL: 'silent', INBOX_SOCIAL_SEND_ENABLED: 'true' });
const disabledConfig = loadApiConfig({ ...baseEnv, LOG_LEVEL: 'silent' });

const sim = new ZernioSimulator(KEY_A, KEY_B);
let services: ApiServices;
let app: FastifyInstance;
let disabledApp: FastifyInstance;
let logs = '';
let address = 0;
let ownerA: string;
let ownerB: string;
let operatorA: string;
let viewerA: string;
let profileA = '';
let accountA: SimAccount;
let accountB: SimAccount;
const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
const db = () => services.database.db;

function call(method: 'GET' | 'POST', url: string, cookie: string | undefined, payload?: object, target: FastifyInstance = app) {
  return target.inject({
    method,
    url,
    remoteAddress: `10.9.1.${++address % 250}`,
    headers: { origin: PANEL, ...(payload ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}),
  });
}
function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}
async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const created = await call('POST', SIGNUP_PATH, undefined, { name: `Dono ${name}`, companyName: name, email, password: PASSWORD });
  expect(created.statusCode).toBe(201);
  return cookieOf(created);
}
async function memberOf(ownerName: string, role: 'viewer' | 'operator') {
  const cookie = await signupCompany(`Pessoa ${role}`);
  const [owner] = await db().select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [membership] = await db().select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  const [user] = await db().select({ id: users.id }).from(users).where(eq(users.name, `Dono Pessoa ${role}`));
  await db().update(members).set({ organizationId: membership?.org ?? '', role }).where(eq(members.userId, user?.id ?? ''));
  await db().update(sessions).set({ activeOrganizationId: membership?.org ?? '' }).where(eq(sessions.userId, user?.id ?? ''));
  return cookie;
}
let accountSeq = 0;
function addAccount(profileId: string, platform: string, username: string): SimAccount {
  const account: SimAccount = { _id: `acc_send_${++accountSeq}`, platform, profileId, username, displayName: `Loja ${username}`, profileUrl: `https://social.exemplo.test/${username}`, isActive: true, needsReconnection: false };
  sim.accounts.set(account._id, account);
  return account;
}
/** Conversa com a última mensagem do contato na quantidade de horas informada (ou sem mensagem do contato) */
function thread(id: string, accountId: string, incomingHoursAgo: number | null): SimInboxThread {
  const messages: SimInboxThread['messages'] = [{ id: `${id}_out`, direction: 'outgoing', message: 'Mensagem da empresa', createdAt: hoursAgo(1) }];
  if (incomingHoursAgo !== null) messages.push({ id: `${id}_in`, direction: 'incoming', message: 'Pergunta do cliente', createdAt: hoursAgo(incomingHoursAgo) });
  return { id, accountId, participantName: 'Contato Teste', lastMessage: 'Pergunta do cliente', updatedTime: hoursAgo(0), status: 'active', unreadCount: 0, messages };
}
const sendBody = (overrides: Record<string, unknown> = {}) => ({ accountId: accountA._id, conversationId: 'conv_janela_aberta', requestId: randomUUID(), text: 'Oi! Vou verificar isso agora.', ...overrides });
const sentCount = () => sim.sentMessages.length;

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  // Papéis que o Supabase já fornece, e a migração 0008 (rascunho) aplicada no banco de teste
  for (const role of ['dz_app', 'anon', 'authenticated', 'service_role']) await db().execute(sql.raw(`create role ${role} nologin`));
  const statements = readFileSync(DRAFT, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((item) => item.trim()).filter(Boolean);
  // A migração 0008 já criou a tabela (sem papéis); o rascunho a refaz com as políticas e concessões de dz_app
  await db().execute(sql.raw('drop table app.inbox_social_sends'));
  for (const statement of statements) await db().execute(sql.raw(statement));
  const zernioClientFactory = (apiKey: string) => createZernioClient(apiKey, { baseUrl: sim.url, publishTimeoutMs: 1500 });
  const logStream = new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } });
  app = await buildApp(config, { services, logStream, zernioClientFactory });
  await app.ready();
  disabledApp = await buildApp(disabledConfig, { services, zernioClientFactory });
  await disabledApp.ready();

  await createSuperAdmin({ auth: services.auth, db: db(), email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  ownerA = await signupCompany('Empresa A');
  ownerB = await signupCompany('Empresa B');
  operatorA = await memberOf('Dono Empresa A', 'operator');
  viewerA = await memberOf('Dono Empresa A', 'viewer');
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.9.2.1', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerA }, payload: { apiKey: KEY_A } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.9.2.2', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerB }, payload: { apiKey: KEY_B } })).statusCode).toBe(200);
  const orgOf = async (name: string) => (await db().select({ org: members.organizationId }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(users.name, name)))[0]?.org ?? '';
  const [connA] = await db().select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa A')));
  profileA = connA?.profileId ?? '';
  const [connB] = await db().select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa B')));
  accountA = addAccount(profileA, 'instagram', 'lojaenvio');
  accountB = addAccount(connB?.profileId ?? '', 'instagram', 'lojaoutra');
  sim.inboxThreads.push(
    thread('conv_janela_aberta', accountA._id, 2),
    thread('conv_human_agent', accountA._id, 72),
    thread('conv_expirada', accountA._id, 8 * 24),
    thread('conv_sem_cliente', accountA._id, null),
    thread('conv_outra_conta', accountB._id, 1),
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await disabledApp?.close();
  await services?.database.close();
  await sim.stop();
});

describe('envio de resposta humana pelo Instagram (Z3.2)', () => {
  it('sem sessão 401; visualizador 403; sem chamada à Zernio', async () => {
    const before = sentCount();
    expectProblem(await call('POST', SOCIAL_SEND_PATH, undefined, sendBody()), 401);
    expectProblem(await call('POST', SOCIAL_SEND_PATH, viewerA, sendBody()), 403);
    expect(sentCount()).toBe(before);
  });

  it('com o envio desligado (padrão), nada é chamado e a resposta diz que não está habilitado', async () => {
    const before = sentCount();
    expect(expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody(), disabledApp), 409).detail).toContain('ainda não está habilitado');
    expect(sentCount()).toBe(before);
  });

  it('janela aberta (até 24 h): envio sem tag, com registro e id do provedor', async () => {
    const body = sendBody();
    const response = await call('POST', SOCIAL_SEND_PATH, operatorA, body);
    expect(response.statusCode).toBe(200);
    const result = socialSendResultSchema.parse(response.json());
    expect(result).toMatchObject({ status: 'sent', replayed: false });
    expect(result.providerMessageId).toMatch(/^mid_sim_/);
    const last = sim.sentMessages.at(-1);
    expect(last).toMatchObject({ conversationId: 'conv_janela_aberta', accountId: accountA._id, message: body.text, idempotencyKey: body.requestId });
    expect(last?.messageTag).toBeUndefined();
    expect(last?.messagingType).toBeUndefined();
  });

  it('entre 24 h e 7 dias: HUMAN_AGENT com MESSAGE_TAG, só para resposta humana', async () => {
    const response = await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ conversationId: 'conv_human_agent' }));
    expect(socialSendResultSchema.parse(response.json()).status).toBe('sent');
    expect(sim.sentMessages.at(-1)).toMatchObject({ messageTag: 'HUMAN_AGENT', messagingType: 'MESSAGE_TAG' });
  });

  it('depois de 7 dias: bloqueado antes de qualquer chamada', async () => {
    const before = sentCount();
    expect(expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ conversationId: 'conv_expirada' })), 409).detail).toContain('bloqueado');
    expect(sentCount()).toBe(before);
  });

  it('sem mensagem do contato nas lidas: bloqueado (falha fechada)', async () => {
    const before = sentCount();
    expect(expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ conversationId: 'conv_sem_cliente' })), 409).detail).toContain('Sem data confiável');
    expect(sentCount()).toBe(before);
  });

  it('histórico não confirmado (ordem não garantida): bloqueado', async () => {
    const before = sentCount();
    sim.ignoreSortOrder = true;
    try {
      expect(expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody()), 409).detail).toContain('Histórico não confirmado');
    } finally {
      sim.ignoreSortOrder = false;
    }
    expect(sentCount()).toBe(before);
  });

  it('mesmo pedido repetido: uma única chamada à Zernio e resposta com replayed', async () => {
    const body = sendBody();
    const before = sentCount();
    const first = socialSendResultSchema.parse((await call('POST', SOCIAL_SEND_PATH, ownerA, body)).json());
    const second = socialSendResultSchema.parse((await call('POST', SOCIAL_SEND_PATH, ownerA, body)).json());
    expect(sentCount()).toBe(before + 1);
    expect(second).toMatchObject({ status: 'sent', replayed: true, providerMessageId: first.providerMessageId });
  });

  it('pedidos simultâneos com o mesmo requestId: a Zernio recebe um só', async () => {
    const body = sendBody();
    const before = sentCount();
    await Promise.all([call('POST', SOCIAL_SEND_PATH, ownerA, body), call('POST', SOCIAL_SEND_PATH, ownerA, body)]);
    expect(sentCount()).toBe(before + 1);
  });

  it('registro no banco: estado e id do provedor, sem texto da mensagem', async () => {
    const body = sendBody();
    await call('POST', SOCIAL_SEND_PATH, ownerA, body);
    const rows = await db().execute(sql`select status, provider_message_id, text_length from app.inbox_social_sends where client_request_id = ${body.requestId}`);
    expect((rows as unknown as { rows: Record<string, unknown>[] }).rows[0]).toMatchObject({ status: 'sent', text_length: body.text.length });
    expect(String((rows as unknown as { rows: Record<string, unknown>[] }).rows[0]?.provider_message_id)).toMatch(/^mid_sim_/);
  });

  it('texto vazio, longo demais ou pedido inválido: 400, sem chamada', async () => {
    const before = sentCount();
    expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ text: '   ' })), 400);
    expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ text: 'x'.repeat(1001) })), 400);
    expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ requestId: 'nao-e-uuid' })), 400);
    expect(sentCount()).toBe(before);
  });

  it('conta de outra empresa: 404 e nenhuma chamada', async () => {
    const before = sentCount();
    expectProblem(await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ accountId: accountB._id, conversationId: 'conv_outra_conta' })), 404);
    expect(sentCount()).toBe(before);
  });

  it('IA ou automação não passam pelo serviço (origem diferente de humano)', async () => {
    const member: Member = { userId: 'u_auto', organizationId: 'org_x', role: 'owner' };
    await expect(sendSocialReply({} as never, member, { conversationId: 'c', accountId: 'a', requestId: randomUUID(), text: 'oi', origin: 'automacao' as unknown as 'humano' }, { enabled: true, registry: dbSendRegistry(db()) })).rejects.toThrow('Só uma pessoa');
  });
});

describe('falhas da Zernio no envio: nada reenviado sozinho', () => {
  // Aplicação própria: o limite de envios por empresa (20 por minuto) não é gasto pelos casos de falha
  let failApp: FastifyInstance;
  beforeAll(async () => {
    failApp = await buildApp(config, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url, publishTimeoutMs: 1500 }) });
    await failApp.ready();
  });
  afterAll(async () => {
    await failApp?.close();
  });
  const failWith = async (mode: typeof sim.sendMode) => {
    sim.sendMode = mode;
    const body = sendBody();
    const result = socialSendResultSchema.parse((await call('POST', SOCIAL_SEND_PATH, ownerA, body, failApp)).json());
    sim.sendMode = 'ok';
    return { result, body };
  };

  it('409 (em processamento): resultado desconhecido; repetir o mesmo pedido não chama a Zernio de novo', async () => {
    const { result, body } = await failWith('409');
    expect(result).toMatchObject({ status: 'unknown', replayed: false });
    const before = sentCount();
    const again = socialSendResultSchema.parse((await call('POST', SOCIAL_SEND_PATH, ownerA, body, failApp)).json());
    expect(again).toMatchObject({ status: 'unknown', replayed: true });
    expect(sentCount()).toBe(before);
  });

  it('422 (validação ou chave reutilizada): falha sem envio, sem reenvio', async () => {
    const { result } = await failWith('422');
    expect(result).toMatchObject({ status: 'failed', providerMessageId: null });
  });

  it('429 (limite): falha sem envio; uma nova intenção é permitida depois', async () => {
    const { result } = await failWith('429');
    expect(result.status).toBe('failed');
    const fresh = socialSendResultSchema.parse((await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody(), failApp)).json());
    expect(fresh.status).toBe('sent');
  });

  it('500 e 502 (falha do servidor): resultado desconhecido, nunca reenviado', async () => {
    expect((await failWith('500')).result.status).toBe('unknown');
    expect((await failWith('502')).result.status).toBe('unknown');
  });

  it('403 da Meta (possível janela fechada): falha sem envio, mensagem fixa', async () => {
    const { result } = await failWith('janela');
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toContain('não aceitou');
  });

  it('200 sem id da mensagem: não dá para afirmar que saiu, então é desconhecido', async () => {
    const { result } = await failWith('sem_id');
    expect(result).toMatchObject({ status: 'unknown', providerMessageId: null });
  });

  it('o texto da Zernio nunca chega à resposta', async () => {
    sim.sendMode = '500';
    const response = await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody(), failApp);
    sim.sendMode = 'ok';
    expect(response.body).not.toContain('platform failed');
    expect(response.body).not.toContain('internal_error');
  });
});

describe('privacidade e log do envio', () => {
  it('o log registra a situação e a repetição, nunca o texto, a chave ou o perfil', async () => {
    let captured = '';
    const logStream = new Writable({ write(chunk: Buffer, _encoding, done) { captured += chunk.toString(); done(); } });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info', INBOX_SOCIAL_SEND_ENABLED: 'true' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url, publishTimeoutMs: 1500 }) });
    await logged.ready();
    await call('POST', SOCIAL_SEND_PATH, ownerA, sendBody({ text: SECRET_TEXT }), logged);
    await logged.close();
    expect(captured).toContain('inbox.social.envio');
    for (const secret of [SECRET_TEXT, KEY_A, profileA]) expect(captured).not.toContain(secret);
  });
});

