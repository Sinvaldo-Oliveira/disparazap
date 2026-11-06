import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTOMATIONS_COMMENT_PATH,
  AUTOMATIONS_FLOWS_PATH,
  AUTOMATIONS_FLOW_QUESTION_PATH,
  automationActivityPath,
  automationActivitySchema,
  AUTOMATIONS_OVERVIEW_PATH,
  automationStatePath,
  PROBLEM_CONTENT_TYPE,
  SIGNUP_PATH,
  ZERNIO_KEY_PATH,
  automationDetailPath,
  automationDetailSchema,
  automationFlowPath,
  automationFlowStatePath,
  automationsOverviewSchema,
  flowQrSchema,
  flowSummarySchema,
  flowsListSchema,
  problemDetailsSchema,
} from '@disparazap/contracts';
import { members, sessions, users, zernioConnections } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createZernioClient } from '../integrations/zernio-client.ts';
import { createServices, type ApiServices } from '../services.ts';
import { ZernioSimulator, type SimAccount, type SimCommentAutomation } from '../testing/zernio-simulator.ts';

// Tudo fictício: Zernio simulada, banco em memória, textos de teste que não existem em lugar nenhum
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const KEY_A = `sk_${'c3'.repeat(32)}`;
const KEY_B = `sk_${'d4'.repeat(32)}`;
const SECRET_DM = 'Texto secreto da DM de teste que nunca pode aparecer no log';
const SECRET_REPLY = 'Resposta publica secreta de teste';

const baseEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
  LOG_LEVEL: 'info',
};
const config = loadApiConfig(baseEnv);
// Segunda API com a trava ligada (A2), sobre os mesmos serviços: só para testar a escrita contra a Zernio simulada
const writeConfig = loadApiConfig({ ...baseEnv, AUTOMATIONS_WRITE_ENABLED: 'true' });

const sim = new ZernioSimulator(KEY_A, KEY_B);
let services: ApiServices;
let app: FastifyInstance;
let writeApp: FastifyInstance;
let logs = '';
let address = 0;
let ownerA: string;
let viewerA: string;
let operatorA: string;
let noKey: string;
let profileA = '';
let profileB = '';
let instagramA: SimAccount;
let facebookA: SimAccount;
let tiktokA: SimAccount;
let instagramB: SimAccount;

const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

const get = (url: string, cookie: string | undefined) =>
  app.inject({ method: 'GET', url, remoteAddress: `10.9.0.${++address % 250}`, headers: { origin: PANEL, ...(cookie ? { cookie } : {}) } });

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const created = await app.inject({ method: 'POST', url: SIGNUP_PATH, remoteAddress: `10.9.1.${++address % 250}`, headers: { origin: PANEL, 'content-type': 'application/json' }, payload: { name: `Dono ${name}`, companyName: name, email, password: PASSWORD } });
  expect(created.statusCode).toBe(201);
  return cookieOf(created);
}

async function memberOf(ownerName: string, role: 'viewer' | 'operator') {
  const cookie = await signupCompany(`Pessoa Automacao ${role}`);
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [membership] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.name, `Dono Pessoa Automacao ${role}`));
  await db.update(members).set({ organizationId: membership?.org ?? '', role }).where(eq(members.userId, user?.id ?? ''));
  await db.update(sessions).set({ activeOrganizationId: membership?.org ?? '' }).where(eq(sessions.userId, user?.id ?? ''));
  return cookie;
}

let accountSeq = 0;
function addAccount(profileId: string, platform: string, username: string): SimAccount {
  const account: SimAccount = { _id: `acc_auto_${++accountSeq}`, platform, profileId, username, displayName: `Loja ${username}`, profileUrl: `https://social.exemplo.test/${username}`, isActive: true, needsReconnection: false };
  sim.accounts.set(account._id, account);
  return account;
}

function automation(id: string, account: SimAccount, extra: Record<string, unknown> = {}): SimCommentAutomation {
  return {
    id,
    profileId: account.profileId,
    accountId: account._id,
    name: `Automação ${id}`,
    platform: account.platform,
    trigger: 'comment',
    keywords: ['preço'],
    matchMode: 'word',
    isActive: true,
    repeatPolicy: { mode: 'once' },
    dmMessage: SECRET_DM,
    buttons: [{ type: 'url', title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }],
    commentReply: SECRET_REPLY,
    publicReplyPolicy: 'after_dm',
    alsoMatchInDms: false,
    stats: { triggered: 10, dmsSent: 8, dmsFailed: 1, uniqueContacts: 7, linkClicks: 3 },
    createdAt: '2026-11-01T10:00:00.000Z',
    ...extra,
  };
}

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  const logStream = new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } });
  app = await buildApp(config, { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
  await app.ready();
  const writeLogStream = new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } });
  writeApp = await buildApp(writeConfig, { services, logStream: writeLogStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
  await writeApp.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  ownerA = await signupCompany('Empresa Auto A');
  const ownerB = await signupCompany('Empresa Auto B');
  noKey = await signupCompany('Empresa Auto Sem Chave');
  viewerA = await memberOf('Dono Empresa Auto A', 'viewer');
  operatorA = await memberOf('Dono Empresa Auto A', 'operator');

  const db = services.database.db;
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.9.2.1', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerA }, payload: { apiKey: KEY_A } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: ZERNIO_KEY_PATH, remoteAddress: '10.9.2.2', headers: { origin: PANEL, 'content-type': 'application/json', cookie: ownerB }, payload: { apiKey: KEY_B } })).statusCode).toBe(200);
  const orgOf = async (ownerName: string) => (await db.select({ org: members.organizationId }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(users.name, ownerName)))[0]?.org ?? '';
  profileA = (await db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa Auto A'))))[0]?.profileId ?? '';
  profileB = (await db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, await orgOf('Dono Empresa Auto B'))))[0]?.profileId ?? '';

  instagramA = addAccount(profileA, 'instagram', 'lojaauto');
  facebookA = addAccount(profileA, 'facebook', 'paginaauto');
  tiktokA = addAccount(profileA, 'tiktok', 'lojaautott');
  instagramB = addAccount(profileB, 'instagram', 'outraloja');
  sim.commentAutomations.push(
    automation('auto_a_preco', instagramA),
    automation('auto_a_story', instagramA, { name: 'Obrigado pela menção', trigger: 'story_mention', keywords: [], isActive: false, repeatPolicy: { mode: 'every_comment', cooldownHours: 24 }, audience: { followerStatus: 'follower' }, stats: { dmsSent: 2, linkClicks: 0 } }),
    // TikTok: só resposta pública (a Zernio recusa DM); a conta vem como objeto, um dos formatos aceitos
    automation('auto_a_tiktok', tiktokA, { accountId: { _id: tiktokA._id }, dmMessage: null, buttons: [], platformPostId: 'video_123', postTitle: 'Vídeo de lançamento' }),
    automation('auto_b_preco', instagramB),
    // Sem conta: nunca aparece para ninguém
    { id: 'auto_sem_conta', profileId: profileA, accountId: '', name: 'Sem conta' },
  );
}, 120_000);

