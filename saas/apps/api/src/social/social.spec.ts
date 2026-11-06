import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MEDIA_PATH,
  MESSAGE_TEMPLATES_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  SOCIAL_ACCOUNTS_PATH,
  SOCIAL_ANALYTICS_PATH,
  SOCIAL_ERROR_MESSAGES,
  SOCIAL_MEDIA_PATH,
  SOCIAL_OVERVIEW_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SETTINGS_PATH,
  ZERNIO_KEY_PATH,
  mediaFileSchema,
  pinterestBoardsSchema,
  problemDetailsSchema,
  socialAccountsResponseSchema,
  socialAnalyticsSchema,
  socialLibrarySchema,
  socialMediaPath,
  socialOverviewSchema,
  socialPinterestBoardsPath,
  socialPostPath,
  socialPostReschedulePath,
  socialPostResultSchema,
  socialPostRetryPath,
  socialPostSchema,
  socialPostsResponseSchema,
  socialPostUnpublishPath,
  socialSettingsSchema,
  type SocialPostInput,
} from '@disparazap/contracts';
import { members, sessions, socialPosts, users } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createZernioClient } from '../integrations/zernio-client.ts';
import { createServices, type ApiServices } from '../services.ts';
import { ZernioSimulator, type SimAccount } from '../testing/zernio-simulator.ts';
import { resetAnalyticsCache } from './social-overview.ts';
import { resetSyncThrottle } from './social-sync.ts';

// Tudo fictício: Zernio simulada nesta máquina, banco em memória, chaves inventadas
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';
const KEY_A = `sk_${'a1'.repeat(32)}`;
const KEY_B = `sk_${'b2'.repeat(32)}`;
const KEY_D = `sk_${'d4'.repeat(32)}`;
const SECRET_TEXT = 'Promoção de lançamento exclusiva da Loja Exemplo';

const baseEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
  LOG_LEVEL: 'info',
};
const config = loadApiConfig(baseEnv);

const sim = new ZernioSimulator(KEY_A, KEY_B, KEY_D);
let services: ApiServices;
let app: FastifyInstance;
let logs = '';
let superCookie: string;
let ownerA: string;
let viewerA: string;
let operatorA: string;
let ownerB: string;
let ownerC: string;
let ownerD: string;
const acc: Record<string, SimAccount> = {};
let imageA = '';
let imageA2 = '';
let webpA = '';

let address = 0;
const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, payload?: object, origin = PANEL) {
  const body = payload ?? (method === 'POST' || method === 'PUT' ? {} : undefined);
  return app.inject({
    method,
    url,
    remoteAddress: `10.8.0.${++address % 250}`,
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { payload: body } : {}),
  });
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const response = await call('POST', SIGNUP_PATH, undefined, { name: `Dono ${name}`, companyName: name, email, password: PASSWORD });
  expect(response.statusCode).toBe(201);
  return { cookie: cookieOf(response), email };
}

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

async function orgIdOf(ownerName: string) {
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [membership] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  return membership?.org ?? '';
}

let accountSeq = 0;
function addAccount(profileId: string, platform: string, username: string): SimAccount {
  const account: SimAccount = {
    _id: `acc_teste_${++accountSeq}`,
    platform,
    profileId,
    username,
    displayName: `Loja ${username}`,
    profileUrl: `https://social.exemplo.test/${username}`,
    isActive: true,
    needsReconnection: false,
  };
  sim.accounts.set(account._id, account);
  return account;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = (seed: number) => Buffer.from([...PNG, ...randomBytes(64), seed]);
const webpBytes = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), randomBytes(40)]);

async function upload(cookie: string, bytes: Buffer, type: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: `${MEDIA_PATH}?name=${encodeURIComponent(name)}`,
    remoteAddress: '10.8.1.1',
    headers: { origin: PANEL, 'content-type': type, cookie },
    payload: bytes,
  });
  expect(response.statusCode, response.body).toBe(201);
  return mediaFileSchema.parse(response.json()).id;
}

