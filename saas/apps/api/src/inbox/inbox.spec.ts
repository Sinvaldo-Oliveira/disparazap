import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EVOLUTION_SETTINGS_PATH,
  INBOX_CHANNELS_PATH,
  INBOX_CONVERSATIONS_PATH,
  INBOX_STREAM_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  WHATSAPP_INSTANCES_PATH,
  inboxActivationPath,
  inboxChannelsResponseSchema,
  inboxConversationDetailSchema,
  inboxConversationPath,
  inboxConversationsResponseSchema,
  inboxMessagesPath,
  inboxReadPath,
  inboxSendResultSchema,
  inboxStreamEventSchema,
  problemDetailsSchema,
  whatsappInstancePath,
  whatsappInstanceSchema,
  type InboxStreamEvent,
} from '@disparazap/contracts';
import { inboxContacts, inboxConversationEvents, inboxConversations, inboxMessages, members, sessions, users } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createServices, type ApiServices } from '../services.ts';
import { EvolutionSimulator } from '../testing/evolution-simulator.ts';
import type { EvolutionEventStream } from './evolution-events.ts';
import { ingestEvolutionEvent } from './inbox-ingest.ts';
import { ACTIVATION_LOCKED, canDeliverAutomated } from './inbox-service.ts';

// Tudo fictício: Evolution Go simulada nesta máquina (com WebSocket), banco em memória, números de exemplo
vi.setConfig({ testTimeout: 20_000 });

const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const GLOBAL_KEY = 'chave-global-ficticia-INBOX1';
const NEW_GLOBAL_KEY = 'chave-global-ficticia-INBOX2';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const CONTACT_1 = '5511900000001';
const CONTACT_2 = '5511900000002';
const CONTACT_3 = '5511900000003';
const OWN_A = '5511955550001';
const OWN_B = '5511955550002';

const baseEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
};
// A plataforma depois da homologação (chaves ligadas) e a plataforma de hoje (padrão: tudo desligado)
const config = loadApiConfig({ ...baseEnv, LOG_LEVEL: 'info', INBOX_EVENTS_ENABLED: 'true', INBOX_ACTIVATION_ENABLED: 'true' });
const lockedConfig = loadApiConfig({ ...baseEnv, LOG_LEVEL: 'silent' });

const sim = new EvolutionSimulator(GLOBAL_KEY);
let services: ApiServices;
let app: FastifyInstance;
let lockedApp: FastifyInstance;
let stream: EvolutionEventStream;
let base = '';
let logs = '';

let superCookie: string;
let ownerA: string;
let ownerB: string;
let operatorA: string;
let viewerA: string;
let orgA: string;
let orgB: string;
let accountA: string;
let accountB: string;
let simNameA: string;
let simNameB: string;
let conversation1: string;
let conversation2: string;
let firstReplyId: string;
let firstRequestId: string;

let address = 0;
const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const db = () => services.database.db;

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, payload?: object, target: FastifyInstance = app, origin = PANEL) {
  const body = payload ?? (method === 'POST' || method === 'PUT' ? {} : undefined);
  return target.inject({
    method,
    url,
    remoteAddress: `10.7.0.${++address % 250}`,
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { payload: body } : {}),
  });
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const response = await call('POST', SIGNUP_PATH, undefined, { name: `Dono ${name}`, companyName: name, email, password: PASSWORD });
  expect(response.statusCode).toBe(201);
  const [user] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  const [membership] = await db().select({ org: members.organizationId }).from(members).where(eq(members.userId, user?.id ?? ''));
  return { cookie: cookieOf(response), userId: user?.id ?? '', organizationId: membership?.org ?? '' };
}

/** Conta própria movida para outra empresa com outro papel (atendente, visualizador) */
async function joinAs(name: string, organizationId: string, role: 'operator' | 'viewer') {
  const person = await signupCompany(name);
  await db().update(members).set({ organizationId, role }).where(eq(members.userId, person.userId));
  await db().update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.userId, person.userId));
  return person.cookie;
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('tempo esgotado esperando a condição');
    await sleep(20);
  }
}

/** Instância criada e conectada pelo módulo WhatsApp (o mesmo caminho do painel) */
async function connectedInstance(cookie: string, displayName: string, phone: string) {
  const known = new Set(sim.instances.keys());
  const created = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, cookie, { displayName })).json());
  const simInstance = [...sim.instances.values()].find((item) => !known.has(item.id));
  expect((await call('POST', `${whatsappInstancePath(created.id)}/connect`, cookie)).statusCode).toBe(200);
  sim.scan(simInstance?.name ?? '', phone);
  expect((await call('GET', `${whatsappInstancePath(created.id)}/status`, cookie)).json()).toMatchObject({ status: 'connected' });
  return { id: created.id, simName: simInstance?.name ?? '' };
}