afterAll(async () => {
  await writeApp?.close();
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

describe('Automações (A1): leitura pela Zernio, só da própria empresa', () => {
  it('sem sessão 401; dono gerencia; atendente e visualizador só veem (decisão A2); a trava vem desligada', async () => {
    expectProblem(await get(AUTOMATIONS_OVERVIEW_PATH, undefined), 401);
    const owner = automationsOverviewSchema.parse((await get(AUTOMATIONS_OVERVIEW_PATH, ownerA)).json());
    expect(owner).toMatchObject({ canManage: true, writeEnabled: false });
    for (const cookie of [operatorA, viewerA]) {
      const response = await get(AUTOMATIONS_OVERVIEW_PATH, cookie);
      expect(response.statusCode).toBe(200);
      expect(automationsOverviewSchema.parse(response.json())).toMatchObject({ canManage: false, writeEnabled: false });
    }
    expect(sim.automationRequests.every((profile) => profile === profileA)).toBe(true);
  });

  it('descarta automações de outra empresa e sem conta, mesmo se a Zernio devolver na lista', async () => {
    sim.leakAutomations = true;
    try {
      const overview = automationsOverviewSchema.parse((await get(AUTOMATIONS_OVERVIEW_PATH, ownerA)).json());
      expect(overview.automations.map((item) => item.id).sort()).toEqual(['auto_a_preco', 'auto_a_story', 'auto_a_tiktok']);
    } finally {
      sim.leakAutomations = false;
    }
  });

  it('capacidade por rede, totais e resumo de cada automação', async () => {
    const overview = automationsOverviewSchema.parse((await get(AUTOMATIONS_OVERVIEW_PATH, ownerA)).json());
    const capability = Object.fromEntries(overview.accounts.map((account) => [account.id, account.capability]));
    expect(capability).toMatchObject({ [instagramA._id]: 'full', [facebookA._id]: 'dm', [tiktokA._id]: 'public_reply' });
    expect(overview.totals).toEqual({ active: 2, dmsSent: 18, linkClicks: 6 });
    const byId = Object.fromEntries(overview.automations.map((item) => [item.id, item]));
    expect(byId.auto_a_preco).toMatchObject({ accountName: '@lojaauto', trigger: 'comment', keywords: ['preço'], postBound: false, isActive: true, repeat: { mode: 'once', cooldownHours: null }, followersOnly: false, hasDm: true, hasPublicReply: true });
    expect(byId.auto_a_story).toMatchObject({ trigger: 'story_mention', isActive: false, repeat: { mode: 'every_comment', cooldownHours: 24 }, followersOnly: true });
    expect(byId.auto_a_tiktok).toMatchObject({ platform: 'tiktok', postBound: true, postTitle: 'Vídeo de lançamento', hasDm: false, hasPublicReply: true });
  });

  it('detalhe: mostra a DM e os botões à empresa dona; TikTok sem DM; outra empresa, inválida e inexistente respondem 404', async () => {
    const detail = automationDetailSchema.parse((await get(automationDetailPath('auto_a_preco'), viewerA)).json());
    expect(detail).toMatchObject({ dmMessage: SECRET_DM, commentReply: SECRET_REPLY, publicReplyPolicy: 'after_dm', alsoMatchInDms: false });
    expect(detail.buttons).toEqual([{ type: 'url', title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }]);
    const tiktok = automationDetailSchema.parse((await get(automationDetailPath('auto_a_tiktok'), ownerA)).json());
    expect(tiktok).toMatchObject({ dmMessage: null, buttons: [], commentReply: SECRET_REPLY });
    for (const id of ['auto_b_preco', 'auto_sem_conta', 'nao_existe', 'id com espaço']) {
      expect(expectProblem(await get(automationDetailPath(id), ownerA), 404).detail).toBe('Automação não encontrada nesta empresa.');
    }
  });

  it('erros da Zernio viram mensagens fixas, sem o texto dela', async () => {
    for (const mode of ['forbidden', 'server', 'odd'] as const) {
      sim.automationsMode = mode;
      try {
        const response = await get(AUTOMATIONS_OVERVIEW_PATH, ownerA);
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.body).not.toContain('Not allowed for this key');
        expect(response.body).not.toContain('Temporarily unavailable');
      } finally {
        sim.automationsMode = 'ok';
      }
    }
  });

  it('empresa sem a chave da Zernio recebe a orientação de configurar, sem consultar a Zernio', async () => {
    const before = sim.automationRequests.length;
    expect(expectProblem(await get(AUTOMATIONS_OVERVIEW_PATH, noKey), 409).detail).toContain('ainda não foi configurada');
    expect(sim.automationRequests.length).toBe(before);
  });

  it('o log registra a ação com ids e contagens, nunca o texto da DM nem da resposta', async () => {
    await get(AUTOMATIONS_OVERVIEW_PATH, ownerA);
    await get(automationDetailPath('auto_a_preco'), ownerA);
    expect(logs).toContain('automacoes.lista');
    expect(logs).toContain('automacoes.detalhe');
    expect(logs).not.toContain(SECRET_DM);
    expect(logs).not.toContain(SECRET_REPLY);
    expect(logs).not.toContain(KEY_A);
  });
});

// ----- Etapa A2: criar, alterar, ativar, pausar e excluir -----

const write = (target: FastifyInstance, method: 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  target.inject({
    method,
    url,
    remoteAddress: `10.9.3.${++address % 250}`,
    headers: { origin: PANEL, cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

const dmInput = (extra: Record<string, unknown> = {}) => ({
  accountId: instagramA._id,
  name: 'Catálogo por DM',
  keywords: ['preço', 'Preço', 'valor'],
  matchMode: 'word',
  dmMessage: `${SECRET_DM} {{first_name}}`,
  buttons: [{ title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }],
  commentReply: SECRET_REPLY,
  repeat: { mode: 'once', cooldownHours: null },
  ...extra,
});
const lastWrite = () => sim.automationWrites.at(-1);

describe('Automações (A2): escrita com trava, papéis e regras por rede', () => {
  it('com a trava desligada, responde 409 e nada chega à Zernio', async () => {
    const before = sim.automationWrites.length;
    expect(expectProblem(await write(app, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput()), 409).detail).toContain('desligado nesta plataforma');
    expect(expectProblem(await write(app, 'POST', automationStatePath('auto_a_preco'), ownerA, { active: false }), 409).detail).toContain('desligado');
    expect(expectProblem(await write(app, 'DELETE', automationDetailPath('auto_a_preco'), ownerA), 409).detail).toContain('desligado');
    expect(sim.automationWrites.length).toBe(before);
  });

  it('só dono e administradores alteram: atendente e visualizador recebem 403, mesmo com a trava ligada', async () => {
    const before = sim.automationWrites.length;
    for (const cookie of [operatorA, viewerA]) {
      expect(expectProblem(await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, cookie, dmInput()), 403).detail).toContain('Só o dono e os administradores');
    }
    expect(sim.automationWrites.length).toBe(before);
  });

  it('cria Comentário → DM sempre pausada, só com os campos documentados', async () => {
    const response = await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput());
    expect(response.statusCode).toBe(201);
    const created = automationDetailSchema.parse(response.json());
    expect(created.automation).toMatchObject({ name: 'Catálogo por DM', isActive: false, accountId: instagramA._id, keywords: ['preço', 'valor'], hasDm: true, hasPublicReply: true });
    expect(created).toMatchObject({ canManage: true, writeEnabled: true });
    const body = lastWrite()?.body ?? {};
    expect(body).toMatchObject({
      profileId: profileA,
      accountId: instagramA._id,
      isActive: false,
      trigger: 'comment',
      keywords: ['preço', 'valor'],
      matchMode: 'word',
      repeatPolicy: { mode: 'once' },
      buttons: [{ type: 'url', title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }],
      publicReplyPolicy: 'after_dm',
      alsoMatchInDms: false,
    });
    expect(body).not.toHaveProperty('platformPostId');
    expect(body).not.toHaveProperty('audience');
  });

  it('nome repetido na mesma conta: 409, sem criar outra (a Zernio não documenta chave de idempotência)', async () => {
    const before = sim.automationWrites.length;
    expect(expectProblem(await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ name: '  catálogo POR dm ' })), 409).detail).toBe('Já existe uma automação com este nome nesta conta. Use outro nome.');
    expect(sim.automationWrites.length).toBe(before);
  });

  it('regras por rede e campos inválidos são recusados antes de chamar a Zernio', async () => {
    const before = sim.automationWrites.length;
    const cases: [Record<string, unknown>, number, string][] = [
      [dmInput({ accountId: tiktokA._id, name: 'TT com DM' }), 400, 'Nesta rede a automação só responde em público: sem DM e sem botões.'],
      [dmInput({ accountId: tiktokA._id, name: 'TT sem resposta', dmMessage: null, buttons: [], commentReply: null }), 400, 'Escreva a resposta pública.'],
      [dmInput({ name: 'Sem DM', dmMessage: null }), 400, 'Escreva o texto da DM.'],
      [dmInput({ name: 'DM longa', dmMessage: 'a'.repeat(641) }), 400, 'Com botões, a DM tem até 640 caracteres; sem botões, até 1000.'],
      [dmInput({ name: 'Sem palavras', keywords: [] }), 400, 'Informe pelo menos uma palavra-chave.'],
      [dmInput({ name: 'Link inseguro', buttons: [{ title: 'Ver', url: 'http://loja.exemplo.test' }] }), 400, 'O link do botão precisa ser um endereço completo, começando com https://.'],
      [dmInput({ name: 'Sem espera', repeat: { mode: 'every_comment', cooldownHours: null } }), 400, 'Informe a espera, em horas, antes de responder de novo à mesma pessoa.'],
      [dmInput({ name: 'Outra empresa', accountId: instagramB._id }), 404, 'Conta não encontrada nesta empresa.'],
      [{ ...dmInput({ name: 'Campo a mais' }), alsoMatchInDms: true }, 400, 'Dados da automação inválidos. Recarregue a página e tente de novo.'],
    ];
    for (const [payload, status, detail] of cases) {
      expect(expectProblem(await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, payload), status).detail).toBe(detail);
    }
    expect(sim.automationWrites.length).toBe(before);
  });

  it('cria Comentário → resposta pública no TikTok, sem campos de DM', async () => {
    const response = await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ accountId: tiktokA._id, name: 'Resposta TikTok', dmMessage: null, buttons: [], commentReply: SECRET_REPLY }));
    expect(response.statusCode).toBe(201);
    expect(automationDetailSchema.parse(response.json()).automation).toMatchObject({ platform: 'tiktok', hasDm: false, hasPublicReply: true, isActive: false });
    const body = lastWrite()?.body ?? {};
    expect(body).toMatchObject({ commentReply: SECRET_REPLY, isActive: false });
    expect(body).not.toHaveProperty('dmMessage');
    expect(body).not.toHaveProperty('buttons');
  });

  it('ativa, pausa, altera e exclui só automações da própria empresa', async () => {
    const created = automationDetailSchema.parse((await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ name: 'Para ativar' }))).json());
    const id = created.automation.id;
    const activated = automationDetailSchema.parse((await write(writeApp, 'POST', automationStatePath(id), ownerA, { active: true })).json());
    expect(activated.automation.isActive).toBe(true);
    expect(lastWrite()).toMatchObject({ method: 'PATCH', id, body: { isActive: true } });
    expect(automationDetailSchema.parse((await write(writeApp, 'POST', automationStatePath(id), ownerA, { active: false })).json()).automation.isActive).toBe(false);

    const { accountId: _account, ...fields } = dmInput({ name: 'Para ativar (editada)', keywords: ['link'], repeat: { mode: 'every_comment', cooldownHours: 12 } });
    const updated = automationDetailSchema.parse((await write(writeApp, 'PUT', automationDetailPath(id), ownerA, fields)).json());
    expect(updated.automation).toMatchObject({ name: 'Para ativar (editada)', keywords: ['link'], repeat: { mode: 'every_comment', cooldownHours: 12 } });
    expect(lastWrite()?.body).toMatchObject({ repeatPolicy: { mode: 'every_comment', cooldownHours: 12 } });

    expect((await write(writeApp, 'DELETE', automationDetailPath(id), ownerA)).statusCode).toBe(204);
    expect(sim.commentAutomations.some((item) => item.id === id)).toBe(false);

    const before = sim.automationWrites.length;
    expect(expectProblem(await write(writeApp, 'POST', automationStatePath('auto_b_preco'), ownerA, { active: false }), 404).detail).toBe('Automação não encontrada nesta empresa.');
    expect(expectProblem(await write(writeApp, 'PUT', automationDetailPath('auto_b_preco'), ownerA, fields), 404).detail).toBe('Automação não encontrada nesta empresa.');
    expect(expectProblem(await write(writeApp, 'DELETE', automationDetailPath('auto_b_preco'), ownerA), 404).detail).toBe('Automação não encontrada nesta empresa.');
    expect(sim.automationWrites.length).toBe(before);
  });

  it('recusa, conflito e indisponibilidade da Zernio viram mensagens fixas; resultado incerto pede para conferir a lista', async () => {
    const expected: [typeof sim.automationWriteMode, number, string][] = [
      ['invalid', 400, 'A Zernio recusou os dados da automação. Confira o texto, os botões e as palavras-chave.'],
      ['conflict', 409, 'Já existe uma automação ativa para esta publicação.'],
      ['server', 502, 'Não foi possível confirmar se a Zernio concluiu o pedido. Atualize a lista e confira antes de tentar de novo.'],
      ['odd', 502, 'Não foi possível confirmar se a Zernio concluiu o pedido. Atualize a lista e confira antes de tentar de novo.'],
    ];
    for (const [mode, status, detail] of expected) {
      sim.automationWriteMode = mode;
      try {
        const response = await write(writeApp, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ name: `Modo ${mode}` }));
        expect(expectProblem(response, status).detail).toBe(detail);
        expect(response.body).not.toContain('Field rejected');
        expect(response.body).not.toContain('Temporarily unavailable');
      } finally {
        sim.automationWriteMode = 'ok';
      }
    }
  });

  it('alteração sem a automação na resposta relê pela Zernio; o log nunca leva o texto da DM nem da resposta', async () => {
    sim.automationWriteMode = 'odd';
    try {
      const response = await write(writeApp, 'POST', automationStatePath('auto_a_preco'), ownerA, { active: false });
      expect(automationDetailSchema.parse(response.json()).automation.isActive).toBe(false);
    } finally {
      sim.automationWriteMode = 'ok';
    }
    expect(logs).toContain('automacoes.criada');
    expect(logs).toContain('automacoes.excluida');
    expect(logs).not.toContain(SECRET_DM);
    expect(logs).not.toContain(SECRET_REPLY);
  });
});

