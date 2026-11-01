import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { healthLiveSchema, PROBLEM_CONTENT_TYPE, problemDetailsSchema } from '@disparazap/contracts';
import { loadApiConfig } from '../config/env.ts';
import { buildApp } from './build-app.ts';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function captureLogs() {
  const lines: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, logStream };
}

async function makeApp(env: Record<string, string> = {}, setup?: (app: FastifyInstance) => void) {
  const { lines, logStream } = captureLogs();
  const app = await buildApp(loadApiConfig({ LOG_LEVEL: 'info', ...env }), { logStream });
  setup?.(app);
  await app.ready();
  apps.push(app);
  return { app, logs: lines };
}

function expectProblem(body: string, status: number) {
  const parsed = problemDetailsSchema.parse(JSON.parse(body));
  expect(parsed.status).toBe(status);
  expect(body).not.toMatch(/stack|\bat \w+ \(|node_modules|\.ts:\d+/);
  return parsed;
}

describe('GET /health/live', () => {
  it('responde só o contrato público, com cabeçalhos de segurança', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(healthLiveSchema.parse(res.json())).toMatchObject({ status: 'ok', service: 'disparazap-api' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('não aceita id de requisição vindo do cliente', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/live', headers: { 'request-id': 'forjado', 'x-request-id': 'forjado' } });
    expect(res.headers['x-request-id']).not.toBe('forjado');
  });
});

describe('tratamento centralizado de erros (RFC 9457)', () => {
  it('rota inexistente → 404 sem detalhes internos', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/nao-existe?token=abc' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    const problem = expectProblem(res.body, 404);
    expect(problem.instance).toBe('/nao-existe');
  });

  it('/api/v1 existe como prefixo, ainda sem rotas', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/contatos' });
    expect(res.statusCode).toBe(404);
    expectProblem(res.body, 404);
  });

  it('exceção inesperada → 500 genérico; mensagem e stack ficam só no log do servidor', async () => {
    const { app, logs } = await makeApp({}, (instance) => {
      instance.get('/__teste/falha', async () => {
        throw new Error('falha interna com senha=segredo-123');
      });
    });
    const res = await app.inject({ method: 'GET', url: '/__teste/falha' });
    expect(res.statusCode).toBe(500);
    const problem = expectProblem(res.body, 500);
    expect(problem.title).toBe('Erro interno');
    expect(res.body).not.toContain('segredo-123');
    expect(logs.join('')).toContain('erro não tratado');
  });

  it('erro de validação de schema → 400 sem repetir o dado enviado', async () => {
    const { app } = await makeApp({}, (instance) => {
      instance.post('/__teste/validacao', {
        schema: { body: { type: 'object', required: ['nome'], properties: { nome: { type: 'string', minLength: 3 } } } },
      }, async () => ({ ok: true }));
    });
    const res = await app.inject({ method: 'POST', url: '/__teste/validacao', payload: { nome: 'x', extra: 'valor-enviado' } });
    expect(res.statusCode).toBe(400);
    const problem = expectProblem(res.body, 400);
    expect(problem.detail).toBe('Os dados enviados não passaram na validação.');
    expect(res.body).not.toContain('valor-enviado');
  });

  it('JSON malformado → 400; tipo de conteúdo desconhecido → 415; corpo grande → 413', async () => {
    const { app } = await makeApp({}, (instance) => {
      instance.post('/__teste/eco', async () => ({ ok: true }));
    });
    const malformado = await app.inject({ method: 'POST', url: '/__teste/eco', headers: { 'content-type': 'application/json' }, payload: '{"a":' });
    expectProblem(malformado.body, 400);
    const tipo = await app.inject({ method: 'POST', url: '/__teste/eco', headers: { 'content-type': 'application/x-desconhecido' }, payload: 'x' });
    expectProblem(tipo.body, 415);
    const grande = await app.inject({ method: 'POST', url: '/__teste/eco', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ a: 'x'.repeat(1024 * 1024 + 10) }) });
    expectProblem(grande.body, 413);
  });
});

describe('CORS restritivo', () => {
  const preflight = (origin: string) => ({
    method: 'OPTIONS' as const,
    url: '/health/live',
    headers: { origin, 'access-control-request-method': 'GET' },
  });

  it('sem configuração, nenhuma origem externa recebe permissão', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/live', headers: { origin: 'https://site-qualquer.test' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('só a origem cadastrada recebe permissão', async () => {
    const { app } = await makeApp({ API_CORS_ORIGINS: 'https://painel.exemplo.test' });
    const permitida = await app.inject(preflight('https://painel.exemplo.test'));
    expect(permitida.headers['access-control-allow-origin']).toBe('https://painel.exemplo.test');
    const negada = await app.inject(preflight('https://malicioso.test'));
    expect(negada.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('logs', () => {
  it('não registram cabeçalhos sensíveis nem query string', async () => {
    const { app, logs } = await makeApp();
    await app.inject({
      method: 'GET',
      url: '/rota-qualquer?token=token-na-url&senha=senha-na-url',
      headers: { authorization: 'Bearer token-no-cabecalho', cookie: 'sessao=cookie-secreto', 'x-api-key': 'chave-no-cabecalho' },
    });
    const out = logs.join('');
    expect(out).toContain('/rota-qualquer');
    for (const segredo of ['token-na-url', 'senha-na-url', 'token-no-cabecalho', 'cookie-secreto', 'chave-no-cabecalho']) {
      expect(out).not.toContain(segredo);
    }
  });
});

describe('inicialização', () => {
  it('escuta só em 127.0.0.1 por padrão e responde ao health check', async () => {
    const { lines, logStream } = captureLogs();
    const app = await buildApp(loadApiConfig({ API_PORT: '0' }), { logStream });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('endereço inesperado');
    expect(address.address).toBe('127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${address.port}/health/live`);
    expect(res.status).toBe(200);
    expect(lines.join('')).toContain('Server listening');
  });
});
