import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVOLUTION_SETTINGS_PATH,
  PLATFORM_WHATSAPP_INSTANCES_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  WHATSAPP_INSTANCES_PATH,
  pairCodeSchema,
  platformInstanceListSchema,
  problemDetailsSchema,
  qrCodeSchema,
  whatsappInstanceListSchema,
  whatsappInstanceSchema,
  whatsappInstancePath,
} from '@disparazap/contracts';
import { integrationCredentials, members, sessions, users, whatsappInstances } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createServices, type ApiServices } from '../services.ts';
import { EvolutionSimulator } from '../testing/evolution-simulator.ts';
import { classifySendFailure, phoneFromJid } from '../integrations/whatsapp-provider.ts';

// Tudo fictício: Evolution Go simulada nesta máquina, banco em memória, números de exemplo
const PANEL = 'http://127.0.0.1:3000';
const PASSWORD = 'senha-forte-de-teste-123';
const GLOBAL_KEY = 'chave-global-ficticia-WA01';
const SUPER_ADMIN_EMAIL = 'super.admin@disparazap.test';

const config = loadApiConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
  SUPER_ADMIN_EMAIL,
  DATABASE_EMBEDDED_DIR: 'memory://',
});

const sim = new EvolutionSimulator(GLOBAL_KEY);
let services: ApiServices;
let app: FastifyInstance;
let superCookie: string;
let ownerA: string;
let ownerB: string;
let viewerA: string;
let instanceId: string;

let address = 0;
const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

// Como o navegador: content-type só quando há corpo (DELETE vai sem corpo)
function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, payload?: object) {
  const body = payload ?? (method === 'POST' || method === 'PUT' ? {} : undefined);
  return app.inject({
    method,
    url,
    remoteAddress: `10.9.0.${++address % 250}`,
    headers: { origin: PANEL, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { payload: body } : {}),
  });
}