// ----- Etapa A3: só seguidores e menção em story (Instagram) -----

const GATE = { message: 'Toque no botão para confirmar que você segue a conta.', buttonLabel: 'Já sigo', notFollowingMessage: 'Siga a conta e toque no botão de novo.' };
const storyInput = (extra: Record<string, unknown> = {}) => ({
  accountId: instagramA._id,
  name: 'Agradecer menção no story',
  trigger: 'story_mention',
  keywords: [],
  matchMode: 'word',
  dmMessage: SECRET_DM,
  buttons: [],
  commentReply: null,
  repeat: { mode: 'every_comment', cooldownHours: 24 },
  ...extra,
});

describe('Automações (A3): só seguidores e menção em story, só no Instagram', () => {
  // API própria (trava ligada): o limite de 30 alterações por minuto da empresa já foi usado pelos testes da A2
  let a3App: FastifyInstance;
  beforeAll(async () => {
    a3App = await buildApp(writeConfig, { services, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }) });
    await a3App.ready();
  });
  afterAll(async () => {
    await a3App?.close();
  });
  it('cria "só seguidores" com a verificação documentada e a resposta pública sempre', async () => {
    const response = await write(a3App, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ name: 'Só seguidores', followGate: GATE }));
    expect(response.statusCode).toBe(201);
    const created = automationDetailSchema.parse(response.json());
    expect(created.automation).toMatchObject({ followersOnly: true, isActive: false, trigger: 'comment' });
    expect(created.followGate).toEqual(GATE);
    expect(lastWrite()?.body).toMatchObject({ audience: { followerStatus: 'follower', whenUnknown: 'verify' }, followGate: GATE, publicReplyPolicy: 'always', isActive: false });
  });

  it('só seguidores fora do Instagram ou com verificação incompleta é recusado antes de chamar a Zernio', async () => {
    const before = sim.automationWrites.length;
    const cases: [Record<string, unknown>, string][] = [
      [dmInput({ accountId: facebookA._id, name: 'FB seguidores', followGate: GATE }), 'Só seguidores existe apenas no Instagram.'],
      [dmInput({ accountId: tiktokA._id, name: 'TT seguidores', dmMessage: null, buttons: [], followGate: GATE }), 'Só seguidores existe apenas no Instagram.'],
      [dmInput({ name: 'Sem rótulo', followGate: { ...GATE, buttonLabel: ' ' } }), 'Escreva o rótulo do botão de confirmação.'],
      [dmInput({ name: 'Sem aviso', followGate: { ...GATE, notFollowingMessage: '' } }), 'Escreva a mensagem para quem ainda não segue a conta.'],
    ];
    for (const [payload, detail] of cases) {
      expect(expectProblem(await write(a3App, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, payload), 400).detail).toBe(detail);
    }
    expect(sim.automationWrites.length).toBe(before);
  });

  it('cria menção em story: sem palavra-chave, sem resposta pública e com espera entre respostas', async () => {
    const response = await write(a3App, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, storyInput());
    expect(response.statusCode).toBe(201);
    expect(automationDetailSchema.parse(response.json()).automation).toMatchObject({ trigger: 'story_mention', keywords: [], hasDm: true, hasPublicReply: false, isActive: false });
    const body = lastWrite()?.body ?? {};
    expect(body).toMatchObject({ trigger: 'story_mention', keywords: [], dmMessage: SECRET_DM, repeatPolicy: { mode: 'every_comment', cooldownHours: 24 }, isActive: false, alsoMatchInDms: false });
    expect(body).not.toHaveProperty('matchMode');
    expect(body).not.toHaveProperty('commentReply');
    expect(body).not.toHaveProperty('audience');
  });

  it('menção em story fora do Instagram, com palavra-chave, com resposta pública ou com verificação é recusada', async () => {
    const before = sim.automationWrites.length;
    const cases: [Record<string, unknown>, string][] = [
      [storyInput({ accountId: facebookA._id, name: 'Story FB' }), 'Menção em story só existe no Instagram.'],
      [storyInput({ accountId: tiktokA._id, name: 'Story TT', dmMessage: null }), 'Menção em story só existe no Instagram.'],
      [storyInput({ name: 'Story com palavra', keywords: ['oi'] }), 'Menção em story não usa palavra-chave: toda menção à conta conta.'],
      [storyInput({ name: 'Story com resposta', commentReply: 'Obrigado!' }), 'Menção em story não tem resposta pública: não há comentário para responder.'],
      [storyInput({ name: 'Story seguidores', followGate: GATE }), 'A recompensa só para seguidores vale para comentários, não para menção em story.'],
    ];
    for (const [payload, detail] of cases) {
      expect(expectProblem(await write(a3App, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, payload), 400).detail).toBe(detail);
    }
    expect(sim.automationWrites.length).toBe(before);
  });

  it('editar: tirar a verificação desliga o "só seguidores"; o gatilho não muda; gatilho criado fora não é editado', async () => {
    const created = automationDetailSchema.parse((await write(a3App, 'POST', AUTOMATIONS_COMMENT_PATH, ownerA, dmInput({ name: 'Seguidores editável', followGate: GATE }))).json());
    const id = created.automation.id;
    const { accountId: _account, ...fields } = dmInput({ name: 'Seguidores editável', followGate: null });
    const updated = automationDetailSchema.parse((await write(a3App, 'PUT', automationDetailPath(id), ownerA, fields)).json());
    expect(lastWrite()?.body).toMatchObject({ audience: { followerStatus: 'any', whenUnknown: 'send' }, publicReplyPolicy: 'after_dm' });
    expect(updated.automation.followersOnly).toBe(false);
    expect(updated.followGate).toBeNull();

    const { accountId: _story, ...storyFields } = storyInput({ name: 'Seguidores editável' });
    expect(expectProblem(await write(a3App, 'PUT', automationDetailPath(id), ownerA, storyFields), 400).detail).toBe('O que dispara a automação não muda depois de criada. Para outro gatilho, crie outra automação.');

    sim.commentAutomations.push(automation('auto_a_resposta_story', instagramA, { name: 'Resposta a story', trigger: 'story_reply', keywords: [] }));
    expect(expectProblem(await write(a3App, 'PUT', automationDetailPath('auto_a_resposta_story'), ownerA, fields), 409).detail).toContain('ainda não edita');
  });
});

