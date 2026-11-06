import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INBOX_SOCIAL_CONVERSATIONS_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  ZERNIO_KEY_PATH,
  problemDetailsSchema,
  socialInboxConversationsResponseSchema,
  socialInboxMessagesPath,
  socialInboxMessagesResponseSchema,
} from '@disparazap/contracts';
import { members, sessions, users, zernioConnections } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createZernioClient } from '../integrations/zernio-client.ts';
import { createServices, type ApiServices } from '../services.ts';
import { ZernioSimulator, type SimAccount, type SimInboxThread } from '../testing/zernio-simulator.ts';

// Tudo fictício: Zernio simulada, banco em memória, textos de teste que não existem em lugar nenhum
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const KEY_A = `sk_${'a1'.repeat(32)}`;
const KEY_B = `sk_${'b2'.repeat(32)}`;
const SECRET_TEXT = 'Texto secreto de teste que nunca pode aparecer no log';

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
let address = 0;
let ownerA: string;
let ownerB: string;
let operatorA: string;
let viewerA: string;
let profileA = '';
let profileB = '';
let accountA: SimAccount;
let accountB: SimAccount;
let accountFacebookA: SimAccount;

const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

function call(method: 'GET' | 'POST', url: string, cookie: string | undefined, target: FastifyInstance = app) {
  return target.inject({
    method,
    url,
    remoteAddress: `10.8.0.${++address % 250}`,
    headers: { origin: PANEL, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(method === 'POST' ? { payload: {} } : {}),
  });
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const created = await app.inject({ method: 'POST', url: SIGNUP_PATH, remoteAddress: `10.8.1.${++address % 250}`, headers: { origin: PANEL, 'content-type': 'application/json' }, payload: { name: `Dono ${name}`, companyName: name, email, password: PASSWORD } });
  expect(created.statusCode).toBe(201);
  return cookieOf(created);
}

/** Pessoa com outro papel na empresa do dono */
async function memberOf(ownerName: string, role: 'viewer' | 'operator') {
  const cookie = await signupCompany(`Pessoa ${role}`);
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [membership] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.name, `Dono Pessoa ${role}`));
  await db.update(members).set({ organizationId: membership?.org ?? '', role }).where(eq(members.userId, user?.id ?? ''));
  await db.update(sessions).set({ activeOrganizationId: membership?.org ?? '' }).where(eq(sessions.userId, user?.id ?? ''));
  return cookie;
}

let accountSeq = 0;
function addAccount(profileId: string, platform: string, username: string): SimAccount {
  const account: SimAccount = { _id: `acc_inbox_${++accountSeq}`, platform, profileId, username, displayName: `Loja ${username}`, profileUrl: `https://social.exemplo.test/${username}`, isActive: true, needsReconnection: false };
  sim.accounts.set(account._id, account);
  return account;
}

/** Mensagens de teste: texto fictício, em ordem de tempo crescente */
function thread(id: string, accountId: string, count: number, text = SECRET_TEXT): SimInboxThread {
  const base = Date.parse('2026-11-01T10:00:00.000Z');
  return {
    id,
    accountId,
    participantName: 'Contato Teste',
    lastMessage: text,
    updatedTime: new Date(base + count * 60_000).toISOString(),
    status: 'active',
    unreadCount: 2,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `${id}_m${index + 1}`,
      direction: index % 2 === 0 ? 'incoming' : 'outgoing',
      message: `${text} ${index + 1}`,
      createdAt: new Date(base + index * 60_000).toISOString(),
    })),
  };
}

const LIST = (accountId: string | null, extra = '') => `${INBOX_SOCIAL_CONVERSATIONS_PATH}${accountId ? `?accountId=${accountId}${extra}` : extra ? `?${extra.slice(1)}` : ''}`;

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  app = await buildApp(config, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  ownerA = await signupCompany('Empresa A');
  ownerB = await signupCompany('Empresa B');
  viewerA = await memberOf('Dono Empresa A', 'viewer');
  operatorA = await memberOf('Dono Empresa A', 'operator');

  const db = services.database.db;
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.8.2.1', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerA }, payload: { apiKey: KEY_A } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.8.2.2', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerB }, payload: { apiKey: KEY_B } })).statusCode).toBe(200);
  const orgOf = async (ownerName: string) => (await db.select({ org: members.organizationId }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(users.name, ownerName)))[0]?.org ?? '';
  const [connA] = await db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa A')));
  const [connB] = await db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa B')));
  profileA = connA?.profileId ?? '';
  profileB = connB?.profileId ?? '';

  accountA = addAccount(profileA, 'instagram', 'lojaa');
  accountFacebookA = addAccount(profileA, 'facebook', 'paginaa');
  accountB = addAccount(profileB, 'instagram', 'lojab');
  sim.inboxThreads.push(thread('conv_a_1', accountA._id, 3), thread('conv_b_1', accountB._id, 3, 'Outra empresa secreta'));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