const jid = (phone: string) => `${phone}@s.whatsapp.net`;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Message/SendMessage no formato do whatsmeow que a Evolution repassa */
function messageEvent(input: { id: string; phone: string; text?: string; fromMe?: boolean; at?: string; pushName?: string; message?: Record<string, unknown>; chat?: string; isGroup?: boolean }) {
  const own = jid(OWN_A);
  return {
    Info: {
      ID: input.id,
      Chat: input.chat ?? jid(input.phone),
      Sender: input.fromMe ? own : jid(input.phone),
      IsFromMe: input.fromMe ?? false,
      IsGroup: input.isGroup ?? false,
      Timestamp: input.at ?? new Date().toISOString(),
      PushName: input.fromMe ? '' : (input.pushName ?? 'Cliente Um'),
    },
    Message: input.message ?? { conversation: input.text ?? '' },
  };
}

/** Evento entregue pela Evolution simulada e já processado pela API */
async function deliver(name: string, event: string, data: unknown, options: Parameters<EvolutionSimulator['emit']>[3] = {}) {
  const before = stream.stats.received;
  expect(sim.emit(name, event, data, options)).toBe(1);
  await waitFor(() => stream.stats.received > before);
  await stream.idle();
}

async function conversationsOf(cookie: string, query = '') {
  return inboxConversationsResponseSchema.parse((await call('GET', `${INBOX_CONVERSATIONS_PATH}${query}`, cookie)).json()).conversations;
}

async function detailOf(cookie: string, id: string) {
  return inboxConversationDetailSchema.parse((await call('GET', inboxConversationPath(id), cookie)).json());
}

async function channelsOf(cookie: string, target: FastifyInstance = app) {
  return inboxChannelsResponseSchema.parse((await call('GET', INBOX_CHANNELS_PATH, cookie, undefined, target)).json());
}

async function externalIdOf(messageId: string) {
  const [row] = await db().select({ externalId: inboxMessages.externalId }).from(inboxMessages).where(eq(inboxMessages.id, messageId));
  return row?.externalId ?? '';
}

/** Canal em tempo real aberto como o navegador abriria (EventSource) */
async function openStream(cookie: string | undefined) {
  const controller = new AbortController();
  const response = await fetch(`${base}${INBOX_STREAM_PATH}`, { headers: cookie ? { cookie } : {}, signal: controller.signal });
  const state = { events: [] as InboxStreamEvent[], raw: '', pings: 0, ended: false };
  if (response.ok && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          state.raw += text;
          pending += text;
          let index = pending.indexOf('\n\n');
          while (index >= 0) {
            const block = pending.slice(0, index);
            pending = pending.slice(index + 2);
            if (block.startsWith(':')) state.pings += 1;
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (data) state.events.push(inboxStreamEventSchema.parse(JSON.parse(data)));
            index = pending.indexOf('\n\n');
          }
        }
      } catch {
        // Fechado pelo teste
      }
      state.ended = true;
    })();
  }
  return { status: response.status, headers: response.headers, state, close: () => controller.abort() };
}

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  app = await buildApp(config, {
    services,
    logStream,
    inbox: {
      stream: { reconnectMinMs: 50, reconnectMaxMs: 200, refreshMs: 100, ws: { pingIntervalMs: 150, pongTimeoutMs: 2000, connectTimeoutMs: 3000 } },
      streamHeartbeatMs: 100,
      streamMaxAgeMs: 2500,
      onStream: (created) => {
        stream = created;
      },
    },
  });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  lockedApp = await buildApp(lockedConfig, { services });
  await lockedApp.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, undefined, { email: SUPER_ADMIN_EMAIL, password: PASSWORD }));
  const a = await signupCompany('Empresa A');
  const b = await signupCompany('Empresa B');
  ownerA = a.cookie;
  ownerB = b.cookie;
  orgA = a.organizationId;
  orgB = b.organizationId;
  operatorA = await joinAs('Atendente', orgA, 'operator');
  viewerA = await joinAs('Visitante', orgA, 'viewer');

  // Integração global configurada pelo Super-Admin; cada empresa conecta o seu número pelo módulo WhatsApp
  const saved = await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active', apiKey: GLOBAL_KEY });
  expect(saved.statusCode).toBe(200);
  ({ id: accountA, simName: simNameA } = await connectedInstance(ownerA, 'Atendimento', OWN_A));
  ({ id: accountB, simName: simNameB } = await connectedInstance(ownerB, 'Loja B', OWN_B));
}, 120_000);

afterAll(async () => {
  await app?.close();
  await lockedApp?.close();
  await services?.database.close();
  await sim.stop();
});