const flowInput = (extra: Record<string, unknown> = {}) => ({
  accountId: instagramA._id,
  name: 'Link de boas-vindas',
  ref: 'boas-vindas',
  message: 'Oi! Obrigado por chegar pelo link. Responda MENU para ver as opções.',
  tag: 'veio-do-link',
  cooldownHours: 24,
  ...extra,
});

describe('Automações (A5): link → conversa (só Instagram, sempre criado pausado)', () => {
  let flowApp: FastifyInstance;

  beforeAll(async () => {
    // API própria com a trava ligada: o limite de 30 alterações por minuto não pode atrapalhar outros grupos de testes
    flowApp = await buildApp(writeConfig, {
      services,
      logStream: new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } }),
      zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }),
    });
    await flowApp.ready();
    sim.workflows.push(
      { id: 'wf_a_antigo', profileId: profileA, accountId: instagramA._id, platform: 'instagram', name: 'Fluxo antigo', description: 'DisparaZap link: antigo', status: 'paused', nodes: [{ id: 'n' }], edges: [] },
      // Outra empresa e conta sem vínculo: nunca aparecem para a empresa A
      { id: 'wf_b_outra', profileId: profileB, accountId: instagramB._id, platform: 'instagram', name: 'Fluxo de outra empresa', description: 'DisparaZap link: outra', status: 'draft', nodes: [], edges: [] },
      { id: 'wf_sem_conta', profileId: profileA, accountId: 'acc_nao_existe', platform: 'instagram', name: 'Fluxo sem conta', status: 'draft', nodes: [], edges: [] },
    );
  });

  afterAll(async () => {
    await flowApp?.close();
  });

  it('lista só os fluxos das contas da empresa, com o código e o link pronto; atendente lê, sem poder criar', async () => {
    const owner = await get(AUTOMATIONS_FLOWS_PATH, ownerA);
    expect(owner.statusCode).toBe(200);
    expect(flowsListSchema.parse(owner.json())).toMatchObject({
      flows: [expect.objectContaining({ id: 'wf_a_antigo', ref: 'antigo', link: 'https://ig.me/m/lojaauto?ref=antigo', isActive: false, accountName: '@lojaauto' })],
      writeEnabled: false,
      canManage: true,
    });
    expect(flowsListSchema.parse((await get(AUTOMATIONS_FLOWS_PATH, operatorA)).json())).toMatchObject({ canManage: false, flows: [expect.objectContaining({ id: 'wf_a_antigo' })] });
  });

  it('trava desligada, papéis, conta que não é Instagram, código inválido, código e nome repetidos: nada chega à Zernio', async () => {
    const before = sim.workflowWrites.length;
    expect(expectProblem(await write(app, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput()), 409).detail).toContain('desligado');
    expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, operatorA, flowInput()), 403).detail).toContain('Só o dono');
    expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput({ accountId: facebookA._id })), 400).detail).toBe('O link de conversa está disponível só para contas do Instagram nesta etapa.');
    expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput({ ref: 'Boas Vindas' })), 400).detail).toBe('Use só letras minúsculas, números e hífens, sem espaços.');
    expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput({ ref: 'antigo' })), 409).detail).toBe('Já existe um link com este código nesta conta. Use outro código.');
    expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput({ name: ' fluxo ANTIGO ' })), 409).detail).toBe('Já existe uma automação com este nome nesta conta. Use outro nome.');
    expect(sim.workflowWrites.length).toBe(before);
  });

  it('cria o fluxo pausado: gatilho de referência, mensagem, etiqueta e fim; o link sai pronto', async () => {
    const response = await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput());
    expect(response.statusCode).toBe(201);
    const created = flowSummarySchema.parse(response.json());
    expect(created).toMatchObject({ name: 'Link de boas-vindas', ref: 'boas-vindas', link: 'https://ig.me/m/lojaauto?ref=boas-vindas', isActive: false, status: 'draft', accountId: instagramA._id });
    const body = sim.workflowWrites.at(-1)?.body ?? {};
    expect(body).toMatchObject({ profileId: profileA, accountId: instagramA._id, platform: 'instagram', name: 'Link de boas-vindas', description: 'DisparaZap link: boas-vindas' });
    expect(body.nodes).toEqual([
      { id: 'n_trigger', type: 'trigger', config: { triggerType: 'referral', referral: { ref: 'boas-vindas', matchType: 'exact' }, cooldownHours: 24 } },
      { id: 'n_message', type: 'send_message', config: { messageType: 'text', text: flowInput().message } },
      { id: 'n_tag', type: 'add_tag', config: { tag: 'veio-do-link' } },
      { id: 'n_end', type: 'end' },
    ]);
    expect(body.edges).toHaveLength(3);
    expect(sim.workflowWrites.some((item) => item.path.endsWith('/activate'))).toBe(false);
  });

  it('QR code do link: PNG só para fluxo com link da própria empresa; sem código, 400; outra empresa ou sem conta, 404', async () => {
    const id = sim.workflows.find((item) => item.name === 'Link de boas-vindas')?.id ?? '';
    const qr = await get(`${AUTOMATIONS_FLOWS_PATH}/${id}/qr`, ownerA);
    expect(qr.statusCode).toBe(200);
    const body = flowQrSchema.parse(qr.json());
    expect(body.link).toBe('https://ig.me/m/lojaauto?ref=boas-vindas');
    expect(body.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    // Fluxo da empresa sem código na descrição: não há link para gerar o QR
    sim.workflows.push({ id: 'wf_sem_codigo', profileId: profileA, accountId: instagramA._id, platform: 'instagram', name: 'Fluxo sem código', description: 'outra coisa', status: 'draft', nodes: [], edges: [] });
    try {
      expect(expectProblem(await get(`${AUTOMATIONS_FLOWS_PATH}/wf_sem_codigo/qr`, ownerA), 400).detail).toBe('Este fluxo ainda não tem link: o código do link não foi encontrado nele.');
    } finally {
      sim.workflows.splice(sim.workflows.findIndex((item) => item.id === 'wf_sem_codigo'), 1);
    }
    expect(expectProblem(await get(`${AUTOMATIONS_FLOWS_PATH}/wf_b_outra/qr`, ownerA), 404).detail).toBe('Fluxo não encontrado nesta empresa.');
    expect(expectProblem(await get(`${AUTOMATIONS_FLOWS_PATH}/wf_sem_conta/qr`, ownerA), 404).detail).toBe('Fluxo não encontrado nesta empresa.');
  });

  it('ativa e pausa só fluxos da própria empresa; de outra empresa responde 404 sem tocar na Zernio', async () => {
    const id = sim.workflows.find((item) => item.name === 'Link de boas-vindas')?.id ?? '';
    const on = await write(flowApp, 'POST', automationFlowStatePath(id), ownerA, { active: true });
    expect(on.statusCode).toBe(200);
    expect(flowSummarySchema.parse(on.json()).isActive).toBe(true);
    expect(sim.workflows.find((item) => item.id === id)?.status).toBe('active');
    const off = await write(flowApp, 'POST', automationFlowStatePath(id), ownerA, { active: false });
    expect(flowSummarySchema.parse(off.json()).isActive).toBe(false);
    expect(sim.workflows.find((item) => item.id === id)?.status).toBe('paused');

    const before = sim.workflowWrites.length;
    expect(expectProblem(await write(flowApp, 'POST', automationFlowStatePath('wf_b_outra'), ownerA, { active: true }), 404).detail).toBe('Fluxo não encontrado nesta empresa.');
    expect(expectProblem(await write(flowApp, 'DELETE', automationFlowPath('wf_sem_conta'), ownerA), 404).detail).toBe('Fluxo não encontrado nesta empresa.');
    expect(sim.workflowWrites.length).toBe(before);
  });

  it('exclui o fluxo da própria empresa; recusa da Zernio vira mensagem fixa e não cria nada', async () => {
    const id = sim.workflows.find((item) => item.name === 'Link de boas-vindas')?.id ?? '';
    expect((await write(flowApp, 'DELETE', automationFlowPath(id), ownerA)).statusCode).toBe(204);
    expect(sim.workflows.some((item) => item.id === id)).toBe(false);

    sim.automationWriteMode = 'invalid';
    try {
      expect(expectProblem(await write(flowApp, 'POST', AUTOMATIONS_FLOWS_PATH, ownerA, flowInput({ name: 'Outro fluxo', ref: 'outro-fluxo' })), 400).detail).toBe(
        'A Zernio recusou os dados da automação. Confira o texto, os botões e as palavras-chave.',
      );
    } finally {
      sim.automationWriteMode = 'ok';
    }
    expect(sim.workflows.some((item) => item.name === 'Outro fluxo')).toBe(false);
  });
});