describe('Inbox: conversas do Instagram (Z2, leitura direta da Zernio)', () => {
  it('sem sessão 401; visualizador recebe 403 sem consultar a Zernio', async () => {
    const before = sim.inboxRequests.length;
    expectProblem(await call('GET', LIST(accountA._id), undefined), 401);
    expectProblem(await call('GET', LIST(accountA._id), viewerA), 403);
    expect(sim.inboxRequests.length).toBe(before);
  });

  it('atendente lê as conversas da conta da própria empresa, com o perfil certo e limite de 50', async () => {
    const response = await call('GET', LIST(accountA._id), operatorA);
    expect(response.statusCode).toBe(200);
    const page = socialInboxConversationsResponseSchema.parse(response.json());
    expect(page.conversations.map((item) => item.id)).toEqual(['conv_a_1']);
    expect(page.conversations[0]).toMatchObject({ platform: 'instagram', accountId: accountA._id, accountName: '@lojaa', contactName: 'Contato Teste', archived: false, unreadCount: 2 });
    expect(sim.inboxRequests.at(-1)).toEqual({ profileId: profileA, limit: '50' });
  });

  it('conta de outra empresa responde 404; conta do Facebook responde 400 (esta etapa lê só o Instagram)', async () => {
    expect(expectProblem(await call('GET', LIST(accountB._id), ownerA), 404).detail).toBe('Conta não encontrada nesta empresa.');
    expect(expectProblem(await call('GET', LIST(accountFacebookA._id), ownerA), 400).detail).toBe('Esta etapa lê conversas só do Instagram e do TikTok.');

  });
  it('TikTok (autorizado em 2026-11-05): lista as conversas da conta TikTok da empresa, mas não lê mensagens nesta etapa', async () => {
    const accountTikTok = addAccount(profileA, 'tiktok', 'lojatt');
    sim.inboxThreads.push({ ...thread('conv_tt_1', accountTikTok._id, 2), platform: 'tiktok' });
    const list = await call('GET', LIST(accountTikTok._id), ownerA);
    expect(list.statusCode).toBe(200);
    const page = socialInboxConversationsResponseSchema.parse(list.json());
    expect(page.conversations.map((item) => item.id)).toEqual(['conv_tt_1']);
    expect(page.conversations[0]).toMatchObject({ platform: 'tiktok', accountId: accountTikTok._id });
    expect(sim.inboxRequests.at(-1)).toEqual({ profileId: profileA, limit: '50' });
    const messages = await call('GET', INBOX_SOCIAL_CONVERSATIONS_PATH + '/conv_tt_1/messages?accountId=' + accountTikTok._id, ownerA);
    expect(expectProblem(messages, 400).detail).toBe('Esta etapa lê só conversas do Instagram.');
  });

  it('sem a conta na consulta: 400 (a Zernio nunca é chamada sem ela)', async () => {
    const before = sim.inboxRequests.length;
    expectProblem(await call('GET', INBOX_SOCIAL_CONVERSATIONS_PATH, ownerA), 400);
    expect(sim.inboxRequests.length).toBe(before);
  });

  it('mensagens em ordem cronológica, com quem escreveu (contato ou empresa) e sem texto de outra conta', async () => {
    const response = await call('GET', `${socialInboxMessagesPath('conv_a_1')}?accountId=${accountA._id}`, operatorA);
    expect(response.statusCode).toBe(200);
    const page = socialInboxMessagesResponseSchema.parse(response.json());
    expect(page.messages.map((item) => item.direction)).toEqual(['incoming', 'outgoing', 'incoming']);
    expect(page.messages.map((item) => item.text)).toEqual([`${SECRET_TEXT} 1`, `${SECRET_TEXT} 2`, `${SECRET_TEXT} 3`]);
    const times = page.messages.map((item) => Date.parse(item.sentAt ?? ''));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(page.messages[0]).toMatchObject({ attachmentTypes: [], id: 'conv_a_1_m1' });
  });

  it('conversa de outra empresa pela conta da própria empresa responde 404', async () => {
    expectProblem(await call('GET', `${socialInboxMessagesPath('conv_b_1')}?accountId=${accountA._id}`, ownerA), 404);
  });

  it('histórico longo: a página traz as 50 mais recentes em ordem e um cursor para as anteriores', async () => {
    sim.inboxThreads.push(thread('conv_a_longa', accountA._id, 120, 'Mensagem longa'));
    const first = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_longa')}?accountId=${accountA._id}`, ownerA)).json());
    expect(first.messages).toHaveLength(50);
    expect(first.messages.at(-1)?.text).toBe('Mensagem longa 120');
    expect(first.messages[0]?.text).toBe('Mensagem longa 71');
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const older = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_longa')}?accountId=${accountA._id}&cursor=${first.nextCursor}`, ownerA)).json());
    expect(older.messages.at(-1)?.text).toBe('Mensagem longa 70');
    expect(older.messages[0]?.text).toBe('Mensagem longa 21');
  });

  it('cursor inválido responde 400 pela validação', async () => {
    expectProblem(await call('GET', `${socialInboxMessagesPath('conv_a_1')}?accountId=${accountA._id}&cursor=`, ownerA), 400);
  });
});