describe('antes da homologação (configuração padrão)', () => {
  it('com as chaves desligadas, a Inbox mostra o recebimento desligado e o botão não liga nada', async () => {
    const channels = await channelsOf(ownerA, lockedApp);
    expect(channels.reception).toEqual({ state: 'disabled', since: null });
    expect(channels.activationAvailable).toBe(false);
    expect(channels.canManage).toBe(true);
    expect(channels.channels).toEqual([expect.objectContaining({ id: accountA, type: 'whatsapp', name: 'Atendimento', connected: true, inboxEnabledAt: null, unreadCount: 0 })]);

    const calls = sim.connectCalls.length;
    expect(expectProblem(await call('POST', inboxActivationPath(accountA), ownerA, undefined, lockedApp), 409).detail).toBe(ACTIVATION_LOCKED);
    expect(sim.connectCalls).toHaveLength(calls);
  });

  it('conectar o número pelo módulo WhatsApp não liga os eventos (corpo vazio, como sempre)', () => {
    expect(sim.connectCalls.filter((item) => item.instance === simNameA).every((item) => Object.keys(item.body).length === 0)).toBe(true);
    expect(sim.byName(simNameA)?.websocket).toBe(false);
    expect(sim.byName(simNameB)?.websocket).toBe(false);
  });

  it('o consumidor conecta só com a chave global e descarta eventos de instâncias sem a Inbox ligada', async () => {
    await waitFor(() => stream.state === 'connected');
    expect(sim.ws.accepted).toBe(1);
    expect(sim.ws.rejected).toBe(0);
    // A Evolution nem entrega (WebSocket desligado na instância)...
    expect(sim.emit(simNameA, 'Message', messageEvent({ id: 'ANTES-0', phone: CONTACT_1, text: 'nao entregue' }))).toBe(0);
    // ...e, se entregasse (ligado por fora do DisparaZap), o evento seria descartado antes de gravar
    const dropped = stream.stats.dropped;
    await deliver(simNameA, 'Message', messageEvent({ id: 'ANTES-1', phone: CONTACT_1, text: 'antes de ligar' }), { force: true });
    expect(stream.stats.dropped).toBe(dropped + 1);
    expect(await db().select().from(inboxMessages)).toEqual([]);
    expect(await db().select().from(inboxContacts)).toEqual([]);
  });
});

describe('ligar o recebimento ("Receber mensagens na Inbox")', () => {
  it('sem sessão 401; visualizador não usa a Inbox; atendente não liga o recebimento', async () => {
    expectProblem(await call('GET', INBOX_CHANNELS_PATH, undefined), 401);
    expectProblem(await call('GET', INBOX_CHANNELS_PATH, viewerA), 403);
    expectProblem(await call('POST', inboxActivationPath(accountA), viewerA), 403);
    expectProblem(await call('POST', inboxActivationPath(accountA), operatorA), 403);
    expect((await channelsOf(operatorA)).canManage).toBe(false);
  });

  it('outra empresa não liga o recebimento na instância da Empresa A', async () => {
    const calls = sim.connectCalls.length;
    expectProblem(await call('POST', inboxActivationPath(accountA), ownerB), 404);
    expect(sim.connectCalls).toHaveLength(calls);
  });

  it('o dono liga: só a instância dele recebe a configuração de eventos, sem desconectar', async () => {
    const response = await call('POST', inboxActivationPath(accountA), ownerA);
    expect(response.statusCode).toBe(200);
    const channels = inboxChannelsResponseSchema.parse(response.json());
    expect(channels.channels[0]?.inboxEnabledAt).not.toBeNull();
    expect(channels.reception.state).toBe('connected');
    expect(sim.connectCalls.at(-1)).toEqual({ instance: simNameA, body: { subscribe: ['MESSAGE', 'SEND_MESSAGE', 'READ_RECEIPT', 'CONNECTION'], websocketEnable: 'enabled' } });
    expect(sim.byName(simNameA)).toMatchObject({ websocket: true, state: 'connected' });
    expect(sim.byName(simNameB)?.websocket).toBe(false);
    expect(response.body).not.toContain(GLOBAL_KEY);
    expect(response.body).not.toContain(sim.byName(simNameA)?.token ?? '§');
  });

  it('reconectar o número pelo QR Code mantém o recebimento ligado', async () => {
    await call('POST', `${whatsappInstancePath(accountA)}/connect`, ownerA);
    expect(sim.connectCalls.at(-1)).toMatchObject({ instance: simNameA, body: { websocketEnable: 'enabled' } });
    expect((await call('GET', `${whatsappInstancePath(accountA)}/status`, ownerA)).json()).toMatchObject({ status: 'connected' });
  });

  it('a Empresa B liga o dela', async () => {
    expect((await call('POST', inboxActivationPath(accountB), ownerB)).statusCode).toBe(200);
    expect(sim.byName(simNameB)?.websocket).toBe(true);
  });
});

