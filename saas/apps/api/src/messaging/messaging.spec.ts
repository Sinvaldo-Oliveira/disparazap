import { randomBytes } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTACTS_SEARCH_PATH,
  CONTACT_LISTS_PATH,
  EVOLUTION_SETTINGS_PATH,
  MEDIA_PATH,
  MESSAGE_TEMPLATES_PATH,
  MESSAGING_SEND_PATH,
  PROBLEM_CONTENT_TYPE,
  SIGN_IN_PATH,
  SIGNUP_PATH,
  WHATSAPP_INSTANCES_PATH,
  contactListContactsPath,
  contactListDetailSchema,
  contactListPath,
  contactListRemoveContactsPath,
  contactListSaveResultSchema,
  contactListSummarySchema,
  contactListsResponseSchema,
  contactSearchResponseSchema,
  contactUpdateResultSchema,
  contactsAddResultSchema,
  contactsRemoveResultSchema,
  mediaFileSchema,
  mediaPath,
  messageTemplatePath,
  messageTemplateSchema,
  messageTemplatesResponseSchema,
  problemDetailsSchema,
  sendTextResultSchema,
  whatsappInstanceSchema,
  whatsappInstancePath,
} from '@disparazap/contracts';
import { contacts, members, sessions, users, whatsappInstances } from '@disparazap/db';
import { buildApp } from '../app/build-app.ts';
import { createSuperAdmin } from '../auth/super-admin.ts';
import { loadApiConfig } from '../config/env.ts';
import { createServices, type ApiServices } from '../services.ts';
import { EvolutionSimulator } from '../testing/evolution-simulator.ts';

// Tudo fictício: Evolution Go simulada nesta máquina, banco em memória, números de exemplo
const PANEL = 'http://127.0.0.1:5173';
const PASSWORD = 'senha-forte-de-teste-123';
const GLOBAL_KEY = 'chave-global-ficticia-MSG1';
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
let operatorA: string;
let instanceA: string;
let simNameA: string;

let address = 0;
const cookieOf = (response: LightMyRequestResponse) => ([] as string[]).concat(response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string | undefined, payload?: object) {
  const body = payload ?? (method === 'POST' || method === 'PUT' || method === 'PATCH' ? {} : undefined);
  return app.inject({
    method,
    url,
    remoteAddress: `10.8.0.${++address % 250}`,
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

/** Conta própria movida para a empresa do dono com outro papel */
async function memberOf(ownerName: string, role: 'viewer' | 'operator') {
  const account = await signupCompany(`Pessoa ${role}`);
  const db = services.database.db;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.name, ownerName));
  const [org] = await db.select({ org: members.organizationId }).from(members).where(eq(members.userId, owner?.id ?? ''));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email));
  await db.update(members).set({ organizationId: org?.org ?? '', role }).where(eq(members.userId, user?.id ?? ''));
  await db.update(sessions).set({ activeOrganizationId: org?.org ?? '' }).where(eq(sessions.userId, user?.id ?? ''));
  return account.cookie;
}

function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return problemDetailsSchema.parse(response.json());
}

const send = (cookie: string, phone: string, text = 'Olá!', instanceId = instanceA) => call('POST', MESSAGING_SEND_PATH, cookie, { instanceId, phone, text });

beforeAll(async () => {
  await sim.start();
  services = await createServices(config, () => {});
  app = await buildApp(config, { services });
  await app.ready();

  await createSuperAdmin({ auth: services.auth, db: services.database.db, email: SUPER_ADMIN_EMAIL, name: 'Dono da Plataforma', password: PASSWORD });
  superCookie = cookieOf(await call('POST', SIGN_IN_PATH, undefined, { email: SUPER_ADMIN_EMAIL, password: PASSWORD }));
  await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active', apiKey: GLOBAL_KEY });

  ownerA = (await signupCompany('Empresa A')).cookie;
  ownerB = (await signupCompany('Empresa B')).cookie;
  viewerA = await memberOf('Dono Empresa A', 'viewer');
  operatorA = await memberOf('Dono Empresa A', 'operator');

  // Instância da Empresa A, conectada
  instanceA = whatsappInstanceSchema.parse((await call('POST', WHATSAPP_INSTANCES_PATH, ownerA, { displayName: 'Vendas' })).json()).id;
  await call('POST', `${whatsappInstancePath(instanceA)}/connect`, ownerA);
  simNameA = [...sim.instances.values()][0]?.name ?? '';
  sim.scan(simNameA);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await services?.database.close();
  await sim.stop();
});