const post = (input: Partial<SocialPostInput> & Pick<SocialPostInput, 'targets' | 'mode'>): SocialPostInput => ({ requestId: randomUUID(), content: '', media: [], scheduledAt: null, ...input });
const publish = (cookie: string, input: SocialPostInput) => call('POST', SOCIAL_POSTS_PATH, cookie, input);
const result = (response: LightMyRequestResponse) => {
  expect(response.statusCode, response.body).toBeLessThan(300);
  return socialPostResultSchema.parse(response.json());
};
const lastRequest = (method: string) => [...sim.postRequests].reverse().find((request) => request.method === method);

/** Id da Zernio de uma publicação local (pelo banco) */
async function zernioIdOf(localId: string) {
  const [row] = await services.database.db.select({ zernio: socialPosts.zernioPostId }).from(socialPosts).where(eq(socialPosts.id, localId));
  return row?.zernio ?? '';
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
  app = await buildApp(config, { services, logStream, zernioClientFactory: (apiKey) => createZernioClient(apiKey, { baseUrl: sim.url, publishTimeoutMs: 1500 }) });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, undefined, { email: SUPER_ADMIN_EMAIL, password: PASSWORD }));
  ownerA = (await signupCompany('Empresa A')).cookie;
  ownerB = (await signupCompany('Empresa B')).cookie;
  ownerC = (await signupCompany('Empresa C')).cookie;
  ownerD = (await signupCompany('Empresa D')).cookie;
  viewerA = await memberOf('Dono Empresa A', 'viewer');
  operatorA = await memberOf('Dono Empresa A', 'operator');

  for (const [cookie, key] of [
    [ownerA, KEY_A],
    [ownerB, KEY_B],
    [ownerD, KEY_D],
  ] as const) {
    const saved = await call('PUT', ZERNIO_KEY_PATH, cookie, { apiKey: key });
    expect(saved.statusCode, saved.body).toBe(200);
  }
  const profileOf = async (owner: string) => {
    const orgId = await orgIdOf(owner);
    return [...sim.profiles.values()].find((profile) => profile.externalId === orgId)?._id ?? '';
  };
  const profileA = await profileOf('Dono Empresa A');
  const profileB = await profileOf('Dono Empresa B');
  const profileD = await profileOf('Dono Empresa D');
  acc.igA = addAccount(profileA, 'instagram', 'loja_a');
  acc.fbA = addAccount(profileA, 'facebook', 'pagina_a');
  acc.liA = addAccount(profileA, 'linkedin', 'empresa_a');
  acc.pinA = addAccount(profileA, 'pinterest', 'pins_a');
  acc.xA = addAccount(profileA, 'twitter', 'loja_a_x');
  acc.ttA = addAccount(profileA, 'tiktok', 'loja_a_tt');
  acc.gbA = addAccount(profileA, 'googlebusiness', 'loja_a_google');
  // Mesma conta Zernio da empresa A, mas no perfil "Default" (fora do DisparaZap): nunca pode ser usada
  acc.igDefault = addAccount('prf_default_da_conta_a', 'instagram', 'loja_a_default');
  acc.igB = addAccount(profileB, 'instagram', 'loja_b');
  acc.igD = addAccount(profileD, 'instagram', 'loja_d');
  acc.xD = addAccount(profileD, 'twitter', 'loja_d_x');
  acc.fbD = addAccount(profileD, 'facebook', 'pagina_d');

  imageA = await upload(ownerA, pngBytes(1), 'image/png', 'C:\\fotos\\banner-lancamento.png');
  imageA2 = await upload(ownerA, pngBytes(2), 'image/png', 'segunda.png');
  webpA = await upload(ownerA, webpBytes(), 'image/webp', 'foto.webp');
}, 120_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

const target = (account: SimAccount, extra: Record<string, unknown> = {}) => ({ accountId: account._id, platform: account.platform as never, ...extra });