describe('receber mensagens', () => {
  it('mensagem nova do cliente cria contato e conversa na empresa e na conta certas', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'MSG-1', phone: CONTACT_1, text: 'Olá, preciso de ajuda com meu pedido', at: minutesAgo(10) }));
    const list = await conversationsOf(ownerA);
    expect(list).toHaveLength(1);
    conversation1 = list[0]?.id ?? '';
    expect(list[0]).toMatchObject({
      channel: 'whatsapp',
      accountId: accountA,
      accountName: 'Atendimento',
      contact: { name: 'Cliente Um', phone: CONTACT_1 },
      status: 'open',
      controlMode: 'human',
      controlVersion: 0,
      assignedTo: null,
      unreadCount: 1,
      lastMessagePreview: 'Olá, preciso de ajuda com meu pedido',
      lastMessageDirection: 'inbound',
    });
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.canSend).toBe(true);
    expect(detail.messages).toEqual([
      expect.objectContaining({ direction: 'inbound', author: 'contact', authorName: null, contentType: 'text', text: 'Olá, preciso de ajuda com meu pedido', status: 'received', error: null }),
    ]);
    expect((await channelsOf(ownerA)).channels[0]?.unreadCount).toBe(1);
  });

  it('evento repetido não duplica a mensagem', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'MSG-1', phone: CONTACT_1, text: 'Olá, preciso de ajuda com meu pedido', at: minutesAgo(10) }));
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.messages).toHaveLength(1);
    expect(detail.conversation.unreadCount).toBe(1);
  });

  it('fora de ordem: a mensagem mais antiga entra no lugar certo e não troca a prévia', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'MSG-2', phone: CONTACT_1, text: 'É o pedido 123', at: minutesAgo(5) }));
    await deliver(simNameA, 'Message', messageEvent({ id: 'MSG-0', phone: CONTACT_1, text: 'Bom dia', at: minutesAgo(20) }));
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.messages.map((item) => item.text)).toEqual(['Bom dia', 'Olá, preciso de ajuda com meu pedido', 'É o pedido 123']);
    expect(detail.conversation).toMatchObject({ lastMessagePreview: 'É o pedido 123', unreadCount: 3 });
  });

  it('mensagem digitada no celular do número aparece como enviada pelo celular', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'CEL-1', phone: CONTACT_1, text: 'Já vou verificar', fromMe: true, at: minutesAgo(4) }));
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.messages.at(-1)).toMatchObject({ direction: 'outbound', author: 'phone', text: 'Já vou verificar', status: 'sent' });
    expect(detail.conversation).toMatchObject({ lastMessagePreview: 'Já vou verificar', lastMessageDirection: 'outbound', unreadCount: 3 });
  });

  it('mídia: registra só o tipo e a legenda, nunca o arquivo', async () => {
    const base64 = 'SU1BR0VNLVNJTVVMQURBLURP';
    await deliver(simNameA, 'Message', messageEvent({ id: 'IMG-1', phone: CONTACT_1, at: minutesAgo(3), message: { imageMessage: { caption: 'foto do produto', mimetype: 'image/jpeg' }, base64 } }));
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.messages.at(-1)).toMatchObject({ contentType: 'media', mediaKind: 'image', text: 'foto do produto' });
    expect(JSON.stringify(await db().select().from(inboxMessages))).not.toContain(base64);
  });

  it('grupos e mensagens de controle (reação) ficam de fora', async () => {
    const before = (await db().select().from(inboxMessages)).length;
    await deliver(simNameA, 'Message', messageEvent({ id: 'GRP-1', phone: CONTACT_2, text: 'mensagem de grupo', chat: '120363000000000000@g.us', isGroup: true }));
    await deliver(simNameA, 'Message', messageEvent({ id: 'REA-1', phone: CONTACT_1, message: { reactionMessage: { text: '👍' } } }));
    expect(await db().select().from(inboxMessages)).toHaveLength(before);
  });

  it('lida no celular (ReadSelf) zera as não lidas; ler no painel também', async () => {
    await deliver(simNameA, 'Receipt', { MessageIDs: ['MSG-2'], Chat: jid(CONTACT_1), Sender: jid(OWN_A), IsFromMe: true }, { state: 'ReadSelf' });
    expect((await detailOf(ownerA, conversation1)).conversation.unreadCount).toBe(0);

    await deliver(simNameA, 'Message', messageEvent({ id: 'MSG-3', phone: CONTACT_1, text: 'Alguma novidade?', at: minutesAgo(2) }));
    expect((await detailOf(ownerA, conversation1)).conversation.unreadCount).toBe(1);
    expect((await call('POST', inboxReadPath(conversation1), ownerA)).statusCode).toBe(200);
    expect((await detailOf(ownerA, conversation1)).conversation.unreadCount).toBe(0);
  });

  it('filtros: não lidas, busca por nome e por número, por conta', async () => {
    expect(await conversationsOf(ownerA, '?filter=unread')).toEqual([]);
    expect((await conversationsOf(ownerA, '?search=cliente')).map((item) => item.id)).toEqual([conversation1]);
    expect((await conversationsOf(ownerA, '?search=00000001')).map((item) => item.id)).toEqual([conversation1]);
    expect(await conversationsOf(ownerA, '?search=ninguem')).toEqual([]);
    expect((await conversationsOf(ownerA, `?accountId=${accountA}&channel=whatsapp`)).map((item) => item.id)).toEqual([conversation1]);
    expectProblem(await call('GET', `${INBOX_CONVERSATIONS_PATH}?filter=qualquer`, ownerA), 400);
  });
});