describe('listas de contatos', () => {
  let listId: string;

  it('começa vazia e diz quem pode enviar', async () => {
    expect(contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, ownerA)).json())).toEqual({ lists: [], canSend: true });
    expect(contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, operatorA)).json()).canSend).toBe(true);
    expect(contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, viewerA)).json()).canSend).toBe(false);
  });

  it('cria: valida de novo cada telefone (regra do MVP), tira repetidos e mantém a ordem', async () => {
    const response = await call('POST', CONTACT_LISTS_PATH, ownerA, {
      name: '  Clientes   de maio ',
      contacts: [
        { name: 'Ana', phone: '5511988887777' },
        { name: 'Bruno\u0007', phone: '+55 (21) 99876-5432' },
        { name: 'Ana de novo', phone: '55 11 98888-7777' },
        { name: 'Sem DDI', phone: '11988887777' },
        { phone: 'abc' },
      ],
    });
    expect(response.statusCode).toBe(201);
    const saved = contactListSaveResultSchema.parse(response.json());
    listId = saved.list.id;
    expect(saved).toMatchObject({ list: { name: 'Clientes de maio', contactCount: 2 }, ignored: { invalid: 2, duplicate: 1 } });

    const detail = contactListDetailSchema.parse((await call('GET', contactListPath(listId), ownerA)).json());
    expect(detail.contacts).toEqual([
      { name: 'Ana', phone: '5511988887777' },
      { name: 'Bruno', phone: '5521998765432' },
    ]);
  });

  it('nome repetido na empresa (sem diferenciar maiúsculas) → 409; nome curto → 400', async () => {
    expect(expectProblem(await call('POST', CONTACT_LISTS_PATH, ownerA, { name: 'CLIENTES DE MAIO', contacts: [] }), 409).detail).toContain('Já existe');
    expect(expectProblem(await call('POST', CONTACT_LISTS_PATH, ownerA, { name: 'X', contacts: [] }), 400).detail).toContain('nome');
    // Outra empresa pode usar o mesmo nome
    expect((await call('POST', CONTACT_LISTS_PATH, ownerB, { name: 'Clientes de maio', contacts: [] })).statusCode).toBe(201);
  });

  it('atualiza: troca o nome e a lista inteira de contatos', async () => {
    const saved = contactListSaveResultSchema.parse(
      (await call('PUT', contactListPath(listId), operatorA, { name: 'Clientes de junho', contacts: [{ name: 'Carla', phone: '5531988887777' }] })).json(),
    );
    expect(saved.list).toMatchObject({ id: listId, name: 'Clientes de junho', contactCount: 1 });
    const detail = contactListDetailSchema.parse((await call('GET', contactListPath(listId), viewerA)).json());
    expect(detail.contacts).toEqual([{ name: 'Carla', phone: '5531988887777' }]);
  });

  it('aceita 10.000 contatos num pedido só (mais de 1 MB) e recusa acima disso', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ name: `Contato de exemplo número ${i} com um nome comprido para ocupar espaço`, phone: `55119${String(i).padStart(8, '0')}` }));
    expect(JSON.stringify(many).length).toBeGreaterThan(1024 * 1024);
    const response = await call('POST', CONTACT_LISTS_PATH, ownerA, { name: 'Lista grande', contacts: many });
    expect(response.statusCode).toBe(201);
    expect(contactListSaveResultSchema.parse(response.json()).list.contactCount).toBe(10_000);
    const tooMany = [...many, { name: 'Um a mais', phone: '5511988880000' }];
    expect(expectProblem(await call('POST', CONTACT_LISTS_PATH, ownerA, { name: 'Lista grande demais', contacts: tooMany }), 400).detail).toContain('10.000');
  }, 60_000);

  it('a Empresa B não vê, não lê, não altera nem exclui as listas da Empresa A', async () => {
    const listsB = contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, ownerB)).json()).lists;
    expect(listsB.map((list) => list.name)).toEqual(['Clientes de maio']);
    expect(listsB.some((list) => list.id === listId)).toBe(false);
    expectProblem(await call('GET', contactListPath(listId), ownerB), 404);
    expectProblem(await call('PUT', contactListPath(listId), ownerB, { name: 'Roubada', contacts: [] }), 404);
    expectProblem(await call('DELETE', contactListPath(listId), ownerB), 404);
    expect(contactListDetailSchema.parse((await call('GET', contactListPath(listId), ownerA)).json()).name).toBe('Clientes de junho');
  });

  it('quem só visualiza vê as listas, mas não cria, altera nem exclui', async () => {
    expect(contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, viewerA)).json()).lists.length).toBeGreaterThan(0);
    expectProblem(await call('POST', CONTACT_LISTS_PATH, viewerA, { name: 'Nova', contacts: [] }), 403);
    expectProblem(await call('PUT', contactListPath(listId), viewerA, { name: 'Nova', contacts: [] }), 403);
    expectProblem(await call('DELETE', contactListPath(listId), viewerA), 403);
  });

  it('exclui de vez: os contatos saem do banco', async () => {
    expect((await call('DELETE', contactListPath(listId), ownerA)).statusCode).toBe(204);
    expectProblem(await call('GET', contactListPath(listId), ownerA), 404);
    const [left] = await services.database.db.select({ total: count() }).from(contacts).where(eq(contacts.listId, listId));
    expect(left?.total).toBe(0);
  });

  it('sem login: 401; outro site: 403; Super-Admin sem empresa: 403', async () => {
    expectProblem(await call('GET', CONTACT_LISTS_PATH, undefined), 401);
    const foreign = await app.inject({ method: 'POST', url: CONTACT_LISTS_PATH, headers: { origin: 'https://malicioso.test', cookie: ownerA, 'content-type': 'application/json' }, payload: { name: 'X', contacts: [] } });
    expectProblem(foreign, 403);
    expect(expectProblem(await call('GET', CONTACT_LISTS_PATH, superCookie), 403).detail).toContain('empresa');
  });
});