describe('Inbox social: falhas da Zernio viram mensagens fixas', () => {
  const failWith = (status: number, body: Record<string, unknown>) => {
    sim.failRoute = { method: 'GET', path: '/inbox/conversations', status, body };
  };

  it('chave recusada (401): mensagem para trocar a chave, sem o texto da Zernio', async () => {
    failWith(401, { error: 'Invalid API key', type: 'authentication_error', code: 'invalid_credentials' });
    const problem = expectProblem(await call('GET', LIST(accountA._id), ownerA), 409);
    expect(problem.detail).toContain('Trocar chave');
  });

  it('Inbox não liberada (403): mensagem de plano/complemento, com o código da Zernio fora do texto', async () => {
    failWith(403, { error: 'Inbox addon required', type: 'permission_error', code: 'feature_not_available' });
    const problem = expectProblem(await call('GET', LIST(accountA._id), ownerA), 403);
    expect(problem.detail).toContain('não liberou a Inbox');
    expect(JSON.stringify(problem)).not.toContain('addon');
  });

  it('limite da Zernio (429): pede uma pausa', async () => {
    failWith(429, { error: 'Too many', type: 'rate_limit_error', code: 'rate_limited' });
    expect(expectProblem(await call('GET', LIST(accountA._id), ownerA), 429).detail).toContain('pausa');
  });

  it('erro do servidor (500) e resposta fora do formato: mensagem geral, 502', async () => {
    failWith(500, { error: 'Internal', type: 'api_error', code: 'internal_error' });
    expect(expectProblem(await call('GET', LIST(accountA._id), ownerA), 502).detail).toContain('não previsto');
    sim.inboxMode = 'odd';
    expect(expectProblem(await call('GET', LIST(accountA._id), ownerA), 502).detail).toContain('não previsto');
    sim.inboxMode = 'ok';
  });
});

describe('Inbox social: privacidade no log', () => {
  it('o log registra só a ação e a quantidade; nem chave, perfil, nem texto de mensagem', async () => {
    let captured = '';
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        captured += chunk.toString();
        done();
      },
    });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await logged.ready();
    expect((await call('GET', `${socialInboxMessagesPath('conv_a_1')}?accountId=${accountA._id}`, ownerA, logged)).statusCode).toBe(200);
    expect((await call('GET', LIST(accountA._id), ownerA, logged)).statusCode).toBe(200);
    expect(captured).toContain('inbox.social.mensagens');
    expect(captured).toContain('inbox.social.conversas');
    // O caminho da requisição (com o id opaco da conversa) segue o padrão das outras rotas; texto, chave e perfil não
    for (const secret of [SECRET_TEXT, KEY_A, profileA]) expect(captured).not.toContain(secret);
    await logged.close();
  });
});

describe('Inbox social: registros inconsistentes são descartados (Z2.2)', () => {
  it('a lista só traz conversas do Instagram da conta pedida; o que não bate sai, e o identificador nunca é trocado', async () => {
    const tiktok = { ...thread('conv_a_tiktok', accountA._id, 1), platform: 'tiktok' };
    const leakOfB = thread('conv_b_leak', accountB._id, 1);
    sim.inboxThreads.push(tiktok, leakOfB);
    sim.leakInboxThreads = true;
    try {
      const page = socialInboxConversationsResponseSchema.parse((await call('GET', LIST(accountA._id), ownerA)).json());
      const ids = page.conversations.map((item) => item.id);
      expect(ids).toContain('conv_a_1');
      expect(ids).not.toContain('conv_a_tiktok');
      expect(ids).not.toContain('conv_b_leak');
      expect(ids).not.toContain('conv_b_1');
      expect(page.conversations.every((item) => item.accountId === accountA._id && item.platform === 'instagram')).toBe(true);
    } finally {
      sim.leakInboxThreads = false;
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(tiktok), 1);
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(leakOfB), 1);
    }
  });
});