describe('isolamento entre empresas', () => {
  it('evento da instância da Empresa B fica só na Empresa B', async () => {
    await deliver(simNameB, 'Message', messageEvent({ id: 'B-1', phone: CONTACT_1, text: 'mensagem para a loja B', pushName: 'Cliente Um' }));
    const listB = await conversationsOf(ownerB);
    expect(listB).toHaveLength(1);
    expect(listB[0]).toMatchObject({ accountId: accountB, contact: { phone: CONTACT_1 }, lastMessagePreview: 'mensagem para a loja B' });
    expect(listB[0]?.id).not.toBe(conversation1);
    expect((await conversationsOf(ownerA)).map((item) => item.id)).toEqual([conversation1]);
  });

  it('conversa de outra empresa responde 404 em todas as rotas, sem enviar nada', async () => {
    const sent = sim.sent.length;
    expectProblem(await call('GET', inboxConversationPath(conversation1), ownerB), 404);
    expectProblem(await call('POST', inboxReadPath(conversation1), ownerB), 404);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), ownerB, { requestId: randomUUID(), text: 'tentativa' }), 404);
    expect(sim.sent).toHaveLength(sent);
    expect(await conversationsOf(ownerB, `?accountId=${accountA}`)).toEqual([]);
  });
});

describe('eventos descartados antes de gravar ou avisar', () => {
  it('instância desconhecida (de fora do DisparaZap, como as do MVP) é descartada', async () => {
    sim.instances.set('fora-1', { id: 'fora-1', name: 'vendas-mvp', token: 'token-de-fora', state: 'connected', phone: null, websocket: true, subscribe: ['MESSAGE'] });
    const dropped = stream.stats.dropped;
    await deliver('vendas-mvp', 'Message', messageEvent({ id: 'FORA-1', phone: CONTACT_3, text: 'mensagem de outra instância' }));
    expect(stream.stats.dropped).toBe(dropped + 1);
    expect(await db().select().from(inboxContacts).where(eq(inboxContacts.phoneE164, CONTACT_3))).toEqual([]);
    sim.instances.delete('fora-1');
  });

  it('token da instância diferente do cofre: descartado', async () => {
    const rejected = stream.stats.rejectedToken;
    await deliver(simNameA, 'Message', messageEvent({ id: 'FALSO-1', phone: CONTACT_3, text: 'evento adulterado' }), { instanceToken: 'token-adulterado' });
    expect(stream.stats.rejectedToken).toBe(rejected + 1);
    expect(await db().select().from(inboxMessages).where(eq(inboxMessages.externalId, 'FALSO-1'))).toEqual([]);
  });

  it('mensagem inválida não derruba o recebimento', async () => {
    const received = stream.stats.received;
    const invalid = stream.stats.invalid;
    sim.emitRaw('isto não é JSON');
    sim.emitRaw(JSON.stringify({ queue: 'x', payload: '{"event":' }));
    await waitFor(() => stream.stats.received >= received + 2);
    await stream.idle();
    expect(stream.stats.invalid).toBe(invalid + 2);
    expect(stream.state).toBe('connected');
  });
});