describe('página Contatos: gestão das listas', () => {
  // Empresa própria: as gravações não disputam o limite por minuto da Empresa A
  let ownerC: string;
  let viewerC: string;
  let listId: string;
  const detail = async (cookie = ownerC) => contactListDetailSchema.parse((await call('GET', contactListPath(listId), cookie)).json());
  const search = (q: string, cookie = ownerC) => call('GET', `${CONTACTS_SEARCH_PATH}?q=${encodeURIComponent(q)}`, cookie);

  beforeAll(async () => {
    ownerC = (await signupCompany('Empresa C')).cookie;
    viewerC = await memberOf('Dono Empresa C', 'viewer');
    const created = await call('POST', CONTACT_LISTS_PATH, ownerC, { name: 'Leads da feira', contacts: [] });
    expect(created.statusCode).toBe(201);
    listId = contactListSaveResultSchema.parse(created.json()).list.id;
  }, 60_000);

  it('adiciona no fim da lista: telefone validado de novo; os que já estão na lista e os repetidos ficam de fora', async () => {
    const first = contactsAddResultSchema.parse((await call('POST', contactListContactsPath(listId), ownerC, { contacts: [{ name: 'Ana', phone: '5511988887777' }, { name: 'Bruno', phone: '+55 21 99876-5432' }] })).json());
    expect(first).toMatchObject({ added: 2, list: { contactCount: 2 }, ignored: { invalid: 0, duplicate: 0, overLimit: 0 } });

    const second = contactsAddResultSchema.parse(
      (await call('POST', contactListContactsPath(listId), ownerC, {
        contacts: [
          { name: 'Ana outra vez', phone: '55 11 98888-7777' },
          { name: 'Carla', phone: '5531988887777' },
          { name: 'Carla de novo', phone: '5531988887777' },
          { name: 'Sem DDI', phone: '11988887777' },
        ],
      })).json(),
    );
    expect(second).toMatchObject({ added: 1, list: { contactCount: 3 }, ignored: { invalid: 1, duplicate: 2, overLimit: 0 } });
    expect((await detail()).contacts).toEqual([
      { name: 'Ana', phone: '5511988887777' },
      { name: 'Bruno', phone: '5521998765432' },
      { name: 'Carla', phone: '5531988887777' },
    ]);
    expect(expectProblem(await call('POST', contactListContactsPath(listId), ownerC, { contacts: [] }), 400).detail).toContain('Nenhum contato');
  });

  it('renomeia a lista (nome único na empresa)', async () => {
    const renamed = contactListSummarySchema.parse((await call('PATCH', contactListPath(listId), ownerC, { name: '  Leads   da feira 2026 ' })).json());
    expect(renamed).toMatchObject({ id: listId, name: 'Leads da feira 2026', contactCount: 3 });
    await call('POST', CONTACT_LISTS_PATH, ownerC, { name: 'Outra lista', contacts: [] });
    expect(expectProblem(await call('PATCH', contactListPath(listId), ownerC, { name: 'OUTRA LISTA' }), 409).detail).toContain('Já existe');
    expectProblem(await call('PATCH', contactListPath(listId), ownerC, { name: 'X' }), 400);
  });

  it('altera nome e telefone de um contato; recusa número inválido, número que já está na lista e contato inexistente', async () => {
    const edited = contactUpdateResultSchema.parse((await call('PATCH', contactListContactsPath(listId), ownerC, { phone: '5521998765432', name: 'Bruno Souza', newPhone: '+55 (21) 99876-0000' })).json());
    expect(edited.contact).toEqual({ name: 'Bruno Souza', phone: '5521998760000' });
    expect((await detail()).contacts[1]).toEqual({ name: 'Bruno Souza', phone: '5521998760000' });

    expect(expectProblem(await call('PATCH', contactListContactsPath(listId), ownerC, { phone: '5521998760000', name: 'Bruno', newPhone: '21998760000' }), 400).detail).toContain('Telefone inválido');
    expect(expectProblem(await call('PATCH', contactListContactsPath(listId), ownerC, { phone: '5521998760000', name: 'Bruno', newPhone: '5511988887777' }), 409).detail).toContain('já está na lista');
    expectProblem(await call('PATCH', contactListContactsPath(listId), ownerC, { phone: '5599999999999', name: 'Ninguém', newPhone: '5599999999999' }), 404);
  });

  it('remove de vez os contatos escolhidos', async () => {
    const removed = contactsRemoveResultSchema.parse((await call('POST', contactListRemoveContactsPath(listId), ownerC, { phones: ['5511988887777', '5531988887777', '5599999999999'] })).json());
    expect(removed).toMatchObject({ removed: 2, list: { contactCount: 1 } });
    expect((await detail()).contacts).toEqual([{ name: 'Bruno Souza', phone: '5521998760000' }]);
    const [left] = await services.database.db.select({ total: count() }).from(contacts).where(and(eq(contacts.listId, listId), eq(contacts.phoneE164, '5511988887777')));
    expect(left?.total).toBe(0);
    expectProblem(await call('POST', contactListRemoveContactsPath(listId), ownerC, { phones: [] }), 400);
  });

  it('busca em todas as listas da empresa: parte do nome (sem diferenciar maiúsculas) ou do telefone; curingas são texto comum', async () => {
    await call('POST', contactListContactsPath(listId), ownerC, { contacts: [{ name: 'Daniela 50%', phone: '5541988881234' }] });
    const other = contactListsResponseSchema.parse((await call('GET', CONTACT_LISTS_PATH, ownerC)).json()).lists.find((list) => list.name === 'Outra lista');
    await call('POST', contactListContactsPath(other?.id ?? ''), ownerC, { contacts: [{ name: 'Daniel', phone: '5541977770000' }] });

    const byName = contactSearchResponseSchema.parse((await search('DANI')).json());
    expect(byName.results.map((r) => [r.listName, r.name])).toEqual([
      ['Leads da feira 2026', 'Daniela 50%'],
      ['Outra lista', 'Daniel'],
    ]);
    expect(byName.truncated).toBe(false);
    expect(contactSearchResponseSchema.parse((await search('8881-234')).json()).results).toEqual([{ listId, listName: 'Leads da feira 2026', name: 'Daniela 50%', phone: '5541988881234' }]);
    // "%" e "_" não funcionam como curinga
    expect(contactSearchResponseSchema.parse((await search('0%')).json()).results.map((r) => r.name)).toEqual(['Daniela 50%']);
    expect(contactSearchResponseSchema.parse((await search('__')).json()).results).toEqual([]);
    expect(expectProblem(await search('a'), 400).detail).toContain('pelo menos 2');
  });

  it('a busca e a gestão nunca cruzam empresas; quem só visualiza busca e lê, mas não altera', async () => {
    // A Empresa A tem "Ana" e "Bruno", mas a busca da Empresa C não os vê, e vice-versa
    expect(contactSearchResponseSchema.parse((await search('Daniel', ownerA)).json()).results).toEqual([]);
    expectProblem(await call('PATCH', contactListPath(listId), ownerB, { name: 'Roubada' }), 404);
    expectProblem(await call('POST', contactListContactsPath(listId), ownerB, { contacts: [{ name: 'Intruso', phone: '5511900001111' }] }), 404);
    expectProblem(await call('PATCH', contactListContactsPath(listId), ownerB, { phone: '5521998760000', name: 'X', newPhone: '5521998760000' }), 404);
    expectProblem(await call('POST', contactListRemoveContactsPath(listId), ownerB, { phones: ['5521998760000'] }), 404);

    expect(contactSearchResponseSchema.parse((await search('Bruno', viewerC)).json()).results).toHaveLength(1);
    expect((await detail(viewerC)).contacts.length).toBe(2);
    expectProblem(await call('PATCH', contactListPath(listId), viewerC, { name: 'Nova' }), 403);
    expectProblem(await call('POST', contactListContactsPath(listId), viewerC, { contacts: [{ name: 'X', phone: '5511900001111' }] }), 403);
    expectProblem(await call('PATCH', contactListContactsPath(listId), viewerC, { phone: '5521998760000', name: 'X', newPhone: '5521998760000' }), 403);
    expectProblem(await call('POST', contactListRemoveContactsPath(listId), viewerC, { phones: ['5521998760000'] }), 403);
    expect((await detail()).contacts.length).toBe(2);
    expectProblem(await call('GET', `${CONTACTS_SEARCH_PATH}?q=Bruno`, undefined), 401);
  });

  it('ao adicionar, a lista para em 10.000 contatos: o excedente fica de fora e é informado', async () => {
    const many = Array.from({ length: 9_999 }, (_, i) => ({ name: '', phone: `55119${String(i).padStart(8, '0')}` }));
    const big = contactListSaveResultSchema.parse((await call('POST', CONTACT_LISTS_PATH, ownerC, { name: 'Quase cheia', contacts: many })).json()).list.id;
    const result = contactsAddResultSchema.parse((await call('POST', contactListContactsPath(big), ownerC, { contacts: [{ name: 'Cabe', phone: '5521911110001' }, { name: 'Não cabe', phone: '5521911110002' }, { name: 'Também não', phone: '5521911110003' }] })).json());
    expect(result).toMatchObject({ added: 1, list: { contactCount: 10_000 }, ignored: { overLimit: 2 } });
  }, 60_000);
});