describe('Inbox social: conteúdo das mensagens (Z2.3)', () => {
  it('anexos aparecem pelo tipo; mensagem só com anexo não ganha texto inventado; tipo desconhecido vira "não suportado"', async () => {
    const withMedia: SimInboxThread = {
      id: 'conv_a_midia',
      accountId: accountA._id,
      participantName: 'Contato Mídia',
      lastMessage: null,
      updatedTime: '2026-11-02T09:06:00.000Z',
      status: 'active',
      unreadCount: 0,
      messages: [
        { id: 'mi_1', direction: 'incoming', message: null, createdAt: '2026-11-02T09:00:00.000Z', attachments: [{ type: 'image' }] },
        { id: 'mi_2', direction: 'incoming', message: 'Veja isto', createdAt: '2026-11-02T09:01:00.000Z', attachments: [{ type: 'video' }, { type: 'hologram' }] },
        { id: 'mi_3', direction: 'outgoing', message: null, createdAt: '2026-11-02T09:02:00.000Z', attachments: [{ type: 'sticker' }] },
        { id: 'mi_4', direction: 'incoming', message: null, createdAt: '2026-11-02T09:03:00.000Z', attachments: [] },
      ],
    };
    sim.inboxThreads.push(withMedia);
    try {
      const page = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_midia')}?accountId=${accountA._id}`, ownerA)).json());
      expect(page.messages.map((item) => item.attachmentTypes)).toEqual([['image'], ['video', 'unsupported_type'], ['sticker'], []]);
      expect(page.messages[0]?.text).toBeNull();
      expect(page.messages[1]?.text).toBe('Veja isto');
      expect(page.messages[3]?.text).toBeNull();
      expect(page.sortOrderApplied).toBe('desc');
    } finally {
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(withMedia), 1);
    }
  });

  it('ordem pelo horário de envio: a página chega fora de ordem e a tela mostra em ordem cronológica', async () => {
    const shuffled: SimInboxThread = {
      id: 'conv_a_fora',
      accountId: accountA._id,
      participantName: 'Contato Fora de Ordem',
      lastMessage: null,
      updatedTime: '2026-11-02T09:06:00.000Z',
      status: 'active',
      unreadCount: 0,
      messages: [
        { id: 'f_3', direction: 'incoming', message: 'terceira', createdAt: '2026-11-02T09:03:00.000Z' },
        { id: 'f_1', direction: 'incoming', message: 'primeira', createdAt: '2026-11-02T09:01:00.000Z' },
        { id: 'f_2', direction: 'outgoing', message: 'segunda', createdAt: '2026-11-02T09:02:00.000Z' },
      ],
    };
    sim.inboxThreads.push(shuffled);
    try {
      const page = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_fora')}?accountId=${accountA._id}`, ownerA)).json());
      expect(page.messages.map((item) => item.text)).toEqual(['primeira', 'segunda', 'terceira']);
    } finally {
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(shuffled), 1);
    }
  });
});