describe('responder pela Inbox', () => {
  it('a resposta sai pela instância da conversa e a conversa passa a ser de quem respondeu', async () => {
    firstRequestId = randomUUID();
    const response = await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: firstRequestId, text: '  Oi! Vou verificar seu pedido agora.  ' });
    expect(response.statusCode).toBe(201);
    const result = inboxSendResultSchema.parse(response.json());
    firstReplyId = result.message.id;
    expect(result).toMatchObject({ replayed: false, message: { direction: 'outbound', author: 'user', authorName: 'Dono Empresa A', text: 'Oi! Vou verificar seu pedido agora.', status: 'sent', error: null } });
    expect(sim.sent.at(-1)).toEqual({ instance: simNameA, number: CONTACT_1, text: 'Oi! Vou verificar seu pedido agora.' });
    expect(await externalIdOf(firstReplyId)).toMatch(/^3EB0/);
    expect(response.body).not.toContain(await externalIdOf(firstReplyId));
    const detail = await detailOf(ownerA, conversation1);
    expect(detail.conversation).toMatchObject({ assignedTo: { name: 'Dono Empresa A' }, controlMode: 'human', lastMessagePreview: 'Oi! Vou verificar seu pedido agora.', lastMessageDirection: 'outbound' });
  });

  it('o mesmo pedido repetido não envia de novo', async () => {
    const sent = sim.sent.length;
    const response = await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: firstRequestId, text: 'Oi! Vou verificar seu pedido agora.' });
    expect(response.statusCode).toBe(200);
    expect(inboxSendResultSchema.parse(response.json())).toMatchObject({ replayed: true, message: { id: firstReplyId } });
    expect(sim.sent).toHaveLength(sent);
  });

  it('dois cliques ao mesmo tempo: uma mensagem só', async () => {
    const sent = sim.sent.length;
    const body = { requestId: randomUUID(), text: 'Resposta enviada uma vez só' };
    const [first, second] = await Promise.all([call('POST', inboxMessagesPath(conversation1), ownerA, body), call('POST', inboxMessagesPath(conversation1), ownerA, body)]);
    const ids = [first, second].map((response) => inboxSendResultSchema.parse(response.json()).message.id);
    expect(ids[0]).toBe(ids[1]);
    expect(sim.sent).toHaveLength(sent + 1);
    expect((await detailOf(ownerA, conversation1)).messages.filter((item) => item.text === body.text)).toHaveLength(1);
  });

  it('o eco do envio (SendMessage) não duplica a mensagem', async () => {
    const externalId = await externalIdOf(firstReplyId);
    await deliver(simNameA, 'SendMessage', messageEvent({ id: externalId, phone: CONTACT_1, text: 'Oi! Vou verificar seu pedido agora.', fromMe: true }));
    const messages = (await detailOf(ownerA, conversation1)).messages;
    expect(messages.filter((item) => item.text === 'Oi! Vou verificar seu pedido agora.')).toHaveLength(1);
    expect(messages.some((item) => item.author === 'api')).toBe(false);
  });

  it('envio feito por outro sistema pela API da Evolution aparece como "api"', async () => {
    await deliver(simNameA, 'SendMessage', messageEvent({ id: 'API-1', phone: CONTACT_1, text: 'Lembrete automático de outro sistema', fromMe: true }));
    expect((await detailOf(ownerA, conversation1)).messages.at(-1)).toMatchObject({ author: 'api', direction: 'outbound', status: 'sent' });
  });

  it('o eco que chega antes da resposta da Evolution confirma a mensagem pendente', async () => {
    const id = randomUUID();
    await db().insert(inboxMessages).values({ id, organizationId: orgA, conversationId: conversation1, direction: 'outbound', author: 'user', clientRequestId: randomUUID(), contentType: 'text', body: 'Texto ainda pendente', status: 'pending', sentAt: new Date() });
    await ingestEvolutionEvent(db(), { organizationId: orgA, accountId: accountA }, { event: 'SendMessage', data: messageEvent({ id: 'ECO-1', phone: CONTACT_1, text: 'Texto ainda pendente', fromMe: true }) });
    const rows = await db().select().from(inboxMessages).where(eq(inboxMessages.externalId, 'ECO-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: 'sent', author: 'user' });
  });

  it('validação: texto vazio, longo demais e pedido sem identificador', async () => {
    const sent = sim.sent.length;
    expectProblem(await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: randomUUID(), text: '   ' }), 400);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: randomUUID(), text: 'x'.repeat(4097) }), 400);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: 'repetir', text: 'oi' }), 400);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: randomUUID(), text: 'oi', extra: true }), 400);
    expect(sim.sent).toHaveLength(sent);
  });

  it('número desconectado: a mensagem fica com falha e o motivo aparece na conversa', async () => {
    sim.drop(simNameA);
    const response = await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: randomUUID(), text: 'Mensagem que não sai' });
    expect(response.statusCode).toBe(201);
    const result = inboxSendResultSchema.parse(response.json());
    expect(result.message.status).toBe('failed');
    expect(result.message.error).toContain('desconectado');
    expect(response.body).not.toContain('no active session');
    sim.scan(simNameA, OWN_A);
    expect((await call('GET', `${whatsappInstancePath(accountA)}/status`, ownerA)).json()).toMatchObject({ status: 'connected' });
  });

  it('pedido vindo de outra origem é recusado', async () => {
    const sent = sim.sent.length;
    expect((await call('POST', inboxMessagesPath(conversation1), ownerA, { requestId: randomUUID(), text: 'oi' }, app, 'https://site-estranho.test')).statusCode).toBe(403);
    expect(sim.sent).toHaveLength(sent);
  });
});

describe('confirmações de entrega e leitura', () => {
  it('entregue e depois lida; um "entregue" atrasado não volta atrás', async () => {
    const externalId = await externalIdOf(firstReplyId);
    const receipt = { MessageIDs: [externalId], Chat: jid(CONTACT_1), Sender: jid(CONTACT_1), IsFromMe: false, Timestamp: new Date().toISOString() };
    const statusOf = async () => (await detailOf(ownerA, conversation1)).messages.find((item) => item.id === firstReplyId)?.status;
    await deliver(simNameA, 'Receipt', receipt, { state: 'Delivered' });
    expect(await statusOf()).toBe('delivered');
    await deliver(simNameA, 'Receipt', receipt, { state: 'Read' });
    expect(await statusOf()).toBe('read');
    await deliver(simNameA, 'Receipt', receipt, { state: 'Delivered' });
    expect(await statusOf()).toBe('read');
  });

  it('confirmação que chega antes da mensagem é aplicada quando ela chega', async () => {
    await deliver(simNameA, 'Receipt', { MessageIDs: ['CEL-2'], Chat: jid(CONTACT_1) }, { state: 'Read' });
    await deliver(simNameA, 'Message', messageEvent({ id: 'CEL-2', phone: CONTACT_1, text: 'Enviado do celular depois', fromMe: true }));
    expect((await detailOf(ownerA, conversation1)).messages.find((item) => item.text === 'Enviado do celular depois')?.status).toBe('read');
  });
});