describe('Automações (A4): atividade — quem recebeu, quem foi pulado e por quê', () => {
  let activityApp: FastifyInstance;

  beforeAll(async () => {
    activityApp = await buildApp(config, {
      services,
      logStream: new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } }),
      zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }),
    });
    await activityApp.ready();
    const at = '2026-11-05T12:00:00.000Z';
    sim.automationLogs.set('auto_a_preco', [
      { id: 'log_sent', status: 'sent', source: 'comment', error: null, clickCount: 2, createdAt: at, commentText: 'quero o preço da Atividade', commenterName: 'Ana Atividade', commenterUsername: 'ana.atividade' },
      { id: 'log_skip', status: 'skipped', source: 'comment', error: 'repeatPolicy: already sent to this person', clickCount: 0, createdAt: at, commentText: 'preço de novo', commenterName: 'Ana Atividade', commenterUsername: 'ana.atividade' },
      { id: 'log_fail', status: 'failed', source: 'comment', error: 'DM failed: texto cru da Zernio', clickCount: 0, createdAt: at, commentText: 'valor', commenterName: 'Caio Atividade', commenterUsername: null },
      { id: 'log_gate', status: 'gated', source: 'comment', error: null, clickCount: 0, createdAt: at, commentText: 'preço', commenterName: 'Dani Atividade', commenterUsername: null },
      { id: 'log_odd', status: 'estranho', source: null, error: null, clickCount: 0, createdAt: at, commentText: null, commenterName: null, commenterUsername: null },
    ]);
    sim.automationMisses.push({ commentText: 'oi tudo bem por aqui', commenterName: 'Bia Atividade', excludedBy: null, at });
  });

  afterAll(async () => {
    await activityApp?.close();
  });

  it('cada registro leva um texto fixo; o motivo e o texto da Zernio não saem da API', async () => {
    const response = await get(automationActivityPath('auto_a_preco'), ownerA);
    expect(response.statusCode).toBe(200);
    const body = automationActivitySchema.parse(response.json());
    expect(body.entries.map((entry) => entry.label)).toEqual([
      'DM enviada',
      'Não enviada: regra de repetição ou intervalo entre respostas',
      'Falha no envio da DM',
      'Aguardando a confirmação de quem segue a conta',
      'Situação não reconhecida',
    ]);
    expect(response.body).not.toContain('repeatPolicy');
    expect(response.body).not.toContain('texto cru da Zernio');
    expect(body.entries[0]).toMatchObject({ id: 'log_sent', status: 'sent', source: 'comment', clicks: 2, at: '2026-11-05T12:00:00.000Z' });
  });

  it('comentários que não casaram e nomes só para dono e administradores; atendente lê os registros sem eles', async () => {
    const owner = automationActivitySchema.parse((await get(automationActivityPath('auto_a_preco'), ownerA)).json());
    expect(owner).toMatchObject({ canManage: true, misses: { total: 1, samples: [expect.objectContaining({ commenterName: 'Bia Atividade', commentText: 'oi tudo bem por aqui' })] } });

    const operator = await get(automationActivityPath('auto_a_preco'), operatorA);
    expect(operator.statusCode).toBe(200);
    const body = automationActivitySchema.parse(operator.json());
    expect(body).toMatchObject({ canManage: false, misses: null });
    expect(body.entries).toHaveLength(5);
    expect(operator.body).not.toContain('Bia Atividade');
    expect(operator.body).not.toContain('oi tudo bem');
  });

  it('automação de outra empresa ou inexistente responde 404; o log nunca leva o texto do comentário', async () => {
    expect(expectProblem(await get(automationActivityPath('auto_b_preco'), ownerA), 404).detail).toBe(NOT_FOUND_TEXT);
    expect(expectProblem(await get(automationActivityPath('auto_inexistente'), ownerA), 404).detail).toBe(NOT_FOUND_TEXT);
    expect(logs).not.toContain('quero o preço da Atividade');
    expect(logs).not.toContain('oi tudo bem por aqui');
  });
});