// PNG de 1×1 pixel, fictício
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function upload(cookie: string, bytes: Buffer, type = 'image/png') {
  return app.inject({ method: 'POST', url: MEDIA_PATH, remoteAddress: `10.8.1.${++address % 250}`, headers: { origin: PANEL, cookie, 'content-type': type }, payload: bytes });
}

describe('imagens e modelos de mensagem', () => {
  let mediaA: string;
  let templateA: string;

  it('imagem: guarda um PNG de verdade (o mesmo arquivo de novo não duplica) e recusa o que não é imagem ou passa de 5 MB', async () => {
    const response = await upload(ownerA, PNG);
    expect(response.statusCode).toBe(201);
    const media = mediaFileSchema.parse(response.json());
    mediaA = media.id;
    expect(media).toMatchObject({ mimeType: 'image/png', size: PNG.length });
    expect(mediaFileSchema.parse((await upload(ownerA, PNG)).json()).id).toBe(mediaA);

    expect(expectProblem(await upload(ownerA, Buffer.from('não sou uma imagem')), 415).detail).toContain('JPG, PNG ou WebP');
    expectProblem(await upload(ownerA, PNG, 'application/pdf'), 415);
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expectProblem(await upload(ownerA, huge), 413);
  });

  it('imagem: a empresa vê a sua; outra empresa não; quem só visualiza não envia', async () => {
    const own = await call('GET', mediaPath(mediaA), ownerA);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(own.rawPayload.equals(PNG)).toBe(true);
    expectProblem(await call('GET', mediaPath(mediaA), ownerB), 404);
    expectProblem(await upload(viewerA, PNG), 403);
  });

  it('modelo: guarda imagem, texto, CTA e variações (as vazias saem); valida o CTA; nome único na empresa', async () => {
    const input = { name: 'Promoção de novembro', body: 'Olá {nome}! *20% de desconto*', variations: ['Oi {nome}, tudo bem?', '   '], mediaId: mediaA, ctaText: 'Quero aproveitar', ctaUrl: 'https://loja.exemplo.test/promo' };
    const response = await call('POST', MESSAGE_TEMPLATES_PATH, ownerA, input);
    expect(response.statusCode).toBe(201);
    const template = messageTemplateSchema.parse(response.json());
    templateA = template.id;
    expect(template).toMatchObject({ name: 'Promoção de novembro', variations: ['Oi {nome}, tudo bem?'], mediaId: mediaA, ctaText: 'Quero aproveitar', ctaUrl: 'https://loja.exemplo.test/promo' });

    expect(expectProblem(await call('POST', MESSAGE_TEMPLATES_PATH, ownerA, { ...input, name: 'Outro', ctaUrl: '' }), 400).detail).toContain('link do CTA');
    expect(expectProblem(await call('POST', MESSAGE_TEMPLATES_PATH, ownerA, { ...input, name: 'Outro', ctaUrl: 'javascript:alert(1)' }), 400).detail).toContain('https://');
    expect(expectProblem(await call('POST', MESSAGE_TEMPLATES_PATH, ownerA, { ...input, name: 'PROMOÇÃO DE NOVEMBRO' }), 409).detail).toContain('Já existe');
    expect(messageTemplatesResponseSchema.parse((await call('GET', MESSAGE_TEMPLATES_PATH, viewerA)).json()).templates.map((t) => t.id)).toEqual([templateA]);
  });

  it('modelo: a imagem precisa ser da mesma empresa; a Empresa B não vê, não altera nem exclui; quem só visualiza só lê', async () => {
    expect(expectProblem(await call('POST', MESSAGE_TEMPLATES_PATH, ownerB, { name: 'Copiado', body: 'Oi', mediaId: mediaA }), 400).detail).toContain('imagem do modelo');
    expect(messageTemplatesResponseSchema.parse((await call('GET', MESSAGE_TEMPLATES_PATH, ownerB)).json()).templates).toEqual([]);
    expectProblem(await call('PUT', messageTemplatePath(templateA), ownerB, { name: 'Roubado', body: 'x' }), 404);
    expectProblem(await call('DELETE', messageTemplatePath(templateA), ownerB), 404);
    expectProblem(await call('POST', MESSAGE_TEMPLATES_PATH, viewerA, { name: 'Do visitante', body: 'Oi' }), 403);
  });

  it('modelo: atualiza (tirando o CTA) e exclui', async () => {
    const updated = messageTemplateSchema.parse((await call('PUT', messageTemplatePath(templateA), operatorA, { name: 'Promoção de dezembro', body: 'Oi {nome}', mediaId: mediaA })).json());
    expect(updated).toMatchObject({ id: templateA, name: 'Promoção de dezembro', ctaText: null, ctaUrl: null, variations: [] });
    expect((await call('DELETE', messageTemplatePath(templateA), ownerA)).statusCode).toBe(204);
    expectProblem(await call('DELETE', messageTemplatePath(templateA), ownerA), 404);
  });

  it('envio com imagem: vai para /send/media em base64 puro, com o texto (e o CTA) como legenda', async () => {
    const caption = 'Olá Ana!\n\n👉 Quero aproveitar: https://loja.exemplo.test/promo';
    const response = await call('POST', MESSAGING_SEND_PATH, ownerA, { instanceId: instanceA, phone: '5511988887777', text: caption, mediaId: mediaA });
    expect(sendTextResultSchema.parse(response.json())).toEqual({ ok: true, messageId: '3EB1000001' });
    expect(sim.sentMedia.at(-1)).toEqual({ instance: simNameA, number: '5511988887777', base64: PNG.toString('base64'), caption });
    expect(expectProblem(await call('POST', MESSAGING_SEND_PATH, ownerA, { instanceId: instanceA, phone: '5511988887777', text: 'Oi', mediaId: 'nao-existe' }), 404).detail).toContain('Imagem não encontrada');
  });
});