async function signupCompany(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@empresa.test`;
  const response = await call('POST', SIGNUP_PATH, undefined, { name: `Dono ${name}`, companyName: name, email, password: PASSWORD });
  expect(response.statusCode).toBe(201);
  return { cookie: cookieOf(response), email };
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  app = await buildApp(config, { services });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, undefined, { email: SUPER_ADMIN_EMAIL, password: PASSWORD }));
  ownerA = (await signupCompany('Empresa A')).cookie;
  ownerB = (await signupCompany('Empresa B')).cookie;

  // Um "viewer" da Empresa A: conta própria, movida para a Empresa A com papel de leitura
  const viewer = await signupCompany('Visitante');
  viewerA = viewer.cookie;
  const db = services.database.db;
  const [ownerAUser] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'Dono Empresa A'));
  const [orgA] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, ownerAUser?.id ?? ''));
  const [viewerUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, viewer.email));
  await db.update(members).set({ organizationId: orgA?.org ?? '', role: 'viewer' }).where(eq(members.userId, viewerUser?.id ?? ''));
  await db.update(sessions).set({ activeOrganizationId: orgA?.org ?? '' }).where(eq(sessions.userId, viewerUser?.id ?? ''));
}, 90_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

describe('sem a integração global configurada', () => {
  it('a lista avisa que a integração não está disponível, e criar é recusado', async () => {
    const list = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerA)).json());
    expect(list).toMatchObject({ instances: [], limit: 1, canManage: true, integration: 'missing' });
    expect(expectProblem(await call('POST', WHATSAPP_INSTANCES_PATH, ownerA, { displayName: 'Vendas' }), 409).detail).toContain('integração');
  });

  it('com a integração configurada, ela fica pronta', async () => {
    const saved = await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active', apiKey: GLOBAL_KEY });
    expect(saved.statusCode).toBe(200);
    const list = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerA)).json());
    expect(list.integration).toBe('ready');
  });
});

describe('ciclo de vida de uma instância', () => {
  it('cria: nome técnico dz_, token próprio cifrado, nada técnico na resposta', async () => {
    const response = await call('POST', WHATSAPP_INSTANCES_PATH, ownerA, { displayName: 'Vendas' });
    expect(response.statusCode).toBe(201);
    const instance = whatsappInstanceSchema.parse(response.json());
    instanceId = instance.id;
    expect(instance).toMatchObject({ displayName: 'Vendas', status: 'created', phone: null });

    const [simInstance] = [...sim.instances.values()];
    expect(simInstance?.name).toMatch(/^dz_[a-z0-9]{1,8}_[0-9a-f]{10}$/);
    expect(simInstance?.token.length).toBeGreaterThanOrEqual(40);
    expect(response.body).not.toContain(simInstance?.token ?? '§');
    expect(response.body).not.toContain(simInstance?.name ?? '§');
    expect(response.body).not.toContain(GLOBAL_KEY);

    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, instanceId));
    expect(row?.providerInstanceId).toBe(simInstance?.id);
    const [credential] = await services.database.db.select().from(integrationCredentials).where(eq(integrationCredentials.id, row?.credentialId ?? ''));
    expect(credential).toMatchObject({ kind: 'instance_token', organizationId: row?.organizationId, revokedAt: null });
    expect(JSON.stringify(credential)).not.toContain(simInstance?.token ?? '§');
  });

  it('respeita o limite de 1 instância por empresa', async () => {
    expect(expectProblem(await call('POST', WHATSAPP_INSTANCES_PATH, ownerA, { displayName: 'Suporte' }), 409).detail).toContain('Limite');
  });

  it('conecta por QR Code: devolve a imagem e fica "Conectando"', async () => {
    const qr = qrCodeSchema.parse((await call('POST', `${whatsappInstancePath(instanceId)}/connect`, ownerA)).json());
    expect(qr.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(qr.instance.status).toBe('connecting');
    const again = qrCodeSchema.parse((await call('GET', `${whatsappInstancePath(instanceId)}/qr`, ownerA)).json());
    expect(again.qrCode).toMatch(/^data:image\//);
  });

  it('depois que o celular lê o QR: sem QR, "Conectado" e com o número', async () => {
    sim.scan([...sim.instances.values()][0]?.name ?? '');
    const qr = qrCodeSchema.parse((await call('GET', `${whatsappInstancePath(instanceId)}/qr`, ownerA)).json());
    expect(qr.qrCode).toBeNull();
    expect(qr.instance).toMatchObject({ status: 'connected', phone: '5511988887777' });
    expect(qr.instance.connectedAt).not.toBeNull();
    const status = whatsappInstanceSchema.parse((await call('GET', `${whatsappInstancePath(instanceId)}/status`, viewerA)).json());
    expect(status.status).toBe('connected');
  });

  it('desconecta: status "Desconectado" e o número some', async () => {
    const response = await call('POST', `${whatsappInstancePath(instanceId)}/logout`, ownerA);
    expect(whatsappInstanceSchema.parse(response.json())).toMatchObject({ status: 'disconnected', phone: null, connectedAt: null });
  });

  it('código de pareamento: valida o número com a regra do MVP e devolve o código', async () => {
    expect(expectProblem(await call('POST', `${whatsappInstancePath(instanceId)}/pair`, ownerA, { phone: '11988887777' }), 400).detail).toContain('DDI 55');
    const response = await call('POST', `${whatsappInstancePath(instanceId)}/pair`, ownerA, { phone: '+55 (11) 98888-7777' });
    expect(pairCodeSchema.parse(response.json())).toMatchObject({ code: 'ABCD1234', instance: { status: 'connecting' } });
  });

  it('a lista consulta o servidor: conexão concluída depois que o painel parou de acompanhar vira "Conectado" com o número', async () => {
    // Caso real de 2026-11-01: o código foi digitado no celular depois dos 2 minutos de acompanhamento do painel
    sim.scan([...sim.instances.values()][0]?.name ?? '', '5531988887777');
    const [instance] = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerA)).json()).instances;
    expect(instance).toMatchObject({ status: 'connected', phone: '5531988887777' });
    expect(platformInstanceListSchema.parse((await call('GET', PLATFORM_WHATSAPP_INSTANCES_PATH, superCookie)).json()).instances[0]).toMatchObject({ status: 'connected' });
  });

  it('a lista consulta o servidor: se o celular desconectar, vira "Desconectado"', async () => {
    sim.drop([...sim.instances.values()][0]?.name ?? '');
    const [instance] = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerA)).json()).instances;
    expect(instance).toMatchObject({ status: 'disconnected', phone: null, connectedAt: null });
  });

  it('exclui: some da Evolution, da lista e revoga o token', async () => {
    const response = await call('DELETE', whatsappInstancePath(instanceId), ownerA);
    expect(response.statusCode).toBe(204);
    expect(sim.instances.size).toBe(0);
    expect(whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerA)).json()).instances).toEqual([]);
    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, instanceId));
    expect(row?.deletedAt).not.toBeNull();
    const [credential] = await services.database.db.select().from(integrationCredentials).where(eq(integrationCredentials.id, row?.credentialId ?? ''));
    expect(credential?.revokedAt).not.toBeNull();
  });
});

describe('isolamento e permissões', () => {
  let instanceOfA: string;

  it('a Empresa B não vê nem age sobre a instância da Empresa A (responde como inexistente)', async () => {
    instanceOfA = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, ownerA, { displayName: 'Atendimento' })).json()).id;
    expect(whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerB)).json()).instances).toEqual([]);
    for (const [method, suffix] of [['GET', '/status'], ['GET', '/qr'], ['POST', '/connect'], ['POST', '/logout'], ['DELETE', '']] as const) {
      expectProblem(await call(method, `${whatsappInstancePath(instanceOfA)}${suffix}`, ownerB), 404);
    }
    expect(sim.instances.size).toBe(1);
  });

  it('quem só visualiza vê a lista e o status, mas não cria, conecta nem exclui', async () => {
    const list = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, viewerA)).json());
    expect(list).toMatchObject({ canManage: false });
    expect(list.instances.map((item) => item.id)).toEqual([instanceOfA]);
    expectProblem(await call('POST', WHATSAPP_INSTANCES_PATH, viewerA, { displayName: 'Outra' }), 403);
    expectProblem(await call('POST', `${whatsappInstancePath(instanceOfA)}/connect`, viewerA), 403);
    expectProblem(await call('DELETE', whatsappInstancePath(instanceOfA), viewerA), 403);
    expect((await call('GET', `${whatsappInstancePath(instanceOfA)}/status`, viewerA)).statusCode).toBe(200);
  });

  it('sem login: 401; pedido de outro site: 403', async () => {
    expectProblem(await call('GET', WHATSAPP_INSTANCES_PATH, undefined), 401);
    const foreign = await app.inject({ method: 'POST', url: WHATSAPP_INSTANCES_PATH, headers: { origin: 'https://malicioso.test', cookie: ownerA, 'content-type': 'application/json' }, payload: { displayName: 'X' } });
    expectProblem(foreign, 403);
  });

  it('Super-Admin vê todas as instâncias com a empresa (só leitura); empresa não acessa essa lista', async () => {
    const all = platformInstanceListSchema.parse((await call('GET', PLATFORM_WHATSAPP_INSTANCES_PATH, superCookie)).json());
    expect(all.instances.map((item) => [item.id, item.organization.name])).toEqual([[instanceOfA, 'Empresa A']]);
    expect(JSON.stringify(all)).not.toMatch(/dz_|token/);
    expectProblem(await call('GET', PLATFORM_WHATSAPP_INSTANCES_PATH, ownerA), 403);
  });

  it('Super-Admin sem empresa não usa o módulo das empresas', async () => {
    expect(expectProblem(await call('GET', WHATSAPP_INSTANCES_PATH, superCookie), 403).detail).toContain('empresa');
  });
});

describe('leitura das respostas da Evolution Go (formatos do código-fonte)', () => {
  it('número a partir do JID, com ou sem o sufixo do servidor', () => {
    expect(phoneFromJid('5511988887777:11')).toBe('5511988887777');
    expect(phoneFromJid('5511988887777:3@s.whatsapp.net')).toBe('5511988887777');
    expect(phoneFromJid('')).toBeNull();
  });

  it('falhas de envio classificadas pelo texto, sem repassá-lo', () => {
    expect(classifySendFailure(500, '{"error":"no active session found"}')).toBe('disconnected');
    expect(classifySendFailure(500, '{"error":"client disconnected"}')).toBe('disconnected');
    expect(classifySendFailure(500, '{"error":"number 5511988887777 is not registered on WhatsApp"}')).toBe('invalid_number');
    expect(classifySendFailure(500, '{"error":"could not parse phone: 123"}')).toBe('invalid_number');
    expect(classifySendFailure(401, '{"error":"not authorized"}')).toBe('unauthorized');
    expect(classifySendFailure(404, '{"error":"instance not found"}')).toBe('not_found');
    expect(classifySendFailure(500, '{"error":"algo inesperado"}')).toBe('rejected');
    expect(classifySendFailure(502, '<html>gateway</html>')).toBe('rejected');
  });
});

describe('falhas da Evolution Go', () => {
  it('se a criação falhar na Evolution: mensagem fixa, nada gravado', async () => {
    const before = await services.database.db.select().from(whatsappInstances);
    sim.failNextCreate = true;
    const problem = expectProblem(await call('POST', WHATSAPP_INSTANCES_PATH, ownerB, { displayName: 'Vendas B' }), 502);
    expect(problem.detail).toContain('servidor de WhatsApp');
    expect(JSON.stringify(problem)).not.toContain('nao-deve-vazar');
    expect(await services.database.db.select().from(whatsappInstances)).toHaveLength(before.length);
  });

  it('se a Evolution não devolver o ID na criação, ele é buscado na lista de instâncias', async () => {
    sim.omitIdOnCreate = true;
    const instance = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, ownerB, { displayName: 'Vendas B' })).json());
    sim.omitIdOnCreate = false;
    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, instance.id));
    expect(row?.providerInstanceId).toBeTruthy();
    expect(sim.instances.has(row?.providerInstanceId ?? '')).toBe(true);
  });

  it('Evolution fora do ar: mensagem fixa, sem detalhes internos', async () => {
    const list = whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerB)).json());
    await sim.stop();
    const problem = expectProblem(await call('GET', `${whatsappInstancePath(list.instances[0]?.id ?? '')}/status`, ownerB), 502);
    expect(problem.detail).toBe('O servidor de WhatsApp não respondeu. Tente de novo em instantes.');
    expect(JSON.stringify(problem)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    await sim.start();
  });
});

describe('exclusão recusada pela Evolution (auditoria de 2026-11-04)', () => {
  let createdId = '';

  beforeAll(async () => {
    // O teste anterior sobe o simulador em outra porta: a integração precisa do endereço atual
    const saved = await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active', apiKey: GLOBAL_KEY });
    expect(saved.statusCode).toBe(200);
    // Empresa B pode ter uma instância de um teste anterior (limite de 1): sai antes, pelo próprio simulador
    for (const item of whatsappInstanceListSchema.parse((await call('GET', WHATSAPP_INSTANCES_PATH, ownerB)).json()).instances) {
      expect((await call('DELETE', whatsappInstancePath(item.id), ownerB)).statusCode).toBe(204);
    }
  });

  it('se o servidor recusa e a instância ainda existe lá, nada é apagado aqui e a tela diz isso (sem o status nem o texto da Evolution)', async () => {
    const created = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, ownerB, { displayName: 'Loja B' })).json());
    createdId = created.id;
    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, created.id));
    expect(sim.instances.has(row?.providerInstanceId ?? '')).toBe(true);

    sim.failNextDelete = true;
    const response = await call('DELETE', whatsappInstancePath(created.id), ownerB);
    const problem = expectProblem(response, 502);
    expect(problem.detail).toContain('Nada foi apagado aqui');
    expect(response.body).not.toContain('falha simulada');
    expect(sim.instances.has(row?.providerInstanceId ?? '')).toBe(true);
    const [after] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, created.id));
    expect(after?.deletedAt).toBeNull();
  });

  it('nova tentativa com o servidor normal exclui de vez', async () => {
    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, createdId));
    expect((await call('DELETE', whatsappInstancePath(createdId), ownerB)).statusCode).toBe(204);
    expect(sim.instances.has(row?.providerInstanceId ?? '')).toBe(false);
    const [after] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, createdId));
    expect(after?.deletedAt).not.toBeNull();
  });

  it('se o servidor recusa mas a instância já não existe lá, a exclusão segue aqui (não prende a empresa)', async () => {
    const created = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, ownerB, { displayName: 'Loja B 2' })).json());
    const [row] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, created.id));
    sim.instances.delete(row?.providerInstanceId ?? '');
    sim.failNextDelete = true;
    expect((await call('DELETE', whatsappInstancePath(created.id), ownerB)).statusCode).toBe(204);
    const [after] = await services.database.db.select().from(whatsappInstances).where(eq(whatsappInstances.id, created.id));
    expect(after?.deletedAt).not.toBeNull();
  });
});
