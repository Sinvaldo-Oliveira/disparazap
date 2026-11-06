import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigError } from '@disparazap/shared';
import { pathOnly } from './logger.ts';

/**
 * Painel já compilado (apps/web/dist) servido pela própria API, na mesma origem — para hospedagens com um só processo
 * Node (ex.: aplicativo Node.js da Hostinger). Em desenvolvimento quem serve o painel é o Vite; aqui fica desligado.
 */

/** Política de conteúdo do painel: tudo da própria origem; imagens também de data: (ícone) e blob: (pré-visualização) */
export const PANEL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Só estes tipos são servidos. Mapas de código-fonte (.map) e qualquer outra extensão ficam de fora.
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface PanelFile {
  body: Buffer;
  type: string;
  etag: string;
  /** Arquivos com hash no nome (assets/): podem ficar no cache do navegador para sempre */
  immutable: boolean;
}

export type PanelFiles = ReadonlyMap<string, PanelFile>;

/**
 * Lê o painel para a memória na inicialização. Depois disso, um pedido só recebe um arquivo desta lista
 * (comparação exata do caminho): não há como sair da pasta nem ler arquivos ocultos.
 */
export function loadPanelFiles(distDir: string): PanelFiles {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new ConfigError(['WEB_DIST_DIR: a pasta do painel não tem index.html (gere com npm run build)']);
  }
  const files = new Map<string, PanelFile>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Atalhos (symlinks) e tipos desconhecidos ficam de fora
      const type = CONTENT_TYPES[extname(entry.name).toLowerCase()];
      if (!entry.isFile() || !type) continue;
      const urlPath = `/${relative(distDir, full).split(sep).join('/')}`;
      const body = readFileSync(full);
      files.set(urlPath, {
        body,
        type,
        etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
        immutable: urlPath.startsWith('/assets/'),
      });
    }
  };
  walk(distDir);
  return files;
}

const API_PATH = /^\/(api|health)(\/|$)/;

/** Último trecho do caminho com extensão (ex.: /assets/x.js): é pedido de arquivo, não de página */
const looksLikeFile = (path: string) => /\.[^/]+$/.test(path);

/**
 * Para o "não encontrado": devolve o arquivo do painel ou, para rotas da aplicação (ex.: /contatos/123),
 * o index.html (o React Router decide a página). Rotas da API, arquivos inexistentes e outros métodos seguem para o 404.
 */
export function panelFallback(files: PanelFiles) {
  const index = files.get('/index.html');
  return (request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
    const path = pathOnly(request.url);
    if (API_PATH.test(path)) return undefined;
    const file = files.get(path) ?? (looksLikeFile(path) ? undefined : index);
    if (!file) return undefined;
    reply.header('etag', file.etag);
    reply.header('cache-control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (file.type.startsWith('text/html')) reply.header('content-security-policy', PANEL_CSP);
    if (request.headers['if-none-match'] === file.etag) return reply.status(304).send();
    return reply.status(200).type(file.type).send(file.body);
  };
}