describe('envio de texto', () => {
  it('envia pela instância da empresa: número validado de novo, nada técnico na resposta', async () => {
    const response = await send(operatorA, '+55 11 98888-7777', 'Olá Ana! Tudo bem?');
    expect(sendTextResultSchema.parse(response.json())).toEqual({ ok: true, messageId: '3EB0000001' });
    expect(sim.sent.at(-1)).toEqual({ instance: simNameA, number: '5511988887777', text: 'Olá Ana! Tudo bem?' });
    const token = sim.byName(simNameA)?.token ?? '§';
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(GLOBAL_KEY);
    expect(response.body).not.toContain('dz_');
  });

  it('número sem WhatsApp: falha só deste contato, com mensagem fixa (o texto da Evolution não vaza)', async () => {
    sim.unregistered.add('5511977776666');
    const response = await send(ownerA, '5511977776666');
    expect(sendTextResultSchema.parse(response.json())).toMatchObject({ ok: false, reason: 'invalid_number', stop: false });
    expect(response.body).not.toContain('is not registered');
  });

  it('valida antes de chamar a Evolution: telefone pela regra do MVP, mensagem vazia ou longa demais', async () => {
    const before = sim.sent.length;
    expect(expectProblem(await send(ownerA, '11988887777'), 400).detail).toContain('DDI 55');
    expect(expectProblem(await send(ownerA, '5511988887777', '   '), 400).detail).toContain('vazia');
    expect(expectProblem(await send(ownerA, '5511988887777', 'x'.repeat(4097)), 400).detail).toContain('4096');
    expect(sim.sent.length).toBe(before);
  });

  it('instância de outra empresa: 404; quem só visualiza: 403', async () => {
    expectProblem(await send(ownerB, '5511988887777'), 404);
    expectProblem(await send(viewerA, '5511988887777'), 403);
  });

  it('instância desconectada: pede para parar o disparo e a página WhatsApp passa a mostrar "Desconectado"', async () => {
    sim.drop(simNameA);
    expect(sendTextResultSchema.parse((await send(ownerA, '5511988887777')).json())).toMatchObject({ ok: false, reason: 'instance_disconnected', stop: true });
    const [row] = await services.database.db.select().from(whatsappInstances).where(and(eq(whatsappInstances.id, instanceA)));
    expect(row?.status).toBe('disconnected');
    sim.scan(simNameA);
  });

  it('Evolution fora do ar: falha deste envio, sem detalhes internos', async () => {
    await sim.stop();
    const response = await send(ownerA, '5511988887777');
    expect(sendTextResultSchema.parse(response.json())).toMatchObject({ ok: false, reason: 'unreachable', stop: false });
    expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    await sim.start();
    await call('PUT', EVOLUTION_SETTINGS_PATH, superCookie, { name: 'Servidor principal', baseUrl: sim.url, status: 'active' });
  });

  it('no máximo 60 envios por minuto para a mesma instância', async () => {
    let accepted = 0;
    let limited: LightMyRequestResponse | null = null;
    for (let i = 0; i < 70 && !limited; i++) {
      const response = await send(ownerA, '5511988887777');
      if (response.statusCode === 429) limited = response;
      else accepted++;
    }
    expect(limited).not.toBeNull();
    expect(accepted).toBeLessThanOrEqual(60);
    expect(expectProblem(limited as LightMyRequestResponse, 429).detail).toContain('intervalo');
  });
});