describe('atendentes e permissões', () => {
  it('o atendente vê a fila sem responsável e não vê a conversa de outro atendente', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'C2-1', phone: CONTACT_2, text: 'Quero um orçamento', pushName: 'Cliente Dois' }));
    const owner = await conversationsOf(ownerA);
    expect(owner).toHaveLength(2);
    const mine = await conversationsOf(operatorA);
    expect(mine).toHaveLength(1);
    conversation2 = mine[0]?.id ?? '';
    expect(mine[0]).toMatchObject({ contact: { name: 'Cliente Dois' }, assignedTo: null });
    expectProblem(await call('GET', inboxConversationPath(conversation1), operatorA), 404);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), operatorA, { requestId: randomUUID(), text: 'não deveria sair' }), 404);
  });

  it('o atendente responde a da fila e ela passa a ser dele', async () => {
    const response = await call('POST', inboxMessagesPath(conversation2), operatorA, { requestId: randomUUID(), text: 'Claro! Qual produto?' });
    expect(response.statusCode).toBe(201);
    expect(inboxSendResultSchema.parse(response.json()).message).toMatchObject({ authorName: 'Dono Atendente', status: 'sent' });
    expect(sim.sent.at(-1)).toMatchObject({ number: CONTACT_2 });
    expect((await detailOf(operatorA, conversation2)).conversation.assignedTo?.name).toBe('Dono Atendente');
    expect((await detailOf(ownerA, conversation2)).conversation.assignedTo?.name).toBe('Dono Atendente');
  });

  it('o visualizador não lê nem envia', async () => {
    expectProblem(await call('GET', INBOX_CONVERSATIONS_PATH, viewerA), 403);
    expectProblem(await call('GET', inboxConversationPath(conversation1), viewerA), 403);
    expectProblem(await call('POST', inboxMessagesPath(conversation1), viewerA, { requestId: randomUUID(), text: 'oi' }), 403);
    expectProblem(await call('POST', inboxReadPath(conversation1), viewerA), 403);
    expectProblem(await call('GET', INBOX_CONVERSATIONS_PATH, undefined), 401);
  });
});

describe('controle do atendimento (preparação para IA e automações)', () => {
  it('quando o humano assume, a versão muda e a resposta automática pendente não pode sair', async () => {
    await db().update(inboxConversations).set({ controlMode: 'ai', controlVersion: 3 }).where(eq(inboxConversations.id, conversation2));
    expect(await canDeliverAutomated(db(), orgA, conversation2, 'ai', 3)).toBe(true);
    expect(await canDeliverAutomated(db(), orgB, conversation2, 'ai', 3)).toBe(false);

    expect((await call('POST', inboxMessagesPath(conversation2), operatorA, { requestId: randomUUID(), text: 'Assumi o atendimento' })).statusCode).toBe(201);
    expect((await detailOf(operatorA, conversation2)).conversation).toMatchObject({ controlMode: 'human', controlVersion: 4 });
    expect(await canDeliverAutomated(db(), orgA, conversation2, 'ai', 3)).toBe(false);
    const events = await db().select({ type: inboxConversationEvents.type }).from(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversation2));
    expect(events.map((item) => item.type)).toEqual(expect.arrayContaining(['assigned', 'control_changed']));
  });

  it('conversa encerrada reabre quando o cliente escreve de novo', async () => {
    await db().update(inboxConversations).set({ status: 'closed' }).where(eq(inboxConversations.id, conversation2));
    expect((await conversationsOf(ownerA, '?filter=closed')).map((item) => item.id)).toEqual([conversation2]);
    await deliver(simNameA, 'Message', messageEvent({ id: 'C2-2', phone: CONTACT_2, text: 'Voltei', pushName: 'Cliente Dois' }));
    expect((await detailOf(ownerA, conversation2)).conversation.status).toBe('open');
    const events = await db().select({ type: inboxConversationEvents.type }).from(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversation2));
    expect(events.map((item) => item.type)).toContain('reopened');
  });
});

describe('tempo real (SSE)', () => {
  it('avisa a empresa certa quando chega mensagem (só ids); a outra empresa não recebe nada', async () => {
    const a = await openStream(ownerA);
    const b = await openStream(ownerB);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toContain('text/event-stream');
    expect(a.headers.get('cache-control')).toContain('no-store');
    await waitFor(() => a.state.events.some((event) => event.type === 'ready') && b.state.events.some((event) => event.type === 'ready'));
    await deliver(simNameA, 'Message', messageEvent({ id: 'SSE-1', phone: CONTACT_1, text: 'mensagem em tempo real' }));
    await waitFor(() => a.state.events.some((event) => event.type === 'conversation' && event.conversationId === conversation1));
    await sleep(150);
    expect(b.state.events.filter((event) => event.type === 'conversation')).toEqual([]);
    expect(a.state.raw).not.toContain('mensagem em tempo real');
    expect(a.state.raw).not.toContain(CONTACT_1);
    a.close();
    b.close();
  });

  it('o atendente só é avisado das conversas dele e da fila', async () => {
    const operator = await openStream(operatorA);
    await waitFor(() => operator.state.events.some((event) => event.type === 'ready'));
    await deliver(simNameA, 'Message', messageEvent({ id: 'SSE-2', phone: CONTACT_1, text: 'para o dono' }));
    await deliver(simNameA, 'Message', messageEvent({ id: 'SSE-3', phone: CONTACT_2, text: 'para o atendente', pushName: 'Cliente Dois' }));
    await waitFor(() => operator.state.events.some((event) => event.conversationId === conversation2));
    expect(operator.state.events.some((event) => event.conversationId === conversation1)).toBe(false);
    operator.close();
  });

  it('manda sinal de vida e fecha sozinho no prazo máximo (o navegador reconecta e a sessão é conferida de novo)', async () => {
    const a = await openStream(ownerA);
    await waitFor(() => a.state.pings > 0);
    await waitFor(() => a.state.ended, 6000);
  });

  it('visualizador e quem não tem sessão não abrem o canal', async () => {
    expect((await openStream(viewerA)).status).toBe(403);
    expect((await openStream(undefined)).status).toBe(401);
  });

  it('sem o canal (consulta periódica do painel), a lista traz a mensagem nova', async () => {
    await deliver(simNameA, 'Message', messageEvent({ id: 'POLL-1', phone: CONTACT_1, text: 'vista pela consulta periódica' }));
    expect((await conversationsOf(ownerA)).find((item) => item.id === conversation1)?.lastMessagePreview).toBe('vista pela consulta periódica');
  });
});