describe('Diagnóstico temporário das datas (Z2.4)', () => {
  const DIAG = '/api/internal/inbox/social/diagnostico-datas';
  const post = (cookie: string | undefined, payload: object, target: FastifyInstance = app) =>
    target.inject({ method: 'POST', url: DIAG, remoteAddress: `10.8.3.${++address % 250}`, headers: { origin: PANEL, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, payload });

  it('só dono e administradores; atendente recebe 403', async () => {
    expectProblem(await post(operatorA, { accountId: accountA._id, conversationId: 'conv_a_1' }), 403);
    expectProblem(await post(undefined, { accountId: accountA._id, conversationId: 'conv_a_1' }), 401);
  });

  it('lê no máximo 10 mensagens, sem nenhum texto, e informa datas, campos e ordem', async () => {
    const long = thread('conv_a_diag', accountA._id, 25);
    sim.inboxThreads.push(long);
    try {
      const response = await post(ownerA, { accountId: accountA._id, conversationId: 'conv_a_diag' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.readCount).toBe(10);
      expect(body.hasMore).toBe(true);
      expect(body.sortOrderApplied).toBe('desc');
      expect(body.messages).toHaveLength(10);
      expect(body.messages[0]).toHaveProperty('hasText', true);
      expect(body.messages[0]).not.toHaveProperty('text');
      expect(body.orderMatchesSentAt).toBe(true);
      expect(body.orderMatchesCreatedAt).toBe(true);
      expect(response.body).not.toContain(SECRET_TEXT);
      expect(response.body).not.toContain(KEY_A);
    } finally {
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(long), 1);
    }
  });

  it('mensagem só com anexo aparece como sem texto e com o tipo; diferença entre sentAt e createdAt é informada', async () => {
    const media: SimInboxThread = {
      id: 'conv_a_diag_midia',
      accountId: accountA._id,
      participantName: 'Contato',
      lastMessage: null,
      updatedTime: '2026-11-02T09:06:00.000Z',
      status: 'active',
      unreadCount: 0,
      messages: [
        { id: 'dm_1', direction: 'incoming', message: null, createdAt: '2026-11-02T09:00:00.000Z', attachments: [{ type: 'image' }] },
        { id: 'dm_2', direction: 'outgoing', message: 'Oi', createdAt: '2026-11-02T09:01:00.000Z' },
      ],
    };
    sim.inboxThreads.push(media);
    try {
      const body = (await post(ownerA, { accountId: accountA._id, conversationId: 'conv_a_diag_midia' })).json();
      expect(body.messages[0]).toMatchObject({ direction: 'outgoing', hasText: true, attachmentTypes: [] });
      expect(body.messages[1]).toMatchObject({ direction: 'incoming', hasText: false, attachmentTypes: ['image'] });
      expect(body.lastIncoming).toMatchObject({ createdAt: '2026-11-02T09:00:00.000Z' });
    } finally {
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(media), 1);
    }
  });

  it('conversa de outra empresa pela conta própria responde 404', async () => {
    expectProblem(await post(ownerA, { accountId: accountA._id, conversationId: 'conv_b_1' }), 404);
  });

  it('o log registra só a contagem e a ordem, sem texto', async () => {
    let captured = '';
    const logStream = new Writable({ write(chunk: Buffer, _e, done) { captured += chunk.toString(); done(); } });
    const logged = await buildApp(loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info' }), { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await logged.ready();
    expect((await post(ownerA, { accountId: accountA._id, conversationId: 'conv_a_1' }, logged)).statusCode).toBe(200);
    expect(captured).toContain('inbox.social.diagnostico_datas');
    for (const secret of [SECRET_TEXT, KEY_A, profileA]) expect(captured).not.toContain(secret);
    await logged.close();
  });
});

describe('Auditoria Z3: ordem e paginação do histórico (respostas simuladas)', () => {
  it('H0, a Zernio respeita sortOrder=desc: a página traz as 50 mais recentes e "ver anteriores" traz as mais antigas', async () => {
    const big = thread('conv_a_ord', accountA._id, 120, 'Ordem');
    sim.inboxThreads.push(big);
    try {
      const first = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_ord')}?accountId=${accountA._id}`, ownerA)).json());
      expect(first.sortOrderApplied).toBe('desc');
      expect(first.historyReliable).toBe(true);
      expect(first.messages.at(-1)?.text).toBe('Ordem 120');
      const older = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_ord')}?accountId=${accountA._id}&cursor=${first.nextCursor}`, ownerA)).json());
      expect(Date.parse(older.messages.at(-1)?.sentAt ?? '')).toBeLessThan(Date.parse(first.messages[0]?.sentAt ?? ''));
    } finally {
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(big), 1);
    }
  });

  it('H1, a Zernio ignora sortOrder=desc: a página vem com as mais antigas e sortOrderApplied=asc (a tela precisa avisar)', async () => {
    const big = thread('conv_a_ord2', accountA._id, 120, 'Ordem');
    sim.inboxThreads.push(big);
    sim.ignoreSortOrder = true;
    try {
      const page = socialInboxMessagesResponseSchema.parse((await call('GET', `${socialInboxMessagesPath('conv_a_ord2')}?accountId=${accountA._id}`, ownerA)).json());
      expect(page.sortOrderApplied).toBe('asc');
      // Sem confirmação da ordem, o histórico não serve para a janela de resposta
      expect(page.historyReliable).toBe(false);
      // Resultado observado: a página mostra as 50 mais antigas. Sem o aviso, a tela parece completa.
      expect(page.messages[0]?.text).toBe('Ordem 1');
      expect(page.messages.at(-1)?.text).toBe('Ordem 50');
      expect(page.hasMore).toBe(true);
    } finally {
      sim.ignoreSortOrder = false;
      sim.inboxThreads.splice(sim.inboxThreads.indexOf(big), 1);
    }
  });
});