describe('Redes Sociais: visão geral e contas', () => {
  it('sem Zernio configurada: a visão geral diz isso e não inventa números', async () => {
    const overview = socialOverviewSchema.parse((await call('GET', SOCIAL_OVERVIEW_PATH, ownerC)).json());
    expect(overview.connection).toBe('not_configured');
    expect(overview.accounts).toEqual([]);
    expect(overview.counts).toEqual({ published: 0, scheduled: 0, failed: 0, drafts: 0 });
    expect(overview.performance).toBeNull();
    expect(overview.timezone).toBe('America/Sao_Paulo');
  });

  it('com Zernio: só as contas do perfil da empresa; TikTok aparece sem poder publicar (vídeo vem depois)', async () => {
    const overview = socialOverviewSchema.parse((await call('GET', SOCIAL_OVERVIEW_PATH, ownerA)).json());
    expect(overview.connection).toBe('ok');
    expect(overview.canPublish).toBe(true);
    const ids = overview.accounts.map((account) => account.id);
    expect(ids).toContain(acc.igA?._id);
    expect(ids).not.toContain(acc.igDefault?._id);
    expect(ids).not.toContain(acc.igB?._id);
    const tiktok = overview.accounts.find((account) => account.platform === 'tiktok');
    expect(tiktok?.publishable).toBe(false);
    expect(tiktok?.reason).toContain('vídeo');
    expect(overview.accounts.find((account) => account.platform === 'instagram')?.publishable).toBe(true);
  });

  it('visualizador vê, mas não publica; Super-Admin sem empresa e outro site são recusados', async () => {
    const accounts = socialAccountsResponseSchema.parse((await call('GET', SOCIAL_ACCOUNTS_PATH, viewerA)).json());
    expect(accounts.canPublish).toBe(false);
    const before = sim.postRequests.length;
    expectProblem(await publish(viewerA, post({ content: 'oi', targets: [target(acc.liA as SimAccount)], mode: 'now' })), 403);
    expect(sim.postRequests.length).toBe(before);
    expectProblem(await call('GET', SOCIAL_OVERVIEW_PATH, superCookie), 403);
    expectProblem(await call('GET', SOCIAL_OVERVIEW_PATH, undefined), 401);
    expectProblem(await call('POST', SOCIAL_POSTS_PATH, ownerA, post({ content: 'oi', targets: [target(acc.liA as SimAccount)], mode: 'now' }), 'https://outro-site.test'), 403);
  });
});