describe('reconexão e falhas do WebSocket', () => {
  it('responde ao ping do servidor e manda o próprio sinal de vida', async () => {
    const pongs = sim.ws.pongs;
    sim.pingWsClients();
    await waitFor(() => sim.ws.pongs > pongs);
    await sleep(400);
    expect(stream.state).toBe('connected');
  });

  it('queda da conexão: reconecta sozinho, registra o período sem recebimento e volta a receber', async () => {
    const accepted = sim.ws.accepted;
    sim.dropWsConnections();
    await waitFor(() => sim.ws.accepted > accepted && stream.state === 'connected');
    await waitFor(async () => (await channelsOf(ownerA)).gaps.some((gap) => gap.accountId === accountA && gap.endedAt !== null));
    expect((await channelsOf(ownerB)).gaps.every((gap) => gap.accountId === accountB)).toBe(true);
    await deliver(simNameA, 'Message', messageEvent({ id: 'POS-1', phone: CONTACT_1, text: 'depois da queda' }));
    expect((await detailOf(ownerA, conversation1)).messages.at(-1)?.text).toBe('depois da queda');
  });

  it('fechamento combinado pelo servidor também reconecta', async () => {
    const accepted = sim.ws.accepted;
    sim.closeWsConnections();
    await waitFor(() => sim.ws.accepted > accepted && stream.state === 'connected');
  });

  it('chave global recusada: não insiste, avisa na Inbox e volta quando o Super-Admin troca a chave', async () => {
    sim.rotateGlobalKey(NEW_GLOBAL_KEY);
    const rejected = sim.ws.rejected;
    sim.dropWsConnections();
    await waitFor(() => stream.state === 'auth_failed');
    await sleep(800);
    expect(sim.ws.rejected).toBe(rejected + 1);
    const channels = await channelsOf(ownerA);
    expect(channels.reception.state).toBe('auth_failed');
    expect(channels.gaps.some((gap) => gap.accountId === accountA && gap.endedAt === null)).toBe(true);

    expect((await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active', apiKey: NEW_GLOBAL_KEY })).statusCode).toBe(200);
    await waitFor(() => stream.state === 'connected');
    await waitFor(async () => (await channelsOf(ownerA)).gaps.every((gap) => gap.endedAt !== null));
  });
});

describe('desligar o recebimento', () => {
  it('o dono desliga: a instância volta ao padrão e os eventos dela passam a ser descartados', async () => {
    const response = await call('DELETE', inboxActivationPath(accountA), ownerA);
    expect(response.statusCode).toBe(200);
    expect(inboxChannelsResponseSchema.parse(response.json()).channels[0]?.inboxEnabledAt).toBeNull();
    expect(sim.connectCalls.at(-1)).toEqual({ instance: simNameA, body: {} });
    expect(sim.byName(simNameA)?.websocket).toBe(false);

    const dropped = stream.stats.dropped;
    await deliver(simNameA, 'Message', messageEvent({ id: 'DEPOIS-1', phone: CONTACT_1, text: 'depois de desligar' }), { force: true });
    expect(stream.stats.dropped).toBe(dropped + 1);
    expect(await db().select().from(inboxMessages).where(eq(inboxMessages.externalId, 'DEPOIS-1'))).toEqual([]);
    // O histórico continua disponível, e responder continua possível
    expect((await detailOf(ownerA, conversation1)).messages.length).toBeGreaterThan(5);
  });
});

describe('registro (log)', () => {
  it('nada de chave, URL do WebSocket, token, texto de mensagem ou número no log; as ações ficam registradas', () => {
    const forbidden = [
      GLOBAL_KEY,
      NEW_GLOBAL_KEY,
      'token=',
      '/ws',
      sim.byName(simNameA)?.token ?? '§',
      sim.byName(simNameB)?.token ?? '§',
      'Olá, preciso de ajuda',
      'Vou verificar seu pedido',
      'Quero um orçamento',
      'mensagem em tempo real',
      CONTACT_1,
      CONTACT_2,
    ];
    for (const item of forbidden) expect(logs).not.toContain(item);
    expect(logs).toContain('inbox.recebimento.conectado');
    expect(logs).toContain('inbox.recebimento.ligado');
    expect(logs).toContain('inbox.resposta');
    expect(logs).toContain('inbox.evento_recusado');
  });
});
