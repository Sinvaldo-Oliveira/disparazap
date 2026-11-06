import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '@disparazap/contracts';
import { ConfigError } from '@disparazap/shared';
import { buildApp } from '../app/build-app.ts';
import { loadApiConfig } from '../config/env.ts';
import { PANEL_CSP } from './web-panel.ts';

// Painel de mentira numa pasta temporária: index.html, um arquivo com hash, o mapa de código-fonte e um arquivo oculto
const INDEX = '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-a1b2.js"></script></body></html>';
const SCRIPT = 'console.log("painel")';
let dist: string;
let app: FastifyInstance;

const base = { NODE_ENV: 'test', LOG_LEVEL: 'silent' };

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'dz-painel-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'assets', 'app-a1b2.js'), SCRIPT);
  writeFileSync(join(dist, 'assets', 'app-a1b2.js.map'), '{"sources":["segredo-do-codigo.ts"]}');
  writeFileSync(join(dist, '.env'), 'NAO_PODE_SAIR=1');
  app = await buildApp(loadApiConfig({ ...base, WEB_DIST_DIR: dist }));
});

afterAll(async () => {
  await app?.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('painel servido pela API (WEB_DIST_DIR)', () => {
  it.each(['/', '/contatos', '/contatos/123', '/envio-de-mensagens'])('%s devolve o index.html com CSP e sem cache', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe(INDEX);
    expect(response.headers['content-security-policy']).toBe(PANEL_CSP);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('arquivo com hash: tipo certo, cache longo e 304 quando o navegador já tem', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app-a1b2.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.body).toBe(SCRIPT);
    const again = await app.inject({ method: 'GET', url: '/assets/app-a1b2.js', headers: { 'if-none-match': String(response.headers.etag) } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it.each([
    ['mapa de código-fonte', '/assets/app-a1b2.js.map'],
    ['arquivo oculto', '/.env'],
    ['arquivo inexistente', '/assets/nao-existe.js'],
    ['subir de pasta', '/assets/..%2f..%2fpackage.json'],
    ['subir de pasta (barra)', '/../package.json'],
  ])('%s: 404 em JSON, sem conteúdo do disco', async (_label, url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.body).not.toContain('segredo-do-codigo');
    expect(response.body).not.toContain('NAO_PODE_SAIR');
  });

  it('rotas da API e outros métodos continuam com o 404 da API (nunca o index.html)', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/nao-existe'],
      ['GET', '/api'],
      ['GET', '/health/nao-existe'],
      ['POST', '/contatos'],
      ['DELETE', '/'],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    }
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toMatchObject({ status: 'ok' });
  });

  it('sem WEB_DIST_DIR (desenvolvimento): a API não serve painel nenhum', async () => {
    const apiOnly = await buildApp(loadApiConfig(base));
    const response = await apiOnly.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.headers['cache-control']).toBe('no-store');
    await apiOnly.close();
  });

  it('pasta sem index.html: a API não sobe e diz por quê', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dz-vazio-'));
    await expect(buildApp(loadApiConfig({ ...base, WEB_DIST_DIR: empty }))).rejects.toBeInstanceOf(ConfigError);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('atrás de proxy reverso e em produção', () => {
  async function clientIp(trustProxy: string, forwardedFor: string, remoteAddress = '10.0.0.1') {
    const instance = await buildApp(loadApiConfig({ ...base, API_TRUST_PROXY: trustProxy }));
    instance.get('/ip-de-teste', (request) => ({ ip: request.ip }));
    const response = await instance.inject({ method: 'GET', url: '/ip-de-teste', remoteAddress, headers: { 'x-forwarded-for': forwardedFor } });
    await instance.close();
    return (response.json() as { ip: string }).ip;
  }

  it('API_TRUST_PROXY=true: com o proxy num endereço interno, o IP do visitante vem dele (o que o visitante escreveu antes não vale)', async () => {
    expect(await clientIp('true', '203.0.113.7')).toBe('203.0.113.7');
    expect(await clientIp('true', '203.0.113.7', '127.0.0.1')).toBe('203.0.113.7');
    // O visitante tenta se passar por outro IP: vale o que o proxy viu (o último da lista)
    expect(await clientIp('true', '198.51.100.99, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('API_TRUST_PROXY=true: quem chega direto pela internet (fora do proxy) não escolhe o próprio IP', async () => {
    expect(await clientIp('true', '198.51.100.99', '203.0.113.50')).toBe('203.0.113.50');
  });

  it('API_TRUST_PROXY com a lista exata do proxy; valor inválido impede o início', async () => {
    expect(await clientIp('192.0.2.10', '203.0.113.7', '192.0.2.10')).toBe('203.0.113.7');
    expect(await clientIp('192.0.2.10', '203.0.113.7', '192.0.2.11')).toBe('192.0.2.11');
    expect(() => loadApiConfig({ ...base, API_TRUST_PROXY: 'sim' })).toThrow(ConfigError);
  });

  it('padrão (sem proxy): o cabeçalho X-Forwarded-For é ignorado', async () => {
    expect(await clientIp('false', '203.0.113.7')).toBe('10.0.0.1');
  });

  it('produção: HSTS em toda resposta; fora de produção, não', async () => {
    const production = await buildApp(
      loadApiConfig({
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://usuario:senha@banco.exemplo.test:5432/postgres',
        DATABASE_CA_FILE: 'certificado-de-exemplo.crt',
        AUTH_SECRET: randomBytes(36).toString('base64url'),
        SECRETS_MASTER_KEY: randomBytes(32).toString('base64url'),
        AUTH_BASE_URL: 'https://painel.exemplo.test',
      }),
    );
    expect((await production.inject({ method: 'GET', url: '/health/live' })).headers['strict-transport-security']).toBe('max-age=31536000');
    await production.close();
    expect((await app.inject({ method: 'GET', url: '/health/live' })).headers['strict-transport-security']).toBeUndefined();
  });
});