describe('Redes Sociais: publicar agora', () => {
  let published = '';

  it('publica com imagem e texto por rede: envia o arquivo sem a chave, usa os nomes exatos e a Idempotency-Key', async () => {
    const input = post({
      content: SECRET_TEXT,
      media: [{ kind: 'library', id: imageA }],
      targets: [target(acc.igA as SimAccount), target(acc.liA as SimAccount, { customContent: 'Versão para o LinkedIn' })],
      mode: 'now',
    });
    const created = result(await publish(ownerA, input));
    published = created.post.id;
    expect(created.replayed).toBe(false);
    expect(created.post.status).toBe('published');
    expect(created.post.createdInApp).toBe(true);
    expect(created.post.createdByName).toBe('Dono Empresa A');
    expect(created.post.targets.every((item) => item.status === 'published' && item.url?.startsWith('https://'))).toBe(true);
    expect(created.post.media).toEqual([{ kind: 'library', id: imageA, url: `${MEDIA_PATH}/${imageA}` }]);

    // Envio do arquivo: endereço assinado, tipo certo, mesmos bytes, e NUNCA a chave da empresa
    const sent = sim.uploads.at(-1);
    expect(sent?.authorization).toBeUndefined();
    expect(sent?.contentType).toBe('image/png');
    expect(sim.presigns.at(-1)).toEqual({ filename: `${imageA}.png`, contentType: 'image/png', size: sent?.bytes.length });

    const request = lastRequest('POST');
    expect(request?.headers['idempotency-key']).toBe(input.requestId);
    expect(request?.body).toEqual({
      content: SECRET_TEXT,
      mediaItems: [{ type: 'image', url: expect.stringContaining('/public/uploads/') }],
      platforms: [
        { platform: 'instagram', accountId: acc.igA?._id },
        { platform: 'linkedin', accountId: acc.liA?._id, customContent: 'Versão para o LinkedIn' },
      ],
      timezone: 'America/Sao_Paulo',
      publishNow: true,
    });
  });

  it('repetir o mesmo pedido não publica de novo (nem chama a Zernio)', async () => {
    const first = post({ content: 'Texto único de teste', targets: [target(acc.liA as SimAccount)], mode: 'now' });
    result(await publish(ownerA, first));
    const calls = sim.postRequests.length;
    const again = result(await publish(ownerA, first));
    expect(again.replayed).toBe(true);
    expect(sim.postRequests.length).toBe(calls);
  });

  it('tempo esgotado: repete com a mesma chave e a Zernio devolve o mesmo post (um só criado)', async () => {
    const before = sim.posts.size;
    sim.delayNextPostMs = 3000;
    const created = result(await publish(ownerA, post({ content: 'Publicação lenta', targets: [target(acc.liA as SimAccount)], mode: 'now' })));
    expect(created.post.status).toBe('published');
    expect(sim.posts.size).toBe(before + 1);
    const keys = sim.postRequests.slice(-2).map((request) => request.headers['idempotency-key']);
    expect(keys[0]).toBe(keys[1]);
  }, 20_000);

  it('falha parcial: mostra cada rede, com mensagem fixa (nunca o texto da rede); tentar de novo refaz só a que falhou', async () => {
    sim.failPlatforms.add('facebook');
    const created = result(await publish(ownerA, post({ content: 'Parcial', targets: [target(acc.fbA as SimAccount), target(acc.liA as SimAccount)], mode: 'now' })));
    expect(created.post.status).toBe('partial');
    const facebook = created.post.targets.find((item) => item.platform === 'facebook');
    expect(facebook?.status).toBe('failed');
    expect(facebook?.error).toEqual({ category: 'user_content', ...SOCIAL_ERROR_MESSAGES.user_content });
    expect(JSON.stringify(created)).not.toContain('texto bruto');

    sim.failPlatforms.clear();
    const retried = result(await call('POST', socialPostRetryPath(created.post.id), ownerA));
    expect(retried.post.status).toBe('published');
    expect(lastRequest('POST')?.path).toBe(`/posts/${await zernioIdOf(created.post.id)}/retry`);
    expectProblem(await call('POST', socialPostRetryPath(created.post.id), ownerA), 409);
  });

  it('remover da rede: só dono e administradores; Instagram não permite', async () => {
    expectProblem(await call('POST', socialPostUnpublishPath(published), operatorA, { platform: 'linkedin', accountId: acc.liA?._id }), 403);
    expectProblem(await call('POST', socialPostUnpublishPath(published), ownerA, { platform: 'instagram', accountId: acc.igA?._id }), 400);
    const removed = result(await call('POST', socialPostUnpublishPath(published), ownerA, { platform: 'linkedin', accountId: acc.liA?._id }));
    expect(removed.post.targets.find((item) => item.platform === 'linkedin')?.status).toBe('cancelled');
    expect(lastRequest('POST')?.body).toEqual({ platform: 'linkedin', accountId: acc.liA?._id });
  });

  it('Story e Pinterest: formato e opções vão em platformSpecificData', async () => {
    result(await publish(ownerA, post({ media: [{ kind: 'library', id: imageA2 }], targets: [target(acc.igA as SimAccount, { format: 'story' })], mode: 'now' })));
    expect(lastRequest('POST')?.body.platforms).toEqual([{ platform: 'instagram', accountId: acc.igA?._id, platformSpecificData: { contentType: 'story' } }]);
    expectProblem(
      await publish(ownerA, post({ media: [{ kind: 'library', id: imageA }, { kind: 'library', id: imageA2 }], targets: [target(acc.igA as SimAccount, { format: 'story' })], mode: 'now' })),
      400,
    );

    const boards = pinterestBoardsSchema.parse((await call('GET', socialPinterestBoardsPath(acc.pinA?._id ?? ''), ownerA)).json());
    expect(boards.boards.map((board) => board.name)).toEqual(['Promoções', 'Novidades']);
    expectProblem(await call('GET', socialPinterestBoardsPath(acc.igA?._id ?? ''), ownerA), 400);
    const pin = result(
      await publish(
        ownerA,
        post({
          content: 'Descrição do pin',
          media: [{ kind: 'library', id: imageA }],
          targets: [target(acc.pinA as SimAccount, { pinterest: { title: 'Título do pin', link: 'https://loja.exemplo.test/produto', boardId: 'board_novidades' } })],
          mode: 'now',
        }),
      ),
    );
    expect(lastRequest('POST')?.body.platforms).toEqual([
      { platform: 'pinterest', accountId: acc.pinA?._id, platformSpecificData: { title: 'Título do pin', link: 'https://loja.exemplo.test/produto', boardId: 'board_novidades' } },
    ]);
    // As opções do pin voltam na publicação (a edição vem preenchida)
    expect(pin.post.targets[0]?.pinterest).toEqual({ title: 'Título do pin', link: 'https://loja.exemplo.test/produto', boardId: 'board_novidades' });
  });
});