const NOT_FOUND_TEXT = 'Automação não encontrada nesta empresa.';

const questionInput = (extra: Record<string, unknown> = {}) => ({
  accountId: instagramA._id,
  name: 'Pergunta antes do guia',
  keywords: ['guia'],
  question: 'Oi! Quer receber o guia? Responda SIM.',
  reward: 'Aqui está o guia.',
  buttonTitle: 'Baixar guia',
  url: 'https://loja.exemplo.test/guia.pdf',
  ...extra,
});

describe('Automações (A6): comentário → perguntar antes do link (Instagram, nasce pausado)', () => {
  let questionApp: FastifyInstance;

  beforeAll(async () => {
    questionApp = await buildApp(writeConfig, {
      services,
      logStream: new Writable({ write(chunk: Buffer, _encoding, done) { logs += chunk.toString(); done(); } }),
      zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url }),
    });
    await questionApp.ready();
  });

  afterAll(async () => {
    await questionApp?.close();
  });

  it('recusas antes da Zernio: trava, papel, conta que não é Instagram, palavra-chave vazia e link sem https', async () => {
    const before = sim.workflowWrites.length;
    expect(expectProblem(await write(app, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput()), 409).detail).toContain('desligado');
    expect(expectProblem(await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, operatorA, questionInput()), 403).detail).toContain('Só o dono');
    expect(expectProblem(await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput({ accountId: facebookA._id })), 400).detail).toBe('O link de conversa está disponível só para contas do Instagram nesta etapa.');
    expect(expectProblem(await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput({ keywords: [] })), 400).detail).toBe('Informe pelo menos uma palavra-chave.');
    expect(expectProblem(await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput({ url: 'http://loja.exemplo.test/guia' })), 400).detail).toBe('O link precisa começar com https://.');
    expect(sim.workflowWrites.length).toBe(before);
  });

  it('cria a pergunta pausada: comentário → pergunta em texto → espera → botão com o link, sem botão antes da resposta', async () => {
    const writesBefore = sim.workflowWrites.length;
    const response = await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput());
    expect(response.statusCode).toBe(201);
    const created = flowSummarySchema.parse(response.json());
    expect(created).toMatchObject({ kind: 'question', link: null, ref: null, isActive: false, status: 'draft' });
    const nodes = sim.workflowWrites.at(-1)?.body.nodes as { id: string; type: string; config?: Record<string, unknown> }[];
    expect(nodes.map((node) => node.type)).toEqual(['trigger', 'send_message', 'wait_for_reply', 'send_message', 'end']);
    expect(nodes[0]?.config).toEqual({ triggerType: 'comment', comment: { keywords: ['guia'], matchType: 'contains' } });
    expect(nodes[1]?.config).toEqual({ messageType: 'text', text: 'Oi! Quer receber o guia? Responda SIM.' });
    expect(nodes[2]?.config).toEqual({ timeoutMinutes: 1440, saveAs: 'answer' });
    expect(nodes[3]?.config).toEqual({ messageType: 'text', text: 'Aqui está o guia.', buttons: [{ type: 'url', title: 'Baixar guia', url: 'https://loja.exemplo.test/guia.pdf' }] });
    const edges = sim.workflowWrites.at(-1)?.body.edges as { source: string; target: string; sourceHandle?: string }[];
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'n_wait', target: 'n_link', sourceHandle: 'reply' }),
        expect.objectContaining({ source: 'n_wait', target: 'n_end', sourceHandle: 'timeout' }),
      ]),
    );
    // Não há botão na pergunta nem na espera: só no envio do link
    expect(nodes[1]?.config).not.toHaveProperty('buttons');
    // Só esta criação aconteceu nesta etapa do teste: nenhuma ativação
    expect(sim.workflowWrites.slice(writesBefore).some((item) => item.path.endsWith('/activate'))).toBe(false);
    expect(sim.workflowWrites.length).toBe(writesBefore + 1);

    const list = flowsListSchema.parse((await get(AUTOMATIONS_FLOWS_PATH, ownerA)).json());
    expect(list.flows).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, kind: 'question', link: null })]));
  });

  it('Zernio recusa a criação: mensagem fixa e nenhuma pergunta criada', async () => {
    sim.automationWriteMode = 'invalid';
    try {
      expect(expectProblem(await write(questionApp, 'POST', AUTOMATIONS_FLOW_QUESTION_PATH, ownerA, questionInput({ name: 'Outra pergunta', keywords: ['outra'] })), 400).detail).toBe(
        'A Zernio recusou os dados da automação. Confira o texto, os botões e as palavras-chave.',
      );
    } finally {
      sim.automationWriteMode = 'ok';
    }
    expect(sim.workflows.some((item) => item.name === 'Outra pergunta')).toBe(false);
  });
});