describe('Redes Sociais: regras de cada rede e erros da Zernio', () => {
  it('regras conferidas na API antes de chamar a Zernio', async () => {
    const before = sim.postRequests.length;
    const cases: [SocialPostInput, RegExp][] = [
      [post({ content: 'Sem imagem', targets: [target(acc.igD as SimAccount)], mode: 'now' }), /Instagram .*precisa de uma imagem/],
      [post({ content: 'x'.repeat(281), targets: [target(acc.xD as SimAccount)], mode: 'now' }), /X \(Twitter\).*280/],
      [post({ content: 'oi', targets: [target(acc.xD as SimAccount), target(acc.xD as SimAccount)], mode: 'now' }), /duas vezes/],
      [post({ content: 'oi', targets: [target(acc.igDefault as SimAccount)], mode: 'now' }), /não encontrada/],
      [post({ content: 'oi', targets: [{ accountId: acc.igD?._id ?? '', platform: 'tiktok' as never }], mode: 'now' }), /./],
    ];
    for (const [input, message] of cases) {
      const response = await publish(ownerD, input);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(problemDetailsSchema.parse(response.json()).detail ?? '').toMatch(message);
    }
    // Imagem de outra empresa não é encontrada na biblioteca desta
    expectProblem(await publish(ownerD, post({ media: [{ kind: 'library', id: imageA }], targets: [target(acc.igD as SimAccount)], mode: 'now' })), 404);
    expect(sim.postRequests.length).toBe(before);
  });

  it('WebP no Instagram é recusado (aceita só JPG e PNG)', async () => {
    const response = await publish(ownerA, post({ media: [{ kind: 'library', id: webpA }], targets: [target(acc.igA as SimAccount)], mode: 'now' }));
    expect(expectProblem(response, 400).detail).toContain('JPEG, PNG');
  });

  it('conta que precisa reconectar, conta desconectada na Zernio e limite de publicações viram mensagens claras', async () => {
    (acc.fbD as SimAccount).needsReconnection = true;
    expect(expectProblem(await publish(ownerD, post({ content: 'oi', targets: [target(acc.fbD as SimAccount)], mode: 'now' })), 409).detail).toContain('reconectada');
    (acc.fbD as SimAccount).needsReconnection = false;

    sim.failRoute = { method: 'POST', path: '/posts', status: 403, body: { error: 'Account disconnected', type: 'permission_error', code: 'ACCOUNT_DISCONNECTED' } };
    expect(expectProblem(await publish(ownerD, post({ content: 'oi', targets: [target(acc.xD as SimAccount)], mode: 'now' })), 409).detail).toContain('Reconecte');

    sim.failRoute = { method: 'POST', path: '/posts', status: 429, body: { error: 'Velocity limit', type: 'rate_limit_error', code: 'velocity_limit' }, headers: { 'retry-after': '120' } };
    expect(expectProblem(await publish(ownerD, post({ content: 'oi', targets: [target(acc.xD as SimAccount)], mode: 'now' })), 429).detail).toContain('2 min');

    sim.failRoute = { method: 'POST', path: '/posts', status: 409, body: { error: 'Duplicate content detected', type: 'invalid_request_error', code: 'duplicate_content' } };
    expect(expectProblem(await publish(ownerD, post({ content: 'oi', targets: [target(acc.xD as SimAccount)], mode: 'now' })), 409).detail).toContain('24 horas');
  });
});

describe('Redes Sociais: agendar, rascunho, editar e cancelar', () => {
  let scheduled = '';

  it('agenda no fuso da empresa (horário passado recusado) e manda o instante exato com o fuso', async () => {
    expectProblem(await publish(ownerA, post({ content: 'Antigo', targets: [target(acc.liA as SimAccount)], mode: 'schedule', scheduledAt: '2020-01-01T10:00' })), 400);
    const created = result(await publish(ownerA, post({ content: 'Agendada', targets: [target(acc.liA as SimAccount)], mode: 'schedule', scheduledAt: '2030-12-01T10:00' })));
    scheduled = created.post.id;
    expect(created.post.status).toBe('scheduled');
    expect(created.post.scheduledFor).toBe('2030-12-01T13:00:00.000Z');
    expect(lastRequest('POST')?.body).toMatchObject({ scheduledFor: '2030-12-01T13:00:00.000Z', timezone: 'America/Sao_Paulo' });
    expect(lastRequest('POST')?.body.publishNow).toBeUndefined();
  });

  it('fuso da empresa: só dono e administradores trocam; fuso inválido recusado; o agendamento segue o novo fuso', async () => {
    expectProblem(await call('PUT', SOCIAL_SETTINGS_PATH, operatorA, { timezone: 'America/Manaus' }), 403);
    expectProblem(await call('PUT', SOCIAL_SETTINGS_PATH, ownerA, { timezone: 'Marte/Base_Um' }), 400);
    expect(socialSettingsSchema.parse((await call('PUT', SOCIAL_SETTINGS_PATH, ownerA, { timezone: 'America/Manaus' })).json()).timezone).toBe('America/Manaus');
    const created = result(await publish(ownerA, post({ content: 'Manaus', targets: [target(acc.liA as SimAccount)], mode: 'schedule', scheduledAt: '2030-12-01T10:00' })));
    expect(created.post.scheduledFor).toBe('2030-12-01T14:00:00.000Z');
    expect(lastRequest('POST')?.body.timezone).toBe('America/Manaus');
    expect(socialSettingsSchema.parse((await call('PUT', SOCIAL_SETTINGS_PATH, ownerA, { timezone: 'America/Sao_Paulo' })).json()).timezone).toBe('America/Sao_Paulo');
  });

  it('reagendar um agendado; publicação já publicada não pode ser editada', async () => {
    const updated = result(await call('PUT', socialPostPath(scheduled), ownerA, post({ content: 'Agendada (nova hora)', targets: [target(acc.liA as SimAccount)], mode: 'schedule', scheduledAt: '2030-12-02T09:30' })));
    expect(updated.post.scheduledFor).toBe('2030-12-02T12:30:00.000Z');
    expect(lastRequest('PUT')?.body).toMatchObject({ scheduledFor: '2030-12-02T12:30:00.000Z', isDraft: false, content: 'Agendada (nova hora)' });

    // Reagendar só a data: a Zernio recebe só o horário e o fuso (o resto do post fica como está)
    expectProblem(await call('POST', socialPostReschedulePath(scheduled), ownerA, { scheduledAt: '2020-01-01T08:00' }), 400);
    const moved = result(await call('POST', socialPostReschedulePath(scheduled), ownerA, { scheduledAt: '2030-12-03T08:15' }));
    expect(moved.post.scheduledFor).toBe('2030-12-03T11:15:00.000Z');
    expect(moved.post.content).toBe('Agendada (nova hora)');
    expect(lastRequest('PUT')?.body).toEqual({ scheduledFor: '2030-12-03T11:15:00.000Z', timezone: 'America/Sao_Paulo' });
    expectProblem(await call('POST', socialPostReschedulePath(scheduled), viewerA, { scheduledAt: '2030-12-04T08:15' }), 403);

    const done = result(await publish(ownerA, post({ content: 'Já saiu', targets: [target(acc.liA as SimAccount)], mode: 'now' })));
    const puts = sim.postRequests.filter((request) => request.method === 'PUT').length;
    expectProblem(await call('PUT', socialPostPath(done.post.id), ownerA, post({ content: 'mudar', targets: [target(acc.liA as SimAccount)], mode: 'now' })), 409);
    expectProblem(await call('DELETE', socialPostPath(done.post.id), ownerA), 409);
    expect(sim.postRequests.filter((request) => request.method === 'PUT').length).toBe(puts);
  });

  it('rascunho sem contas; depois publicado pelo próprio rascunho', async () => {
    const draft = result(await publish(ownerA, post({ content: 'Ideia de post', targets: [], mode: 'draft' })));
    expect(draft.post.status).toBe('draft');
    expect(lastRequest('POST')?.body).toMatchObject({ isDraft: true, platforms: [] });
    const now = result(await call('PUT', socialPostPath(draft.post.id), ownerA, post({ content: 'Ideia de post', targets: [target(acc.liA as SimAccount)], mode: 'now' })));
    expect(now.post.status).toBe('published');
    expect(lastRequest('PUT')?.body).toMatchObject({ publishNow: true, isDraft: false });
  });

  it('cancelar um agendado exclui na Zernio e aqui', async () => {
    const response = await call('DELETE', socialPostPath(scheduled), ownerA);
    expect(response.statusCode).toBe(204);
    expect(lastRequest('DELETE')?.path).toMatch(/^\/posts\//);
    expectProblem(await call('GET', socialPostPath(scheduled), ownerA), 404);
  });
});

describe('Redes Sociais: histórico, calendário e sincronização', () => {
  it('outra empresa não vê nem mexe nas publicações', async () => {
    const list = socialPostsResponseSchema.parse((await call('GET', SOCIAL_POSTS_PATH, ownerA)).json());
    const anyId = list.posts[0]?.id ?? '';
    expect(anyId).not.toBe('');
    expectProblem(await call('GET', socialPostPath(anyId), ownerB), 404);
    expectProblem(await call('DELETE', socialPostPath(anyId), ownerB), 404);
    expectProblem(await call('POST', socialPostRetryPath(anyId), ownerB), 404);
    const listB = socialPostsResponseSchema.parse((await call('GET', SOCIAL_POSTS_PATH, ownerB)).json());
    expect(listB.posts.some((item) => item.id === anyId)).toBe(false);
  });

  it('traz publicações criadas direto na Zernio (só do perfil da empresa), pedindo só o que mudou', async () => {
    resetSyncThrottle();
    const profileA = acc.igA?.profileId ?? '';
    sim.addExternalPost({ profileId: profileA, accountId: acc.igA?._id ?? '', platform: 'instagram', content: 'Criado no painel da Zernio', scheduledFor: '2030-11-20T15:00:00.000Z' });
    sim.addExternalPost({ profileId: 'prf_default_da_conta_a', accountId: acc.igDefault?._id ?? '', platform: 'instagram', content: 'De outro perfil' });
    const list = socialPostsResponseSchema.parse((await call('GET', `${SOCIAL_POSTS_PATH}?refresh=1`, ownerA)).json());
    const external = list.posts.find((item) => item.content === 'Criado no painel da Zernio');
    expect(external?.createdInApp).toBe(false);
    expect(external?.targets[0]?.accountLabel).toBe('@loja_a');
    expect(list.posts.some((item) => item.content === 'De outro perfil')).toBe(false);
    const query = sim.listQueries.at(-1);
    expect(query).toMatchObject({ profileId: profileA, limit: '100' });
    expect(query?.updatedSince).toMatch(/Z$/);
    expect(list.syncError).toBeNull();
    expect(list.syncedAt).not.toBeNull();

    // Excluída lá: some daqui ao abrir os detalhes
    sim.posts.delete(await zernioIdOf(external?.id ?? ''));
    expectProblem(await call('GET', socialPostPath(external?.id ?? ''), ownerA), 404);
  });

  it('calendário por intervalo, filtros e busca', async () => {
    const range = socialPostsResponseSchema.parse((await call('GET', `${SOCIAL_POSTS_PATH}?from=2030-12-01T00:00:00.000Z&to=2030-12-31T00:00:00.000Z`, ownerA)).json());
    expect(range.posts.every((item) => item.occursAt >= '2030-12-01' && item.occursAt < '2030-12-31')).toBe(true);
    expect(range.posts.some((item) => item.content === 'Manaus')).toBe(true);
    const linkedin = socialPostsResponseSchema.parse((await call('GET', `${SOCIAL_POSTS_PATH}?platform=linkedin`, ownerA)).json());
    expect(linkedin.posts.length).toBeGreaterThan(0);
    expect(linkedin.posts.every((item) => item.targets.some((t) => t.platform === 'linkedin'))).toBe(true);
    const search = socialPostsResponseSchema.parse((await call('GET', `${SOCIAL_POSTS_PATH}?search=${encodeURIComponent('100%')}`, ownerA)).json());
    expect(search.posts).toEqual([]);
    const failedNone = socialPostsResponseSchema.parse((await call('GET', `${SOCIAL_POSTS_PATH}?status=failed`, ownerA)).json());
    expect(failedNone.posts.every((item) => item.status === 'failed')).toBe(true);
  });

  it('visão geral com números reais, próximas publicações e métricas (ou aviso de plano)', async () => {
    resetAnalyticsCache();
    const overview = socialOverviewSchema.parse((await call('GET', SOCIAL_OVERVIEW_PATH, ownerA)).json());
    expect(overview.counts.published).toBeGreaterThan(0);
    expect(overview.counts.scheduled).toBeGreaterThan(0);
    expect(overview.upcoming[0]?.status).toBe('scheduled');
    expect(overview.performance?.state).toBe('available');

    const analytics = socialAnalyticsSchema.parse((await call('GET', `${SOCIAL_ANALYTICS_PATH}?days=7`, ownerA)).json());
    expect(analytics.state).toBe('available');
    if (analytics.state === 'available') {
      expect(analytics.totals.likes).toBeGreaterThan(0);
      expect(analytics.topPosts[0]?.url).toMatch(/^https:/);
    }
    expectProblem(await call('GET', `${SOCIAL_ANALYTICS_PATH}?days=15`, ownerA), 400);

    resetAnalyticsCache();
    sim.analyticsLocked = true;
    const locked = socialAnalyticsSchema.parse((await call('GET', `${SOCIAL_ANALYTICS_PATH}?days=30`, ownerA)).json());
    expect(locked).toMatchObject({ state: 'unavailable', reason: 'plan' });
    sim.analyticsLocked = false;
  });
});

describe('Redes Sociais: biblioteca de mídia', () => {
  it('lista as imagens com o nome do arquivo (sem a pasta); só dono e administradores excluem; imagem de modelo fica', async () => {
    const library = socialLibrarySchema.parse((await call('GET', SOCIAL_MEDIA_PATH, ownerA)).json());
    expect(library.items.map((item) => item.fileName)).toContain('banner-lancamento.png');
    expect(library.canDelete).toBe(true);
    expect(socialLibrarySchema.parse((await call('GET', SOCIAL_MEDIA_PATH, operatorA)).json()).canDelete).toBe(false);
    expect(socialLibrarySchema.parse((await call('GET', SOCIAL_MEDIA_PATH, ownerB)).json()).items).toEqual([]);

    expectProblem(await call('DELETE', socialMediaPath(webpA), operatorA), 403);
    const template = await call('POST', MESSAGE_TEMPLATES_PATH, ownerA, { name: 'Modelo com imagem', body: 'Olá', mediaId: imageA2 });
    expect(template.statusCode, template.body).toBe(201);
    expect(expectProblem(await call('DELETE', socialMediaPath(imageA2), ownerA), 409).detail).toContain('Modelo com imagem');
    expect((await call('DELETE', socialMediaPath(webpA), ownerA)).statusCode).toBe(204);
    expectProblem(await call('DELETE', socialMediaPath(webpA), ownerA), 404);
    expectProblem(await call('DELETE', socialMediaPath(imageA), ownerB), 404);
  });
});

describe('Redes Sociais: o que vai para o log', () => {
  it('nem a chave da Zernio nem o texto das publicações aparecem no log', () => {
    expect(logs).toContain('redes.publicacao');
    expect(logs).not.toContain(KEY_A);
    expect(logs).not.toContain(SECRET_TEXT);
    expect(logs).not.toContain('texto bruto');
  });

  it('o post devolvido segue o contrato público', async () => {
    const list = socialPostsResponseSchema.parse((await call('GET', SOCIAL_POSTS_PATH, ownerA)).json());
    for (const item of list.posts) socialPostSchema.parse(item);
  });
});
